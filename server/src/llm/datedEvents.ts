import { type PrimitiveRejection } from "../primitives/rejections";

/**
 * Разбор датированных событий ответа — второй канал ТЕКСТА, не воздействия.
 *
 * ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Каналом изменения мира. Мир меняют только примитивы
 * (docs/PRIMITIVES.md §1); датированное событие — запись о том, что модель уже
 * рассказала прозой, вынесенная структурой, чтобы лента кампании читалась
 * хронологически, а не помесячной простынёй. Поэтому здесь нет ничего похожего
 * на `impacts` из чужих схем: событие ничего не применяет и применить не может.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ РАЗБОР, А НЕ ZOD В КОНВЕРТЕ. По той же причине, по которой
 * примитивы разбираются поэлементно (`parsePrimitives`): одна кривая дата не
 * должна ронять ответ, в котором есть три правильных события и применимые
 * примитивы. Битый элемент отбрасывается со СВОЕЙ причиной, остальные живут.
 */

/**
 * Сколько датированных событий принимается за ход.
 *
 * Не «сколько модель осилит»: заголовки baseline-прогона перечисляют 2–3
 * события на месяц (`.agent/runs/dated-events-2026-08-08/`), и кап в 4 оставляет
 * запас, не приглашая добивать список ради списка. Событие сверх капа
 * отбрасывается с причиной — молча срезанный хвост означал бы, что модель
 * считает записанным то, чего в истории нет.
 */
export const MAX_DATED_EVENTS = 4;

/** Заголовок — строка ленты, а не абзац. */
const MAX_TITLE_LENGTH = 120;

/** Описание — один-три предложения: подробности живут в прозе ответа. */
const MAX_DESCRIPTION_LENGTH = 500;

/** Валидное событие ДО того, как ему выдали id и привязали к записи ответа. */
export interface DatedEventDraft {
  date: string;
  title: string;
  description: string;
  claimedCountries: string[];
}

export interface ParsedDatedEvents {
  drafts: DatedEventDraft[];
  rejections: PrimitiveRejection[];
}

/** `YYYY-MM-DD`, существующая календарная дата — «2026-02-30» не проходит. */
function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Разбирает поле `events` ответа модели.
 *
 * @param raw            значение поля из конверта (может быть чем угодно);
 * @param turnDate       игровая дата хода `YYYY-MM-DD` — событие обязано лежать
 *                       в ЭТОМ месяце: ответ покрывает ровно один месяц, а
 *                       событие с датой из прошлого либо дублирует уже
 *                       записанное, либо правит историю задним числом;
 * @param isKnownCountry известен ли движку id страны. Список стран у события —
 *                       ЗАЯВЛЕНИЕ модели, а не факт применения, поэтому чужой id
 *                       отбрасывается, а само событие остаётся: выдуманная
 *                       страна в теге не повод терять верно датированный факт.
 */
export function parseDatedEvents(
  raw: unknown,
  turnDate: string,
  isKnownCountry: (countryId: string) => boolean
): ParsedDatedEvents {
  if (raw === undefined || raw === null) return { drafts: [], rejections: [] };

  if (!Array.isArray(raw)) {
    return {
      drafts: [],
      rejections: [
        { code: "datedEventInvalid", position: 0, detail: '"events" must be an array' },
      ],
    };
  }

  const monthPrefix = turnDate.slice(0, 7);
  const drafts: DatedEventDraft[] = [];
  const rejections: PrimitiveRejection[] = [];

  raw.forEach((entry, index) => {
    const reject = (detail: string): void => {
      rejections.push({ code: "datedEventInvalid", position: index, detail });
    };

    if (drafts.length >= MAX_DATED_EVENTS) {
      reject(`at most ${MAX_DATED_EVENTS} dated events per response`);
      return;
    }

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      reject("event must be an object");
      return;
    }

    const record = entry as Record<string, unknown>;
    const date = trimmedString(record["date"]);
    const title = trimmedString(record["title"]);
    const description = trimmedString(record["description"]);

    if (date === undefined || !isRealIsoDate(date)) {
      reject('"date" must be a real calendar date in YYYY-MM-DD form');
      return;
    }
    if (!date.startsWith(monthPrefix)) {
      reject(`"date" must fall inside ${monthPrefix} — this response covers that month only`);
      return;
    }
    if (title === undefined) {
      reject('"title" must be a non-empty string');
      return;
    }
    if (title.length > MAX_TITLE_LENGTH) {
      reject(`"title" must be at most ${MAX_TITLE_LENGTH} characters`);
      return;
    }
    if (description === undefined) {
      reject('"description" must be a non-empty string');
      return;
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      reject(`"description" must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
      return;
    }

    const rawCountries = record["countries"];
    const claimedCountries = Array.isArray(rawCountries)
      ? rawCountries
          .filter((id): id is string => typeof id === "string")
          .map(id => id.trim())
          .filter(id => isKnownCountry(id))
      : [];

    drafts.push({
      date,
      title,
      description,
      claimedCountries: [...new Set(claimedCountries)],
    });
  });

  return { drafts, rejections };
}
