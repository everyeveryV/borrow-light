import qrcode from 'qrcode-generator';
import { plateFiles } from '../game/render';
import { shortAddress } from './storage';
import { contractAddress, explorer } from '../chain/lazy';

const playUrl = 'https://everyeveryv.github.io/borrow-light/';
const WIDTH = 1080;
const HEIGHT = 1440;
const MARGIN = 72;
const serif = "'Noto Serif SC','Songti SC',SimSun,serif";
// SimSun sets digits and the full stop on a fixed grid, which pulls a time like 5.85 apart.
const figures = "'Noto Serif SC','Songti SC','Times New Roman',Georgia,serif";
const sans = "'Microsoft YaHei UI','PingFang SC',sans-serif";
const mono = "Consolas,'SF Mono',Menlo,monospace";
const night = '#0c181e';
const paper = '#ece3cf';
const mist = '#93a9a7';
const lamp = '#f0c060';
const tide = '#82c4c8';
const numerals = ['一', '二', '三', '四', '五'];
const paces = ['', '平安抵达', '从容过河', '一步不差'];
// The line is picked by the finishing tick, so the same crossing always prints the same card.
const blessings = [
  ['给八秒后的自己，留了一盏灯。', '雨还在下，路已经亮了。', '第一盏灯点亮，骑楼下不再只有雨声。'],
  ['灯油只够换两次，刚好够我过河。', '三座桥，两次换灯，一步没有踏空。', '省下的每一滴灯油，都照在了脚下。'],
  ['潮水退去之前，我学会了等。', '等一场退潮，比赶路更需要耐心。', '在石台上站了一会儿，路自己露了出来。'],
  ['灯油不够的那一夜，有陌生人为我留了光。', '借来一束光，也留下一束，给下一个过河的人。', '素不相识，却被同一盏灯照过。'],
  ['提着灯笼回家，长街为我亮了一路。', '每一拍都是一个区块，每一步都算数。', '夜市的灯亮了，这一路的雨没有白淋。'],
];
const journeyBlessing = '下一场雨里，也许有人会借走我的光。';

export interface NightCard { level: number; name: string; tick: number; stars: number; marks: string[]; hash?: string; account?: string | null }
/** A night is `verified` when the time printed for it is the one the contract holds for the connected wallet. */
export interface JourneyCard { nights: { name: string; tick: number; stars: number; verified?: boolean }[]; marks: string[]; account?: string | null }
export interface Keepsake {
  file: File; preview: string; alt: string;
  /** The words to paste next to the picture, links included. */
  caption: string;
  /** The X composer, opened with the same words. */
  post: string;
  /** Puts the picture on the clipboard. Has to be called straight from a click. */
  copy(): Promise<void>;
}

