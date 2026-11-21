import levelData from '../../../shared/levels.json';

/** All positions are integer decipixels; time advances only in 50 ms ticks. */
export const TICK_MS = 50;
export type Action = 0 | 1 | 2 | 3;
export type Score = readonly number[] | Uint8Array;
export type Gap = { a: number; b: number; kind: 'lamp' | 'tide'; lamp: number; mask: number };
export interface Level {
  id: number; name: string; subtitle: string; beatTicks: number; beats: number;
  startX: number; bellX: number; minX: number; maxX: number; speed: number;
  maxSwitches: number; lampCount: number; borrowable: boolean; hasItem: boolean;
  itemRequired: boolean; itemX: number; itemRadius: number; itemTicks: number;
  par2: number; par3: number; gaps: Gap[];
}
export interface SimState {
  x: number; tick: number; hasItem: boolean; busy: number;
  status: 'playing' | 'win' | 'fell' | 'timeup';
  finishTick?: number; fellTick?: number; gapIndex?: number;
}
export type SimResult = SimState;
export const levels = levelData as Level[];

export class SimValidationError extends Error {
  constructor(public readonly code: 'BadScore' | 'BadBorrow' | 'BadInputs') {
    super(code);
    this.name = 'SimValidationError';
  }
}

export function switches(score: Score): number {
  let count = 0;
  for (let i = 1; i < score.length; i++) if (score[i] !== score[i - 1]) count++;
  return count;
}

export function validateScore(level: Level, score: Score): boolean {
  return score.length === level.beats
    && Array.from(score).every(lamp => Number.isInteger(lamp) && lamp >= 1 && lamp <= level.lampCount)
    && switches(score) <= level.maxSwitches;
}

export function createState(level: Level): SimState {
  return { x: level.startX, tick: 0, hasItem: false, busy: 0, status: 'playing' };
}

/** The caller validates complete scores before starting a live run. This is a pure single tick. */
export function step(level: Level, state: SimState, score: Score, borrowed: Score, action: number): SimState {
  if (state.status !== 'playing') return { ...state };
  if (!Number.isInteger(action) || action < 0 || action > 3) throw new SimValidationError('BadInputs');
  const tick = state.tick;
  if (tick >= level.beats * level.beatTicks) return { ...state, status: 'timeup' };
  const beat = Math.floor(tick / level.beatTicks);
  const next: SimState = { ...state, tick: tick + 1 };

  if (next.busy > 0) {
    next.busy--;
    if (next.busy === 0) next.hasItem = true;
  } else if (action === 1) next.x = Math.min(level.maxX, next.x + level.speed);
  else if (action === 2) next.x = Math.max(level.minX, next.x - level.speed);
  else if (action === 3 && level.hasItem && !next.hasItem && Math.abs(next.x - level.itemX) <= level.itemRadius) {
    next.busy = level.itemTicks;
  }

  for (let gapIndex = 0; gapIndex < level.gaps.length; gapIndex++) {
    const gap = level.gaps[gapIndex]!;
    if (gap.a < next.x && next.x < gap.b) {
      const safe = gap.kind === 'lamp'
        ? score[beat] === gap.lamp || (borrowed.length > 0 && borrowed[beat] === gap.lamp)
        : ((gap.mask >>> beat) & 1) === 1;
      if (!safe) return { ...next, status: 'fell', fellTick: tick, gapIndex };
    }
  }
  if (next.x >= level.bellX && (!level.itemRequired || next.hasItem)) {
    return { ...next, status: 'win', finishTick: tick + 1 };
  }
  if (next.tick === level.beats * level.beatTicks) next.status = 'timeup';
  return next;
}

export function simulate(level: Level, score: Score, inputs: Score, borrowed: Score = []): SimResult {
  if (!validateScore(level, score)) throw new SimValidationError('BadScore');
  if (borrowed.length && (!level.borrowable || !validateScore(level, borrowed))) {
    throw new SimValidationError('BadBorrow');
  }
  if (inputs.length > level.beats * level.beatTicks
      || Array.from(inputs).some(a => !Number.isInteger(a) || a < 0 || a > 3)) {
    throw new SimValidationError('BadInputs');
  }
  let state = createState(level);
  while (state.status === 'playing') state = step(level, state, score, borrowed, inputs[state.tick] ?? 0);
  return state;
}

export function starsFor(level: Level, finishTick: number): number {
  if (!Number.isInteger(finishTick) || finishTick <= 0) return 0;
  return finishTick <= level.par3 ? 3 : finishTick <= level.par2 ? 2 : 1;
}
