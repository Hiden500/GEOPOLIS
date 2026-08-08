/**
 * АДАПТЕР — превращает состояние партии в модель экрана.
 *
 * Единственное место, где интерфейс встречается с `GameState`. Всё, что экран
 * умеет показывать, приходит отсюда; всё, чего в состоянии нет, приходит
 * пустым и в интерфейсе не появляется вовсе. Это не осторожность, а правило:
 * панель, заполненная правдоподобной выдумкой, обесценивает соседнюю панель с
 * настоящим числом — а отличить их игрок не может.
 *
 * Считать здесь ничего нельзя. Числа считает движок (docs/AI_RULES.md);
 * адаптер только выбирает, переводит и форматирует. Единственное исключение —
 * место в рейтинге и доли бюджета: и то и другое выводится из уже посчитанных
 * полей и нужно ровно для показа.
 */

import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { type Region } from "@shared/types/map/Region";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { type PrimitiveOutcomeLine } from "@shared/types/politics/PrimitiveOutcome";
import { getDomainTier } from "@shared/utils/technology";
import {
  type ScreenCountry,
  type ScreenEvent,
  type ScreenModel,
  type ScreenRegion,
  type ScreenCampaign,
  type ScreenStat,
} from "./model";

/** K/M/B/T вместо «млн» и «тыс.»: сокращения одинаковы во всех локалях. */
function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toString();
}

function signed(value: number): string {
  return value >= 0 ? `+${compact(value)}` : `−${compact(Math.abs(value))}`;
}

/** Доля 0…1 в проценты. Величины, уже выраженные в процентах, сюда не идут. */
function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * Показатели политики и инфляция хранятся уже в шкале 0…100, а не долей —
 * умножать их ещё раз значит показать «5000».
 */
function score(value: number): string {
  return Math.round(value).toString();
}

/**
 * Направление хорошо/плохо задаёт вызывающий, а не знак числа: рост долга и
 * рост ВВП — оба «плюс», но это разные новости.
 */
function tone(value: number, goodWhenPositive: boolean): "good" | "bad" | "neutral" {
  if (value === 0) return "neutral";
  return value > 0 === goodWhenPositive ? "good" : "bad";
}

/**
 * Место в мировом рейтинге. Для игрока движок считает его сам
 * (`playerStanding`), для остальных берётся порядок по ВВП — это показ, а не
 * механика, и подменой чужого ранга ничего не решается.
 */
function ranksByGdp(countries: Country[]): Map<string, number> {
  const sorted = [...countries].sort((a, b) => b.economy.gdp - a.economy.gdp);
  return new Map(sorted.map((country, index) => [country.id, index + 1]));
}

const TIER_LABEL: Record<string, string> = {
  major: "Великая держава",
  regional: "Региональная держава",
  minor: "Малая держава",
};

function toCountry(
  country: Country,
  game: GameState,
  locale: Locale,
  rank: number,
): ScreenCountry {
  const player = game.countries.find((c) => c.id === game.playerCountryId);
  const relation =
    country.id === game.playerCountryId
      ? 100
      : (player?.diplomacy.relations[country.id] ?? 0);

  const bloc =
    player === undefined || country.id === game.playerCountryId
      ? "—"
      : player.diplomacy.allies.includes(country.id)
        ? "союзник"
        : player.diplomacy.rivals.includes(country.id)
          ? "соперник"
          : "—";

  return {
    id: country.id,
    name: getText(country.name, locale),
    short: getText(country.shortName, locale),
    rank,
    tier: TIER_LABEL[country.tier] ?? country.tier,
    gdp: compact(country.economy.gdp),
    population: compact(country.population),
    army: compact(country.military.activePersonnel),
    bloc,
    relation,
    ideology: country.politics.ideology,
    colors: [country.color, country.color],
  };
}

function toRegion(
  region: Region,
  game: GameState,
  locale: Locale,
  renderLine: RenderLine,
): ScreenRegion {
  const groupName = (groupId: string) => {
    const found = game.ethnicGroups.find((group) => group.id === groupId);
    return found === undefined ? groupId : getText(found.names, locale);
  };

  return {
    id: String(region.id),
    name: getText(region.names, locale),
    owner: region.ownerCountryId,
    population: compact(region.population),
    groups: (region.demographics ?? [])
      .map((share) => ({ name: groupName(share.groupId), share: share.share }))
      .sort((a, b) => b.share - a.share),
    // Недовольство — обратная сторона устойчивости: отдельного поля нет, а
    // выдумывать второе число под ту же величину значит развести их со
    // временем.
    discontent: Math.max(0, Math.min(1, 1 - region.stability)),
    industry: Math.round((region.economy?.industry ?? 0) * 100),
    resources: Object.entries(region.extraction ?? {})
      .filter(([, amount]) => amount > 0)
      .map(([type]) => type),
    history: (region.placeHistory ?? []).map((entry) => ({
      when: entry.date,
      text: renderLine(entry.line),
    })),
  };
}

