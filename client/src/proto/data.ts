/**
 * Шаблонные данные кликабельного макета.
 *
 * Это НЕ игровые данные и не срез сценария 1946: числа правдоподобны, но
 * выдуманы, а география условна. Прототип существует, чтобы проверить
 * поведение интерфейса — что откуда выдвигается, что чем закрывается, что
 * куда ведёт, — до того как под него подключается настоящее состояние.
 */

export type CountryId = "SUN" | "USA" | "GBR" | "FRA" | "TUR" | "FIN";

export interface Country {
  id: CountryId;
  name: string;
  short: string;
  rank: number;
  tier: string;
  gdp: string;
  industry: string;
  army: string;
  bloc: string;
  relation: number;
  ideology: string;
  colors: [string, string];
}

export const COUNTRIES: Record<CountryId, Country> = {
  SUN: {
    id: "SUN",
    name: "Союз Советских Социалистических Республик",
    short: "СССР",
    rank: 2,
    tier: "Сверхдержава",
    gdp: "1,46T",
    industry: "42% от США",
    army: "4,1 млн",
    bloc: "—",
    relation: 100,
    ideology: "Коммунизм",
    colors: ["#c1272d", "#f0c14b"],
  },
  USA: {
    id: "USA",
    name: "Соединённые Штаты Америки",
    short: "США",
    rank: 1,
    tier: "Сверхдержава",
    gdp: "3,48T",
    industry: "100%",
    army: "1,9 млн",
    bloc: "—",
    relation: 20,
    ideology: "Либеральная демократия",
    colors: ["#3c3b6e", "#b22234"],
  },
  GBR: {
    id: "GBR",
    name: "Соединённое Королевство",
    short: "Великобритания",
    rank: 3,
    tier: "Великая держава",
    gdp: "0,71T",
    industry: "21% от США",
    army: "1,2 млн",
    bloc: "—",
    relation: 12,
    ideology: "Социал-демократия",
    colors: ["#012169", "#c8102e"],
  },
  FRA: {
    id: "FRA",
    name: "Французская Республика",
    short: "Франция",
    rank: 6,
    tier: "Великая держава",
    gdp: "0,32T",
    industry: "9% от США",
    army: "0,6 млн",
    bloc: "—",
    relation: 34,
    ideology: "Смешанная республика",
    colors: ["#0055a4", "#ef4135"],
  },
  TUR: {
    id: "TUR",
    name: "Турецкая Республика",
    short: "Турция",
    rank: 21,
    tier: "Региональная держава",
    gdp: "0,04T",
    industry: "1% от США",
    army: "0,4 млн",
    bloc: "—",
    relation: -28,
    ideology: "Авторитарная республика",
    colors: ["#e30a17", "#ffffff"],
  },
  FIN: {
    id: "FIN",
    name: "Финляндская Республика",
    short: "Финляндия",
    rank: 38,
    tier: "Малая держава",
    gdp: "0,01T",
    industry: "0,4% от США",
    army: "0,04 млн",
    bloc: "Сфера СССР",
    relation: 6,
    ideology: "Парламентская республика",
    colors: ["#ffffff", "#003580"],
  },
};

export interface Group {
  name: string;
  share: number;
}

export interface Region {
  id: string;
  name: string;
  owner: CountryId;
  population: string;
  groups: Group[];
  discontent: number;
  industry: number;
  resources: string[];
  history: Array<{ when: string; text: string }>;
}

/**
 * Условная «карта» — шестиугольная сетка. Настоящая MapLibre-карта в
 * прототип не подключена намеренно: проверяется поведение панелей, а не
 * география. Сетка нужна лишь затем, чтобы выделение региона и державы
 * было настоящим кликом, а не кнопкой «как будто выбрали».
 */
export const GRID_COLUMNS = 11;
export const GRID_ROWS = 6;

/** null — вода. Порядок: слева направо, сверху вниз. */
export const HEX_OWNERS: Array<CountryId | null> = [
  null, null, "FIN", "FIN", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN", null,
  null, "GBR", "FIN", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN",
  "GBR", "GBR", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN", null,
  null, "FRA", "FRA", "SUN", "SUN", "SUN", "SUN", "SUN", "SUN", null, null,
  null, "FRA", "FRA", "TUR", "TUR", "SUN", "SUN", "SUN", null, null, null,
  null, null, "TUR", "TUR", "TUR", "SUN", "SUN", null, null, null, null,
];

