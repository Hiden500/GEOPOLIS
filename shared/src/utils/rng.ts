/**
 * Seeded RNG (docs/plans/01_PERSISTENCE_STATE.md, mulberry32). Чистая функция
 * над числом-состоянием, не замыкание — состояние обязано быть сериализуемым
 * полем GameState (правило 1 конституции: GameState — только plain JSON).
 * Правило на будущее: вся случайность симуляции — только через game.rngState
 * и эту функцию, не Math.random.
 */
export function nextRandom(state: number): { value: number; nextState: number } {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: a };
}
