import { type Country } from "@shared/types/Country";
import { getDomainTier } from "@shared/utils/technology";
import { ValidationError } from "../errors/AppError";

/**
 * Сервис распределения фокуса исследований (docs/DECISIONS.md, 2026-07-06)
 * — без каталога именных технологий. Прогресс по доменам считает
 * ResearchTick.ts, этот сервис только меняет, куда направлена доля
 * researchSpending, и отдаёт текущее состояние (тиры) для отображения/промта.
 */
export class ResearchService {
  /**
   * Задаёт долю researchSpending для одного домена — остальные домены без
   * явной доли делят остаток поровну (см. ResearchTick.ts). Сдвигает фокус
   * на один домен за раз, не переприсваивает распределение целиком.
   */
  setAllocation(country: Country, domain: string, share: number): void {
    if (!(domain in country.technology.domains)) {
      throw new ValidationError(`Unknown technology domain: ${domain}`);
    }

    country.technology.researchAllocation = {
      ...country.technology.researchAllocation,
      [domain]: share,
    };
  }

  /**
   * Сводное состояние технологий страны — прогресс и тир по домену, текущее
   * распределение фокуса.
   */
  getTechnologyState(country: Country): {
    domains: Record<string, { progress: number; tier: number }>;
    researchAllocation: Partial<Record<string, number>>;
  } {
    const domains: Record<string, { progress: number; tier: number }> = {};
    for (const [domain, progress] of Object.entries(country.technology.domains)) {
      domains[domain] = { progress, tier: getDomainTier(progress) };
    }
    return {
      domains,
      researchAllocation: country.technology.researchAllocation ?? {},
    };
  }
}