const REGION_NAMES: Record<number, string> = {
  2: "Лапландия",
  3: "Похьянмаа",
  4: "Мурманск",
  5: "Карелия",
  6: "Архангельск",
  7: "Коми",
  8: "Ямал",
  9: "Таймыр",
  12: "Шотландия",
  13: "Уусимаа",
  14: "Ленинград",
  15: "Новгород",
  16: "Вологда",
  17: "Пермь",
  18: "Тюмень",
  19: "Томск",
  20: "Якутия",
  21: "Чукотка",
  22: "Уэльс",
  23: "Англия",
  24: "Сааремаа",
  25: "Эстония",
  26: "Псков",
  27: "Москва",
  28: "Казань",
  29: "Свердловск",
  30: "Омск",
  31: "Иркутск",
  34: "Бретань",
  35: "Иль-де-Франс",
  36: "Литва",
  37: "Белоруссия",
  38: "Смоленск",
  39: "Воронеж",
  40: "Самара",
  41: "Челябинск",
  45: "Аквитания",
  46: "Прованс",
  47: "Фракия",
  48: "Анатолия",
  49: "Украина",
  50: "Дон",
  51: "Кубань",
  57: "Каппадокия",
  58: "Киликия",
  59: "Курдистан",
  60: "Кавказ",
  61: "Каспий",
};

const GROUPS: Record<string, Group[]> = {
  Сааремаа: [
    { name: "Эстонцы", share: 0.87 },
    { name: "Русские", share: 0.09 },
    { name: "Шведы", share: 0.04 },
  ],
  Эстония: [
    { name: "Эстонцы", share: 0.79 },
    { name: "Русские", share: 0.18 },
    { name: "Немцы", share: 0.03 },
  ],
  Литва: [
    { name: "Литовцы", share: 0.81 },
    { name: "Поляки", share: 0.12 },
    { name: "Русские", share: 0.07 },
  ],
  Украина: [
    { name: "Украинцы", share: 0.74 },
    { name: "Русские", share: 0.21 },
    { name: "Евреи", share: 0.05 },
  ],
  Кавказ: [
    { name: "Грузины", share: 0.41 },
    { name: "Армяне", share: 0.29 },
    { name: "Азербайджанцы", share: 0.24 },
    { name: "Русские", share: 0.06 },
  ],
};

const HIGH_DISCONTENT: Record<string, number> = {
  Сааремаа: 0.61,
  Эстония: 0.54,
  Литва: 0.49,
  Украина: 0.38,
  Кавказ: 0.33,
  Курдистан: 0.44,
};

function makeRegion(index: number, owner: CountryId): Region {
  const name = REGION_NAMES[index] ?? `Область ${index}`;
  const groups = GROUPS[name] ?? [
    { name: COUNTRIES[owner].short === "СССР" ? "Русские" : COUNTRIES[owner].short, share: 0.92 },
    { name: "Прочие", share: 0.08 },
  ];
  const discontent = HIGH_DISCONTENT[name] ?? 0.05 + ((index * 37) % 18) / 100;
  return {
    id: `r${index}`,
    name,
    owner,
    population: `${(0.4 + ((index * 53) % 90) / 10).toFixed(1)} млн`,
    groups,
    discontent: Number(discontent.toFixed(2)),
    industry: 4 + ((index * 29) % 60),
    resources: [
      ["Уголь", "Нефть", "Сталь"][index % 3],
      ["Зерно", "Лес", "Каучук", "Вольфрам"][index % 4],
    ],
    history:
      name === "Сааремаа"
        ? [
            { when: "1917", text: "Германская оккупация островов" },
            { when: "1940", text: "Присоединение к СССР" },
            { when: "1944", text: "Бои за Моонзундский архипелаг" },
          ]
        : [{ when: "1940", text: "Вошёл в состав державы" }],
  };
}

export const REGIONS: Record<string, Region> = Object.fromEntries(
  HEX_OWNERS.flatMap((owner, index) =>
    owner === null ? [] : [[`r${index}`, makeRegion(index, owner)] as const],
  ),
);

export const MAP_MODES = [
  { id: "powers", name: "Державы" },
  { id: "blocs", name: "Блоки" },
  { id: "population", name: "Население" },
  { id: "discontent", name: "Недовольство" },
  { id: "industry", name: "Промышленность" },
  { id: "resources", name: "Ресурсы" },
  { id: "armies", name: "Армии" },
  { id: "terrain", name: "Рельеф" },
] as const;

export type MapModeId = (typeof MAP_MODES)[number]["id"];

export const TOMES = [
  { id: "economy", name: "Экономика" },
  { id: "politics", name: "Политика" },
  { id: "defence", name: "Оборона" },
  { id: "science", name: "Наука" },
  { id: "diplomacy", name: "Дипломатия" },
  { id: "goals", name: "Цели" },
] as const;

export type TomeId = (typeof TOMES)[number]["id"];

export const LEDGER_TABS = [
  { id: "powers", name: "Державы" },
  { id: "regions", name: "Регионы" },
  { id: "blocs", name: "Блоки" },
  { id: "chronicle", name: "Летопись" },
] as const;

export type LedgerTabId = (typeof LEDGER_TABS)[number]["id"];

export const RESOURCES = [
  { id: "coal", label: "Уголь", amount: "412", delta: { text: "+8", tone: "good" as const } },
  { id: "oil", label: "Нефть", amount: "96", delta: { text: "−4", tone: "bad" as const } },
  { id: "steel", label: "Сталь", amount: "188", delta: { text: "+2", tone: "good" as const } },
  { id: "alu", label: "Алюминий", amount: "54", delta: { text: "+1", tone: "good" as const } },
  { id: "rubber", label: "Каучук", amount: "7", delta: { text: "−1", tone: "bad" as const }, shortage: true },
  { id: "tungsten", label: "Вольфрам", amount: "3", delta: { text: "0", tone: "neutral" as const }, shortage: true },
];

