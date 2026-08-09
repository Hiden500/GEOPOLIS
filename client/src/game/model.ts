/**
 * МОДЕЛЬ ЭКРАНА — контракт между интерфейсом и тем, что его наполняет.
 *
 * Экран не знает ни про `GameState`, ни про шаблонные данные: он получает эту
 * модель и рисует её. Источников у модели ровно два — адаптер настоящего
 * состояния (`adapter.ts`) и шаблонные данные песочницы (`proto/data.ts`).
 * Смысл разделения не в чистоте, а в конкретной проблеме: пока песочница была
 * отдельным экраном, любая правка формы жила в двух местах и расходилась.
 * Теперь экран физически один.
 *
 * Правило наполнения: чего в источнике НЕТ, то приходит пустым, и раздел
 * прячется. Придумывать число, чтобы панель не пустовала, нельзя — интерфейс,
 * который показывает выдуманное наравне с настоящим, обесценивает и то и
 * другое.
 */

import { createContext, useContext } from "react";

export interface ScreenGroup {
  name: string;
  share: number;
}

export interface ScreenCountry {
  id: string;
  name: string;
  short: string;
  /**
   * Место по ВВП. Это НЕ «место в мире»: силу движок считает отдельно и по
   * другой формуле. Смешивать их в одной колонке нельзя — получаются два
   * четвёртых места подряд, и таблица начинает врать.
   */
  rank: number;
  tier: string;
  gdp: string;
  /** Население. Промышленного выпуска на уровне державы в состоянии нет. */
  population: string;
  army: string;
  bloc: string;
  /** Отношение к игроку, −100…100. */
  relation: number;
  ideology: string;
  /** Две краски флага: основная и вспомогательная. */
  colors: [string, string];
}

export interface ScreenRegion {
  id: string;
  name: string;
  owner: string;
  population: string;
  groups: ScreenGroup[];
  discontent: number;
  industry: number;
  resources: string[];
  history: Array<{ when: string; text: string }>;
}

export interface ScreenEvent {
  id: string;
  date: string;
  title: string;
  body: string;
  factuality?: "confirmed" | "partial" | "unconfirmed";
  /**
   * Датированное событие — один факт из прозы месяца, а не сама месячная
   * запись. Два уровня обязаны различаться взглядом, без чтения (контракт
   * «Лента кампании», `docs/UI_DESIGN.md`), поэтому вид приходит моделью:
   * решать по длине текста или по наличию тегов интерфейс не должен.
   */
  dated?: boolean;
  /** Текст приказа, породившего событие. Есть только у своих действий. */
  order?: string;
  tags?: Array<{ id: string; label: string; kind: "region" | "country" | "object" }>;
}

export interface ScreenStat {
  /**
   * Ключ смысла, а не подпись: по нему ШАПКА подбирает иконку, том и группу.
   * Иконка и группировка — знание интерфейса, поэтому в модели их нет.
   */
  key?: string;
  label: string;
  value: string;
  delta?: { text: string; tone: "good" | "bad" | "neutral" };
  threshold?: "near" | "over";
}

export interface ScreenResource {
  id: string;
  label: string;
  amount: string;
  delta?: { text: string; tone: "good" | "bad" | "neutral" };
  shortage?: boolean;
}

export interface ScreenTechSlot {
  name: string;
  generations: number;
  readiness: number;
  capability: number;
  count: string;
  forbiddenFrom?: number;
  rival?: { label: string; readiness: number };
}

export interface ScreenDomain {
  name: string;
  tier: number;
  /** Доля пути до следующего тира, 0…1. */
  progress: number;
  unlocks: string;
  /** Доля исследовательских денег, направленная в домен. undefined — не задана. */
  focus?: number;
}

export interface ScreenProject {
  name: string;
  progress: number;
  eta: string;
  note: string;
}

export interface ScreenGoal {
  text: string;
  progress: number;
  kind: string;
}

export type RegionTab = "obzor" | "lyudi" | "hozyaystvo" | "istoriya";

export const REGION_TABS: Array<[RegionTab, string]> = [
  ["obzor", "Обзор"],
  ["lyudi", "Люди"],
  ["hozyaystvo", "Хозяйство"],
  ["istoriya", "История"],
];

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

/**
 * КОНЕЦ ИЛИ РАЗВИЛКА КАМПАНИИ (docs/CONCEPT.md §6, §7.1). Не панель, а
 * состояние, которое перекрывает всё: пока держава распалась и осколок не
 * выбран, играть нечем. Выбор осколка — необратимое действие, поэтому окно не
 * закрывается само и не имеет крестика.
 */
