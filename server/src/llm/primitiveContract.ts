import {
  INCITE_UNREST_MIN_DISTANCE,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  MAX_SOFT_PRIMITIVES_PER_TURN,
  MAX_STRUCTURAL_PRIMITIVES_PER_TURN,
  MAX_PRIMITIVES_PER_TARGET_PER_TURN,
} from "@shared/defines/discontent";

/**
 * Контракт примитивов, как он предъявляется модели (docs/PRIMITIVES.md §1-§4).
 *
 * Числа порогов и капов подставляются из ТЕХ ЖЕ констант, что читает движок.
 * Иначе текст промта и валидатор разъезжаются молча, и модель получает отказы
 * по правилам, которых ей не сообщали, — а по документу отказ обязан учить её
 * («чтобы не долбилась в невозможное», §3), значит правила в промте должны быть
 * настоящими.
 *
 * Отдельный модуль, а не константа внутри `LLMService`: тот же текст нужен
 * второму промту — переводу свободного приказа игрока (`primitiveTranslation.ts`).
 * Две копии алфавита разошлись бы на первой же правке, и игрок с режиссёром
 * играли бы по разным правилам.
 *
 * Строка не читает состояние партии и потому собирается один раз на модуль.
 */
export const PRIMITIVE_CONTRACT = `Impact primitives (the "primitives" array) — a separate, stricter channel than
the legacy "actions". A primitive is one elementary verb of influence; the
engine validates its precondition, computes every magnitude itself, and applies
it atomically or rejects it whole.

- incite_unrest — target {regionId, groupId} — requires the ideological
  distance between the authorities holding that region and that group to be at
  least ${INCITE_UNREST_MIN_DISTANCE}.
- repress — target {regionId} or {regionId, groupId} — sourceCountryId must
  control the region. Without groupId it addresses every group living there.
- grant_autonomy — target {regionId} or {regionId, groupId} — same control
  requirement. The same group in neighbouring regions takes heart in
  proportion to what was actually granted.
- enact_reform — target {countryId}, which MUST equal sourceCountryId: a
  reform is a domestic act of the country that pays for it. Requires
  government support of at least ${ENACT_REFORM_MIN_GOVERNMENT_SUPPORT}, and at least one of
  params.economicDirection ("left"/"right") or params.politicalDirection
  ("authoritarian"/"democratic"). A direction whose coordinate already sits at
  the edge of the spectrum is rejected before any cost is paid.
- spawn_incident — target {regionId}, params.incidentKind
  "protest"/"uprising"/"border_dispute" — requires regional discontent of at
  least ${SPAWN_INCIDENT_MIN_DISCONTENT}; "uprising" additionally needs ${SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT} (a region in crisis is
  not yet a region in revolt); "border_dispute" additionally needs a
  neighbouring region held by someone who is not an ally.

Rules the engine enforces, not requests:
- You NEVER set a magnitude. params carry qualitative hints only —
  params.intensity is "mild" | "moderate" | "severe", and it selects a position
  inside a corridor whose width the world state decides. Where the state gives
  no room, "severe" equals "mild". Any numeric field inside params is a schema
  error that rejects the primitive.
- Order is execution order: each primitive sees the effect of the previous one,
  so incite_unrest followed by spawn_incident is a legitimate chain.
- At most ${MAX_SOFT_PRIMITIVES_PER_TURN} soft primitives and ${MAX_STRUCTURAL_PRIMITIVES_PER_TURN} structural one (enact_reform) per game
  turn, and at most ${MAX_PRIMITIVES_PER_TARGET_PER_TURN} use of the same verb against the same target per turn.
  These are budgets of the TURN, not of your response: the player's own orders
  this month draw on the same budget, so a target they have already acted on is
  spent for you too. A refusal that says the budget is spent is not a mistake to
  retry — it is this month being over for that target.
- Do NOT put numeric consequences of primitives in free text. You cannot know
  them: the engine computes them after your response and reports the actual
  figures back. Describe what happened qualitatively; the true numbers are
  added by the engine.`;

/**
 * Оговорка, действующая только в мировом цикле: режиссёр не принимает за игрока
 * решений государственной политики (docs/CONCEPT.md §7.2). В промте перевода
 * приказа она была бы прямо ложной — там эти глаголы и есть предмет перевода, —
 * поэтому живёт отдельной строкой, а не внутри общего алфавита.
 */
export const PRIMITIVE_PLAYER_AGENCY_NOTE = `- repress, grant_autonomy and enact_reform for the PLAYER's own country are
  refused: creating pressure is your job, answering it is the player's. Put the
  choice in front of them in "descriptions" instead.`;
