import './style.css';
import './design.css';
import './motion.css';
import './keepsake.css';
import lettering from './ui/wordmark.svg?raw';
import { levels, createState, step, simulate, switches, validateScore, starsFor, TICK_MS } from './game/sim';
import { createRenderer } from './game/render';
import { createAudio } from './game/audio';
import { loadSave, persist, recordBest, escapeHtml as esc, shortAddress, type SavedRun } from './ui/storage';
import type { Keepsake } from './ui/card';
import * as chain from './chain/lazy';
import deployment from './chain/deployment.json';
import seedData from '../../shared/seeds.json';
import solutionData from '../../shared/solutions.json';

type Mode = 'ready' | 'recording' | 'playing' | 'replay' | 'result';
type Solution = { level: number; seedKey?: string; score: number[]; inputs: number[] };
const solutions = solutionData as Solution[];
const numerals = ['一', '二', '三', '四', '五'];
const icon = (name: string) => {
  const paths: Record<string, string> = {
    start:'M8 5l11 7-11 7z', record:'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
    restart:'M4 10a8 8 0 1 1 2 8M4 4v6h6', edit:'M4 20l4-1L20 7l-3-3L5 16z',
    replay:'M9 5L2 12l7 7V5zM20 5l-7 7 7 7V5z', next:'M5 12h14m-6-6 6 6-6 6',
    submit:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6', borrow:'M4 8h14m-4-4 4 4-4 4M20 16H6m4-4-4 4 4 4',
    card:'M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9.5 8.5h5M9.5 12.5h5',
  };
  return paths[name] ? `<svg class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>` : '';
};
const mechanics = ['录光与过桥', '两次换灯', '等一场退潮', '借陌生人的光', '带灯笼回家'];
const seedLights: chain.Light[] = seedData.map(s => ({ id: '0', author: '陌生人', score: s.score, borrowCount: 0, seedKey: s.key, label: s.label }));
const save = loadSave();
let screen: 'map' | 'game' = 'map';
let level = levels[0];
let mode: Mode = 'ready';
let state = createState(level);
let previousX = state.x;
let score: number[] = [];
let borrowed: chain.Light = seedLights[0];
let pool: chain.Light[] = [...seedLights];
let selectedLamp = 1;
let selectedCell = -1;
let preview: { beat: number; lamp: number } | null = null;
let triedFirstSwitch = false;
let borrowStartedAt = -Infinity;
let repairHint = '';
let inputLog: number[] = [];
let lastAttempt: { score: number[]; borrowed: number[]; inputs: number[]; borrowedLight?: chain.Light } | null = null;
let playback: number[] = [];
let replayBorrowed: number[] = [];
// The optional paper boat is a local collectible. During pickup the recorded feet stand still.
function playableLevel(id: number) {
  const base = levels[id - 1];
  return id === 2 ? { ...base, hasItem: true, itemX: 2750, itemRadius: 200, itemTicks: 12 } : base;
}
let checkpoint: typeof state | null = null;
let stoneAvailable = false;
let liveLamp = false;
let checkpointManual = false;
const desktop = matchMedia('(min-width:1000px)');
let waitingForTide = false;
let stallLit = false;
let checkpointStall = false;
const stallX = 8650;
function safeDeparture() {
  const tide = level.gaps.find(g => g.kind === 'tide')!;
  for (let x = state.x + level.speed, t = state.tick; x < tide.b; x += level.speed, t++) {
    if (x > tide.a && ((tide.mask >>> Math.floor(t / level.beatTicks)) & 1) === 0) return false;
  }
  return true;
}
function borrowRoute(light: chain.Light) {
  return light.score.filter((lamp, i) => !i || lamp !== light.score[i - 1]).map(lamp => '桥' + numerals[lamp - 1]).join(' → ');
}
let rehearsal = false;
let isDemo = false;
let paused = false;
let awaitingStep = false;
let recordTick = 0;
let clockTick = 0;
let practice = false;
let accumulator = 0;
let lastTime = performance.now();
let lastBeat = -1;
let dialogWasPaused = false;
let previousFocus: HTMLElement | null = null;
let txBusy = false;
let txView = '';
let poolBusy = false;
let toastTimer: ReturnType<typeof setTimeout>;
let freshTimer: ReturnType<typeof setTimeout>;
let resultNote = '';
let trail: number[] = [];
let echoTold = 0;
const held = new Set<string>();
let interactionQueued = false;
const audio = createAudio();
audio.setEnabled(save.sound);
audio.setMusic(save.music !== false);

const wordmark = '<span class="visually-hidden">光的回声</span><span class="wordmark" aria-hidden="true">' +
  ['guang', 'de', 'hui', 'sheng'].map(id => `<svg viewBox="0 0 64 52" focusable="false"><use href="#glyph-${id}"/></svg>`).join('') + '</span>';
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `${lettering}
  <div class="shell">
    <header class="header">
      <button class="brand" data-action="map" aria-label="光的回声，返回关卡地图"><span class="seal" aria-hidden="true">光</span><span class="brand-title">${wordmark}</span><span class="brand-note">雨夜掌灯人</span></button>
      <nav class="head-actions" aria-label="游戏工具">
        <button class="quiet" data-action="sound" id="sound-button">声音 · 关</button>
        <button class="quiet help-button" data-action="help">玩法</button>
        <button class="wallet-button" data-action="connect" id="wallet-button"><i class="status-dot"></i>连接钱包</button>
      </nav>
    </header>
    <main>
      <section class="map" id="map" aria-label="五关雨夜地图">
        <div class="map-bg" aria-hidden="true"></div>
        <div class="map-content">
          <div class="map-intro"><h1 class="map-title">${wordmark}</h1><p>在骑楼上留一段光，再下楼，沿着它过桥。<br>下一场雨里，也许有人会借走你的光。</p></div>
          <div class="lantern-string"><svg class="wire" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true"><path d="M-10 6 Q500 140 1010 6"/></svg><div class="lanterns" id="lanterns"></div></div>
          <div class="map-bottom"><p id="map-progress">从第一盏灯开始。</p><div class="actions"><button class="quiet" data-action="recent" id="recent-button" hidden>上次通关</button><button class="quiet" data-action="practice" id="practice-button">自由练习</button><button class="primary" data-action="continue" id="continue-button">点亮第一盏灯</button></div></div>
        </div>
      </section>
      <section id="game" hidden aria-label="掌灯过桥">
        <div class="game-title"><button class="quiet back" data-action="map">‹ 回到长街</button><span class="route-label" id="route-label"></span><button class="quiet back" data-action="board">本关灯榜</button></div>
        <div class="frame">
          <canvas id="scene" class="scene" width="1120" height="460" aria-label="雨夜骑楼与纸桥。使用方向键过桥，E键拾取。"></canvas>
          <div class="scene-top"><div><h2 id="place"></h2><p id="subtitle"></p></div><span id="badge" class="badge">在楼上掌灯</span></div>
          <div id="cross-cue" class="cross-cue" role="status" hidden></div>
          <div class="scene-bottom"><span id="scene-item"></span><span id="scene-clock">0.0 秒</span></div>
          <div id="pause-screen" class="pause-screen" hidden><h2>雨替你停一会儿。</h2><p>灯谱与脚步都已暂停</p><button class="primary" data-action="resume">继续过桥</button></div>
        </div>
        <section class="console" aria-label="灯谱控制台">
          <div class="control-top"><div class="control-copy"><h3 id="hint-title"></h3><p id="hint-text"></p></div><div class="crossing-strip" id="crossing-strip" aria-label="本夜路线"></div><div id="actions" class="actions"></div><p class="desk-keys" id="desk-keys"></p></div>
          <div class="timeline-head"><span class="legend" id="legend"></span><span class="metrics"><span id="oil"></span><span id="beat-info"></span><span id="par-info"></span><span id="item-info"></span></span><small id="timeline-clock"></small></div>
          <div class="timeline-scroll"><div class="score" id="own-track"></div><div class="timeline-scale" id="timeline-scale"></div></div>
          <div id="fault" class="fault-marker" hidden></div>
          <div class="console-bottom"><div class="lamp-tools" id="lamp-tools"></div><div class="move-tools" id="move-tools"><button data-move="left" aria-label="向左走，按住">← 左行</button><button data-move="interact" aria-label="拾取道具">E 拾取</button><button data-move="right" aria-label="向右走，按住">右行 →</button></div></div>
          <div class="console-foot"><div class="secondary-tools"><button class="quiet" data-action="reference">参考灯谱</button><button class="quiet" data-action="demo">看示范</button><button class="quiet" data-action="help">玩法</button><button class="quiet" data-action="pause" id="pause-button">暂停</button></div><div class="secondary-tools" id="borrow-tools"></div></div>
          <p class="reference-hint" id="reference-hint" hidden></p>
        </section>
        <section class="result" id="result" hidden aria-live="polite"></section>
        <div class="game-under"><span>掌灯：数字键　过桥：← → / A D　拾取：E　暂停：Esc</span><span id="game-network"></span></div>
      </section>
    </main>
    <footer class="footer"><span class="note feed" id="feed">一场雨，一盏灯。你的脚步，会成为可以验证的回声。</span><span class="network-label" id="network-label">离线可玩 · Monad 测试网</span></footer>
  </div>
  <dialog class="dialog" id="dialog" aria-labelledby="dialog-title"><div class="dialog-inner"><div class="panel-head"><h2 id="dialog-title"></h2><button class="quiet close" data-action="close-dialog" aria-label="关闭弹窗">×</button></div><div id="dialog-body"></div></div></dialog>
  <div class="toast" id="toast" role="status" hidden></div>`;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('scene');
