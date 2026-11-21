import { paintScene, scenePalettes } from './scenery';
/** All coordinates in RenderLevel / RenderState are deci-pixels. Drawing uses pixels. */
export interface RenderGap {
  a: number;
  b: number;
  kind: 'lamp' | 'tide';
  lamp: number;
  mask: number;
}

export interface RenderLevel {
  id: number;
  name: string;
  subtitle: string;
  beatTicks: number;
  beats: number;
  startX: number;
  bellX: number;
  minX: number;
  maxX: number;
  speed: number;
  maxSwitches: number;
  lampCount: number;
  borrowable: boolean;
  hasItem: boolean;
  itemRequired: boolean;
  itemX: number;
  itemRadius: number;
  itemTicks: number;
  par2: number;
  par3: number;
  gaps: RenderGap[];
}

export interface RenderState {
  x: number;
  tick: number;
  hasItem: boolean;
  busy: number;
  status: 'playing' | 'win' | 'fell' | 'timeup';
  finishTick?: number;
  fellTick?: number;
  gapIndex?: number;
}

export interface RenderView {
  level: RenderLevel;
  state: RenderState;
  score: readonly number[] | Uint8Array;
  borrowed: readonly number[] | Uint8Array;
  mode: 'ready' | 'recording' | 'playing' | 'replay' | 'result';
  /** Monotonic presentation time, in seconds; independent of the simulation tick. */
  time: number;
  alpha: number;
  previousX?: number;
  selectedLamp: number;
  preview?: { beat: number; lamp: number } | null;
  borrowArrival?: number;
  borrowedAuthor?: string;
  paused?: boolean;
}

type Point = readonly [number, number];
type Paint = string | CanvasGradient;
const WIDTH = 1120;
const HEIGHT = 460;
const GROUND = 353;
const GOLD = '#f5cf84';
const BLUE = '#a9e0df';
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'];

function poly(c: CanvasRenderingContext2D, points: Point[], fill: Paint): void {
  c.fillStyle = fill;
  c.beginPath();
  points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y));
  c.closePath();
  c.fill();
}

function stroke(c: CanvasRenderingContext2D, points: Point[], color: string, width = 1): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y));
  c.stroke();
}

function ellipse(c: CanvasRenderingContext2D, x: number, y: number,
  rx: number, ry: number, color: Paint): void {
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
  c.fill();
}

function label(c: CanvasRenderingContext2D, text: string, x: number, y: number,
  color = '#e9e4cf', size = 12): void {
  c.font = `${size}px "Microsoft YaHei UI", "PingFang SC", sans-serif`;
  c.textAlign = 'center';
  c.fillStyle = color;
  c.shadowColor = '#10232c';
  c.shadowBlur = 5;
  c.fillText(text, x, y);
  c.shadowBlur = 0;
}

function tideSafe(gap: RenderGap, beat: number): boolean {
  return ((gap.mask >>> beat) & 1) === 1;
}