/**
 * События. ЯРЛЫКИ и ЗНАК достоверности не выдумываются интерфейсом — они уже
 * лежат в расписке ответа (`ResponseReceipt`): что именно применилось, к каким
 * странам и регионам это относится и насколько подтверждено.
 */
function toEvents(
  game: GameState,
  locale: Locale,
  limit: number,
  renderLine: RenderLine,
): ScreenEvent[] {
  const shortName = (countryId: string) => {
    const found = game.countries.find((c) => c.id === countryId);
    return found === undefined ? countryId : getText(found.shortName, locale);
  };
  const regionName = (regionId: number) => {
    const found = game.regions.find((r) => r.id === regionId);
    return found === undefined ? String(regionId) : getText(found.names, locale);
  };

  // Подтверждённость датированного события разрешается по записи ответа, с
  // которой оно пришло: своей квитанции у него нет и быть не может — квитанция
  // описывает ответ целиком, а не отдельный факт его прозы.
  const receiptOf = (event: GameState["eventHistory"][number]) => {
    if (event.kind === "response") return event.receipt;
    const source = game.eventHistory.find(
      (candidate) => candidate.kind === "response" && candidate.id === event.responseEventId,
    );
    return source?.kind === "response" ? source.receipt : undefined;
  };

  /*
   * ЛЕНТА строится ПО ДАТЕ, новое сверху, — не по порядку записи движком
   * (контракт «Лента кампании», `docs/UI_DESIGN.md`). Датированные события
   * месяца приходят вместе с записью ответа, у которой дата — первое число,
   * но происходят позже неё, и модель перечисляет их не обязательно по
   * возрастанию. Порядок записи дал бы ленту, где 5 марта стоит выше 20-го.
   *
   * Сортировка устойчивая: при равных датах порядок остаётся тем, в котором
   * писал движок. Ограничение применяется ПОСЛЕ сортировки — иначе поздно
   * записанное раннее событие вытеснило бы из окна действительно свежее.
   */
  return game.eventHistory
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      a.event.date === b.event.date ? b.index - a.index : a.event.date < b.event.date ? 1 : -1,
    )
    .slice(0, limit)
    .map(({ event }) => {
      const receipt = receiptOf(event);
      // Ярлыки применённого — только у записи ответа: применённые примитивы
      // относятся к ответу целиком, и приписать их одному датированному факту
      // значило бы назвать его причиной чужих последствий.
      const applied = event.kind === "response" ? receipt?.primitives.applied ?? [] : [];
      const countryTags =
        event.kind === "response" ? receipt?.countries ?? [] : event.claimedCountries;
      const regionTags = event.kind === "response" ? receipt?.regions ?? [] : [];
      return {
        id: event.id,
        date: event.date,
        title: event.title,
        body: event.description,
        factuality: receipt?.factuality,
        dated: event.kind === "dated",
        order: applied.length > 0 ? applied.map((item) => renderLine(item.headline)).join("; ") : undefined,
        tags: [
          ...countryTags.map((id) => ({
            id,
            label: shortName(id),
            kind: "country" as const,
          })),
          ...regionTags.map((id) => ({
            id: String(id),
            label: regionName(id),
            kind: "region" as const,
          })),
        ],
      };
    });
}

function economyStats(country: Country): ScreenStat[] {
  const economy = country.economy;
  const debtRatio = economy.gdp === 0 ? 0 : economy.debt / economy.gdp;
  return [
    { label: "ВВП", value: compact(economy.gdp) },
    {
      label: "Баланс",
      value: signed(economy.budgetBalance),
      delta: { text: signed(economy.tradeBalance), tone: tone(economy.tradeBalance, true) },
    },
    {
      label: "Долг к ВВП",
      value: debtRatio.toFixed(2),
      threshold: debtRatio >= 1 ? "over" : debtRatio >= 0.8 ? "near" : undefined,
    },
    { label: "Инфляция", value: `${economy.inflation.toFixed(1)}%` },
  ];
}

function politicsStats(country: Country): ScreenStat[] {
  const politics = country.politics;
  return [
    { label: "Стабильность", value: score(politics.stability) },
    { label: "Легитимность", value: score(politics.legitimacy) },
    { label: "Коррупция", value: score(politics.corruption) },
    { label: "Поддержка", value: score(politics.governmentSupport) },
  ];
}

