export function packGap(gap) {
  return BigInt(gap.a) | (BigInt(gap.b) << 16n) | (BigInt(gap.kind === 'tide' ? 1 : 0) << 32n)
    | (BigInt(gap.lamp ?? 0) << 40n) | (BigInt(gap.mask ?? 0) << 48n);
}
export function contractLevel(level) {
  const { beatTicks, beats, startX, bellX, minX, maxX, speed, maxSwitches, lampCount, borrowable,
    hasItem, itemRequired, itemX, itemRadius, itemTicks, par2, par3 } = level;
  return { beatTicks, beats, startX, bellX, minX, maxX, speed, maxSwitches, lampCount, borrowable,
    hasItem, itemRequired, itemX, itemRadius, itemTicks, par2, par3, gaps: level.gaps.map(packGap) };
}
export const bytes = values => `0x${values.map(value => value.toString(16).padStart(2, '0')).join('')}`;