export function createRenderer(canvas: HTMLCanvasElement): {
  draw(view: RenderView): void;
  destroy(): void;
} {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法绘制游戏画面。');
  const ctx: CanvasRenderingContext2D = context;
  const scenery = document.createElement('canvas');
  scenery.width = WIDTH;
  scenery.height = HEIGHT;
  const background = scenery.getContext('2d')!;
  const plateFiles = ['plate.webp', 'plate-2.webp', 'plate-3.webp', 'plate.webp', 'plate-5.webp'];
  const plates = new Map<string, HTMLImageElement>();
  for (const file of new Set(plateFiles)) {
    const image = new Image();
    image.onload = () => { dirty = true; };
    image.src = `${import.meta.env.BASE_URL}assets/${file}`;
    plates.set(file, image);
  }
  let dirty = true;
  let lastLevel: RenderLevel | undefined;
  let lastStatus = '';
  let statusTime = 0;
  let visualTime = 0;
  let lastX = 0;
  let face = 1;
  let disposed = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function bank(c: CanvasRenderingContext2D, a: number, b: number): void {
    if (b <= a) return;
    poly(c, [[a, GROUND], [b, GROUND], [b - 3, GROUND + 55], [a, GROUND + 55]], '#192d38');
    for (let row = 0; row < 3; row++) {
      for (let x = a - 35 + (row % 2) * 24; x < b; x += 52) {
        const left = Math.max(x, a);
        const right = Math.min(x + 50, b);
        if (right <= left) continue;
        const y = GROUND + 3 + row * 14;
        poly(c, [[left, y + 1], [right, y], [right - 1, y + 12], [left + 1, y + 13]],
          ['#4a5354', '#495857', '#515d5b', '#3d5054'][(Math.abs(Math.floor(x)) + row) % 4]);
      }
    }
    c.fillStyle = '#8c9284';
    c.fillRect(a, GROUND - 3, b - a, 5);
    stroke(c, [[a, GROUND - 3], [b, GROUND - 3]], '#c5b99b', 1.3);
  }

  function balcony(c: CanvasRenderingContext2D, right = false): void {
    c.save();
    if (right) { c.translate(WIDTH, 0); c.scale(-1, 1); }
    poly(c, [[0, 151], [188, 151], [177, 164], [0, 172]], '#252f34');
    stroke(c, [[0, 150], [187, 150]], '#c1a680', 3);
    for (let x = 10; x <= 171; x += 23) stroke(c, [[x, 151], [x, 133]], '#394349', 4);
    stroke(c, [[0, 131], [176, 131]], '#968e7b', 3);
    stroke(c, [[156, 153], [168, 173], [198, 177]], '#614a35', 5);
    c.restore();
  }

  function architecture(level: RenderLevel): void {
    const c = background;
    c.clearRect(0, 0, WIDTH, HEIGHT);
    const sky = c.createLinearGradient(0, 0, 0, HEIGHT);
    sky.addColorStop(0, '#526578');
    sky.addColorStop(1, '#263f4c');
    c.fillStyle = sky;
    c.fillRect(0, 0, WIDTH, HEIGHT);
    const plate = plates.get(plateFiles[level.id - 1])!;
    if (plate.complete && plate.naturalWidth) {
      const scale = Math.max(WIDTH / plate.width, HEIGHT / plate.height);
      c.save();
      if (level.id === 4) { c.translate(WIDTH, 0); c.scale(-1, 1); }
      c.drawImage(plate, (WIDTH - plate.width * scale) / 2,
        (HEIGHT - plate.height * scale) * 0.48, plate.width * scale, plate.height * scale);
      c.restore();
    } else if (level.id !== 1) paintScene(c, level.id);
    c.fillStyle = ['#0d212c38', '#1a1f3a30', '#0f2a3a40', '#1a1d4a52', '#2a1a3030'][level.id - 1];
    c.fillRect(0, 0, WIDTH, HEIGHT);
    const water = c.createLinearGradient(0, GROUND, 0, HEIGHT);
    water.addColorStop(0, scenePalettes[level.id - 1][2] + '96');
    water.addColorStop(1, scenePalettes[level.id - 1][0] + 'e8');
    c.fillStyle = water;
    c.fillRect(0, GROUND + 16, WIDTH, HEIGHT - GROUND);
    let cursor = 0;
    for (const gap of [...level.gaps].sort((a, b) => a.a - b.a)) {
      bank(c, cursor, gap.a / 10);
      cursor = gap.b / 10;
    }
    bank(c, cursor, WIDTH);
    balcony(c);
    if (level.borrowable) balcony(c, true);
    const door = level.bellX / 10 - 6;
    poly(c, [[door - 24, GROUND - 3], [door - 24, 277], [door - 15, 262],
      [door, 255], [door + 15, 262], [door + 26, 277], [door + 26, GROUND - 3]], '#644d37');
    stroke(c, [[door + 27, 269], [level.bellX / 10 + 26, 269],
      [level.bellX / 10 + 26, 276]], '#b59b6c', 3);
    dirty = false;
    lastLevel = level;
  }

  function character(x: number, y: number, scale: number, ghost: boolean,
    step: number, facing = 1): void {
    const c = ctx;
    c.save();
    c.translate(x, y);
    c.scale(scale * facing, scale);
    if (ghost) c.globalAlpha = 0.8;
    const coat = ghost ? '#9fc9d4' : '#f5be5e';
    const shadow = ghost ? '#5c8594' : '#b17c3d';
    const ink = ghost ? '#64818e' : '#2c3236';
    const stride = Math.sin(step) * 4;
    stroke(c, [[-4, -12], [-4 - stride, 0], [-7 - stride, 0]], ink, 4);
    stroke(c, [[3, -12], [4 + stride, -1], [7 + stride, -1]], ink, 4);
    poly(c, [[-6, -30], [2, -34], [9, -24], [11, -12], [4, -9], [-10, -11]], coat);
    poly(c, [[-6, -30], [-1, -26], [-5, -11], [-10, -11]], shadow);
    ellipse(c, 0, -35, 7, 8, ghost ? '#bdd9da' : '#e4b68b');
    poly(c, [[-9, -35], [-8, -40], [-2, -45], [6, -43], [10, -37], [4, -38], [1, -33]], coat);
    poly(c, [[-3, -30], [4, -31], [8, -28], [0, -26],
      [-12, -23 + Math.sin(visualTime * 4) * 1.5], [-18, -25], [-9, -26]], ghost ? '#7ab0bf' : '#dd7056');
    stroke(c, [[3, -25], [6, -20], [ghost ? 16 : 9, -22]], shadow, 3);
    c.restore();
  }

  function beam(level: RenderLevel, lamp: number, borrowed: boolean, pulse: number): void {
    const gap = level.gaps.find(g => g.kind === 'lamp' && g.lamp === lamp);
    if (!gap) return;
    const origin: Point = borrowed ? [WIDTH - 198, 178] : [198, 178];
    const destination = (gap.a + gap.b) / 20;
    const halfWidth = (gap.b - gap.a) / 20 + 12;
    const c = ctx;
    c.save();
    c.globalAlpha = pulse;
    const light = c.createLinearGradient(origin[0], origin[1], destination, GROUND);
    light.addColorStop(0, borrowed ? 'rgba(148,226,232,.38)' : 'rgba(255,219,144,.46)');
    light.addColorStop(0.88, borrowed ? 'rgba(128,219,229,.12)' : 'rgba(255,207,116,.20)');
    light.addColorStop(1, borrowed ? 'rgba(148,226,232,.28)' : 'rgba(255,213,118,.32)');
    poly(c, [[origin[0] - 3, origin[1]], [origin[0] + 5, origin[1] - 4],
      [destination + halfWidth, GROUND + 7], [destination - halfWidth, GROUND + 7]], light);
    ellipse(c, destination, GROUND + 5, halfWidth, 5, borrowed ? '#b2e8e533' : '#ffe3a333');
    if (!reducedMotion) {
      for (let i = 0; i < 10; i++) {
        const progress = (i * 0.083 + visualTime * 0.14) % 1;
        ellipse(c, origin[0] + (destination - origin[0]) * progress + Math.sin(i * 17) * progress * 40,
          origin[1] + (GROUND - origin[1]) * progress, 1.1, 1.7, borrowed ? '#c4f6f188' : '#ffe9ab99');
      }
    }
    // Each reflection stays underneath the bridge lit by this lamp.
    for (let row = 0; row < 6; row++) {
      const y = GROUND + 21 + row * 6;
      const drift = Math.sin(row * 2.6 + (reducedMotion ? 0 : visualTime * 1.3)) * (row + 2);
      ellipse(c, destination + drift, y, halfWidth * (0.46 - row * 0.052), 1,
        borrowed ? '#a2ddd53d' : '#e9c77a40');
    }
    c.translate(origin[0], origin[1]);
    c.rotate(Math.atan2(GROUND - origin[1], destination - origin[0]) - Math.PI / 2);
    poly(c, [[-5, -9], [5, -9], [11, 4], [-11, 4]], borrowed ? '#78a4ab' : '#c29455');
    ellipse(c, 0, 4, 10, 3, borrowed ? '#d5fffa' : '#ffedb0');
    c.restore();
  }

  function lampBridge(gap: RenderGap, own: number, borrowed: number): void {
    const a = gap.a / 10;
    const b = gap.b / 10;
    const mid = (a + b) / 2;
    const lit = gap.lamp === own || gap.lamp === borrowed;
    const borrowedOnly = gap.lamp !== own && gap.lamp === borrowed;
    const color = borrowedOnly ? BLUE : GOLD;
    const c = ctx;
    c.save();
    if (lit) {
      c.shadowBlur = 13;
      c.shadowColor = color;
      c.fillStyle = color;
      c.fillRect(a, GROUND - 4, b - a, 5);
      c.shadowBlur = 0;
      poly(c, [[a, GROUND + 1], [mid, GROUND + 7], [b, GROUND + 1],
        [b - 8, GROUND + 13], [mid, GROUND + 19], [a + 7, GROUND + 13]], borrowedOnly ? '#66999f' : '#b89562');
      for (let x = a + 6; x < b - 5; x += 17) stroke(c, [[x, GROUND + 3], [x + 6, GROUND + 11]], color, 1.5);
      for (const x of [a + 5, mid, b - 5]) {
        stroke(c, [[x, GROUND], [x, GROUND - 14]], color, 2);
        ellipse(c, x, GROUND - 15, 3, 3, borrowedOnly ? '#e3fff6' : '#ffe2a1');
      }
      c.beginPath();
      c.moveTo(a + 5, GROUND - 14);
      c.quadraticCurveTo((a + mid) / 2, GROUND - 7, mid, GROUND - 14);
      c.quadraticCurveTo((mid + b) / 2, GROUND - 7, b - 5, GROUND - 14);
      c.strokeStyle = color;
      c.lineWidth = 1.8;
      c.stroke();
    } else {
      c.setLineDash([3, 6]);
      stroke(c, [[a, GROUND - 1], [b, GROUND - 1]], '#89bec2', 1.6);
      c.setLineDash([]);
    }
    label(c, ROMAN[gap.lamp - 1] || String(gap.lamp), mid, GROUND + 42,
      lit ? color : '#a4c3c6', 14);
    c.restore();
  }

  function tidePlatform(gap: RenderGap, beat: number, beats: number): void {
    const c = ctx;
    const a = gap.a / 10;
    const b = gap.b / 10;
    const safe = tideSafe(gap, beat);
    const warning = safe && beat + 1 < beats && !tideSafe(gap, beat + 1);
    const waterY = safe ? GROUND + 29 : GROUND - 8;
    c.save();
    for (let x = a; x < b; x += 25) {
      const right = Math.min(b, x + 23);
      poly(c, [[x, GROUND], [right, GROUND - 1], [right - 2, GROUND + 24], [x + 1, GROUND + 24]], '#6c7f7c');
      stroke(c, [[x + 2, GROUND - 1], [right - 2, GROUND - 2]], '#b5c3ac', 3);
    }
    const flood = c.createLinearGradient(0, waterY, 0, GROUND + 50);
    flood.addColorStop(0, safe ? '#568d9b72' : '#5599afb8');
    flood.addColorStop(1, '#214754f0');
    c.fillStyle = flood;
    c.fillRect(a, waterY, b - a, GROUND + 53 - waterY);
    const wave: Point[] = [];
    for (let x = a; x <= b; x += 4) wave.push([x, waterY + Math.sin(x * 0.065 + visualTime * 2.5) * 2]);
    stroke(c, wave, safe ? '#a9cdca77' : '#c3e6e5cc', 1.5);
    label(c, warning ? '潮水将至' : safe ? '退潮 · 可走' : '涨潮 · 等一等', (a + b) / 2,
      GROUND + 45, warning ? '#f5c17d' : safe ? '#c4d8cc' : '#b6e1ec', 11);
    if (warning) {
      stroke(c, [[a + 2, GROUND - 12], [b - 2, GROUND - 12]], '#f5c17d88', 1);
    }
    c.restore();
  }

  function lantern(x: number, y: number, scale: number, color = '#edb569', swing = 0): void {
    const c = ctx;
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    c.rotate(swing);
    stroke(c, [[0, -17], [0, -11]], '#d7b777', 1);
    c.shadowColor = color;
    c.shadowBlur = 15;
    ellipse(c, 0, 0, 9, 12, color);
    c.shadowBlur = 0;
    stroke(c, [[-6, -10], [6, -10]], '#6c503d', 2);
    stroke(c, [[-6, 10], [6, 10]], '#6c503d', 2);
    stroke(c, [[0, 11], [0, 20]], '#bd6951', 1.5);
    stroke(c, [[-3, -8], [-3, 8]], '#ffe6b880', 1);
    stroke(c, [[3, -8], [3, 8]], '#a2694d80', 1);
    c.restore();
  }

  function draw(view: RenderView): void {
    if (disposed) return;
    const { level, state } = view;
    if (!view.paused) visualTime = view.time;
    const statusKey = `${level.id}:${view.mode}:${state.status}`;
    if (statusKey !== lastStatus) {
      statusTime = visualTime;
      lastStatus = statusKey;
      if (state.tick === 0) { lastX = state.x / 10; face = 1; }
    }
    const eventTime = Math.max(0, visualTime - statusTime);
    if (dirty || lastLevel !== level) architecture(level);
    const size = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round((size.width || WIDTH) * dpr));
    const height = Math.max(1, Math.round((size.height || HEIGHT) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(scenery, 0, 0);
    const lastTick = view.mode === 'recording' ? state.tick : Math.max(0, state.tick - 1);
    const beat = view.preview?.beat ?? Math.min(level.beats - 1, Math.floor(lastTick / level.beatTicks));
    const own = view.preview?.lamp ?? (view.mode === 'recording' || view.mode === 'ready'
      ? view.selectedLamp || view.score[beat] || 1 : view.score[beat] || 1);
    const borrowed = view.borrowed[beat] || 0;
    if (level.id === 2 && (view.mode === 'ready' || view.mode === 'playing')) {
      const next = Array.from(view.score).findIndex((lamp, index) => index > beat && lamp !== view.score[beat]);
      if (next >= 0) label(ctx, `第${next + 1}拍 → 桥${ROMAN[view.score[next] - 1]}`, 246, 166, '#ffe1a3', 13);
    }
    const pulse = level.beatTicks === 8 && !reducedMotion && view.mode === 'playing'
      ? 0.8 + 0.2 * (1 - (lastTick % level.beatTicks) / level.beatTicks) : 1;

    for (let i = 0; i < 35; i++) {
      const x = (i * 97 + visualTime * 6) % (WIDTH + 30) - 15;
      const y = 385 + (i * 17 % 75);
      stroke(ctx, [[x, y], [x + 8 + i % 17, y]], '#acc4bc3b');
    }
    beam(level, own, false, pulse);
    const arrival = reducedMotion ? 1 : view.borrowArrival ?? 1;
    if (borrowed) {
      const x = WIDTH - 198;
      const glow = ctx.createRadialGradient(x, 178, 1, x, 178, 37);
      glow.addColorStop(0, 'rgba(188,247,240,.48)'); glow.addColorStop(1, 'transparent');
      ctx.save(); ctx.globalAlpha = Math.min(1, arrival * 5);
      ellipse(ctx, x, 178, 37, 37, glow); ctx.restore();
      beam(level, borrowed, true, Math.min(1, Math.max(0, (arrival - 0.12) * 2.3)));
    }
    for (const gap of level.gaps) {
      if (gap.kind === 'lamp') lampBridge(gap, own, arrival >= 0.56 ? borrowed : 0);
      else tidePlatform(gap, beat, level.beats);
    }
    character(145, 148, 0.94, view.mode !== 'recording', 0);
    if (borrowed) {
      character(WIDTH - 145, 148, 0.94, true, 0, -1);
      const author = view.borrowedAuthor || '陌生人';
      label(ctx, author.length > 16 ? `${author.slice(0, 6)}…${author.slice(-4)}` : author,
        WIDTH - 145, 91, '#c5eeea', 11);
    }

    const door = level.bellX / 10 - 6;
    const locked = level.itemRequired && !state.hasItem;
    poly(ctx, [[door - 17, GROUND - 3], [door - 17, 278], [door - 9, 266],
      [door + 4, 263], [door + 16, 278], [door + 16, GROUND - 3]], locked ? '#5e5550' : '#e6b265');
    if (locked) {
      stroke(ctx, [[door, 268], [door, GROUND - 3]], '#b39b79', 2);
      ellipse(ctx, door + 5, 315, 2, 2, GOLD);
      label(ctx, '提灯归来', door, 245, '#ead5af', 11);
    } else {
      ctx.fillStyle = '#4d4841';
      ctx.fillRect(door - 3, 272, 3, 75);
    }

    const bell = level.bellX / 10 + 26;
    const sw = state.status === 'win'
      ? Math.sin(eventTime * 14) * Math.exp(-eventTime * 1.4) * 0.55 : Math.sin(visualTime * 1.5) * 0.035;
    ctx.save();
    ctx.translate(bell, 276);
    ctx.rotate(reducedMotion ? sw * 0.15 : sw);
    stroke(ctx, [[0, 0], [0, 10]], '#e9d3a0');
    poly(ctx, [[-5, 12], [0, 8], [5, 12], [8, 21], [-8, 21]], '#f5cd7a');
    stroke(ctx, [[0, 21], [0, 30]], '#e3b573');
    poly(ctx, [[-1, 29], [3, 30], [2, 39], [-2, 38]], '#d4634c');
    ctx.restore();

    if (level.hasItem && !state.hasItem) {
      const x = level.itemX / 10;
      if (level.itemRequired) {
        stroke(ctx, [[x - 18, GROUND - 1], [x - 18, GROUND - 55], [x, GROUND - 55]], '#6a5340', 3);
        lantern(x, GROUND - 29, 1, '#f5c676', Math.sin(visualTime * 1.4) * 0.05);
      } else {
        const y = GROUND - 31;
        poly(ctx, [[x - 10, y], [x - 4, y + 6], [x + 9, y + 6], [x + 15, y]], '#f1deb7');
        poly(ctx, [[x - 2, y], [x + 6, y - 7], [x + 6, y]], '#fff1c9');
        stroke(ctx, [[x - 18, y + 8], [x + 19, y + 8]], '#987f61', 2);
      }
      if (Math.abs(state.x - level.itemX) <= level.itemRadius && state.busy === 0 && state.status === 'playing') {
        label(ctx, level.itemRequired ? 'E · 拾灯笼' : 'E · 拾纸船', x, GROUND - 91, '#fff0c3', 11);
      }
    }

    const moving = view.mode === 'playing' || view.mode === 'replay';
    const alpha = Math.max(0, Math.min(1, view.alpha));
    const x = (moving && state.status === 'playing' && view.previousX !== undefined
      ? view.previousX + (state.x - view.previousX) * alpha : state.x) / 10;
    if (Math.abs(x - lastX) > 0.01) face = x > lastX ? 1 : -1;
    const walking = moving && Math.abs(x - lastX) > 0.01 && state.busy === 0;
    lastX = x;
    let y = GROUND - 3;
    if (state.status === 'fell') y += Math.min(92, eventTime * eventTime * 290);
    if (state.busy > 0) y -= Math.sin((1 - state.busy / Math.max(1, level.itemTicks)) * Math.PI) * 9;
    ctx.save();
    if (state.status === 'fell') ctx.globalAlpha = Math.max(0.12, 1 - eventTime * 0.8);
    character(x, y, 1.1, false, walking ? visualTime * 10 : 0, face);
    if (state.hasItem && level.itemRequired) lantern(x + face * 15, y - 18, 0.46);
    ctx.restore();
    if (state.busy > 0) {
      const fraction = 1 - state.busy / Math.max(1, level.itemTicks);
      ctx.strokeStyle = '#d4b57255';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y - 66, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = GOLD;
      ctx.beginPath();
      ctx.arc(x, y - 66, 10, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2);
      ctx.stroke();
    }
    if (state.status === 'fell') {
      ctx.strokeStyle = '#c2d9d7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, GROUND + 46, Math.min(42, eventTime * 37), 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      label(ctx, `↓ ${((state.fellTick ?? state.tick) * 0.05).toFixed(2)} 秒`, x, GROUND - 65, '#f7b08a', 13);
    }
    if (state.status === 'win' && !reducedMotion && eventTime < 5) {
      for (let i = 0; i < 18; i++) {
        const a = (i * 0.062 + eventTime * 0.18) % 1;
        ellipse(ctx, bell + Math.sin(i * 14 + a * 3) * 64 * a, 286 - a * 87, 1.8, 1.8, '#ffe8a9');
      }
    }
    const rainCount = reducedMotion ? 15 : level.id === 3 ? 65 : 44;
    for (let i = 0; i < rainCount; i++) {
      const rx = (i * 163 + WIDTH - (visualTime * 14) % WIDTH) % WIDTH;
      const ry = (i * 67 + visualTime * 125) % (HEIGHT + 20) - 10;
      stroke(ctx, [[rx, ry], [rx - 2, ry + 7]], '#d5e9ed31', 0.8);
    }
  }

  return {
    draw,
    destroy() { disposed = true; for (const image of plates.values()) image.onload = null; },
  };
}