type Pen = CanvasRenderingContext2D;

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
function rounded(c: Pen, x: number, y: number, width: number, height: number, radius: number) {
  c.beginPath();
  c.moveTo(x + radius, y);
  c.arcTo(x + width, y, x + width, y + height, radius);
  c.arcTo(x + width, y + height, x, y + height, radius);
  c.arcTo(x, y + height, x, y, radius);
  c.arcTo(x, y, x + width, y, radius);
  c.closePath();
}
/** Canvas letter-spacing is not available everywhere, so spaced text is laid out one glyph at a time. */
function spaced(c: Pen, text: string, x: number, y: number, gap: number) {
  for (const glyph of text) { c.fillText(glyph, x, y); x += c.measureText(glyph).width + gap; }
  return x - gap;
}
function wrap(c: Pen, text: string, width: number) {
  const lines: string[] = [];
  let line = '';
  for (const glyph of text) {
    // Closing punctuation stays with the line it ends rather than opening the next one.
    if (line && !'，。、！？'.includes(glyph) && c.measureText(line + glyph).width > width) { lines.push(line); line = glyph; }
    else line += glyph;
  }
  if (line) lines.push(line);
  return lines;
}
/** A blessing reads as two short lines, broken at the comma nearest its middle. */
function couplet(text: string) {
  const commas = [...text].flatMap((glyph, i) => glyph === '，' ? [i] : []);
  if (!commas.length) return [text];
  const middle = text.length / 2;
  const cut = commas.reduce((best, i) => Math.abs(i - middle) < Math.abs(best - middle) ? i : best);
  return [text.slice(0, cut + 1), text.slice(cut + 1)];
}
function star(c: Pen, x: number, y: number, radius: number, lit: boolean) {
  c.save();
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 5;
    const reach = i % 2 ? radius * 0.42 : radius;
    c.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
  }
  c.closePath();
  if (lit) { c.fillStyle = lamp; c.shadowColor = 'rgba(240,192,96,.6)'; c.shadowBlur = radius * 0.6; c.fill(); }
  else { c.strokeStyle = 'rgba(147,169,167,.6)'; c.lineWidth = Math.max(1.5, radius / 14); c.stroke(); }
  c.restore();
}
/** A paper lantern centred on (x, y), hanging from a cord that starts 2.4 sizes above it. */
function lantern(c: Pen, x: number, y: number, size: number, label: string) {
  c.save();
  const glow = c.createRadialGradient(x, y, size * 0.2, x, y, size * 3.4);
  glow.addColorStop(0, 'rgba(255,214,130,.5)');
  glow.addColorStop(1, 'rgba(255,214,130,0)');
  c.fillStyle = glow;
  c.fillRect(x - size * 3.4, y - size * 3.4, size * 6.8, size * 6.8);
  c.strokeStyle = 'rgba(236,227,207,.6)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(x, y - size * 2.4); c.lineTo(x, y - size * 1.24); c.stroke();
  const body = c.createRadialGradient(x, y - size * 0.2, size * 0.1, x, y, size * 1.25);
  body.addColorStop(0, '#fff3cf');
  body.addColorStop(0.6, '#f6c878');
  body.addColorStop(1, '#d98e3c');
  c.fillStyle = body;
  c.beginPath(); c.ellipse(x, y, size * 0.92, size * 1.18, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#5b3a1e';
  rounded(c, x - size * 0.42, y - size * 1.3, size * 0.84, size * 0.2, 4); c.fill();
  rounded(c, x - size * 0.42, y + size * 1.1, size * 0.84, size * 0.2, 4); c.fill();
  c.fillStyle = '#5b3212';
  c.font = `${Math.round(size * 0.9)}px ${serif}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, x, y + size * 0.04);
  c.restore();
}
function today() {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`;
}
/** The shared sheet: a rain-night plate fading into the dark, the wordmark, the date and who held the lamp. */
async function sheet(plate: string, plateHeight: number, seed: number, account?: string | null) {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const c = canvas.getContext('2d')!;
  c.fillStyle = night;
  c.fillRect(0, 0, WIDTH, HEIGHT);
  const image = await loadImage(`${import.meta.env.BASE_URL}assets/${plate}`);
  if (image) {
    const scale = Math.max(WIDTH / image.width, plateHeight / image.height);
    c.save();
    c.beginPath(); c.rect(0, 0, WIDTH, plateHeight); c.clip();
    c.drawImage(image, (WIDTH - image.width * scale) / 2, (plateHeight - image.height * scale) / 2, image.width * scale, image.height * scale);
    c.restore();
  }
  const fade = c.createLinearGradient(0, 0, 0, plateHeight);
  fade.addColorStop(0, 'rgba(12,24,30,.66)');
  fade.addColorStop(0.3, 'rgba(12,24,30,.1)');
  fade.addColorStop(0.7, 'rgba(12,24,30,.7)');
  fade.addColorStop(1, night);
  c.fillStyle = fade;
  c.fillRect(0, 0, WIDTH, plateHeight + 2);

  let state = seed >>> 0 || 1;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  c.strokeStyle = 'rgba(214,232,236,.2)';
  c.lineWidth = 1.5;
  c.beginPath();
  for (let i = 0; i < 110; i++) {
    const x = random() * WIDTH, y = random() * plateHeight, length = 24 + random() * 40;
    c.moveTo(x, y); c.lineTo(x - length * 0.16, y + length);
  }
  c.stroke();
  c.strokeStyle = 'rgba(236,227,207,.16)';
  c.lineWidth = 2;
  c.strokeRect(28, 28, WIDTH - 56, HEIGHT - 56);

  c.save();
  c.translate(MARGIN + 30, MARGIN + 34);
  c.rotate(-0.07);
  rounded(c, -30, -34, 60, 68, 6);
  c.fillStyle = '#c9553f';
  c.fill();
  c.fillStyle = '#f6e7d2';
  c.font = `42px ${serif}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('光', 0, 2);
  c.restore();
  c.save();
  // The plate's leaves and eaves run behind the header, so its text sits on a soft shadow.
  c.shadowColor = 'rgba(4,10,14,.8)';
  c.shadowBlur = 12;
  c.fillStyle = paper;
  c.font = `44px ${serif}`;
  const wordmarkEnd = spaced(c, '光的回声', MARGIN + 86, MARGIN + 50, 10);
  c.fillStyle = mist;
  c.font = `24px ${sans}`;
  spaced(c, '雨夜掌灯人', wordmarkEnd + 26, MARGIN + 46, 4);
  c.textAlign = 'right';
  c.fillText(today(), WIDTH - MARGIN, account ? MARGIN + 30 : MARGIN + 46);
  if (account) c.fillText(`掌灯人 ${shortAddress(account)}`, WIDTH - MARGIN, MARGIN + 66);
  c.restore();
  return { canvas, c };
}
/** The scannable way back to the game, with the proof line beside it. Returns the width left of the code. */
function footer(c: Pen, status: string, verified: boolean, detail: string, detailFont: string) {
  const code = qrcode(0, 'M');
  code.addData(playUrl);
  code.make();
  const count = code.getModuleCount();
  // Whole-pixel modules keep the code crisp; four modules of quiet zone keep it scannable.
  const cell = Math.round(168 / count), quiet = cell * 4, size = cell * count + quiet * 2;
  const x = WIDTH - MARGIN - size, y = HEIGHT - MARGIN - size - 36;
  rounded(c, x, y, size, size, 10);
  c.fillStyle = paper;
  c.fill();
  c.fillStyle = '#10272d';
  for (let row = 0; row < count; row++) for (let column = 0; column < count; column++) {
    if (code.isDark(row, column)) c.fillRect(x + quiet + column * cell, y + quiet + row * cell, cell, cell);
  }
  c.save();
  c.textAlign = 'center';
  c.fillStyle = mist;
  c.font = `22px ${sans}`;
  c.fillText('扫码，点亮第一盏灯', x + size / 2, HEIGHT - MARGIN);
  c.restore();
  c.fillStyle = verified ? tide : mist;
  c.font = `28px ${sans}`;
  c.fillText(status, MARGIN, HEIGHT - MARGIN - 68);
  c.fillStyle = mist;
  c.font = detailFont;
  c.fillText(detail, MARGIN, HEIGHT - MARGIN - 34);
  c.save();
  c.globalAlpha = 0.82;
  c.fillStyle = paper;
  c.font = `24px ${sans}`;
  c.fillText(playUrl.replace(/^https:\/\/|\/$/g, ''), MARGIN, HEIGHT - MARGIN);
  c.restore();
  return x - 40 - MARGIN;
}
/** Clipboards only take PNG, so the picture is encoded again when it is copied. */
async function png(picture: Blob) {
  const bitmap = await createImageBitmap(picture);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The card could not be copied.')), 'image/png'));
}
function finish(canvas: HTMLCanvasElement, name: string, words: string, alt: string, proof = '') {
  const lines = [words, ...(proof ? [`链上验证：${proof}`] : [])];
  const invite = '来点亮你的第一盏灯：';
  return new Promise<Keepsake>((resolve, reject) => canvas.toBlob(blob => {
    if (!blob) { reject(new Error('The card could not be encoded.')); return; }
    const file = new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    resolve({
      file, alt,
      // The preview is a data URL because in-app browsers only offer long-press saving for those.
      preview: canvas.toDataURL('image/jpeg', 0.92),
      caption: [...lines, invite + playUrl].join('\n'),
      post: `https://twitter.com/intent/tweet?text=${encodeURIComponent([...lines, invite].join('\n'))}&url=${encodeURIComponent(playUrl)}&hashtags=Monad`,
      // The picture goes in as a pending promise: Safari only allows the write while the click is still being handled.
      copy: () => navigator.clipboard.write([new ClipboardItem({ 'image/png': png(file) })]),
    });
  }, 'image/jpeg', 0.92));
}