/**
 * Доли бюджета — из уже посчитанных расходных статей, не из отдельного поля.
 * Ключ совпадает с полем `BudgetUpdate`: по нему правка уходит обратно на
 * сервер, а подпись локализуема и для этого не годится.
 */
/**
 * Статьи росписи. Ключ совпадает с полем `spendingShares` и с телом
 * `PUT /budget`: по нему правка уходит обратно на сервер, а подпись
 * локализуема и для этого не годится.
 */
type SpendingShareKey = keyof NonNullable<Country["economy"]["spendingShares"]>;

function budgetShares(country: Country): Array<{ key: string; name: string; share: number }> {
  const economy = country.economy;
  const names: Array<[SpendingShareKey, string]> = [
    ["military", "Оборона"],
    ["research", "Наука"],
    ["education", "Образование"],
    ["infrastructure", "Инфраструктура"],
    ["welfare", "Социальное"],
  ];

  /*
   * Доли берутся ИЗ `spendingShares`, а не пересчитываются из абсолютных
   * статей. Это то самое поле, которое движок применяет к росписи и которое
   * `PUT /budget` перезаписывает дословно (`CountryService.updateBudget`) —
   * показывать что-то другое значит показывать не тот бюджет, который будет
   * применён.
   *
   * Прежняя версия делила статью на СУММУ статей. Ошибка была не в точности:
   * нормировка на сумму даёт единицу ВСЕГДА, поэтому недорасписанный бюджет
   * показать было нечем, а «открыл том → ничего не трогал → Сохранить доли»
   * молча переписывал роспись (доли уходят на сервер как есть).
   *
   * Поле есть у всех стран с 2026-08-01 (`EconomyState.ts`); фолбэк — для
   * состояния, где его почему-то нет. База фолбэка та же, что у движка:
   * доход за вычетом импорта, а не полный доход.
   */
  const shares = economy.spendingShares;
  if (shares) return names.map(([key, name]) => ({ key, name, share: shares[key] }));

  const income =
    economy.taxRevenue + economy.exportIncome + economy.stateEnterpriseIncome + economy.otherIncome;
  const disposableIncome = Math.max(0, income - economy.importSpending);
  if (disposableIncome <= 0) return [];

  const spending: Record<SpendingShareKey, number> = {
    military: economy.militarySpending,
    research: economy.researchSpending,
    education: economy.educationSpending,
    infrastructure: economy.infrastructureSpending,
    welfare: economy.welfareSpending,
  };
  return names.map(([key, name]) => ({ key, name, share: spending[key] / disposableIncome }));
}

function goalText(goal: Country["goals"][number]): string {
  if (goal.title !== undefined && goal.title !== "") return goal.title;
  switch (goal.kind) {
    case "reach_gdp":
      return `Достичь ВВП ${compact(goal.target)}`;
    case "reach_power_rank":
      return `Подняться до ${goal.targetRank}-го места в мире`;
    case "control_regions":
      return `Контролировать регионов: ${goal.targetCount}`;
    case "reach_tech_tier":
      return `Довести домен «${goal.domain}» до тира ${goal.targetTier}`;
  }
}

/**
 * Строки отклика приходят с сервера ключом и параметрами, а не готовым
 * текстом; разрешает их клиент, потому что язык интерфейса знает он
 * (docs/LOCALIZATION.md). Адаптер — чистая функция, поэтому рендер приходит
 * снаружи, а не берётся из хука.
 */
export type RenderLine = (line: PrimitiveOutcomeLine) => string;

export interface ScreenModelInput {
  game: GameState;
  locale: Locale;
  renderLine: RenderLine;
  mapModes: Array<{ id: string; name: string }>;
  /** Ответ движка: интерфейс не решает, что необратимо. */
  isIrreversible: (text: string) => boolean;
  monthsNominative: string[];
  monthsGenitive: string[];
  ordersPerTurn: number;
  /** Человеческое имя домена технологий по его идентификатору. */
  domainName: (id: string) => string;
  /**
   * Развилка кампании приходит уже переведённой: её текст собирается из
   * словаря интерфейса, а адаптер словаря не знает и знать не должен.
   */
  campaign: ScreenCampaign | null;
}

