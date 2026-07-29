import { describe, it, expect } from "vitest";
import { splitByAgency, VERB_AGENCY, isPlayerDecisionVerb } from "../primitiveAgency";
import { PRIMITIVE_VERBS, type Primitive, type PrimitiveVerb } from "../../primitives/types";

/**
 * Граница агентности покрывает ВЕСЬ алфавит (`docs/CONCEPT.md` §7.2).
 *
 * Тест заведён по факту дефекта, а не на всякий случай. Прежняя граница
 * перечисляла три глагола списком и не обновлялась, пока алфавит рос с пяти до
 * четырнадцати: девять новых — включая `war`, необратимость которого §7.2
 * называет прямо, — молча проходили за игрока. Список-снимок не умеет заявить о
 * своей неполноте, и ни один тест этого не ловил.
 *
 * Теперь сторон две: тип `Record<PrimitiveVerb, AgencySide>` не даст
 * скомпилироваться без решения по новому глаголу, а тесты ниже держат смысл
 * решения — что классификация не выродилась в «всё разрешено».
 */

function primitiveOf(verb: PrimitiveVerb, sourceCountryId: string): Primitive {
  return { verb, sourceCountryId, target: {}, params: {} } as unknown as Primitive;
}

describe("граница агентности покрывает весь алфавит", () => {
  it("у каждого глагола названа сторона границы", () => {
    const missing = PRIMITIVE_VERBS.filter(verb => VERB_AGENCY[verb] === undefined);
    expect(missing).toEqual([]);
  });

  it("в словаре нет глаголов, которых нет в алфавите", () => {
    const alphabet = new Set<string>(PRIMITIVE_VERBS);
    const stale = Object.keys(VERB_AGENCY).filter(verb => !alphabet.has(verb));
    expect(stale).toEqual([]);
  });

  it("обе стороны непусты: классификация не выродилась", () => {
    // Если все глаголы окажутся с одной стороны, тесты выше всё равно пройдут,
    // а граница перестанет существовать — молча в любую из двух сторон.
    const sides = PRIMITIVE_VERBS.map(verb => VERB_AGENCY[verb]);
    expect(sides).toContain("playerDecision");
    expect(sides).toContain("worldPressure");
  });
});

describe("что режиссёр не делает за игрока", () => {
  const PLAYER = "SUN";

  it("необратимые акты государства отклоняются", () => {
    // §7.2 перечисляет войну прямо; мир так же необратим и так же принадлежит
    // государству.
    for (const verb of ["war", "peace"] as PrimitiveVerb[]) {
      const { allowed, refused } = splitByAgency([primitiveOf(verb, PLAYER)], PLAYER);
      expect(allowed, verb).toEqual([]);
      expect(refused[0]?.rejection.code, verb).toBe("agencyPlayerDecision");
    }
  });

  it("акты внешней политики и траты казны отклоняются", () => {
    for (const verb of ["diplomacy", "sanction", "send_aid", "condemn", "support_proxy"] as PrimitiveVerb[]) {
      const { allowed } = splitByAgency([primitiveOf(verb, PLAYER)], PLAYER);
      expect(allowed, verb).toEqual([]);
    }
  });

  it("давление извне и снизу по-прежнему разрешено — ради него режиссёра и зовут", () => {
    for (const verb of ["incite_unrest", "spawn_incident", "capital_flight"] as PrimitiveVerb[]) {
      const { allowed, refused } = splitByAgency([primitiveOf(verb, PLAYER)], PLAYER);
      expect(allowed.length, verb).toBe(1);
      expect(refused, verb).toEqual([]);
    }
  });

  it("раскол страны игрока разрешён осознанно: подтверждение — выбор осколка", () => {
    const { allowed } = splitByAgency([primitiveOf("split_country", PLAYER)], PLAYER);
    expect(allowed.length).toBe(1);
  });

  it("для ЧУЖОЙ страны те же глаголы разрешены целиком", () => {
    // ИИ-держава ведёт свою политику сама, и подтверждение спрашивать не у кого.
    const foreign = PRIMITIVE_VERBS.map(verb => primitiveOf(verb, "USA"));
    const { allowed, refused } = splitByAgency(foreign, PLAYER);
    expect(refused).toEqual([]);
    expect(allowed.length).toBe(PRIMITIVE_VERBS.length);
  });

  it("isPlayerDecisionVerb согласован со словарём для каждого глагола", () => {
    const mismatched = PRIMITIVE_VERBS.filter(
      verb => isPlayerDecisionVerb(verb) !== (VERB_AGENCY[verb] === "playerDecision")
    );
    expect(mismatched).toEqual([]);
  });
});