export interface ScreenCampaign {
  kind: "succession" | "defeated";
  title: string;
  lead: string;
  successors: Array<{ id: string; label: string }>;
}

/**
 * РЕЖИМ КАРТЫ — один словарь на оба источника модели.
 *
 * Идентификатор живёт здесь, а не рядом с раскраской, потому что это контракт
 * ЭКРАНА: по нему экран подбирает иконку кнопки и легенду. Пока словарей было
 * два — шифры движка (`pol`, `eco`, `sta`…) в игре и читаемые имена в
 * песочнице, — пересечение множеств было пустым, и в игре кнопки режимов
 * рисовались БЕЗ иконок, а легенда не появлялась никогда: поиск по ключу всегда
 * давал `undefined`. В песочнице те же ключи совпадали, поэтому дефект дожил до
 * игрока. Отсюда правило: оформление не ключуется строкой, которую два
 * источника модели вправе написать по-разному.
 *
 * Имена читаемые, а не шифры движка: три из восьми прежних врали о том, что
 * показывают (`sta` выводился как «Недовольство», `dip` — как «Блоки», `eco` —
 * как «Промышленность»).
 *
 * `relations`, а не `blocs`: раскраска читает ПАРНОЕ отношение владельца к
 * игроку (`diplomacy.relations[playerCountryId]`), а не членство в блоке —
 * двух чужих блоков между собой не видно вовсе. Данные честные, врало имя, и
 * поправлено имя. Настоящий режим блоков — `docs/IDEAS.md`, после v1.
 *
 * Режима «Армии» здесь нет: он красил «оккупирован → фронт, иначе тыл», линии
 * фронта в данных нет, и решением пользователя 2026-08-09 режим снят до её
 * появления. Снят из ОБЪЕДИНЕНИЯ, а не условием в рендере, — тогда лишние
 * ветки раскраски убирает компилятор.
 */
export type MapMode =
  | "powers"
  | "industry"
  | "resources"
  | "population"
  | "unrest"
  | "relations"
  | "infrastructure";

/** Порядок кнопок РЕЖИМОВ. Один и тот же в игре и в песочнице. */
export const MAP_MODE_ORDER: MapMode[] = [
  "powers",
  "industry",
  "resources",
  "population",
  "unrest",
  "relations",
  "infrastructure",
];

export interface ScreenMapMode {
  id: MapMode;
  name: string;
}

/**
 * Всё, что экран показывает. Собирается заново на каждое изменение состояния —
 * дешевле и честнее, чем держать вторую живую копию мира в интерфейсе.
 */
export interface ScreenModel {
  playerId: string;
  /** Место игрока в мировом рейтинге СИЛЫ — то, что считает движок. */
  playerRank: number;
  countries: Record<string, ScreenCountry>;
  regions: Record<string, ScreenRegion>;
  events: ScreenEvent[];

  /** Дата хода: месяц 0…11 и год. Подписи приходят локализованными. */
  monthIndex: number;
  year: number;
  monthsNominative: string[];
  monthsGenitive: string[];

  /** ПРИБОРЫ в ШАПКЕ — ровно пять, больше строка не держит. */
  stats: ScreenStat[];

  mapModes: ScreenMapMode[];

  /* Наполнение ТОМОВ. Пустой массив — раздел не показывается. */
  resources: ScreenResource[];
  techSlots: ScreenTechSlot[];
  domains: ScreenDomain[];
  projects: ScreenProject[];
  /**
   * Доли бюджета. `key` — статья расхода на сервере, `name` — подпись; без
   * ключа доли пришлось бы сопоставлять по подписи, а она локализуемая.
   */
  budget: Array<{ key: string; name: string; share: number }>;
  goals: ScreenGoal[];
  redLines: string[];

  /** Ключевые числа ТОМОВ. Пусто — секция не рисуется. */
  economyStats: ScreenStat[];
  politicsStats: ScreenStat[];

  /**
   * Курс на плоскости. Расстояние между точками и есть смысл (docs/CONCEPT.md
   * §4.2), поэтому соперник — часть модели, а не украшение.
   */
  ideology: {
    point: { x: number; y: number; label: string };
    rival: { x: number; y: number; label: string } | null;
    xFrom: string;
    xTo: string;
    yFrom: string;
    yTo: string;
    zones: [string, string, string, string];
  } | null;