export function buildScreenModel({
  game,
  locale,
  renderLine,
  mapModes,
  isIrreversible,
  monthsNominative,
  monthsGenitive,
  ordersPerTurn,
  domainName,
  campaign,
}: ScreenModelInput): ScreenModel {
  const player = game.countries.find((c) => c.id === game.playerCountryId);
  const ranks = ranksByGdp(game.countries);

  // Ранг в таблицах — один и тот же для всех: место по ВВП. Сила игрока живёт
  // отдельным числом, у неё своя подпись.
  const countries: Record<string, ScreenCountry> = {};
  for (const country of game.countries) {
    countries[country.id] = toCountry(country, game, locale, ranks.get(country.id) ?? 0);
  }

  const regions: Record<string, ScreenRegion> = {};
  for (const region of game.regions) {
    regions[String(region.id)] = toRegion(region, game, locale, renderLine);
  }

  // Дата приходит из движка строкой ISO — разбираем, а не пересчитываем.
  const [yearText, monthText] = game.currentDate.split("-");
  const year = Number(yearText);
  const monthIndex = Math.max(0, Math.min(11, Number(monthText) - 1));

  const stats: ScreenStat[] =
    player === undefined
      ? []
      : [
          { key: "gdp", label: "ВВП", value: compact(player.economy.gdp) },
          {
            key: "treasury",
            label: "Казна",
            value: signed(player.economy.treasury),
            delta: {
              text: signed(player.economy.budgetBalance),
              tone: tone(player.economy.budgetBalance, true),
            },
          },
          { key: "rank", label: "Место в мире", value: `№${game.playerStanding.rank}` },
          { key: "stab", label: "Стабильность", value: score(player.politics.stability) },
          { key: "legit", label: "Легитимность", value: score(player.politics.legitimacy) },
        ];

  // Сильнейшая чужая держава — тот, с кем игрока и сравнивают по умолчанию.
  const rival = game.countries
    .filter((c) => c.id !== game.playerCountryId)
    .sort((a, b) => b.economy.gdp - a.economy.gdp)[0];

  const coords = player?.politics.ideologyCoordinates;
  const rivalCoords = rival?.politics.ideologyCoordinates;

  return {
    playerId: game.playerCountryId,
    playerRank: game.playerStanding.rank,
    countries,
    regions,
    events: toEvents(game, locale, 40, renderLine),
    monthIndex,
    year,
    monthsNominative,
    monthsGenitive,
    stats,
    mapModes,

    // Склад игрока: показываем только то, что действительно лежит.
    resources:
      player === undefined
        ? []
        : Object.entries(player.stockpile)
            .filter(([, amount]) => typeof amount === "number" && amount !== 0)
            .map(([type, amount]) => ({
              id: type,
              label: type,
              amount: compact(amount as number),
              shortage: (amount as number) < 0,
            })),

    // Слоты техники требуют сопоставления парка с поколениями домена — этой
    // связи в состоянии пока нет, и придумывать её интерфейс не будет.
    techSlots: [],

    /*
     * Тир считает общая утилита, а не интерфейс: порог тира — правило игры, и
     * второе мнение о нём в клиенте разошлось бы с движком при первой правке.
     */
    domains:
      player === undefined
        ? []
        : Object.entries(player.technology.domains)
            .sort(([, a], [, b]) => b - a)
            .map(([id, progress]) => {
              const tier = getDomainTier(progress);
              const step = progress / (tier + 1 || 1);
              return {
                name: domainName(id),
                tier,
                progress: Math.max(0, Math.min(1, step - Math.floor(step))),
                unlocks: "",
                focus: player.technology.researchAllocation?.[id],
              };
            }),

    // Проектов как сущности в состоянии нет.
    projects: [],
    budget: player === undefined ? [] : budgetShares(player),
    goals:
      player === undefined
        ? []
        : player.goals.map((goal) => ({
            text: goalText(goal),
            progress: goal.completed ? 1 : 0,
            kind: goal.completed ? "выполнена" : "в работе",
          })),
    redLines: [],
    economyStats: player === undefined ? [] : economyStats(player),
    politicsStats: player === undefined ? [] : politicsStats(player),
    ideology:
      coords === undefined || player === undefined
        ? null
        : {
            point: {
              x: coords.economic,
              y: coords.political,
              label: getText(player.shortName, locale),
            },
            rival:
              rival === undefined || rivalCoords === undefined
                ? null
                : {
                    x: rivalCoords.economic,
                    y: rivalCoords.political,
                    label: getText(rival.shortName, locale),
                  },
            xFrom: "лево",
            xTo: "право",
            yFrom: "авторитаризм",
            yTo: "демократия",
            zones: ["соц-демократия", "либеральная демократия", "консерватизм", "коммунизм"],
          },
    // Советник — текст от LLM; отдельного поля под оценку в состоянии нет.
    advisor: null,
    nuclear:
      player === undefined
        ? null
        : { warheads: String(player.military.nuclearWarheads), note: "" },
    campaign,
    ordersPerTurn,
    isIrreversible,
  };
}

export { compact, signed, percent };
