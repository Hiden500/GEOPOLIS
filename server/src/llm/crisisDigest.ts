import { type GameState } from "@shared/types/GameState";
import { type Region } from "@shared/types/map/Region";
import { getText, LLM_LOCALE } from "@shared/types/i18n/LocalizedText";
import { effectiveController } from "@shared/utils/regionControl";
import { regionDiscontent, regionGroupDiscontent } from "@shared/utils/discontent";

/**
 * Выборка активных кризисов для промта (docs/CONCEPT.md §7, кризисный кап).
 *
 * Чистые функции без мутаций: их зовут и рендер основного промта (который
 * дополнительно потребляет одноразовые факты), и перевод приказа игрока
 * (который не вправе трогать состояние вовсе). Общий код здесь именно поэтому —
 * дублировать выборку значило бы получить два разных ответа на вопрос «какие
 * кризисы сейчас острее всего».
 *
 * Стоимость, названная честно (уточнено ревью 2026-07-26). `activeCrises`
 * обходит все регионы фильтром по латчу — это дёшево, — но для КАЖДОГО
 * залатченного зовёт `regionDiscontent`, а тот внутри строит полное разложение
 * по группам (`regionGroupDiscontent`). То есть разложение считается не для
 * пятёрки показанных, а для всех регионов в кризисе: `MAX_PROMPT_CRISES`
 * ограничивает РЕНДЕР, а не выборку, — иначе нечем было бы выбрать острейшие.
 *
 * Сегодня это дёшево по ДАННЫМ, а не по конструкции: демографией размечены 14
 * регионов, и 11 из них уже в кризисе. При полной разметке Милстоуна 2 (~1399
 * регионов) «в кризисе» станет сопоставимо с миром, и разложение по группам
 * будет считаться для тысяч регионов на каждый рендер промта. Прежняя
 * формулировка обещала обратное («считается для числа регионов в кризисе, а не
 * для мира») — при полной разметке это одно и то же число. Мерить заново тогда,
 * а не считать вопрос закрытым (docs/TODO.md).
 */

export interface ActiveCrisis {
  region: Region;
  discontent: number;
}

/**
 * Регионы под кризисным латчем с их АКТУАЛЬНЫМ недовольством, острые первыми.
 *
 * Источник — латч, а не одноразовые факты `region_crisis`: факт выдаётся ровно
 * один раз при пересечении порога, поэтому отбор среди фактов терял бы
 * невлезший кризис навсегда. Пересчёт остроты каждый рендер даёт обратное
 * свойство — «тлеющий» кризис всплывает сам, как только станет острее
 * показанных, а снятый исчезает сам и не врёт о себе.
 *
 * id вторым ключом сортировки: при равном недовольстве порядок обязан быть
 * воспроизводим, иначе один и тот же мир давал бы разные промты.
 */
export function activeCrises(game: GameState): ActiveCrisis[] {
  const latched = new Set(game.regionCrisisLatch);
  if (latched.size === 0) return [];

  const active: ActiveCrisis[] = [];
  for (const region of game.regions) {
    if (!latched.has(region.id)) continue;
    const discontent = regionDiscontent(game, region);
    if (discontent === undefined) continue;
    active.push({ region, discontent });
  }

  return active.sort((a, b) => b.discontent - a.discontent || a.region.id - b.region.id);
}

/** Имя региона на языке промта; фолбэк — идентификатор, а не пустота. */
export function regionPromptLabel(region: Region): string {
  return getText(region.names, LLM_LOCALE) || `region ${region.id}`;
}

/**
 * Развёрнутое описание одного кризиса: id и имя региона, кто им фактически
 * владеет, индекс недовольства и разложение по группам с их РЕАЛЬНЫМИ id —
 * примитив адресуется по id, а не по имени.
 */
export function renderCrisis(
  game: GameState,
  crisis: ActiveCrisis,
  options: { isNew?: boolean } = {}
): string {
  const groups = regionGroupDiscontent(game, crisis.region)
    .sort((a, b) => b.share - a.share)
    .map(g => {
      const name =
        getText(game.ethnicGroups.find(e => e.id === g.groupId)?.names, LLM_LOCALE) || g.groupId;
      return (
        `${name} (id ${g.groupId}, ${(g.share * 100).toFixed(0)}% of the region) ` +
        `at ${g.discontent.toFixed(2)}`
      );
    })
    .join("; ");

  return (
    `- region ${crisis.region.id} (${regionPromptLabel(crisis.region)}), ` +
    `held by ${effectiveController(crisis.region)} — ` +
    `discontent index ${crisis.discontent.toFixed(2)}` +
    `${options.isNew ? " — NEW this month" : ""}\n  groups: ${groups}`
  );
}

/**
 * Строка про то, что осталось за капом. Пишется всегда, когда что-то осталось:
 * молчание о хвосте читалось бы как «кризисов ровно столько», то есть как
 * неправда о состоянии мира (docs/PRIMITIVES.md §4 о правдивости чисел).
 */
export function renderHiddenCrises(hidden: readonly ActiveCrisis[]): string {
  const highest = hidden[0]?.discontent ?? 0;
  return (
    `- (${hidden.length} more region(s) are above the threshold but less acute, ` +
    `the highest of them at ${highest.toFixed(2)}; they smoulder in the background ` +
    `and are not detailed here this cycle)`
  );
}
