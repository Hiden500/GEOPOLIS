import { type IdeologyCoordinates } from "./politics/Ideology";
import { type PowerStructure, type SovereigntyStatus } from "./politics/Government";

export interface PoliticsState {

  ideology: string;

  /**
   * Позиция власти на двух осях спектра (docs/CONCEPT.md §4.2). Опционально:
   * покрытие сценарных данных частичное (server/data/scenarios/1946/ideology.json),
   * страна без координат получает фолбэк по ярлыку `ideology`
   * (shared/src/defines/discontent.ts::IDEOLOGY_LABEL_COORDINATES) — это штатное
   * поведение, а не ошибка данных.
   */
  ideologyCoordinates?: IdeologyCoordinates | undefined;

  /**
   * Кто фактически осуществляет власть (docs/POLITICS.md).
   *
   * Опционально по той же причине, что и координаты идеологии: слой
   * `government.json` покрывает сценарий 1946 целиком, но сценарии 1836/2000
   * его не имеют, и страна без записи должна остаться без ярлыка, а не
   * получить выдуманный. Заменило `governmentType: string` (см. ниже).
   */
  powerStructure?: PowerStructure | undefined;

  /**
   * Юридическое положение государства (docs/POLITICS.md). Опционально —
   * см. `powerStructure`.
   *
   * ЭТО НЕ `diplomacy.puppets`. Разбор различия и инварианты, которые не дают
   * двум представлениям разойтись, — в `shared/src/types/politics/Government.ts`.
   */
  sovereigntyStatus?: SovereigntyStatus | undefined;

  /**
   * Держава(ы), которым государство юридически подчинено. Пусто у суверенных,
   * ровно две записи у кондоминиума (Судан — Египет и Британия, Новые Гебриды —
   * Франция и Британия).
   *
   * Хранится ПОДЧИНЁННЫМ, а не сюзереном: у субъекта сюзерен один (максимум
   * два и по одному поводу), у державы клиентов десятки, и обратный список
   * пришлось бы держать согласованным вручную. Обратный индекс —
   * `diplomacy.puppets` — существует отдельно и означает другое.
   *
   * Место ссылок на страны: зарегистрировано в
   * `server/src/primitives/countryRefs.ts` (жизненный цикл, docs/CONCEPT.md
   * §7.1) — исчезнувший сюзерен не оставляет висячую ссылку.
   */
  overlordIds?: string[] | undefined;

  stability: number;

  legitimacy: number;

  corruption: number;

  governmentSupport: number;
}
