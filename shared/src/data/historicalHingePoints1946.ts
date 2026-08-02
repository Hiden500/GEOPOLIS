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
  // Южная Азия (docs/tasks/SOUTH_ASIA_1946_HINGE_POINTS.md, исследование
  // 2026-07-24, интегрировано 2026-08-02) — Раздел Индии/Пакистан остаются
  // заблокированы (нужна механика "создать страну в рантайме"), Хайдарабад
  // не тронут (продуктовое решение пользователя, не принято в этом заходе).
  {
    id: "fall_of_portuguese_india",
    title: "Конец Португальской Индии: Дадра и Нагар-Хавели, Гоа, Даман и Диу",
    windowStart: "1954-07",
    windowEnd: "1961-12",
    primaryCountries: ["IND", "QPI"],
    historicalOutcome:
      "Местные просоюзные активисты берут Дадра и Нагар-Хавели в 1954 году без участия регулярной армии Индии; Гоа, Даман и Диу присоединяются силовым путём в декабре 1961 ('Operation Vijay') за 36 часов.",
    preconditions: [{ type: "relationBelow", a: "IND", b: "QPI", threshold: 30 }],
    baseWeight: 0.75,
    divergenceHint:
      "Прямые переговоры или международное давление (ООН/Португалия) могли отсрочить силовой вариант вплоть до мирной передачи, как случилось с французскими владениями (см. french_india_transfer).",
    representable: true,
  },
  {
    id: "french_india_transfer",
    title: "Мирная передача Французской Индии",
    windowStart: "1948-01",
    windowEnd: "1954-11",
    primaryCountries: ["IND", "QFI"],
    historicalOutcome:
      "В отличие от Гоа, Франция ведёт переговоры: локальные референдумы в анклавах с 1948, де-факто передача управления Индии 1 ноября 1954 без военных действий; де-юре ратификация договора в 1962.",
    preconditions: [{ type: "relationAbove", a: "IND", b: "QFI", threshold: -10 }],
    baseWeight: 0.6,
    divergenceHint:
      "Ухудшение отношений (в отличие от исторического хода) могло бы свести этот случай к силовому сценарию fall_of_portuguese_india вместо переговорного.",
    representable: true,
  },
  {
    id: "sikkim_merger",
    title: "Утрата суверенитета и слияние Сиккима с Индией",
    windowStart: "1973-04",
    windowEnd: "1975-05",
    primaryCountries: ["IND", "QSI"],
    historicalOutcome:
      "После десятилетий индийского контроля над обороной/внешними связями (с 1950) массовые протесты 1973 года приводят к референдуму апреля 1975 (97% за упразднение монархии) и формальному слиянию как 22-й штат Индии в мае 1975.",
    preconditions: [{ type: "stabilityBelow", country: "QSI", threshold: 40 }],
    baseWeight: 0.65,
    divergenceHint:
      "Сохранение легитимности монархии Чогьяла (высокая стабильность QSI) — правдоподобный путь к продолжению существования Сиккима как отдельного государства дольше 1975 года.",
    representable: true,
  },
  {
    id: "sino_indian_border_war",
    title: "Индийско-китайская пограничная война",
    windowStart: "1962-10",
    windowEnd: "1962-11",
    primaryCountries: ["IND", "CHN"],
    historicalOutcome:
      "Спор о линии Мак-Магона (NEFA) и Аксайчине выливается в войну октября-ноября 1962 года; Китай побеждает тактически, но в одностороннем порядке отводит войска к довоенной линии контроля.",
    preconditions: [{ type: "relationBelow", a: "IND", b: "CHN", threshold: 20 }],
    baseWeight: 0.55,
    divergenceHint:
      "Развилка не привязана к конкретному спорному региону — Аксайчин/NEFA сейчас не выделены отдельными регионами (не проверено, к какой стране относятся на карте сегодня), в отличие от Кашмира войну нельзя территориально анимировать точнее уровня страны.",
    representable: true,
  },
  {
    id: "naga_insurgency",
    title: "Нагаленд: движение за независимость и вооружённое восстание",
    windowStart: "1955-01",
    windowEnd: "1997-07",
    primaryCountries: ["IND"],
    historicalOutcome:
      "Национальный совет нага провозглашает независимость 14 августа 1947 (за день до Индии); политическое движение перерастает в вооружённое восстание к середине 1950-х; Нагаленд получает статус штата в 1963; конфликт тянется десятилетиями (раскол NSCN 1980, перемирие 1997).",
    preconditions: [{ type: "stabilityBelow", country: "IND", threshold: 40 }],
    baseWeight: 0.4,
    divergenceHint:
      "Как и greek_civil_war — внутристрановое событие, нет отдельной игровой сущности для повстанцев; эффект выражается через politics.stability IND, не войну между двумя id.",
    representable: true,
  },
];