export const TECH_SLOTS = [
  { name: "Средний танк", generations: 6, readiness: 3, capability: 4, count: "4 120" },
  { name: "Тяжёлый танк", generations: 6, readiness: 2, capability: 3, count: "870" },
  { name: "Тактическая авиация", generations: 6, readiness: 2, capability: 4, count: "2 380" },
  { name: "Стратегический бомбардировщик", generations: 6, readiness: 3, capability: 3, count: "210", rival: { label: "США", readiness: 5 } },
  { name: "Эсминец", generations: 6, readiness: 4, capability: 4, count: "34" },
  { name: "Подводная лодка", generations: 6, readiness: 3, capability: 4, count: "112" },
  { name: "Ракета средней дальности", generations: 6, readiness: 2, capability: 5, count: "0", forbiddenFrom: 3 },
  { name: "Ядерный заряд", generations: 6, readiness: 0, capability: 1, count: "0" },
];

export const DOMAINS = [
  { name: "Индустрия", tier: 3, progress: 0.62, unlocks: "Поточные линии: +8% к выпуску" },
  { name: "Ракетная техника", tier: 2, progress: 0.41, unlocks: "Баллистическая ракета малой дальности" },
  { name: "Ядерная физика", tier: 1, progress: 0.18, unlocks: "Программа расщепляющихся материалов" },
  { name: "Электроника", tier: 2, progress: 0.77, unlocks: "Бортовые радиолокаторы" },
  { name: "Авиация", tier: 3, progress: 0.29, unlocks: "Реактивный двигатель второго поколения" },
];

export const PROJECTS = [
  { name: "Программа РДС", progress: 0.34, eta: "1949", note: "Ограничено добычей урана" },
  { name: "Четвёртая пятилетка", progress: 0.71, eta: "1950", note: "Идёт с опережением" },
  { name: "Восстановление Днепрогэса", progress: 0.88, eta: "1947", note: "" },
];

export const BUDGET = [
  { name: "Оборона", share: 0.34 },
  { name: "Промышленность", share: 0.28 },
  { name: "Наука", share: 0.11 },
  { name: "Социальное", share: 0.19 },
  { name: "Резерв", share: 0.08 },
];

export const GOALS = [
  {
    text: "Догнать США по промышленному выпуску к 1960 году",
    progress: 0.42,
    kind: "измеримая" as const,
  },
  {
    text: "Не допустить враждебного блока на западной границе",
    progress: 0.6,
    kind: "нарративная" as const,
  },
  {
    text: "Получить ядерное оружие раньше, чем его получит Британия",
    progress: 0.34,
    kind: "измеримая" as const,
  },
];

export const RED_LINES = [
  "Не применять ядерное оружие первыми",
  "Не воевать с США напрямую",
];

export interface ProtoEvent {
  id: string;
  date: string;
  title: string;
  body: string;
  factuality?: "confirmed" | "partial" | "unconfirmed";
  order?: string;
  tags?: Array<{ id: string; label: string; kind: "region" | "country" | "object" }>;
}

export const INITIAL_EVENTS: ProtoEvent[] = [
  {
    id: "e1",
    date: "5 марта",
    title: "Речь в Фултоне",
    body: "Черчилль говорил о железном занавесе, опустившемся от Штеттина до Триеста. Вашингтон промолчал, но не возразил. Нейтральные столицы впервые обсуждают два лагеря вслух.",
    tags: [
      { id: "GBR", label: "Великобритания", kind: "country" },
      { id: "USA", label: "США", kind: "country" },
    ],
  },
  {
    id: "e2",
    date: "9 марта",
    title: "Волнения в Сааремаа подавлены",
    body: "Гарнизон занял портовый посёлок без стрельбы. Недовольство спало почти вдвое, но эстонские общины замкнулись: отчуждение выросло, и следующая уступка будет стоить дороже.",
    order: "Усилить контроль в Прибалтике, но без массовых репрессий",
    tags: [{ id: "r24", label: "Сааремаа", kind: "region" }],
  },
  {
    id: "e3",
    date: "14 марта",
    title: "Забастовки на верфях Марселя",
    body: "Профсоюзы требуют пересмотра тарифов. Коммунисты в правительстве колеблются между поддержкой и порядком.",
    factuality: "partial",
    tags: [{ id: "FRA", label: "Франция", kind: "country" }],
  },
  {
    id: "e4",
    date: "28 марта",
    title: "Слухи о разладе в Политбюро",
    body: "Иностранные корреспонденты пишут о споре вокруг сроков четвёртой пятилетки. Подтверждений нет.",
    factuality: "unconfirmed",
  },
];

export const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export const MONTHS_NOMINATIVE = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** Слова, по которым прототип считает приказ необратимым. */
export const IRREVERSIBLE_WORDS = ["войн", "ядерн", "переворот", "аннекс", "блок"];