  /**
   * СОВЕТНИК — оценка и предположение от LLM. Это НЕ факт и не расчёт движка
   * (docs/AI_RULES.md: числа считает движок), поэтому в интерфейсе он всегда
   * отделён оговоркой. Нет текста — нет секции: пустой советник хуже, чем
   * никакого.
   */
  advisor: { assessment: string; guess: string } | null;

  /** Ядерное: заряды и одна поясняющая строка. null — раздела нет. */
  nuclear: { warheads: string; note: string } | null;

  /** Развилка преемника или конец партии. null — партия идёт. */
  campaign: ScreenCampaign | null;

  /** Бюджет приказов на ход. */
  ordersPerTurn: number;

  /**
   * Необратимость приказа. В песочнице — список слов, в игре — ответ движка
   * примитивов: интерфейс не решает, что необратимо, он только спрашивает.
   */
  isIrreversible: (text: string) => boolean;
}

const ScreenModelContext = createContext<ScreenModel | null>(null);

export const ScreenModelProvider = ScreenModelContext.Provider;

/**
 * Модель читают листья дерева (тела ТОМОВ, РЕЕСТРА, инспекторов). Протаскивать
 * её пропсами через восемь уровней — шум, из-за которого правки начинают
 * бояться; контекст здесь ровно тот случай, для которого он и существует.
 */
export function useModel(): ScreenModel {
  const model = useContext(ScreenModelContext);
  if (model === null) throw new Error("useModel вызван вне ScreenModelProvider");
  return model;
}


/**
 * ДЕЙСТВИЯ экрана — то, что интерфейс умеет ПОПРОСИТЬ сделать. Отдельно от
 * модели намеренно: модель это снимок мира, а действие — обращение наружу.
 * Смешав их, мы получили бы экран, который нельзя открыть без сервера, — и
 * песочница перестала бы существовать.
 *
 * Действие отсутствует — соответствующий орган управления не рисуется. Кнопка,
 * которая ничего не делает, хуже отсутствующей кнопки: она обещает.
 */
export interface ScreenActions {
  /** Сохранить доли бюджета. Ключи — те же, что в `ScreenModel.budget`. */
  saveBudget?: (shares: Record<string, number>) => Promise<void>;

  /** Выбрать осколок-преемника после распада державы. */
  chooseSuccessor?: (countryId: string) => Promise<void>;

  /**
   * Распознать приказ: что из свободного текста понял движок. Показывается
   * игроку ДО того, как приказ попадёт в список, и не содержит величин —
   * их ещё не существует (docs/PRIMITIVES.md §1).
   */
  recognizeOrder?: (
    text: string,
    regionId: string | null,
  ) => Promise<{ primitives: unknown[]; recognized: string[] }>;

  /**
   * Ручной цикл ИИ-режиссёра (диагностический канал): получить промт вручную,
   * подставить ответ вручную, либо прогнать оба шага автоматически. Обычный
   * ход прогоняет ровно этот же серверный цикл сам — здесь то же самое
   * доступно вручную, когда нужно увидеть промт или обойти автоматический
   * ключ. Ни одно из трёх не задано — окно не откроется.
   */
  getLlmPrompt?: () => Promise<{ prompt: string; llmTurn: number }>;
  submitLlmResponse?: (text: string) => Promise<ScreenLlmResult>;
  runLlmCycle?: () => Promise<ScreenLlmResult>;
}

/**
 * Итог ручного цикла ИИ-режиссёра. Строки уже отрендерены на границе
 * (`GameShell`): экран не умеет разрешать `PrimitiveOutcomeLine`/
 * `PrimitiveRejectionRecord` — это домен движка, а модель экрана его не
 * знает (см. `recognizeOrder` выше — тот же приём).
 */
export interface ScreenLlmResult {
  success: boolean;
  /** Причина отказа ЗАПРОСА (сеть, невалидный JSON ответа) — не отказ примитивов. */
  error?: string;
  /** Стал ли ответ каноном. `false` — режиссёр предложил невозможное. */
  narrativeCanonized: boolean;
  title?: string;
  descriptions?: string;
  /** `undefined` — подтверждено полностью, отдельная оговорка не нужна. */
  factuality?: "partial" | "unconfirmed";
  applied: Array<{ headline: string; details: string[] }>;
  rejected: string[];
}

const ScreenActionsContext = createContext<ScreenActions>({});

export const ScreenActionsProvider = ScreenActionsContext.Provider;

export function useActions(): ScreenActions {
  return useContext(ScreenActionsContext);
}
