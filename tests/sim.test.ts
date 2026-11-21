import test from 'node:test';
import assert from 'node:assert/strict';
import vectorsData from '../shared/vectors.json';
import seeds from '../shared/seeds.json';
import solutions from '../shared/solutions.json';
import { levels, createState, step, simulate, starsFor, switches, validateScore, SimValidationError, type Level } from '../app/src/game/sim';

for (const vector of vectorsData.vectors) {
  test(`shared vector: ${vector.name}`, () => {
    const level = levels.find(level => level.id === vector.level)!;
    const result = simulate(level, vector.score, vector.inputs, vector.borrowed);
    for (const [key, value] of Object.entries(vector.expected)) {
      assert.deepEqual(result[key as keyof typeof result], value, `${vector.name}: ${key}`);
    }
    assert.ok(Number.isInteger(result.x));
    assert.ok(result.x >= level.minX && result.x <= level.maxX);
  });
}

test('every level and all three borrow seeds have a valid reference solution', () => {
  for (const level of levels) {
    assert.ok(vectorsData.vectors.some(v => v.level === level.id && v.expected.status === 'win'));
    assert.ok(vectorsData.vectors.some(v => v.level === level.id && v.expected.status === 'fell'));
    assert.ok(vectorsData.vectors.some(v => v.level === level.id && v.expected.status === 'timeup'));
    const reference = solutions.find(solution => solution.level === level.id)!;
    assert.equal(starsFor(level, reference.inputs.length), 3, `Level ${level.id} must have an achievable three-star reference`);
  }
  for (const seed of seeds) {
    assert.ok(validateScore(levels[3]!, seed.score));
    const solution = solutions.find(solution => solution.seedKey === seed.key)!;
    assert.equal(simulate(levels[3]!, solution.score, solution.inputs, seed.score).status, 'win');
  }
});

test('missing-lantern regression reaches the bell but cannot clear', () => {
  const vector = vectorsData.vectors.find(v => v.name === 'level-5-missing-lantern-keeps-bell-closed')!;
  const result = simulate(levels[4]!, vector.score, vector.inputs);
  assert.equal(result.status, 'timeup');
  assert.equal(result.hasItem, false);
  assert.ok(result.x >= levels[4]!.bellX);
});

test('level data is integer, in range and tide masks follow the documented beat tables', () => {
  for (const level of levels) {
    assert.ok(level.beats <= 32 && level.beats > 0);
    for (const value of [level.startX, level.bellX, level.speed, level.minX, level.maxX]) assert.ok(Number.isInteger(value));
    assert.ok(level.par3 <= level.par2 && level.par2 <= level.beats * level.beatTicks);
  }
  const tide3 = levels[2]!.gaps.find(gap => gap.kind === 'tide')!;
  const tide5 = levels[4]!.gaps.find(gap => gap.kind === 'tide')!;
  for (let beat = 0; beat < 22; beat++) assert.equal((tide3.mask >>> beat) & 1, beat >= 6 && beat <= 10 ? 0 : 1);
  for (let beat = 0; beat < 25; beat++) assert.equal((tide5.mask >>> beat) & 1, beat % 6 < 3 ? 1 : 0);
});

function fails(code: string, fn: () => unknown) {
  assert.throws(fn, error => error instanceof SimValidationError && error.code === code);
}
test('invalid light length, lamp value, fractional value and excess oil are rejected', () => {
  const level = levels[1]!;
  const score = solutions.find(solution => solution.level === level.id)!.score;
  for (const bad of [[], score.slice(1), [...score, 1], score.map((v, i) => i === 0 ? 0 : v), score.map((v, i) => i === 0 ? 4 : v), score.map((v, i) => i === 0 ? 1.5 : v), score.map((_, i) => i % 2 + 1)]) {
    assert.equal(validateScore(level, bad), false);
    fails('BadScore', () => simulate(level, bad, []));
  }
  assert.equal(switches(score), 2);
  assert.equal(switches([]), 0);
});

test('invalid borrowing and all input bytes are checked before replay, including after an early win', () => {
  const solution = solutions[0]!;
  const level = levels[0]!;
  fails('BadBorrow', () => simulate(level, solution.score, [], solution.score));
  fails('BadBorrow', () => simulate(levels[3]!, seeds[0]!.score, [], [1]));
  fails('BadInputs', () => simulate(level, solution.score, Array(level.beats * level.beatTicks + 1).fill(0)));
  for (const action of [-1, 4, 0.5, Number.NaN]) {
    fails('BadInputs', () => simulate(level, solution.score, [action]));
    fails('BadInputs', () => simulate(level, solution.score, [...solution.inputs, action]));
  }
});

