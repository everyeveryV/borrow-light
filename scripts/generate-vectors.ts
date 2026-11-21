import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { levels, createState, simulate, step, validateScore, type Level, type SimState } from '../app/src/game/sim';

const repeat = (value: number, length: number) => Array<number>(length).fill(value);
const segments = (...pairs: [number, number][]) => pairs.flatMap(([lamp, length]) => repeat(lamp, length));
const seeds = [
  { key: 'S1', level: 4, label: '陌生人 · 一盏檐下灯', score: segments([2, 5], [4, 15]) },
  { key: 'S2', level: 4, label: '陌生人 · 一路星光', score: segments([1, 3], [3, 7], [5, 10]) },
  { key: 'S3', level: 4, label: '陌生人 · 雨中的守候', score: segments([1, 4], [4, 16]) },
];
const scores = [
  segments([1, 7], [2, 9]),
  segments([1, 4], [2, 4], [3, 6]),
  segments([1, 11], [2, 11]),
  segments([1, 3], [3, 7], [5, 10]),
  segments([1, 4], [2, 12], [3, 4], [4, 5]),
];

type SearchNode = { state: SimState; inputs: number[] };
/** Breadth-first search proves the earliest finish for each supplied light score. */
function solve(level: Level, score: number[], borrowed: number[] = [], requireItem = level.itemRequired): number[] {
  if (!validateScore(level, score)) throw Error(`Invalid reference score: ${level.id}`);
  let frontier: SearchNode[] = [{ state: createState(level), inputs: [] }];
  while (frontier.length) {
    const next = new Map<string, SearchNode>();
    for (const node of frontier) {
      for (const action of [1, 3, 0]) {
        const state = step(level, node.state, score, borrowed, action);
        const inputs = [...node.inputs, action];
        if (state.status === 'win' && (!requireItem || state.hasItem)) return inputs;
        if (state.status !== 'playing') continue;
        const key = `${state.x}:${state.busy}:${state.hasItem}`;
        if (!next.has(key)) next.set(key, { state, inputs });
      }
    }
    frontier = [...next.values()];
  }
  throw Error(`No reference solution for level ${level.id}`);
}

type Expected = Pick<SimState, 'status'> & Partial<Pick<SimState, 'finishTick' | 'fellTick' | 'gapIndex' | 'hasItem'>>;
type Vector = { name: string; level: number; seedKey?: string; score: number[]; borrowed: number[]; inputs: number[]; expected: Expected };
const vectors: Vector[] = [];
const solutions: { level: number; seedKey?: string; score: number[]; inputs: number[] }[] = [];
function add(name: string, level: Level, score: number[], inputs: number[], borrowed: number[] = [], seedKey?: string) {
  const result = simulate(level, score, inputs, borrowed);
  const expected: Expected = { status: result.status, hasItem: result.hasItem };
  if (result.finishTick !== undefined) expected.finishTick = result.finishTick;
  if (result.fellTick !== undefined) expected.fellTick = result.fellTick;
  if (result.gapIndex !== undefined) expected.gapIndex = result.gapIndex;
  vectors.push({ name, level: level.id, ...(seedKey ? { seedKey } : {}), score, borrowed, inputs, expected });
  return result;
}

for (const level of levels) {
  const score = scores[level.id - 1]!;
  const borrowed = level.borrowable ? seeds[0]!.score : [];
  const inputs = solve(level, score, borrowed);
  add(`level-${level.id}-reference-win`, level, score, inputs, borrowed, level.borrowable ? 'S1' : undefined);
  solutions.push({ level: level.id, ...(level.borrowable ? { seedKey: 'S1' } : {}), score, inputs });
  const wrongScore = repeat(2, level.beats);
  add(`level-${level.id}-unlit-bridge`, level, wrongScore, repeat(1, level.beats * level.beatTicks), borrowed);
  add(`level-${level.id}-timeup`, level, score, [], borrowed);
  if (level.id === 3 || level.id === 5) {
    add(`level-${level.id}-rising-tide`, level, score, repeat(1, level.beats * level.beatTicks));
  }
  if (level.id === 1 || level.id === 3) {
    const itemScore = level.id === 1 ? segments([1, 10], [2, 6]) : score;
    add(`level-${level.id}-optional-paperboat`, level, itemScore, solve(level, itemScore, [], true));
  }
  console.log(`Level ${level.id}: ${inputs.length} ticks, ${(inputs.length * .05).toFixed(2)} seconds`);
}

for (const [index, score] of [
  [1, segments([2, 7], [4, 13])],
  [2, segments([2, 5], [3, 5], [5, 10])],
] as [number, number[]][]) {
  const seed = seeds[index]!;
  const inputs = solve(levels[3]!, score, seed.score);
  add(`level-4-${seed.key}-win`, levels[3]!, score, inputs, seed.score, seed.key);
  solutions.push({ level: 4, seedKey: seed.key, score, inputs });
}

// Zero-based fall frames and strict bridge endpoints are part of the shared contract.
add('level-3-tide-boundary-is-safe', levels[2]!, scores[2]!, [...repeat(1, 50), ...repeat(0, 170)]);
add('level-4-no-borrow-cannot-cross-five-bridges', levels[3]!, scores[3]!, repeat(1, 200));
const last = solutions.find(solution => solution.level === 5)!;
let original = createState(levels[4]!);
const noPickup = last.inputs.map(action => {
  const replacement = original.busy > 0 || action === 3 ? 0 : action;
  original = step(levels[4]!, original, last.score, [], action);
  return replacement;
});
const missingItem = add('level-5-missing-lantern-keeps-bell-closed', levels[4]!, last.score, noPickup);
if (missingItem.status !== 'timeup' || missingItem.hasItem) throw Error('Missing-lantern vector must time out without collecting the item');
add('level-1-win-on-final-tick', levels[0]!, segments([1, 11], [2, 5]), [...repeat(0, 43), ...repeat(1, 117)]);

for (const vector of vectors) {
  if (vector.name.includes('unlit-bridge') || vector.name.includes('rising-tide') || vector.name.includes('no-borrow')) {
    if (vector.expected.status !== 'fell') throw Error(`${vector.name} must fall`);
  }
  if (vector.name.includes('timeup') && vector.expected.status !== 'timeup') throw Error(`${vector.name} must time out`);
}

for (const [filename, value] of Object.entries({
  'vectors.json': { version: 1, vectors }, 'seeds.json': seeds, 'solutions.json': solutions,
})) {
  writeFileSync(fileURLToPath(new URL(`../shared/${filename}`, import.meta.url)), JSON.stringify(value, null, 2) + '\n');
}
console.log(`Wrote ${vectors.length} vectors and ${solutions.length} verified solutions.`);
