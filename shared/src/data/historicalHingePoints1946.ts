import { type HistoricalHingePoint } from "../types/HistoricalHingePoint";

/**
 * Каталог исторических развилок сценария 1946 (docs/tasks/HISTORICAL_HINGE_POINTS_1946.md).
 * Только 1946 — единственный играбельный сценарий сейчас (docs/TODO.md,
 * "Охват до релиза — только 1946"); не обобщать на 1836/2000 без отдельного захода.
 */
export const HISTORICAL_HINGE_POINTS_1946: HistoricalHingePoint[] = [
  {
    id: "cold_war_hardening",
    title: "Начало холодной войны: доктрина Трумэна и план Маршалла",
    windowStart: "1947-03",
    windowEnd: "1948-12",
    primaryCountries: ["SUN", "USA"],
    historicalOutcome:
      "США переходят к политике сдерживания, запускают план Маршалла для Западной Европы; мир раскалывается на два блока.",
    preconditions: [{ type: "relationBelow", a: "SUN", b: "USA", threshold: 40 }],
    baseWeight: 0.85,
    divergenceHint:
      "Если игрок (за SUN или USA) уже вывел отношения в дружественную зону, раскол может не оформиться так резко или отложиться.",
    representable: true,
  },
  {
    id: "chinese_civil_war",
    title: "Гражданская война в Китае: победа коммунистов",
    windowStart: "1946-01",
    windowEnd: "1949-12",
    primaryCountries: ["CHN", "TWN"],
    historicalOutcome:
      "Коммунисты (CHN) при поддержке СССР постепенно занимают материк; националисты (TWN) отступают на Тайвань к концу 1949.",
    preconditions: [
      { type: "relationAbove", a: "SUN", b: "CHN", threshold: -20 },
      { type: "noGuaranteeFrom", target: "TWN", guarantor: "USA" },
    ],
    baseWeight: 0.75,
    divergenceHint:
      "Гарантия США Гоминьдану (TWN) или разрыв SUN-CHN меняет баланс сил гражданской войны — вплоть до сохранения статус-кво материка за TWN.",
    representable: true,
  },
  {
    id: "berlin_blockade",
    title: "Блокада Берлина",
    windowStart: "1948-06",
    windowEnd: "1949-05",
    primaryCountries: ["SUN", "USA"],
    historicalOutcome:
      "СССР блокирует наземные пути в Западный Берлин; союзники организуют воздушный мост; блокада снимается без военного столкновения, раскол Германии закрепляется.",
    preconditions: [{ type: "relationBelow", a: "SUN", b: "USA", threshold: 20 }],
    baseWeight: 0.7,
    divergenceHint:
      "Событие завязано на уже разделённые зоны оккупации Германии (QGS/QGA/QGB/QGF) — если игрок уже нормализовал статус Берлина иначе, повод для блокады может не возникнуть.",
    representable: true,
  },
  {
    id: "korean_war",
    title: "Корейская война",
    windowStart: "1950-06",
    windowEnd: "1953-07",
    primaryCountries: ["QKS", "QKA"],
    historicalOutcome:
      "Северокорейские силы при поддержке СССР/Китая вторгаются на юг; США организуют интервенцию; линия фронта возвращается близко к 38-й параллели.",
    preconditions: [{ type: "relationBelow", a: "QKS", b: "QKA", threshold: 0 }],
    baseWeight: 0.65,
    divergenceHint:
      "Прямая параллель с оккупационными зонами Германии — если игрок уже способствовал объединению Кореи дипломатически, война может не начаться.",
    representable: true,
  },
  {
    id: "nato_formation",
    title: "Формирование НАТО",
    windowStart: "1949-01",
    windowEnd: "1949-12",
    primaryCountries: ["USA", "GBR", "FRA"],
    historicalOutcome:
      "США формализуют гарантии взаимной защиты с Западной Европой в ответ на советскую угрозу.",
    preconditions: [{ type: "relationBelow", a: "SUN", b: "USA", threshold: 30 }],
    baseWeight: 0.6,
    divergenceHint:
      "Ниже базовой вероятности, чем предыдущие — блок мог сформироваться раньше/позже/шире в зависимости от темпа охлаждения отношений.",
    representable: true,
  },
  {
    id: "greek_civil_war",
    title: "Гражданская война в Греции",
    windowStart: "1946-01",
    windowEnd: "1949-10",
    primaryCountries: ["GRC"],
    historicalOutcome:
      "Правительство Греции при западной поддержке подавляет коммунистическое партизанское движение — в игре нет отдельной страны-повстанца, эффект выражается через politics.stability, не через войну между двумя id.",
    preconditions: [{ type: "stabilityBelow", country: "GRC", threshold: 45 }],
    baseWeight: 0.5,
    divergenceHint:
      "Домашнее событие, не межгосударственное — LLM может отразить его через легитимность/стабильность GRC, не через LLMAction типа war.",
    representable: true,
  },
];