test('omitted inputs are zero; moving left clamps at minX and never changes the original state', () => {
  const level = levels[0]!;
  const score = solutions[0]!.score;
  assert.deepEqual(simulate(level, score, []), simulate(level, score, Array(160).fill(0)));
  let state = createState(level);
  const initial = { ...state };
  for (let tick = 0; tick < 20; tick++) state = step(level, state, score, [], 2);
  assert.equal(state.x, level.minX);
  assert.deepEqual(createState(level), initial);
});

function fixture(overrides: Partial<Level> = {}): Level {
  return { ...levels[0]!, beats: 4, beatTicks: 1, minX: 0, maxX: 10000, startX: 100,
    bellX: 9000, speed: 10, maxSwitches: 3, hasItem: false, itemRequired: false, gaps: [], ...overrides };
}
test('gap endpoints are safe but one decipixel inside is dangerous', () => {
  const gap = { a: 100, b: 200, kind: 'lamp' as const, lamp: 2, mask: 0 };
  for (const x of [100, 200]) assert.equal(simulate(fixture({ startX: x, gaps: [gap] }), [1, 1, 1, 1], []).status, 'timeup');
  for (const x of [101, 199]) {
    const result = simulate(fixture({ startX: x, gaps: [gap] }), [1, 1, 1, 1], []);
    assert.equal(result.status, 'fell');
    assert.equal(result.fellTick, 0);
    assert.equal(result.gapIndex, 0);
  }
});

test('pickup takes initiating frame plus itemTicks frames, blocks movement and opens the required bell on completion', () => {
  const level = fixture({ hasItem: true, itemRequired: true, itemX: 100, itemRadius: 0, itemTicks: 2, bellX: 100 });
  let state = createState(level);
  state = step(level, state, [1, 1, 1, 1], [], 3);
  assert.equal(state.busy, 2);
  assert.equal(state.hasItem, false);
  state = step(level, state, [1, 1, 1, 1], [], 1);
  assert.equal(state.x, 100);
  assert.equal(state.busy, 1);
  assert.equal(state.status, 'playing');
  state = step(level, state, [1, 1, 1, 1], [], 1);
  assert.equal(state.x, 100);
  assert.equal(state.hasItem, true);
  assert.equal(state.finishTick, 3);
  assert.equal(state.status, 'win');
});

test('pickup radius is inclusive and rising water is still checked during pickup', () => {
  const level = fixture({ hasItem: true, itemX: 120, itemRadius: 20, itemTicks: 2 });
  assert.equal(step(level, createState(level), [1, 1, 1, 1], [], 3).busy, 2);
  assert.equal(step({ ...level, itemRadius: 19 }, createState(level), [1, 1, 1, 1], [], 3).busy, 0);
  const wet = { ...level, gaps: [{ a: 90, b: 110, kind: 'tide' as const, lamp: 0, mask: 1 }] };
  let state = step(wet, createState(wet), [1, 1, 1, 1], [], 3);
  assert.equal(state.status, 'playing');
  state = step(wet, state, [1, 1, 1, 1], [], 0);
  assert.equal(state.status, 'fell');
  assert.equal(state.fellTick, 1);
});

test('tide bit 31 works as an unsigned mask', () => {
  const level = fixture({ beats: 32, startX: 100, gaps: [{ a: 90, b: 110, kind: 'tide', lamp: 0, mask: 2147483648 }] });
  assert.equal(step(level, { ...createState(level), tick: 31 }, Array(32).fill(1), [], 0).status, 'timeup');
});

test('a completed state is immutable and stars include their threshold ticks', () => {
  const level = levels[0]!;
  const result = simulate(level, solutions[0]!.score, solutions[0]!.inputs);
  assert.deepEqual(step(level, result, solutions[0]!.score, [], 1), result);
  assert.equal(starsFor(level, level.par3), 3);
  assert.equal(starsFor(level, level.par3 + 1), 2);
  assert.equal(starsFor(level, level.par2), 2);
  assert.equal(starsFor(level, level.par2 + 1), 1);
  assert.equal(starsFor(level, 0), 0);
});
