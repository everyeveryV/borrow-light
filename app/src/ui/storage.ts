export interface Progress { tick: number; stars: number; hasItem: boolean }
export interface SavedRun {
  level: number; score: number[]; inputs: number[]; borrowed: number[];
  borrowedId: string; seedKey?: string; finishTick: number; hasItem: boolean;
  submittedHash?: string;
}
export interface SaveData {
  version: 2; progress: Record<number, Progress>; scores: Record<number, number[]>;
  recent: SavedRun | null; sound: boolean;
}
const key = 'borrow-light-v2';
export function loadSave(): SaveData {
  const empty: SaveData = { version: 2, progress: {}, scores: {}, recent: null, sound: false };
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    if (!parsed || parsed.version !== 2) return empty;
    const progress: Record<number, Progress> = {};
    for (const [id, p] of Object.entries(parsed.progress || {})) {
      const v = p as Progress;
      if (+id >= 1 && +id <= 5 && Number.isInteger(v.tick) && v.tick > 0 && v.tick <= 320 && v.stars >= 1 && v.stars <= 3) progress[+id] = v;
    }
    const scores: Record<number, number[]> = {};
    for (const [id, value] of Object.entries(parsed.scores || {})) {
      if (+id >= 1 && +id <= 5 && Array.isArray(value) && value.length <= 32 && value.every(n => Number.isInteger(n) && n >= 1 && n <= 5)) scores[+id] = value;
    }
    const candidate = parsed.recent as SavedRun | undefined;
    const recent = candidate && Number.isInteger(candidate.level) && candidate.level >= 1 && candidate.level <= 5
      && Array.isArray(candidate.score) && candidate.score.length <= 32 && candidate.score.every(n => Number.isInteger(n) && n >= 1 && n <= 5)
      && Array.isArray(candidate.inputs) && candidate.inputs.length <= 320 && candidate.inputs.every(n => Number.isInteger(n) && n >= 0 && n <= 3)
      && Array.isArray(candidate.borrowed) && candidate.borrowed.length <= 32 && candidate.borrowed.every(n => Number.isInteger(n) && n >= 1 && n <= 5)
      && /^\d+$/.test(String(candidate.borrowedId)) && Number.isInteger(candidate.finishTick) && candidate.finishTick > 0
      ? candidate : null;
    return { ...empty, progress, scores, recent, sound: parsed.sound === true };
  } catch { return empty; }
}
export function persist(data: SaveData) {
  try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; }
}
export function recordBest(data: SaveData, level: number, result: Progress) {
  const old = data.progress[level];
  data.progress[level] = { ...(!old || result.tick < old.tick ? result : old), hasItem: Boolean(old?.hasItem || result.hasItem) };
  persist(data);
}
export const shortAddress = (address: string) => /^0x[0-9a-f]{40}$/i.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
export const escapeHtml = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
