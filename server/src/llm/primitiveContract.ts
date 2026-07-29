import {
  INCITE_UNREST_MIN_DISTANCE,
  SPAWN_INCIDENT_MIN_DISCONTENT,
  SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT,
  ENACT_REFORM_MIN_GOVERNMENT_SUPPORT,
  MAX_SOFT_PRIMITIVES_PER_TURN,
  MAX_STRUCTURAL_PRIMITIVES_PER_TURN,
  MAX_PRIMITIVES_PER_TARGET_PER_TURN,
  SPLIT_MIN_GROUP_SHARE,
  SPLIT_MIN_DISCONTENT_LOOSE,
  SPLIT_MIN_DISCONTENT_STRICT,
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

Each verb has its OWN shape of target and params. A field that belongs to
another verb is a schema error, not a field the engine will quietly ignore: a
repress carrying params.incidentKind is rejected whole, and so is a verb whose
required target field is missing.

- incite_unrest — target {regionId, groupId}, both required —
  params {intensity} — requires the ideological distance between the
  authorities holding that region and that group to be at least
  ${INCITE_UNREST_MIN_DISTANCE}.
- repress — target {regionId} with optional {groupId} — params {intensity} —
  sourceCountryId must control the region. Without groupId it addresses every
  group living there.
- grant_autonomy — target {regionId} with optional {groupId} —
  params {intensity} — same control requirement. The same group in neighbouring
  regions takes heart in proportion to what was actually granted.
- enact_reform — target {countryId}, required and MUST equal sourceCountryId: a
  reform is a domestic act of the country that pays for it. Name the country
  explicitly; there is no default. params {intensity, economicDirection,
  politicalDirection}. Requires government support of at least
  ${ENACT_REFORM_MIN_GOVERNMENT_SUPPORT}, and at least one of
  params.economicDirection ("left"/"right") or params.politicalDirection
  ("authoritarian"/"democratic"). A direction whose coordinate already sits at
  the edge of the spectrum is rejected before any cost is paid.
- spawn_incident — target {regionId} — params {intensity, incidentKind} where
  incidentKind is "protest"/"uprising"/"border_dispute" — requires regional
  discontent of at least ${SPAWN_INCIDENT_MIN_DISCONTENT}; "uprising"
  additionally needs ${SPAWN_INCIDENT_UPRISING_MIN_DISCONTENT} (a region in
  crisis is not yet a region in revolt); "border_dispute" additionally needs a
  neighbouring region held by someone who is not an ally.
- split_country — target {countryId}, required and MUST equal sourceCountryId:
  a state falls apart from WITHIN. Breaking up someone else's country is
  conquest or war, not this verb. params {intensity}. The engine decides
  entirely on its own WHICH regions leave and HOW MANY states appear: a region
  secedes when a group holding at least ${SPLIT_MIN_GROUP_SHARE} of it has
  passed the secession threshold, and every seceding region joins the state of
  its own group. You name the event; you do not draw the map. intensity moves
  the THRESHOLD inside a hard corridor (${SPLIT_MIN_DISCONTENT_LOOSE} at
  "severe", ${SPLIT_MIN_DISCONTENT_STRICT} at "mild"), so a calm country cannot
  be broken apart by calling the split severe. That threshold sits ABOVE the one
  an uprising needs: a region ready to revolt is not yet a region leaving the
  country.

Relations between states are primitives too — there is no "actions" shortcut for
them any more. All four take target {countryId}, which must NOT equal
sourceCountryId.

- diplomacy — params {direction, intensity}, direction ("improve"/"worsen") is
  REQUIRED: improving and breaking a relationship are different events, not
  different sizes of one, and the engine will not guess which you meant. How FAR
  the relation moves is decided by the pair's state — how much room is left on
  the scale towards the direction you asked for, and how far the source's word
  reaches this target at all (a shared border, existing influence, a formal tie
  such as an alliance, a guarantee, a client state or a sphere relationship, or
  fighting on the same side).
  A war between the two damps a friendly gesture and does not damp a hostile
  one. Where the scale has no room left, "severe" equals "mild".
- sanction — params {sanctionType} — imposes a sanctions regime and damages
  relations. Only "trade_embargo" actually cuts the target's exports today; the
  other three kinds are reputational and the engine says so in the result. A
  regime already in force is refused: imposing it twice changes nothing.
- war — STRUCTURAL — params {warGoal}, a short free-text aim. Declaring war
  drags in the allies, guarantors and client states of both sides automatically,
  and collapses relations. Refused against a country you already fight, and against
  a formal ally (breaking an alliance is not modelled yet).
- peace — STRUCTURAL — no params at all. Requires an active war between the two.
  The engine settles the terms itself from the war score: the winner keeps the
  ground it occupies, the rest of the occupation is lifted, the loser pays with
  legitimacy, and a decisive victory adds reparations. You name the peace; you
  do not write the treaty.

Rules the engine enforces, not requests:
- You NEVER set a magnitude. params carry qualitative hints only —
  params.intensity is "mild" | "moderate" | "severe", and it selects a position
  inside a corridor whose width the world state decides. Where the state gives
  no room, "severe" equals "mild". Any numeric field inside params is a schema
  error that rejects the primitive.
- A structural primitive (enact_reform, split_country, war, peace) rejected by
  the ENGINE — on the schema, on the preconditions, or on the turn budget —
  rejects the WHOLE response, including the soft primitives you sent with it.
  Send a structural one only when the rest of the response is meant to happen
  together with it. All four share the SAME single structural slot of the turn:
  a month that declares a war cannot also enact a reform.
- The soft diplomatic verbs (diplomacy, sanction) share ONE slot per ordered
  pair of countries per turn. Sanctioning a country you have already addressed
  diplomatically this month is refused — not because the verb is wrong, but
  because that month is over for that pair. Changing the verb does not widen
  what one month may do to one relationship.
- Order is execution order: each primitive sees the effect of the previous one,
  so incite_unrest followed by spawn_incident is a legitimate chain.
- At most ${MAX_SOFT_PRIMITIVES_PER_TURN} soft primitives and ${MAX_STRUCTURAL_PRIMITIVES_PER_TURN} structural one per game
  turn (enact_reform, split_country, war and peace all draw on that single
  structural slot), and at
  most ${MAX_PRIMITIVES_PER_TARGET_PER_TURN} use of the same verb against the same target per turn.
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
 *
 * Здесь же названо ИСКЛЮЧЕНИЕ из правила «структурный уносит весь ответ»
 * (исправлено 2026-07-27 по независимому ревью). Общий текст контракта обещал
 * откат на «ЛЮБОМ слое», а граница агентности в это правило намеренно не
 * входит (docs/PRIMITIVES.md §4, «Отказ агентности ≠ отказ структурного») — и
 * это самый вероятный слой отказа, потому что режиссёр естественно хочет
 * реформировать страну игрока. Обещать модели откат там, где движок его не
 * делает, значит учить её правилу, которого нет.
 */
export const PRIMITIVE_PLAYER_AGENCY_NOTE = `- repress, grant_autonomy and enact_reform for the PLAYER's own country are
  refused: creating pressure is your job, answering it is the player's. Put the
  choice in front of them in "descriptions" instead. This refusal is the one
  exception to the whole-response rollback above: it removes only the primitive
  it refuses, so the soft primitives you sent alongside a refused enact_reform
  DO apply. The pressure lands; the player's answer stays theirs.`;