export async function nightCard(data: NightCard): Promise<Keepsake> {
  const numeral = numerals[data.level - 1];
  const seconds = (data.tick / 20).toFixed(2);
  const blessing = blessings[data.level - 1][data.tick % 3];
  const { canvas, c } = await sheet(plateFiles[data.level - 1], 880, data.tick * 131 + data.level, data.account);

  lantern(c, MARGIN + 50, 700, 48, numeral);
  c.save();
  c.shadowColor = 'rgba(0,0,0,.65)';
  c.shadowBlur = 18;
  c.fillStyle = lamp;
  c.font = `30px ${sans}`;
  spaced(c, `第${numeral}夜`, MARGIN + 142, 668, 10);
  c.fillStyle = paper;
  c.font = `104px ${serif}`;
  spaced(c, data.name, MARGIN + 136, 782, 8);
  c.restore();

  c.fillStyle = lamp;
  c.font = `132px ${figures}`;
  c.fillText(seconds, MARGIN - 4, 964);
  const secondsEnd = MARGIN - 4 + c.measureText(seconds).width;
  c.font = `44px ${serif}`;
  c.fillText('秒', secondsEnd + 14, 964);
  c.fillStyle = mist;
  c.font = `26px ${sans}`;
  c.fillText(`${data.tick} 帧 · 每一帧都可以重放验证`, MARGIN, 1012);
  for (let i = 0; i < 3; i++) star(c, WIDTH - MARGIN - 40 - (2 - i) * 92, 922, 40, i < data.stars);

  let chipX = MARGIN;
  for (const mark of [paces[data.stars], ...data.marks]) {
    c.font = `26px ${sans}`;
    const width = c.measureText(mark).width + 36;
    rounded(c, chipX, 1040, width, 48, 6);
    c.strokeStyle = 'rgba(240,192,96,.5)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = lamp;
    c.fillText(mark, chipX + 18, 1073);
    chipX += width + 14;
  }

  const room = data.hash
    ? footer(c, '已上链 · Monad 测试网可验证', true, `tx ${data.hash.slice(0, 14)}…${data.hash.slice(-12)}`, `24px ${mono}`)
    : footer(c, '本地通关 · 尚未上链', false, '写上 Monad 后，合约会逐帧重放验证', `24px ${sans}`);
  c.fillStyle = paper;
  c.font = `44px ${serif}`;
  const verse = couplet(blessing);
  const widest = Math.max(...verse.map(line => c.measureText(line).width));
  if (widest > room) c.font = `${Math.floor(44 * room / widest)}px ${serif}`;
  verse.forEach((line, i) => c.fillText(line, MARGIN, 1160 + i * 62));

  const stars = '★'.repeat(data.stars) + '☆'.repeat(3 - data.stars);
  return finish(canvas, `光的回声-第${numeral}夜-${data.name}`,
    `我在《光的回声》第${numeral}夜「${data.name}」用 ${seconds} 秒抵达风铃，${stars}。${blessing}${data.hash ? '这一局已写上 Monad 测试网，可以逐帧验证。' : ''}`,
    `第${numeral}夜 ${data.name} 通关纪念卡：${seconds} 秒，${data.stars} 星${data.hash ? '，已上链' : ''}`,
    data.hash ? `${explorer}/tx/${data.hash}` : '');
}

