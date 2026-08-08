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
import {
  SEND_AID_MIN_TREASURY_SHARE,
  VASSALAGE_MIN_HELD_SHARE,
  VASSALAGE_MIN_INFLUENCE,
} from "@shared/defines/diplomacy";
import { CAPITAL_FLIGHT_MAX_STABILITY } from "@shared/defines/economy";
import { ResourceType } from "@shared/types/resources/ResourcesType";

/**
 * Список ресурсов для промта — ИЗ КАТАЛОГА, а не переписанный руками.
 *
 * Так же, как домены исследований (`LLMService.getResearchDomainsLine`): пока
 * закрытый перечень существует только в схеме, модель узнаёт о нём из отказа —
 * то есть уже потратив ход. Ровно этот дефект стоил рычагу исследований
 * практически всей его жизни (1 применение за 72 хода → 154 после того, как
 * домены перечислили). Второе объявление того же перечня разъехалось бы с
 * `ResourceType` при первом же добавлении ресурса.
 */
const RESOURCE_NAMES = Object.values(ResourceType).join(", ");

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
export const PRIMITIVE_CONTRACT = `Impact primitives (the "primitives" array) — the ONLY channel through which a
response changes the world. A primitive is one elementary verb of influence; the
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
  group living there, and that costs the most: the price is charged on how much
  of the region was hit. Force is never free — every application spends the
  controller's own legitimacy, and the spending accumulates, so a regime that
  represses month after month rules with a cheaper and cheaper mandate.
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

Relations between states are primitives too. All four take target {countryId},
which must NOT equal sourceCountryId.

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

Four more soft verbs act on money, reputation and other people's wars. None of
them takes a magnitude either; all take params {intensity} only.

- send_aid — target {countryId} — the donor pays out of its own treasury and the
  recipient's treasury grows by the same amount. How much is decided by the
  donor's fiscal room and by how large the recipient's economy is next to its
  own: nobody spends a fifth of the treasury on a micro-state. Requires the
  donor to hold at least ${(SEND_AID_MIN_TREASURY_SHARE * 100).toFixed(0)}% of
  its GDP in the treasury.
  Aid also buys INFLUENCE over the recipient, in proportion to how visible the
  money is against the recipient's economy. Aid is the only path to influence.
  Note what aid does NOT do: it does
  not move relations directly. Warmth follows later, through the sphere of
  influence and the drift of relations, because that is how patronage works.
- capital_flight — target {regionId} — money leaves a region: its output drops
  and the treasury of whoever controls it takes a hit weighted by how much of
  that economy the region is. Requires the region's stability to be BELOW
  ${CAPITAL_FLIGHT_MAX_STABILITY}: capital flees broken confidence, it does not
  flee on command. How much leaves is decided by how developed the region is
  (there must be capital to flee) and how far its stability has fallen.
- condemn — target {countryId} — a purely reputational strike: it lowers the
  target's LEGITIMACY and touches nothing material, not relations and not trade.
  Requires a PODIUM: the source must hold influence over at least one state or
  have a formal tie to one, otherwise there is nobody for whom its word carries
  weight. How hard it lands is decided by how much legitimacy the target still
  has to lose and how large the source's audience is.
- support_proxy — target {countryId} — the patron pays out of its treasury and
  the client's army grows, without the patron joining the war. Requires all
  three: the client is in an active war, the source is NOT a belligerent in that
  same war, and the source is actually its patron (influence over it or a formal
  tie). How much is decided by the strength of that patronage and by how much of
  the client's land is currently occupied.

Two structural verbs change who commands a state and who owns its land. Neither
takes params at all: a state is either subjected or it is not, land either
changes hands or it does not.

- puppet — STRUCTURAL — target {countryId} — the target keeps its territory and
  its statehood but loses command of its own foreign policy. This writes BOTH
  halves of dependence at once: the runtime tie (the client is dragged into the
  patron's wars and gravitates towards it) and the legal status (a sovereign
  target becomes a protectorate; one already subordinate keeps whatever status
  it has and simply gains another overlord). Requires LEVERAGE, and there are
  exactly two kinds: the source actually controls at least
  ${(VASSALAGE_MIN_HELD_SHARE * 100).toFixed(0)}% of the target's land, or it
  holds at least ${VASSALAGE_MIN_INFLUENCE} influence over it. A state cannot
  subject its own patron, directly or through a chain.
- annex — STRUCTURAL — target {countryId} — every region the target OWNS and the
  source actually CONTROLS passes into the source's ownership; the occupation on
  it is lifted because it has become its own land. Requires holding at least one
  such region: annexation converts ground you already hold, it does not reach
  across a map. A state that loses its last region is NOT deleted and does not
  become part of the winner — it continues as a government without territory,
  and whether the campaign is over is decided by the engine, never by your text.
- merge_countries — STRUCTURAL — target {countryId} — the target ceases to exist
  and everything it had passes to the source: its regions, its treasury, its
  manpower, and every reference the world held to it. Requires the target to be
  a CLIENT of the source already (puppet it first): a state is absorbed into the
  one whose foreign policy it already conducts, not into whoever asks. The state
  the human plays can never be absorbed — the player loses their country by
  losing all of its land, never by merger.
- create_country — STRUCTURAL — target {regionId} — the state that OWNS that
  region lets it go, and a new country is born on it. Which land leaves is
  decided by demography, not by you: every region of the owner where the same
  group holds the majority goes with it, and the new state is named after that
  group. Requires the source to own the region, the region to have a majority
  group at all, and the source to keep at least one region — a state letting go
  of everything is dissolving itself, and that is split_country.

Four more verbs cover commitments and budgets. They used to live in a separate
"actions" channel that let you set numbers directly; that channel no longer
exists, and here the engine decides every magnitude as it does everywhere else.

- guarantee — target {countryId} — no params — the source promises to defend the
  target's independence, and that promise DRAGS IT INTO THE TARGET'S WARS
  automatically. It also warms the pair's relations. Refused if the guarantee is
  already in force: promising it twice changes nothing.
- research_shift — target {countryId}, which MUST equal sourceCountryId: a state
  spends its own budget and only its own. params {domain, direction, intensity},
  where domain is REQUIRED and must be a domain that country actually HAS — a
  name that is not one of its domains is rejected even when it names a real
  field of research. A country's Technology line shows only where it has already
  advanced, not the full set of names it may be given; where the prompt lists the
  domains that exist, copy the name from there verbatim.
  direction is "toward" (default) or "away". How far
  the share moves is decided by how much room is left to the ceiling — and the
  ceiling drops for every war the country is currently fighting, because a
  government fighting on several fronts is a distracted one. A domain already at
  the ceiling moves by the minimum: "severe" then equals "mild".
- production_shift — target {countryId}, same domestic rule. params
  {equipmentType, direction, intensity}, equipmentType REQUIRED and one of
  rifles/trucks/tanks/artillery/fighters/bombers/destroyers/submarines. The
  ceiling here is flat — war concentrates production rather than distracting it.
- build_extraction — target {regionId} — params {resource, direction}, resource
  REQUIRED and one of ${RESOURCE_NAMES} — a name outside that list is refused
  even when it names a real commodity ("steel" and "aluminium" are outputs of
  industry here, not resources of a region). direction "expand" (default) or
  "dismantle". One capacity level per
  order; the engine computes actual output from richness × capacity, and you
  never state a production number. Expanding requires the source to CONTROL the
  region, the region to hold a deposit of that resource, the capacity to be below
  its maximum, and the treasury to afford it. Dismantling requires none of those
  except something to dismantle: a state may wind down its own works even on
  ground it has lost.

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
- The soft bilateral verbs (diplomacy, sanction, guarantee) share ONE slot per
  ordered pair of countries per turn. Sanctioning a country you have already
  addressed diplomatically this month is refused — not because the verb is
  wrong, but because that month is over for that pair. Changing the verb does not
  widen what one month may do to one relationship: all three write into the same
  relation between the same two states.
- The budget verbs are counted per SUBJECT, not per country: research_shift on
  aviation and production_shift on tanks in the same month are a legitimate pair,
  a second shift of the SAME domain is not. build_extraction is counted per
  (region, resource) for the same reason — oil and coal in one region are two
  different building sites.
- condemn and capital_flight are counted PER TARGET, not per source. They cost
  the source nothing, so a second condemnation of the same country in the same
  month is refused even when it comes from a different state — otherwise ten
  states could stack ten strikes on one reputation for free. One month, one
  blow to a given reputation; one month, one flight of capital from a given
  region.
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
export const PRIMITIVE_PLAYER_AGENCY_NOTE = `- Acts of STATE POLICY for the PLAYER's own country are refused — repress,
  grant_autonomy, enact_reform, every diplomatic verb, and the commitment and
  budget verbs (guarantee, research_shift, production_shift, build_extraction):
  creating pressure is your job, answering it is the player's. Put the
  choice in front of them in "descriptions" instead. This refusal is the one
  exception to the whole-response rollback above: it removes only the primitive
  it refuses, so the soft primitives you sent alongside a refused enact_reform
  DO apply. The pressure lands; the player's answer stays theirs.`;