const renderer = createRenderer(canvas);
const dialog = $<HTMLDialogElement>('dialog');
const button = (label: string, action: string, primary = false, disabled = false) => `<button data-action="${action}" class="${primary ? 'primary' : ''}" ${disabled ? 'disabled' : ''}>${icon(action)}<span>${label}</span></button>`;
const starText = (stars: number) => '★'.repeat(stars) + '☆'.repeat(3 - stars);
const borrowedScore = () => level.borrowable ? borrowed.score : [];
const canEdit = () => mode === 'ready' || mode === 'result';
const unlocked = (id: number) => practice || id === 1 || !!save.progress[id - 1] || !!save.progress[id];
function toast(message: string) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => $('toast').hidden = true, 4400); }
function updateHeader() {
  $('sound-button').innerHTML = `<i class="eq${audio.enabled && audio.musicEnabled ? ' on' : ''}" aria-hidden="true"><b></b><b></b><b></b></i>声音 · ${!audio.enabled ? '关' : audio.musicEnabled ? '全开' : '仅音效'}`;
  $('wallet-button').innerHTML = `<i class="status-dot ${chain.account ? 'connected' : ''}"></i>${chain.account ? shortAddress(chain.account) : '连接钱包'}`;
  $('game-network').textContent = chain.contractAddress ? 'Monad 测试网 · 通关可验证' : '本地试玩 · 通关自动保存';
  $('network-label').textContent = chain.contractAddress ? 'Monad 测试网' : '本地试玩 · 合约待部署';
}
function renderMap() {
  const next = levels.find(l => !save.progress[l.id])?.id || 5;
  const drops = [34, 58, 44, 66, 38];
  $('lanterns').innerHTML = levels.map((l, i) => {
    const p = save.progress[l.id]; const open = unlocked(l.id);
    const t = 0.1 + i * 0.2; const sag = (2 * (1 - t) * t * 140 + 6 * ((1 - t) ** 2 + t * t)) / 120;
    const state = p ? 'lit' : open ? 'open' : 'dark';
    return `<button class="lamp-stop ${state} ${l.id === next ? 'current' : ''}" style="--x:${t * 100}%;--sag:${sag};--drop:${drops[i]}px;--i:${i}" data-level="${l.id}" ${!open ? 'disabled' : ''} aria-label="第${numerals[l.id - 1]}夜 ${l.name}${!open ? '，尚未解锁' : p ? `，${p.stars}星` : ''}"><span class="cord" aria-hidden="true"></span><span class="lantern" aria-hidden="true">${numerals[l.id - 1]}</span>${l.id === 2 && p?.hasItem ? '<svg class="boat-charm" viewBox="0 0 32 24" aria-label="纸船"><path d="M16 0v8" stroke="#bea271"/><path d="M4 13l10 2 8-8v7l7-1-7 8H11z" fill="#ead8ab"/><path d="m4 13 13 5 12-5" fill="none" stroke="#947b58"/></svg>' : ''}<strong>${l.name}</strong><span class="mechanic">${l.id === 5 && save.marketLit ? '夜摊已点亮' : l.id === 2 && p?.hasItem ? '已带回纸船' : p ? `最快 ${(p.tick / 20).toFixed(2)} 秒` : open ? mechanics[l.id - 1] : '尚未点亮'}</span><span class="pips" aria-hidden="true">${[1, 2, 3].map(n => `<i class="${(p?.stars || 0) >= n ? 'on' : ''}"></i>`).join('')}</span></button>`;
  }).join('');
  const lit = Object.keys(save.progress).length;
  $('map').toggleAttribute('data-complete', lit === 5);
  const starTotal = Object.values(save.progress).reduce((s, p) => s + p.stars, 0);
  const boats = levels.filter(l => l.hasItem && !l.itemRequired);
  const found = boats.filter(l => save.progress[l.id]?.hasItem).length;
  const charms = [
    ...(boats.length ? [[`纸船 ${found} / ${boats.length}`, found === boats.length ? 'on' : found ? 'some' : '', '沿路可以拾起的纸船']] : []),
    ['夜摊', save.marketLit ? 'on' : '', '第五夜提着灯笼，点亮夜摊'],
    ['满星', starTotal === 15 ? 'on' : '', '五夜全部三星'],
  ];
  $('map-progress').innerHTML = lit ? `${lit === 5 ? '长街全亮' : `已点亮 ${lit} / 5 盏灯`} · ${starTotal} / 15 星<span class="charms">${charms.map(([name, tone, tip]) => `<i class="${tone}" title="${tip}">${name}</i>`).join('')}${lit === 5 ? `<button class="album" data-action="card-all">${icon('card')}五夜纪念卡</button>` : ''}</span>` : '无需钱包，即可开始。';
  $('continue-button').textContent = lit ? lit === 5 ? '再走一段雨夜' : `继续 · ${levels[next - 1].name}` : '点亮第一盏灯';
  $('practice-button').textContent = practice ? '返回逐关解锁' : '自由练习';
  $('recent-button').hidden = !save.recent;
}
function openLevel(id: number) {
  if (!unlocked(id)) return;
  liveLamp = false; waitingForTide = false; stallLit = false; checkpoint = null; stoneAvailable = false; rehearsal = false; level = playableLevel(id); screen = 'game'; mode = 'ready'; state = createState(level); previousX = state.x;
  document.body.dataset.scene = String(id);
  audio.setScene(id, level.beatTicks / 20); resultNote = ''; trail = [];
  canvas.setAttribute('aria-label', `${level.name}与纸桥。使用方向键过桥，E键拾取。`);
  preview = null; triedFirstSwitch = false; repairHint = ''; borrowStartedAt = -Infinity;
  selectedCell = -1; selectedLamp = 1; isDemo = false; inputLog = []; lastAttempt = null; paused = false; txView = '';
  const stored = save.scores[id];
  score = stored && stored.length === level.beats && stored.every(n => n >= 1 && n <= level.lampCount) ? [...stored] : Array(level.beats).fill(1);
  if (id !== 4 && !stored) score = [...solutions.find(s => s.level === id)!.score];
  held.clear(); interactionQueued = false; accumulator = 0; clockTick = 0; lastBeat = -1;
  // Hiding and showing the stage again replays its entrance, also between two nights.
  $('map').hidden = true; $('game').hidden = true; void $('game').offsetWidth; $('game').hidden = false; $('reference-hint').hidden = true;
  $('place').textContent = level.name; $('subtitle').textContent = level.subtitle; $('route-label').textContent = `第${numerals[id - 1]}夜 / 共五夜`;
  $('scene-item').textContent = level.id === 2 ? '第一座桥上有纸船 · 靠近按 E，留出约半秒拾取' : level.itemRequired ? '带上灯笼，风铃才会响' : level.hasItem ? '纸船可拾取，也可以留给雨' : '亮着的纸桥，才有落脚处';
  $('crossing-strip').innerHTML = `<small>今夜路标</small><div>${level.gaps.map((g,i) => `<span data-gate="${i}"><i></i>${g.kind === 'tide' ? '渡口' : '桥' + numerals[g.lamp-1]}</span>`).join('')}<span data-bell><i></i>风铃</span></div>`;
  renderAll();
  if (level.borrowable) { void refreshPool(); openBorrow(); }
}
function goMap() {
  if (dialog.open) closeDialog();
  screen = 'map'; paused = false; held.clear(); interactionQueued = false;
  delete document.body.dataset.scene;
  audio.setScene(0);
  $('game').hidden = true; $('map').hidden = false; renderMap();
}
function writeScore() { save.scores[level.id] = [...score]; persist(save); }
function showPreview(cell: HTMLElement | null) {
  const beat = Number(cell?.dataset.cell);
  const lamp = Number(cell?.dataset.row);
  preview = mode === 'ready' && Number.isInteger(beat) && lamp > 0 ? { beat, lamp } : null;
  for (const node of $('own-track').querySelectorAll('.preview')) node.classList.remove('preview');
  if (preview) cell?.classList.add('preview');
  updateClock();
}
function firstLesson() { return level.id === 1 && !save.progress[1] && !triedFirstSwitch && !repairHint; }
function sourceName(light: chain.Light) {
  if (light.id === '0') return '内置灯谱';
  if (deployment.seedIds.includes(light.id)) return '链上初始灯谱';
  return '玩家灯谱';
}
function renderTracks() {
  const editable = canEdit();
  const track = $('own-track');
  const lend = borrowedScore();
  track.style.setProperty('--beats', String(level.beats));
  track.style.setProperty('--cell-h', `${level.lampCount >= 5 ? 17 : level.lampCount >= 4 ? 20 : level.lampCount === 3 ? 24 : 30}px`);
  track.classList.toggle('locked', !editable);
  let cells = '<span class="beat-number" aria-hidden="true"></span>' + Array.from({length: level.beats}, (_, i) =>
    `<span class="beat-number" aria-hidden="true">${i + 1}</span>`).join('');
  for (let row = 1; row <= level.lampCount; row++) {
    cells += `<span class="row-label">桥${numerals[row - 1]}</span>`;
    for (let beat = 0; beat < level.beats; beat++) {
      const own = score[beat] === row; const lent = lend[beat] === row;
      cells += `<button class="cell ${mode === 'ready' && firstLesson() && beat === 7 && row === 2 ? 'lesson-beat' : ''} ${own ? 'own' : ''} ${lent ? 'lent' : ''} ${selectedCell === beat ? 'selected' : ''} ${beat % 4 === 0 ? 'bar' : ''}" data-cell="${beat}" data-row="${row}" tabindex="${row === score[Math.max(0, selectedCell)] && beat === Math.max(0, selectedCell) ? 0 : -1}" ${!editable ? 'disabled' : ''} aria-label="第${beat + 1}拍照桥${numerals[row - 1]}${own ? '，已选' : ''}${lent ? '，借来的光' : ''}"></button>`;
    }
  }
  const tide = level.gaps.find(g => g.kind === 'tide');
  if (tide) {
    cells += '<span class="row-label tide-label">潮</span>';
    for (let beat = 0; beat < level.beats; beat++) {
      const low = ((tide.mask >>> beat) & 1) === 1;
      cells += `<span class="tide-cell ${low ? 'low' : 'high'}" aria-label="第${beat + 1}拍${low ? '退潮' : '涨潮'}"></span>`;
    }
  }
  track.innerHTML = `${cells}<i class="cursor-line" id="cursor" hidden></i>`;
  $('legend').innerHTML = `<span class="key own">我的光</span>${level.borrowable ? `<span class="key lent">${esc(borrowed.id === '0' ? '内置灯谱' : shortAddress(borrowed.author))}的光</span>` : ''}${tide ? '<span class="key tide">涨潮</span>' : ''}`;
  const duration = level.beats * level.beatTicks / 20;
  $('timeline-scale').innerHTML = [0, .25, .5, .75, 1].map(f => `<span>${(f * duration).toFixed(1)} 秒</span>`).join('');
  $('lamp-tools').innerHTML = Array.from({ length: level.lampCount }, (_, i) => `<button class="lamp-button ${selectedLamp === i + 1 ? 'selected' : ''}" data-lamp="${i + 1}" aria-label="${i + 1} 照桥${numerals[i]}"><span class="lamp-glyph" aria-hidden="true">桥${numerals[i]}</span><kbd>${i + 1}</kbd></button>`).join('');
  $('lamp-tools').hidden = mode !== 'recording';
  $('borrow-tools').innerHTML = level.borrowable ? button('换一束光', 'borrow', false, !editable) + button('只掌灯，留光给别人', 'lend', false, !editable || txBusy || !validateScore(level, score)) : '';
  updateClock();
}
function renderControls() {
  if (level.id === 1) $('scene-item').textContent = liveLamp ? '掌灯手记 · 你按下的每一次换灯都会记进灯谱' : '亮着的桥才能走 · 石台上可以停步';
  const oil = switches(score); const valid = validateScore(level, score);
  const unlimited = level.maxSwitches >= level.beats - 1;
  $('oil').innerHTML = unlimited ? '' : `灯油 <strong class="${oil > level.maxSwitches ? 'danger' : ''}">${Math.max(0, level.maxSwitches - oil)}</strong>/${level.maxSwitches}${oil > level.maxSwitches ? '，换灯太多了' : ''}`;
  $('beat-info').innerHTML = `每拍 <strong>${(level.beatTicks / 20).toFixed(1)}</strong> 秒`;
  $('par-info').innerHTML = `三星 <strong>${(level.par3 / 20).toFixed(2)}</strong> 秒内`;
  $('item-info').textContent = level.itemRequired ? '必须带上灯笼' : '';
  $('pause-button').textContent = paused ? '继续' : '暂停';
  $('pause-screen').hidden = !paused || dialog.open;
  updateCrossing();
  const fault = $('fault'); fault.hidden = state.status !== 'fell';
  if (state.status === 'fell') fault.textContent = `落水：第 ${Math.floor(state.fellTick! / level.beatTicks) + 1} 拍 · 第 ${state.fellTick! + 1} 帧 · ${level.gaps[state.gapIndex!].kind === 'tide' ? '潮水涨起了' : `桥${numerals[level.gaps[state.gapIndex!].lamp - 1]}没有被照亮`}`;
  let title = '先留一张灯谱，再往风铃那头走。';
  let tip = level.id === 1 ? '灯谱已备好。点「开始过桥」，按住 → 沿着亮起的桥走。' : '每列是一拍。点一个格子，灯就从这一拍起改照那座桥。';
  let buttons = button('开始过桥', 'start', true, !valid) + button('重新录光', 'record');
  let badge = '在楼上掌灯';
  if (mode === 'ready' && repairHint) { title = '从落水的这一拍改起。'; tip = repairHint; }
  else if (mode === 'ready' && firstLesson()) { title = '试一试，把光照向第二座桥。'; tip = '点亮框标出的第 8 拍，看看纸桥怎样接住光。也可以直接开始过桥。'; }
  else if (mode === 'ready') { tip = level.id === 1 && triedFirstSwitch ? '点「开始过桥」，按住右行走向风铃。记得看脚下的桥是否亮着。' : '悬停或长按格子可以试光。点一下，从这一拍开始换灯。'; }
  if (level.id === 2 && mode === 'ready' && !repairHint) { title = '过桥，还是带上那只纸船？'; tip = '可以直接去风铃。也可以在第一座桥上停下按 E 拾船，留意灯什么时候移走。'; }
  if (mode === 'recording') { title = '现在的光，会照着未来的脚步。'; tip = `按 1–${level.lampCount} 或点桥换灯。录满后会自动停下。`; buttons = button('结束录光', 'stop-record', true); badge = '正在录光'; }
  if (mode === 'playing') { title = awaitingStep ? '准备好了，就踏出第一步。' : state.busy ? (level.itemRequired ? '正把灯笼提起来……' : '正把纸船拾起来……') : '沿着自己的光，慢慢走。'; tip = awaitingStep ? '按住 → / D 开始。踏出第一步才计时，放松一点。' : '按住 → / D 向右，松开就停。在道具旁按 E，拾取时仍要留意潮水。'; buttons = button('重新走一遍', 'restart'); badge = awaitingStep ? '等你的第一步' : '正在过桥'; }
  if (level.id === 1 && mode === 'ready') {
    if (desktop.matches && !repairHint && selectedCell < 0 && !triedFirstSwitch) {
      title = '一条街，两座桥，一盏灯。'; tip = '按住 D 过第一座桥。到街心石台，按 E 把光交给第二座桥。';
      buttons = button('亲自掌灯', 'live-lamp', true) + button('按灯谱走', 'start', false, !valid) + button('重新录光', 'record');
    } else buttons += button('边走边换灯', 'live-lamp');
  }
  if (liveLamp && mode === 'playing') { tip = '走过第一座桥后，按 E 或点换灯。新方向从下一拍生效。'; badge = '亲自掌灯'; }
  if (level.id === 3 && mode === 'ready' && !repairHint) { title = '听潮，还是自己抢潮？'; tip = '到渡口前按 E 候潮，按住右行，水位合适就出发。也可以自己判断时机。'; }
  if (level.id === 4 && mode === 'ready') buttons += button('合灯试路', 'route-check', false, !valid);
  if (level.id === 5 && mode === 'ready' && !repairHint) { title = '带灯回家，还是顺路点亮夜摊？'; tip = '提灯后，最后一座桥前有一家暗着的小摊。靠近按 E，把灯火分给摊主。'; }
  const interact = $('move-tools').querySelector<HTMLButtonElement>('[data-move="interact"]')!;
  interact.textContent = liveLamp && mode === 'playing' ? 'E 换灯' : level.id === 3 ? 'E 候潮 / 拾取' : level.id === 5 ? 'E 提灯 / 点摊' : 'E 拾取';
  interact.setAttribute('aria-label', interact.textContent);
  if (mode === 'replay') { title = isDemo ? '看灯，也看什么时候停步。' : '回到那一拍，看看光去了哪里。'; tip = isDemo ? '这是参考走法，不记录成绩。记住等潮和拾取的位置，再亲自试试。' : '用原来的灯谱和按键逐帧重放。'; buttons = button('返回改谱', 'edit'); badge = isDemo ? '走法示范' : '回看脚步'; }
  if (mode === 'result') {
    if (state.status === 'win') { title = isDemo ? '路看过了，该你掌灯了。' : '风铃响了。这束光，有了去处。'; tip = isDemo ? '参考走法已结束，可以修改灯谱，再亲自过桥。' : '成绩已经留在本机。连接钱包后，可以让合约重放这段脚步。'; badge = isDemo ? '示范结束' : '已抵达'; }
    else if (state.status === 'fell') { const tide = level.gaps[state.gapIndex!].kind === 'tide'; title = tide ? '潮水比脚步，先到了一拍。' : '这一拍，你和灯错开了。'; tip = tide ? '退到安全石台上等一等。避开标为蓝色的涨潮拍。' : '看看落水时是哪一座桥，把那几拍的光移过去，再走一遍。'; badge = '落水复盘'; }
    else { title = '灯谱走完了，路还差一小段。'; tip = level.itemRequired && !state.hasItem ? '这一次忘了带灯笼。在灯笼旁按 E 拾取，风铃才会为你响。' : '可以少等一会儿，或重新安排灯光。'; badge = '灯谱结束'; }
    if (liveLamp && state.status === 'fell') { title = state.gapIndex === 0 ? '脚还在桥上，灯先走了。' : '人到了，光还在上一座桥。'; tip = state.gapIndex === 0 ? '等走上两座桥之间的石台，再按 E 换灯。' : '看见石台上的 E 就可以换灯。如果已到断桥边，松开 D 等桥亮。'; }
    buttons = button('再走一次', liveLamp ? 'live-lamp' : 'start', true, !valid) + button(state.status === 'fell' ? '调整落水那一拍' : '修改灯谱', state.status === 'fell' ? 'repair' : 'edit') + (lastAttempt ? button('回看脚步', 'replay') : '');
  }
  if (stoneAvailable && checkpoint && (mode === 'ready' || (mode === 'result' && state.status === 'fell'))) buttons += button('从桥头试走', 'stone', false, !valid);
  if (rehearsal && mode === 'playing') badge = '桥头练习';
  if (rehearsal && mode === 'result' && state.status === 'win') {
    title = '这一段走通了。'; badge = '练习完成'; tip = '从起点再走一次，就能正式记录这段脚步。';
    buttons = button('从起点正式走', 'start', true);
  }
  $('desk-keys').textContent = mode === 'ready' ? '点灯谱或用 Tab 进入 · ← → 选拍 · ↑ ↓ 试桥 · Enter 落笔'
    : mode === 'result' && state.status === 'fell' && stoneAvailable ? 'R 从桥头试走　F 调整落水那一拍'
    : mode === 'playing' ? `A / D 移动　${interact.textContent}　Esc 暂停`
    : mode === 'recording' ? '数字键选桥　Esc 暂停' : 'Esc 暂停';
  $('hint-title').textContent = title; $('hint-text').textContent = tip; $('actions').innerHTML = buttons; $('badge').textContent = badge;
  $('game').toggleAttribute('data-awaiting', mode === 'playing' && awaitingStep);
  $('game').dataset.status = mode === 'result' && !rehearsal ? state.status : '';
  $('move-tools').hidden = mode !== 'playing';
  for (const node of document.querySelectorAll<HTMLButtonElement>('[data-action="reference"],[data-action="demo"]')) node.disabled = !canEdit();
  $('result').hidden = rehearsal || mode !== 'result' || state.status !== 'win';
  if (!$('result').hidden) renderResult();
}
function renderResult() {
  const stars = starsFor(level, state.finishTick!);
  const chase = !isDemo && stars > 0 && stars < 3 ? `　<span class="pill">再快 ${((state.finishTick! - (stars === 2 ? level.par3 : level.par2)) / 20).toFixed(2)} 秒就是${stars === 2 ? '三' : '两'}星</span>` : '';
  $('result').innerHTML = `<div><div class="result-details"><span class="stars" aria-label="${stars}星">${[1, 2, 3].map(n => `<i class="${n <= stars ? 'on' : ''}" style="--i:${n}">${n <= stars ? '★' : '☆'}</i>`).join('')}</span><h3>${isDemo ? '走法示范' : '这一夜，平安抵达。'}</h3></div><p>${(state.finishTick! / 20).toFixed(2)} 秒 · ${state.finishTick} 帧${resultNote && !isDemo ? `　<span class="pill${resultNote.startsWith('比') ? '' : ' record'}">${resultNote}</span>` : ''}${chase}${state.hasItem ? `　<span class="pill">${level.itemRequired ? (stallLit ? '夜摊亮了 · 提灯归来' : '提灯归来') : level.id === 2 ? '纸船已挂上第二盏灯' : '拾舟'}</span>` : ''}${level.borrowable && !isDemo ? '　借来的光，照完了一段路。' : ''}</p><div id="tx-status" class="tx-status">${txView || (isDemo ? '示范不计入成绩，请亲自走一遍。' : '本地成绩已保存。' + (!chain.contractAddress ? '合约部署后可继续上链。' : ''))}</div></div><div class="transaction-tools">${!isDemo ? button('把这束光写上链', 'submit', false, txBusy) + button('留一张纪念卡', 'card') : ''}${level.id < 5 && !isDemo ? button('去下一夜', 'next', true) : button('回到长街', 'map', true)}</div>`;
}
function renderAll() { renderTracks(); renderControls(); updateHeader(); }
function updateCrossing() {
  const cue = $('cross-cue');
  if (!desktop.matches) { cue.hidden = true; return; }
  const beat = Math.min(level.beats - 1, Math.floor(Math.max(0,state.tick-1) / level.beatTicks));
  const own = mode === 'ready' ? preview?.lamp ?? selectedLamp : score[beat];
  const lent = (mode === 'replay' ? replayBorrowed : borrowedScore())[mode === 'ready' ? preview?.beat ?? 0 : beat];
  const route = $('crossing-strip');
  level.gaps.forEach((g,i) => {
    const el = route.children[1]?.children[i] as HTMLElement | undefined; if (!el) return;
    const light = state.x >= g.b ? 'crossed' : g.kind === 'tide' ? ((g.mask >>> (mode === 'ready' ? preview?.beat ?? 0 : beat)) & 1 ? 'tide' : 'dark') : own === g.lamp ? 'own' : lent === g.lamp ? 'lent' : 'dark';
    if (el.dataset.light !== light) el.dataset.light = light;
  });
  route.toggleAttribute('data-arrived', state.status === 'win');
  let hint = '', phase = '';
  if (level.id === 1 && liveLamp && mode === 'playing' && !paused && !dialog.open) {
    const [first,second] = level.gaps;
    if (awaitingStep) { phase='start'; hint='按住 D 或 →　踏上第一座桥'; }
    else if (state.x >= first.b && state.x < second.b) {
      const nextBeat = Math.floor(state.tick / level.beatTicks) + 1;
      if (own === 2) { phase='lit'; hint='桥二已亮　往风铃走 →'; }
      else if (score[nextBeat] === 2) { phase='queued'; hint='已接到换灯　下一拍亮桥'; }
      else { phase='switch'; hint='按 E 换灯　照亮第二座桥'; }
    }
  }
  cue.hidden = !hint;
  if (cue.dataset.phase !== phase) { cue.dataset.phase=phase; cue.textContent=hint; }
}
function updateClock() {
  updateCrossing();
  const inspecting = mode === 'ready' ? preview : null;
  const tick = inspecting ? inspecting.beat * level.beatTicks : mode === 'recording' ? recordTick : clockTick;
  const total = level.beatTicks * level.beats;
  const racing = (mode === 'playing' && !awaitingStep || mode === 'replay') && state.status === 'playing' && !rehearsal;
  const pace = racing ? starsFor(level, tick + 1) : 0;
  const clock = $('scene-clock');
  const hurry = racing && mode === 'playing' && total - tick <= 40;
  if (clock.hasAttribute('data-hurry') !== hurry) { clock.toggleAttribute('data-hurry', hurry); $('game').toggleAttribute('data-hurry', hurry); }
  clock.textContent = `${(tick / 20).toFixed(2)} / ${(total / 20).toFixed(1)} 秒${pace ? ' · ' + starText(pace) : ''}`;
  if (clock.dataset.pace !== String(pace)) {
    const dropped = pace > 0 && Number(clock.dataset.pace) > pace;
    clock.dataset.pace = String(pace);
    if (dropped && !matchMedia('(prefers-reduced-motion: reduce)').matches) clock.animate([{ transform: 'scale(1.2)', color: '#ff9a7e' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
  }
  $('timeline-clock').textContent = inspecting ? `试光 · 第 ${inspecting.beat + 1} 拍 · 桥${numerals[inspecting.lamp - 1]}` : `第 ${Math.min(level.beats, Math.floor(tick / level.beatTicks) + 1)} / ${level.beats} 拍`;
  $('cursor').hidden = mode === 'ready';
  $('cursor').style.setProperty('--f', String(Math.min(1, tick / total)));
  const activeBeat = Math.min(level.beats - 1, Math.floor((state.status === 'fell' ? state.fellTick! : tick) / level.beatTicks));
  for (const node of $('own-track').querySelectorAll<HTMLElement>('[data-cell]')) node.classList.toggle('active', mode !== 'ready' && Number(node.dataset.cell) === activeBeat);
}
function chooseLamp(lamp: number) {
  if (mode === 'playing' || mode === 'replay') return;
  if (mode === 'recording') {
    const beat = Math.min(level.beats - 1, Math.floor(recordTick / level.beatTicks));
    const candidate = [...score]; candidate.fill(lamp, beat);
    if (switches(candidate) > level.maxSwitches) { toast('灯油耗尽，这次换灯没有录入。'); return; }
    score = candidate;
  } else if (selectedCell >= 0) { score[selectedCell] = lamp; writeScore(); }
  selectedLamp = lamp; audio.tick(lamp); renderAll();
}
function startRun(fromStone = false, manual = false) {
  if (!validateScore(level, score)) { toast('灯油不够了，请减少灯谱中的切换次数。'); return; }
  liveLamp = fromStone ? checkpointManual : manual; waitingForTide = false; stallLit = fromStone && checkpointStall;
  if (manual) score = Array(level.beats).fill(1); else writeScore();
  preview = null; repairHint = ''; mode = 'playing'; rehearsal = fromStone && checkpoint !== null;
  state = rehearsal ? { ...checkpoint! } : createState(level);
  if (!rehearsal) { checkpoint = null; stoneAvailable = false; }
  previousX = state.x; clockTick = state.tick; accumulator = 0; lastBeat = -1;
  isDemo = false; paused = false; awaitingStep = true; inputLog = []; selectedCell = -1; held.clear(); interactionQueued = false; txView = '';
  audio.unlock(); renderAll();
}
function startRecording() {
  stallLit = false; liveLamp = false; waitingForTide = false;
  checkpoint = null; stoneAvailable = false; rehearsal = false;
  preview = null; repairHint = ''; mode = 'recording'; state = createState(level); recordTick = 0; clockTick = 0; accumulator = 0; lastBeat = -1; paused = false; isDemo = false;
  score = Array(level.beats).fill(selectedLamp); selectedCell = -1; audio.unlock(); renderAll();
}
function edit() { stallLit = false; waitingForTide = false; liveLamp = false; preview = null; repairHint = ''; mode = 'ready'; state = createState(level); previousX = state.x; clockTick = 0; paused = false; isDemo = false; held.clear(); renderAll(); }
function referenceSolution() { return solutions.find(s => s.level === level.id && (!level.borrowable || s.seedKey === borrowed.seedKey)) || solutions.find(s => s.level === level.id); }
function useReference(demo: boolean) {
  checkpoint = null; stoneAvailable = false; rehearsal = false;
  preview = null; repairHint = '';
  const solution = referenceSolution(); if (!solution) return;
  if (level.borrowable && solution.seedKey !== borrowed.seedKey) { borrowed = seedLights.find(s => s.seedKey === solution.seedKey)!; toast('参考走法配套使用内置陌生人的光。'); }
  score = [...solution.score]; writeScore(); selectedCell = -1;
  $('reference-hint').hidden = false;
  $('reference-hint').textContent = [
    '参考：一路向右。经过第一座桥后，灯会为你照亮第二座。',
    '参考：三座桥，只需换两次灯。一路向右即可。',
    '参考：在潮汐石台左岸停下，等到第12拍（5.5秒）再继续。纸船可选。',
    '参考：借来的灯照两座桥，你的灯补齐其余三座。照着两种灯光的交接处走。',
    '参考：在潮汐石台前等到4.8秒；上右岸后先按 E 拾起灯笼，再继续。',
  ][level.id - 1];
  if (demo) { stallLit = false; liveLamp = false; mode = 'replay'; isDemo = true; playback = [...solution.inputs]; replayBorrowed = [...borrowedScore()]; state = createState(level); previousX = state.x; clockTick = 0; accumulator = 0; paused = false; lastBeat = -1; held.clear(); }
  else { edit(); toast('参考灯谱已放好，脚步仍由你来走。'); }
  renderAll();
}
function replayAttempt() {
  if (!lastAttempt) return;
  stallLit = false; liveLamp = false;
  checkpoint = null; stoneAvailable = false; rehearsal = false;
  if (lastAttempt.borrowedLight) borrowed = { ...lastAttempt.borrowedLight, score: [...lastAttempt.borrowedLight.score] };
  mode = 'replay'; isDemo = false; score = [...lastAttempt.score]; playback = [...lastAttempt.inputs]; replayBorrowed = [...lastAttempt.borrowed];
  state = createState(level); previousX = state.x; clockTick = 0; accumulator = 0; paused = false; lastBeat = -1; held.clear(); renderAll();
}
function finishRun(wasPlaying: boolean) {
  resultNote = '';
  const panel = $('result'); panel.classList.remove('fresh'); void panel.offsetWidth; panel.classList.add('fresh');
  clearTimeout(freshTimer); freshTimer = setTimeout(() => panel.classList.remove('fresh'), 2800);
  if (wasPlaying && state.status === 'fell') stoneAvailable = true;
  const finishedMode = mode; mode = 'result'; held.clear(); interactionQueued = false;
  if (wasPlaying && !rehearsal) lastAttempt = { score: [...score], borrowed: [...borrowedScore()], inputs: [...inputLog], borrowedLight: level.borrowable ? { ...borrowed, score: [...borrowed.score] } : undefined };
  if (state.status === 'win') {
    audio.win(isDemo || rehearsal || !wasPlaying ? 0 : starsFor(level, state.finishTick!));
    if (wasPlaying && !rehearsal) {
      if (liveLamp) writeScore();
      if (level.id === 5 && stallLit) save.marketLit = true;
      const old = save.progress[level.id];
      resultNote = !old ? '第一次点亮这盏灯' : state.finishTick! < old.tick ? `新纪录 · 快了 ${((old.tick - state.finishTick!) / 20).toFixed(2)} 秒` : state.finishTick! > old.tick ? `比最快慢 ${((state.finishTick! - old.tick) / 20).toFixed(2)} 秒` : '平了最快纪录';
      if (old && state.finishTick! < old.tick) audio.record();
      if (state.finishTick! < (save.echo?.[level.id]?.length ?? Infinity) - 1) {
        const run = Array.from(trail.slice(0, state.finishTick! + 1)); run[0] = createState(level).x;
        if (run.length === state.finishTick! + 1 && run.every(Number.isInteger)) (save.echo ??= {})[level.id] = run;
      }
      recordBest(save, level.id, { tick: state.finishTick!, stars: starsFor(level, state.finishTick!), hasItem: state.hasItem });
      save.recent = { stallLit: level.id === 5 && stallLit, level: level.id, score: [...score], inputs: inputLog.slice(0, state.finishTick), borrowed: [...borrowedScore()], borrowedId: level.borrowable ? borrowed.id : '0', seedKey: level.borrowable ? borrowed.seedKey : undefined, finishTick: state.finishTick!, hasItem: state.hasItem };
      persist(save);
    }
  } else audio.fall();
  if (finishedMode === 'replay' && !isDemo) txView = '这是原局回放，未重复记录成绩。';
  renderAll();
}
function fixedUpdate() {
  if (mode === 'recording') {
    recordTick++; clockTick = recordTick;
    if (recordTick >= level.beats * level.beatTicks) { mode = 'ready'; writeScore(); toast('光录好了，现在可以下楼过桥。'); renderAll(); }
    else if (recordTick % level.beatTicks === 0) audio.tick(selectedLamp);
    updateClock(); return;
  }
  if (mode !== 'playing' && mode !== 'replay') return;
  let action = mode === 'replay' ? playback[state.tick] ?? 0 : interactionQueued ? 3 : held.has('right') ? 1 : held.has('left') ? 2 : 0;
  if (mode === 'playing' && liveLamp && action === 3) {
    interactionQueued = false;
    const next = Math.floor(state.tick / level.beatTicks) + 1;
    if (next < level.beats) { score.fill(score[next] === 1 ? 2 : 1, next); audio.swap(); renderTracks(); }
    action = held.has('right') ? 1 : held.has('left') ? 2 : 0;
  }
  if (mode === 'playing' && level.id === 3) {
    const bank = level.gaps.find(g => g.kind === 'tide')!.a;
    if (action === 3 && state.x <= bank && state.x >= bank - 600) waitingForTide = !waitingForTide;
    if (waitingForTide && (action === 2 || safeDeparture())) waitingForTide = false;
    if (waitingForTide) action = 0;
  }
  if (level.id === 5 && action === 3 && state.hasItem && Math.abs(state.x - stallX) <= 260 && !stallLit) {
    stallLit = true; audio.tick(3);
  }
  if (mode === 'playing' && awaitingStep) {
    if (action === 0) return;
    awaitingStep = false; audio.begin(level.beatTicks / 20);
    if (save.echo?.[level.id] && !rehearsal && echoTold !== level.id) { echoTold = level.id; toast('上一次的回声也在桥上，看谁先到风铃。'); }
    renderControls();
  }
  interactionQueued = false;
  if (mode === 'playing') {
    const approach = liveLamp ? level.speed * level.beatTicks : 0;
    if (!level.gaps.some(g => state.x > g.a - approach && state.x < g.b)) { checkpoint = { ...state }; checkpointStall = stallLit; checkpointManual = liveLamp; }
    inputLog.push(level.id === 2 && state.busy > 0 ? 0 : action);
  }
  previousX = state.x;
  const hadItem = state.hasItem; const wasBusy = state.busy > 0;
  state = step(level, state, score, mode === 'replay' ? replayBorrowed : borrowedScore(), action);
  clockTick = state.tick;
  if (mode === 'playing') {
    trail[state.tick] = state.x;
    const left = level.beats * level.beatTicks - state.tick;
    if (!rehearsal && state.status === 'playing' && left <= 40 && left > 0 && left % 10 === 0) audio.hurry();
  }
  if (level.id === 3) {
    const bank = level.gaps.find(g => g.kind === 'tide')!.a;
    $('scene-item').textContent = state.x <= bank && state.x >= bank - 600
      ? waitingForTide ? '正在候潮 · 按住右行，退潮时过渡口' : safeDeparture() ? '水位合适 · 现在可以出发' : '前方将涨潮 · 按 E 候潮'
      : '过渡口后，岸边还有一只纸船';
  }
  if (!hadItem && state.hasItem) audio.pickup();
  if (state.x !== previousX && state.status === 'playing') audio.step();
  if (wasBusy !== (state.busy > 0)) renderControls();
  const beat = Math.floor((state.tick - 1) / level.beatTicks);
  if (beat !== lastBeat) { lastBeat = beat; audio.tick(score[beat]); }
  updateClock();
  if (state.status !== 'playing') finishRun(mode === 'playing');
}
function echoAt(alpha: number): number | undefined {
  const run = mode === 'playing' && !awaitingStep && !rehearsal ? save.echo?.[level.id] : undefined;
  if (!run || run.length < 2) return undefined;
  const last = run.length - 1;
  const from = run[Math.min(last, Math.max(0, state.tick - 1))], to = run[Math.min(last, state.tick)];
  return from + (to - from) * Math.max(0, Math.min(1, alpha));
}
function frame(now: number) {
  const delta = now - lastTime; lastTime = now;
  if (screen === 'game') {
    if (!paused && !dialog.open && (mode === 'playing' || mode === 'recording' || mode === 'replay')) {
      if (delta > 1000) pause(true);
      else { accumulator += Math.min(delta, 250); while (accumulator >= TICK_MS && !paused) { accumulator -= TICK_MS; fixedUpdate(); } }
    }
    renderer.draw({ liveLamp, stallLit, level, state: mode === 'recording' ? { ...state, tick: recordTick } : state, score, borrowed: mode === 'replay' ? replayBorrowed : borrowedScore(), mode, time: now / 1000, alpha: accumulator / TICK_MS, previousX, echoX: echoAt(accumulator / TICK_MS), selectedLamp, preview: mode === 'ready' ? preview : null, borrowArrival: mode === 'ready' ? Math.min(1, (now - borrowStartedAt) / 560) : 1, borrowedAuthor: level.borrowable ? (borrowed.id === '0' ? '内置掌灯人' : shortAddress(borrowed.author)) : undefined, paused });
  }
  requestAnimationFrame(frame);
}
function pause(value: boolean) { if (screen !== 'game') return; paused = value; accumulator = 0; held.clear(); interactionQueued = false; renderControls(); }
function openDialog(title: string, body: string) {
  if (!dialog.open) { previousFocus = document.activeElement as HTMLElement; dialogWasPaused = paused; paused = true; held.clear(); interactionQueued = false; }
  $('dialog-title').textContent = title; $('dialog-body').innerHTML = body;
  if (!dialog.open) dialog.showModal();
  $('pause-screen').hidden = true;
}
function closeDialog() { dialog.close(); paused = dialogWasPaused; accumulator = 0; previousFocus?.focus(); if (screen === 'game') renderControls(); }
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeDialog(); } });
function showHelp() {
  openDialog('把灯留给未来的自己', `<p>先在楼上掌灯，再到楼下过桥。你走出的每一步，都能被同一张灯谱重新验证。</p><ul><li><strong>掌灯：</strong>数字键 1–${level.lampCount} 或点桥。点「重新录光」实时录制；也可以直接点灯谱格子编辑。</li><li><strong>过桥：</strong>按住 ← → / A D，松开停步。桥只有被自己的光或借来的光照着时才安全。</li><li><strong>拾取：</strong>靠近道具按 E。拾取需要时间，期间仍会受潮水影响。</li><li><strong>潮汐：</strong>蓝色格为涨潮，暗色格为退潮，退潮时可走。石台边界和普通地面可安全等待。</li><li><strong>星级：</strong>抵达风铃自动结算。快一点能得到更多星；纸船是额外徽章。</li><li><strong>回声：</strong>通关后，你最快那一次的身影会留在桥上；再走这一夜时，它与你同时出发。计时旁会实时显示还能拿到几星。</li><li><strong>声音：</strong>音乐与音效默认开启，右上角「声音」可切换 全开 / 仅音效 / 关。</li></ul><p class="notice">没有钱包也能玩完五关。链上验证仅使用 Monad 测试网；上链耗时按真实交易记录显示。</p><div class="dialog-actions">${button('明白了，去掌灯', 'close-dialog', true)}</div>`);
}
function openBorrow() {
  openDialog('一束来自雨夜的光', `<p>五座纸桥，灯油只够换两次。选一束光，和你的灯谱一起照着这段路。</p><div class="row"><small>${pool.some(l => l.id !== '0') ? '链上灯谱池' : '内置灯谱 · 离线也能借光'}</small>${button(poolBusy ? '正在寻光…' : '刷新灯谱池', 'refresh-pool', false, poolBusy)}</div><div class="borrow-list">${pool.map((light, index) => `<button class="borrow-option ${(light.id !== '0' ? light.id === borrowed.id : light.seedKey === borrowed.seedKey) ? 'current' : ''}" data-borrow="${index}"><span class="row"><span>${esc(light.label || ('掌灯人 ' + shortAddress(light.author)))}</span><small>${sourceName(light)}${light.id === '0' ? ' · 离线可用' : ` #${light.id} · 已借光通关 ${light.borrowCount} 次`}</small></span><span class="mini-score" style="--beats:${light.score.length}">${Array.from({ length: level.lampCount }, (_, r) => light.score.map(lamp => `<i class="${lamp === r + 1 ? 'on' : ''}"></i>`).join('')).join('')}</span><span class="borrow-caption">${borrowRoute(light)}　·　借这一束光 ↗</span></button>`).join('')}</div><div class="dialog-actions">${button('随机借一盏', 'random-borrow', true)}${button('借我上次的光', 'borrow-own', false, !chain.account)}</div><p><small>借来的灯谱只读。每束灯谱都符合灯油限制；参考走法提供内置灯谱的搭配提示。</small></p>`);
}
async function refreshPool() {
  if (!chain.contractAddress || poolBusy) return;
  poolBusy = true;
  try { const found = await chain.getPool(); pool = found.length ? found.map(l => ({ ...l, seedKey: seedLights.find(s => s.score.join(',') === l.score.join(','))?.seedKey })) : [...seedLights]; }
  catch { pool = [...seedLights]; toast('暂时没连上灯谱池，先借内置陌生人的光。'); }
  finally { poolBusy = false; if (dialog.open && $('dialog-title').textContent?.startsWith('一束来自')) openBorrow(); }
}
function chooseBorrow(index: number) {
  borrowed = pool[index]; checkpoint = null; stoneAvailable = false; closeDialog(); edit();
  borrowStartedAt = performance.now();
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const cell of $('own-track').querySelectorAll('.lent')) {
      cell.animate([{ opacity: 0.28 }, { opacity: 1 }], { delay: 320, duration: 240, fill: 'backwards' });
    }
  }
  toast(`已借到${sourceName(borrowed)}的光。青白色的桥由另一盏灯照亮。`);
}
async function openBoard() {
  const boardLevel = level.id;
  openDialog(`${level.name} · 灯榜`, '<div class="loading">看看这段路上，谁的脚步最轻……</div>');
  let content = '';
  try {
    if (!chain.contractAddress) throw new Error('尚未部署');
    const entries = await chain.getBoard(boardLevel);
    content = entries.length ? `<table class="board"><thead><tr><th>名次</th><th>掌灯人</th><th>用时</th><th>星级</th><th>借出光</th></tr></thead><tbody>${entries.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(shortAddress(e.author))}</td><td>${(e.tick / 20).toFixed(2)}s</td><td>${starText(e.stars)}</td><td>${e.lightGiven}</td></tr>`).join('')}</tbody></table><p><small>同样的用时，先留下脚步的人排在前面。</small></p>` : '<div class="empty-state"><h3>这一夜，还在等第一声风铃。</h3><p>通关并上链，就能把你的名字留在这里。</p></div>';
  } catch {
    const p = save.progress[boardLevel];
    content = `<div class="empty-state"><h3>先把这段路，走进自己的记忆。</h3><p>${chain.contractAddress ? '暂时无法读取链上灯榜。' : '测试网合约尚未部署。'}</p></div>${p ? `<table class="board"><thead><tr><th>本地掌灯人</th><th>最佳用时</th><th>星级</th></tr></thead><tbody><tr><td>你</td><td>${(p.tick / 20).toFixed(2)} 秒</td><td>${starText(p.stars)}</td></tr></tbody></table>` : '<p>本关还没有本地成绩，走一次就会记在这里。</p>'}`;
  }
  if (dialog.open && $('dialog-title').textContent?.includes('灯榜')) $('dialog-body').innerHTML = content;
}
function updateTransaction(next: chain.TransactionUpdate) {
  txView = next.status === 'checking' ? '正在本地与合约核验脚步…' : next.status === 'signing' ? '请在钱包中确认，签下这张灯谱。' : next.status === 'broadcast' ? `已广播，正在等风铃回声… <a href="${chain.explorer}/tx/${next.hash}" target="_blank" rel="noopener noreferrer">查看交易</a>` : `<span class="block-stamp" aria-hidden="true"><b>已上链</b>#${next.block}</span>风铃声写进了第 ${next.block} 个区块，用时 ${next.elapsed!.toFixed(2)} 秒。<a href="${chain.explorer}/tx/${next.hash}" target="_blank" rel="noopener noreferrer">查看交易</a>`;
  if (!$('result').hidden) renderResult();
}
async function submitRun() {
  const run = save.recent;
  if (!run || run.level !== level.id || isDemo || txBusy) { toast('先亲自完成一局，就能留下你的光。'); return; }
  if (run.submittedHash) { toast('这局已经上链，不必再次提交。'); return; }
  if (!chain.contractAddress) { openDialog('脚步已留好，等一次上链。', '<p>这一局的灯谱和按键已经保存在本机，离线成绩不会丢失。</p><p>测试网合约尚未部署。部署配置完成后，可继续提交最近一次通关。</p><div class="dialog-actions">' + button('继续玩', 'close-dialog', true) + '</div>'); return; }
  txBusy = true; renderControls();
  try { const result = await chain.submit(run, updateTransaction); run.submittedHash = result.hash; persist(save); await syncBest(); }
  catch (error) { txView = esc(chain.friendlyError(error)) + ' 可稍后重试。'; toast(chain.friendlyError(error)); }
  finally { txBusy = false; if (screen === 'game') renderControls(); }
}
async function syncBest() {
  if (!chain.contractAddress || !chain.account) return;
  try { for (const p of await chain.getBest()) recordBest(save, p.level, { tick: p.tick, stars: p.stars, hasItem: false }); renderMap(); }
  catch { toast('链上成绩暂时未读到，本地进度仍可使用。'); }
}
async function connectWallet() {
  try { if (chain.account) { openDialog('掌灯人的钱包', `<p>已连接 ${esc(shortAddress(chain.account))}，网络为 Monad 测试网。</p><p>连接钱包不会扣费；上链前需要你在钱包里确认。</p><div class="dialog-actions">${button('断开连接', 'disconnect')}${button('返回游戏', 'close-dialog', true)}</div>`); return; } await chain.connect(); await syncBest(); toast('钱包连好了。先过桥，再把光留下。'); }
  catch (error) { toast(chain.friendlyError(error)); }
}
let keepsake: Keepsake | null = null;
async function openCard(journey: boolean) {
  if (journey ? levels.some(l => !save.progress[l.id]) : isDemo || rehearsal || mode !== 'result' || state.status !== 'win') return;
  keepsake = null;
  openDialog(journey ? '五夜纪念卡' : '通关纪念卡', '<p class="keepsake-wait" role="status">正在把这段雨夜印成纪念卡…</p>');
  const showing = () => dialog.open && !!$('dialog-title').textContent?.endsWith('纪念卡');
  try {
    // The contract is asked while the card module loads; a slow RPC must not hold the card back.
    const onChain: Promise<chain.ChainProgress[]> = journey && chain.account && chain.contractAddress
      ? Promise.race([chain.getBest().catch(() => []), new Promise<chain.ChainProgress[]>(resolve => setTimeout(resolve, 4000, []))])
      : Promise.resolve([]);
    const cards = await import('./ui/card');
    let made: Keepsake;
    if (journey) {
      const boats = levels.filter(l => l.hasItem && !l.itemRequired);
      const found = boats.filter(l => save.progress[l.id]?.hasItem).length;
      const best = await onChain;
      made = await cards.journeyCard({
        nights: levels.map(l => {
          const { tick, stars } = save.progress[l.id];
          return { name: l.name, tick, stars, verified: best.some(p => p.level === l.id && p.tick === tick) };
        }),
        marks: [...(found ? [`纸船 ${found} / ${boats.length}`] : []), ...(save.marketLit ? ['夜摊已点亮'] : [])],
        account: chain.account,
      });
    } else {
      const run = save.recent;
      made = await cards.nightCard({
        level: level.id, name: level.name, tick: state.finishTick!, stars: starsFor(level, state.finishTick!),
        marks: [...(level.borrowable ? ['借光同行'] : []), ...(state.hasItem ? [level.itemRequired ? (stallLit ? '夜摊亮了 · 提灯归来' : '提灯归来') : '拾得纸船'] : [])],
        // Only the crossing that was actually submitted may carry its transaction.
        hash: run && run.level === level.id && run.finishTick === state.finishTick ? run.submittedHash : undefined,
        account: chain.account,
      });
    }
    if (!showing()) return;
    keepsake = made;
    const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [made.file] });
    const touch = !matchMedia('(pointer:fine)').matches;
    // Touch screens already offer copying on a long press of the picture; there the system share sheet leads instead.
    const canCopy = !touch && typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function';
    const lead = touch && canShare;
    $('dialog-body').innerHTML = `<figure class="keepsake"><img src="${made.preview}" alt="${esc(made.alt)}" width="1080" height="1440"></figure><p class="keepsake-tip">手机上长按图片可以保存或转发；发到 X 时记得把这张图一起贴上。</p><div class="dialog-actions">${lead ? button('分享到…', 'card-share', true) : ''}${button('保存图片', 'card-save', !lead)}${canCopy ? button('复制图片', 'card-image') : ''}${canShare && !lead ? button('分享到…', 'card-share') : ''}${button('发到 X', 'card-x')}${button('复制文案', 'card-copy')}</div>`;
  } catch {
    if (showing()) closeDialog();
    toast('纪念卡暂时没印出来，请稍后再试。');
  }
}
async function handleAction(action: string) {
  switch (action) {
    case 'map': goMap(); break;
    case 'recent': {
      const run = save.recent; if (!run) break;
      try {
        const result = simulate(playableLevel(run.level), run.score, run.inputs, run.borrowed);
        if (result.status !== 'win') throw new Error('上次记录不完整，请重新过桥。');
        openLevel(run.level);
        if (dialog.open) closeDialog();
        score = [...run.score];
        if (level.borrowable) borrowed = { id: run.borrowedId, author: run.seedKey ? '陌生人' : '借来的光', score: [...run.borrowed], seedKey: run.seedKey, borrowCount: 0 };
        inputLog = [...run.inputs]; lastAttempt = { score: [...score], borrowed: [...run.borrowed], inputs: [...run.inputs], borrowedLight: level.borrowable ? { ...borrowed, score: [...borrowed.score] } : undefined };
        stallLit = run.stallLit === true; state = result; previousX = state.x; clockTick = state.tick; mode = 'result'; isDemo = false;
        txView = run.submittedHash ? `这局已上链。<a href="${chain.explorer}/tx/${esc(run.submittedHash)}" target="_blank" rel="noopener noreferrer">查看交易</a>` : '已恢复上次通关的灯谱与脚步，可以继续上链。';
        renderAll();
      } catch { toast('上次记录不完整，请重新过桥。'); }
      break;
    }
    case 'continue': openLevel(levels.find(l => !save.progress[l.id])?.id || 5); break;
    case 'practice': practice = !practice; renderMap(); toast(practice ? '自由练习已开启，五关都可以试走。' : '回到逐关点灯。'); break;
    case 'start': startRun(); break;
    case 'restart': startRun(false, liveLamp); break;
    case 'live-lamp': startRun(false, true); break;
    case 'route-check': {
      const test = simulate(level, score, Array(level.beats * level.beatTicks).fill(1), borrowedScore());
      if (test.status === 'fell') {
        const beat = Math.floor(test.fellTick! / level.beatTicks);
        const lamp = level.gaps[test.gapIndex!].lamp;
        const cell = $('own-track').querySelector<HTMLElement>(`[data-cell="${beat}"][data-row="${lamp}"]`);
        cell?.focus(); showPreview(cell);
        toast(`一路向右，第 ${beat + 1} 拍会在桥${numerals[lamp - 1]}断光。点选格子试着接上。`);
      } else toast('两束光接上了。一路向右能抵达风铃。');
      break;
    }
    case 'stone': if (checkpoint && stoneAvailable) startRun(true); break;
    case 'record': startRecording(); break;
    case 'stop-record': mode = 'ready'; writeScore(); renderAll(); break;
    case 'edit': edit(); break;
    case 'repair': {
      if (state.status !== 'fell') break;
      const beat = Math.floor(state.fellTick! / level.beatTicks);
      const gap = level.gaps[state.gapIndex!];
      edit();
      selectedCell = beat;
      const lamp = gap.kind === 'lamp' ? gap.lamp : score[beat];
      repairHint = gap.kind === 'lamp' ? `第 ${beat + 1} 拍踏上了桥${numerals[lamp - 1]}。正在预览这座桥，点选格子就能把光移过来。` : `第 ${beat + 1} 拍正在涨潮。对照潮汐行，在岸上等到退潮再走。`;
      renderAll();
      const cell = $('own-track').querySelector<HTMLElement>(`[data-cell="${beat}"][data-row="${lamp}"]`);
      cell?.focus(); showPreview(cell);
      break;
    }
    case 'reference': useReference(false); break;
    case 'demo': useReference(true); break;
    case 'replay': replayAttempt(); break;
    case 'next': openLevel(Math.min(5, level.id + 1)); break;
    case 'pause': pause(!paused); break;
    case 'resume': pause(false); break;
    case 'sound': {
      // 全开 → 仅音效 → 关 → 全开
      if (!audio.enabled) { audio.setEnabled(true); audio.setMusic(true); }
      else if (audio.musicEnabled) audio.setMusic(false);
      else audio.setEnabled(false);
      void audio.unlock(); save.sound = audio.enabled; save.music = audio.musicEnabled; persist(save); updateHeader();
      toast(!audio.enabled ? '已静音。' : audio.musicEnabled ? '音乐与音效都开着。' : '只留音效，音乐先歇一会儿。');
      break;
    }
    case 'help': showHelp(); break;
    case 'close-dialog': closeDialog(); break;
    case 'borrow': openBorrow(); break;
    case 'refresh-pool': if (!chain.contractAddress) toast('合约尚未部署，当前使用内置灯谱。'); else { void refreshPool(); openBorrow(); } break;
    case 'random-borrow': chooseBorrow(Math.floor(Math.random() * pool.length)); break;
    case 'borrow-own': { const index = pool.findIndex(l => l.author.toLowerCase() === chain.account?.toLowerCase()); if (index < 0) toast('灯谱池还没有你的光，先完成一次通关并上链。'); else chooseBorrow(index); break; }
    case 'board': await openBoard(); break;
    case 'connect': await connectWallet(); break;
    case 'disconnect': chain.disconnect(); closeDialog(); break;
    case 'submit': await submitRun(); break;
    case 'card': await openCard(false); break;
    case 'card-all': await openCard(true); break;
    case 'card-save': {
      if (!keepsake) break;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(keepsake.file); link.download = keepsake.file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      toast('已开始保存；没有反应的话，长按图片也能保存。');
      break;
    }
    case 'card-image': {
      if (!keepsake) break;
      try { await keepsake.copy(); toast('图片已复制，到推文或聊天窗口里粘贴就行。'); }
      catch { toast('这个浏览器不让直接复制图片，先保存图片再发吧。'); }
      break;
    }
    case 'card-share': {
      if (!keepsake) break;
      try { await navigator.share({ files: [keepsake.file], text: keepsake.caption }); }
      catch (error) { if ((error as Error).name !== 'AbortError') toast('没能唤起系统分享，可以先保存图片再发。'); }
      break;
    }
    case 'card-x': if (keepsake) window.open(keepsake.post, '_blank', 'noopener'); break;
    case 'card-copy': {
      if (!keepsake) break;
      try { await navigator.clipboard.writeText(keepsake.caption); toast('文案和链接已复制。'); }
      catch { toast('复制没有成功，可以长按图片直接转发。'); }
      break;
    }
    case 'lend': {
      if (!chain.contractAddress) { toast('合约尚未部署，灯谱已经保存在本机。'); writeScore(); break; }
      if (txBusy) break; txBusy = true; renderAll();
      try { await chain.lend([...score], next => { if (next.status === 'confirmed') toast('这束光已留在链上，等下一个过河的人。'); }); }
      catch (error) { toast(chain.friendlyError(error)); }
      finally { txBusy = false; renderAll(); } break;
    }
  }
}
const track = $('own-track');
const cellFrom = (event: Event) => (event.target as HTMLElement).closest<HTMLElement>('[data-cell]');
let heldPreviewCell: HTMLElement | null = null;
let holdTimer: ReturnType<typeof setTimeout>;
track.addEventListener('pointerover', event => { if (event.pointerType !== 'touch') showPreview(cellFrom(event)); });
track.addEventListener('pointerleave', () => showPreview(null));
track.addEventListener('focusin', event => {
  const cell = cellFrom(event);
  if (!cell) return;
  const entry = track.querySelector<HTMLElement>('[data-cell][tabindex="0"]');
  if (entry) entry.tabIndex = -1;
  cell.tabIndex = 0;
  showPreview(cell);
});
track.addEventListener('keydown', event => {
  const cell = cellFrom(event);
  if (!cell || paused || mode !== 'ready' || event.altKey || event.metaKey || event.ctrlKey) return;
  let beat = Number(cell.dataset.cell);
  let row = Number(cell.dataset.row);
  switch (event.key) {
    case 'Enter': event.preventDefault(); if (!event.repeat) cell.click(); return;
    case 'ArrowLeft': beat--; break;
    case 'ArrowRight': beat++; break;
    case 'ArrowUp': row--; break;
    case 'ArrowDown': row++; break;
    case 'Home': beat = 0; break;
    case 'End': beat = level.beats - 1; break;
    default: return;
  }
  event.preventDefault();
  track.querySelector<HTMLElement>(`[data-cell="${Math.max(0, Math.min(level.beats - 1, beat))}"][data-row="${Math.max(1, Math.min(level.lampCount, row))}"]`)?.focus();
});
track.addEventListener('focusout', () => showPreview(null));
track.addEventListener('pointerdown', event => {
  clearTimeout(holdTimer); heldPreviewCell = null;
  const cell = cellFrom(event);
  if (mode !== 'ready' || event.pointerType !== 'touch' || !cell) return;
  holdTimer = setTimeout(() => { heldPreviewCell = cell; showPreview(cell); }, 320);
});
track.addEventListener('pointerup', () => clearTimeout(holdTimer));
track.addEventListener('pointercancel', () => { clearTimeout(holdTimer); heldPreviewCell = null; showPreview(null); });
document.addEventListener('click', event => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('button'); if (!target || (target as HTMLButtonElement).disabled) return;
  audio.unlock();
  if (target.dataset.cell === undefined && !target.dataset.lamp && target.dataset.action !== 'sound') audio.click();
  if (target.dataset.level) openLevel(Number(target.dataset.level));
  else if (target.dataset.cell !== undefined && canEdit()) {
    if (target === heldPreviewCell && event.detail > 0) { heldPreviewCell = null; return; }
    if (mode === 'result') edit();
    repairHint = '';
    selectedCell = Number(target.dataset.cell);
    const lamp = target.dataset.row ? Number(target.dataset.row) : score[selectedCell] % level.lampCount + 1;
    const run = score[selectedCell];
    for (let beat = selectedCell; beat < score.length && score[beat] === run; beat++) score[beat] = lamp;
    if (level.id === 1 && selectedCell === 7 && lamp === 2) triedFirstSwitch = true;
    selectedLamp = lamp; audio.tick(lamp); writeScore(); renderAll();
    const cell = $('own-track').querySelector<HTMLElement>(`[data-cell="${selectedCell}"][data-row="${lamp}"]`);
    if (event.detail === 0) cell?.focus({ preventScroll: true });
    showPreview(cell);
  }
  else if (target.dataset.lamp) chooseLamp(Number(target.dataset.lamp));
  else if (target.dataset.borrow !== undefined) chooseBorrow(Number(target.dataset.borrow));
  else if (target.dataset.action) void handleAction(target.dataset.action);
  if (target.dataset.action === 'start' || target.dataset.action === 'record' || target.dataset.action === 'restart') target.blur();
});
canvas.addEventListener('pointerdown', event => {
  if (mode !== 'ready' && mode !== 'recording' && mode !== 'result') return;
  const rect = canvas.getBoundingClientRect(); const x = (event.clientX - rect.left) / rect.width * 11200;
  const lamps = level.gaps.filter(g => g.kind === 'lamp'); const gap = lamps.reduce((best, g) => Math.abs((g.a + g.b) / 2 - x) < Math.abs((best.a + best.b) / 2 - x) ? g : best);
  chooseLamp(gap.lamp);
});
for (const control of document.querySelectorAll<HTMLElement>('[data-move]')) {
  control.addEventListener('pointerdown', event => { if (mode !== 'playing' || paused) return; event.preventDefault(); control.setPointerCapture(event.pointerId); control.classList.add('pressed'); const move = control.dataset.move!; if (move === 'interact') interactionQueued = true; else held.add(move); });
  const release = () => { held.delete(control.dataset.move!); control.classList.remove('pressed'); };
  control.addEventListener('pointerup', release); control.addEventListener('pointercancel', release); control.addEventListener('lostpointercapture', release);
}
window.addEventListener('keydown', event => {
  if (dialog.open || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return;
  if (event.key === 'Escape' && screen === 'game') { event.preventDefault(); pause(!paused); return; }
  if (screen !== 'game' || paused) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  if (mode === 'result' && state.status === 'fell' && !event.repeat) {
    if (key === 'r' && checkpoint && stoneAvailable) { event.preventDefault(); startRun(true); return; }
    if (key === 'f') { event.preventDefault(); void handleAction('repair'); return; }
  }
  if (/^[1-5]$/.test(key) && Number(key) <= level.lampCount && !event.repeat) { event.preventDefault(); chooseLamp(Number(key)); }
  if (mode !== 'playing') return;
  if (key === 'arrowright' || key === 'd') { event.preventDefault(); held.add('right'); }
  else if (key === 'arrowleft' || key === 'a') { event.preventDefault(); held.add('left'); }
  else if (key === 'e' && !event.repeat) { event.preventDefault(); interactionQueued = true; }
});
window.addEventListener('keyup', event => { const key = event.key.toLowerCase(); if (key === 'arrowright' || key === 'd') held.delete('right'); if (key === 'arrowleft' || key === 'a') held.delete('left'); });
window.addEventListener('blur', () => { held.clear(); interactionQueued = false; if (screen === 'game' && ['playing', 'recording', 'replay'].includes(mode)) pause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && screen === 'game' && ['playing', 'recording', 'replay'].includes(mode)) pause(true); });
chain.onConnectionChange(updateHeader);
const wakeAudio = () => { void audio.unlock(); };
for (const gesture of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const) window.addEventListener(gesture, wakeAudio, { passive: true });
updateHeader(); renderMap(); requestAnimationFrame(frame);
// Fetched once the first screen has settled, so the first wallet click or board lookup doesn't wait on it.
if (chain.contractAddress) setTimeout(chain.warm, 3000);
const night = Number(new URLSearchParams(location.search).get('night'));
if (Number.isInteger(night) && night >= 1 && night <= levels.length) { practice = true; openLevel(night); }