export async function journeyCard(data: JourneyCard): Promise<Keepsake> {
  const total = data.nights.reduce((sum, played) => sum + played.stars, 0);
  const { canvas, c } = await sheet(plateFiles[0], 760, total * 977 + data.nights[0].tick, data.account);

  // The same sagging wire as the map: a quadratic through (40, 250), (540, 430), (1040, 250).
  c.strokeStyle = 'rgba(236,227,207,.55)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(40, 250); c.quadraticCurveTo(WIDTH / 2, 430, WIDTH - 40, 250); c.stroke();
  data.nights.forEach((_, i) => {
    const along = 0.1 + i * 0.2;
    lantern(c, 40 + along * (WIDTH - 80), 250 + 2 * (1 - along) * along * 180 + 34 * 2.4, 34, numerals[i]);
  });

  c.save();
  c.shadowColor = 'rgba(0,0,0,.65)';
  c.shadowBlur = 18;
  c.fillStyle = lamp;
  c.font = `30px ${sans}`;
  spaced(c, '五个雨夜 · 五盏灯', MARGIN, 596, 8);
  c.fillStyle = paper;
  c.font = `104px ${serif}`;
  spaced(c, '长街全亮', MARGIN - 4, 706, 8);
  c.restore();

  data.nights.forEach((played, i) => {
    const baseline = 830 + i * 62;
    c.fillStyle = mist;
    c.font = `26px ${sans}`;
    c.fillText(`第${numerals[i]}夜`, MARGIN, baseline);
    c.fillStyle = paper;
    c.font = `40px ${serif}`;
    c.fillText(played.name, MARGIN + 112, baseline);
    if (played.verified) {
      const nameEnd = MARGIN + 112 + c.measureText(played.name).width;
      c.fillStyle = tide;
      c.font = `22px ${sans}`;
      c.fillText('已上链', nameEnd + 20, baseline - 4);
    }
    c.save();
    c.textAlign = 'right';
    c.fillStyle = lamp;
    c.font = `34px ${serif}`;
    c.fillText('秒', WIDTH - MARGIN - 150, baseline);
    c.font = `40px ${figures}`;
    c.fillText((played.tick / 20).toFixed(2), WIDTH - MARGIN - 196, baseline);
    c.restore();
    for (let n = 0; n < 3; n++) star(c, WIDTH - MARGIN - 14 - (2 - n) * 38, baseline - 14, 14, n < played.stars);
    c.fillStyle = 'rgba(236,227,207,.1)';
    c.fillRect(MARGIN, baseline + 19, WIDTH - MARGIN * 2, 1);
  });

  const verified = data.nights.filter(played => played.verified).length;
  const room = verified && contractAddress
    ? footer(c, `链上已验证 ${verified} / ${data.nights.length} 夜 · Monad 测试网`, true, `合约 ${contractAddress.slice(0, 10)}…${contractAddress.slice(-8)}`, `24px ${mono}`)
    : footer(c, '五夜长街，全部点亮', false, '每一局都能由 Monad 上的合约逐帧重放验证', `24px ${sans}`);
  c.fillStyle = lamp;
  c.font = `28px ${sans}`;
  c.fillText(wrap(c, [`${total} / 15 星`, ...data.marks].join(' · '), room)[0], MARGIN, 1168);
  c.fillStyle = paper;
  c.font = `38px ${serif}`;
  c.fillText(wrap(c, journeyBlessing, room)[0], MARGIN, 1232);

  return finish(canvas, '光的回声-五夜全亮',
    `《光的回声》五夜全亮，${total} / 15 星${verified ? `，${verified === data.nights.length ? '五夜都' : `其中 ${verified} 夜`}已写上 Monad 测试网` : ''}。${journeyBlessing}`,
    `五夜纪念卡：五盏灯全部点亮，${total} / 15 星${verified ? `，${verified} 夜已上链` : ''}`);
}
