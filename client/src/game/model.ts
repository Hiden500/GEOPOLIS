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
  /** Место в мировом рейтинге; 0 — не считается. */
  rank: number;
  tier: string;
  gdp: string;
  industry: string;
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
  /** Текст приказа, породившего событие. Есть только у своих действий. */
  order?: string;
  tags?: Array<{ id: string; label: string; kind: "region" | "country" | "object" }>;
}

export interface ScreenStat {
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
  progress: number;
  unlocks: string;
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

export interface ScreenMapMode {
  id: string;
  name: string;
}

/**
 * Всё, что экран показывает. Собирается заново на каждое изменение состояния —
 * дешевле и честнее, чем держать вторую живую копию мира в интерфейсе.
 */
export interface ScreenModel {
  playerId: string;
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
  budget: Array<{ name: string; share: number }>;
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
