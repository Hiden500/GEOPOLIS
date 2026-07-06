/**
 * Технологии страны (docs/DECISIONS.md, 2026-07-06) — без каталога именных
 * технологий. Тир домена выводится из накопленного прогресса
 * (shared/src/utils/technology.ts::getDomainTier), не хранится отдельно —
 * нет риска рассинхрона.
 */
export interface TechnologyState {
  // Накопленный прогресс по домену (ключ — имя домена текущей эры, см.
  // shared/src/data/eras.ts). Растёт в ResearchTick.ts от вложенной доли
  // researchSpending.
  domains: Record<string, number>;

  // Доли researchSpending по доменам (0-1), заданные через PlayerIntent/LLM
  // 'research_shift' экшн — доступно и игроку, и топ-державам через LLM
  // (тот же паттерн, что объявление войны). Домены без записи здесь делят
  // оставшуюся долю поровну — детерминированный дефолт для стран, которых
  // LLM не направляет явно.
  researchAllocation?: Partial<Record<string, number>>;
}
