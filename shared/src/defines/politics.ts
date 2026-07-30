import { type PowerStructure } from "../types/politics/Government";

/**
 * Баланс-константы PoliticsTick.ts (docs/plans/03_MODIFIERS_COMMANDS.md,
 * Шаг 3) — план не называл их явно, но файл физически в периметре критерия
 * приёмки (server/src/simulation/**). politics.stability/legitimacy/
 * corruption/governmentSupport дрейфуют к структурному равновесию
 * (equilibrium), которое зависит от режима/экономики/друг друга — числа
 * ниже калибруют и равновесия, и скорость дрейфа к ним.
 *
 * Функции, читающие эти числа, — `shared/src/utils/politics.ts`.
 */

/**
 * Структурный базис коррупции по МЕХАНИЗМУ удержания власти — нижний потолок
 * без институциональных изменений.
 *
 * Ключуется по `politics.powerStructure`, а не по ярлыку идеологии (переведено
 * 2026-07-30, прежнее имя — `GOVERNMENT_TYPE_CORRUPTION_BASE`). Коррупция —
 * вопрос не о точке спектра, а о том, кто и через что распределяет ренту:
 * конкуренция партий и сменяемость власти её ограничивают, личный режим на ней
 * держится. Прежняя таблица знала 10 ярлыков, из которых в данных 1946
 * встречались 3, и 78 стран из 157 падали в дефолт.
 *
 * Тип — `Record<PowerStructure, number>`, а не `Record<string, number>`: новая
 * форма власти в `POWER_STRUCTURES` без записи здесь не скомпилируется. Именно
 * это отсутствовало у прежней таблицы и позволило ей молча разойтись с данными.
 */
export const POWER_STRUCTURE_CORRUPTION_BASE: Record<PowerStructure, number> = {
  /** Сменяемость власти и свободная пресса — сильнейший из доступных 1946 ограничителей. */
  competitive_multiparty: 20,
  /** Конкуренция есть, но ценз и цензура сужают круг спрашивающих. */
  limited_multiparty: 30,
  /** Оппозиция допущена, но не выигрывает — проверка власти формальна. */
  dominant_party: 38,
  /** Партия монопольна, зато дисциплинирует аппарат сверху. */
  one_party: 42,
  /** Мандат на человеке: лояльность покупается доступом к ренте — это и есть механизм. */
  personalist: 60,
  /** Армия как корпорация распределяет ресурсы вне гражданского контроля. */
  military: 55,
  /** Двор и патронаж: должность — часть личного пожалования. */
  dynastic_court: 50,
  /** Иерархия дисциплинирует, но подотчётности мирянам нет. */
  clerical: 40,
  /** Администрация извлекает ресурс и подотчётна метрополии, а не населению. */
  colonial_administration: 45,
  /** Временность плюс чёрный рынок разрушенной экономики. */
  occupation_administration: 50,
  /** Институты ещё не сложились, дележ идёт до правил. */
  provisional_coalition: 48,
  /** Единого центра нет — нет и того, кто спрашивает. */
  fragmented: 70,
};

/**
 * Легитимность как база: центр политической оси (см. ниже) без поправок.
 *
 * Заменила `IDEOLOGY_LEGITIMACY_BASE`, ключевавшуюся по строке
 * `politics.ideology` (2026-07-30). Модель базы — три слагаемых:
 *
 *   `LEGITIMACY_SPECTRUM_BASE`
 *     + `LEGITIMACY_DEMOCRATIC_MANDATE_WEIGHT` × political
 *     + `LEGITIMACY_CONSOLIDATION_WEIGHT` × |political|
 *     + `POWER_STRUCTURE_LEGITIMACY_MANDATE[powerStructure]`
 *
 * КРИВАЯ U-ОБРАЗНАЯ, А НЕ ЛИНЕЙНАЯ. Линейная («чем демократичнее, тем
 * легитимнее») означала бы, что любая диктатура нелегитимна по построению, и
 * СССР-победитель 1946 оказался бы ниже гибридных режимов. У консолидированного
 * полюса — любого — источник мандата ясен (выборы либо идеология и аппарат), у
 * режима посередине не работает ни один: это известная неустойчивость гибридов.
 * Наклон в пользу демократии остаётся, но он меньше вклада консолидации.
 *
 * ЭКОНОМИЧЕСКАЯ ОСЬ В БАЗУ НЕ ВХОДИТ НАМЕРЕННО. Она отвечает на вопрос «чья
 * собственность», а не «по какому праву правят»; включив её, движок заявил бы,
 * что плановая экономика сама по себе делает власть менее правомочной.
 */
export const LEGITIMACY_SPECTRUM_BASE = 45;

/** Наклон в пользу демократии: процедура обновляет мандат, автократия его донашивает. */
export const LEGITIMACY_DEMOCRATIC_MANDATE_WEIGHT = 8;

/** Вклад консолидации (|political|): у полюса мандат есть, у гибрида нет ни одного. */
export const LEGITIMACY_CONSOLIDATION_WEIGHT = 22;

/**
 * Поправка на ПРОИСХОЖДЕНИЕ власти. Координаты говорят, где режим стоит, но не
 * откуда взялось его право править, — а колониальная и оккупационная
 * администрации не имеют его у населения вовсе, каким бы либеральным ни был их
 * метрополийный оригинал. Без этой поправки временное правительство Франции
 * получало базу почти как Британия, а оккупированная Япония — как средняя
 * европейская страна.
 *
 * Ноль у форм, чью легитимность координаты уже описывают: их мандат — вопрос
 * положения на спектре, а не способа прихода к власти. Тип — полная
 * `Record<PowerStructure, number>` по той же причине, что и таблица коррупции.
 */
export const POWER_STRUCTURE_LEGITIMACY_MANDATE: Record<PowerStructure, number> = {
  /** Мандат описан координатами — выборы и есть источник права. */
  competitive_multiparty: 0,
  limited_multiparty: 0,
  dominant_party: 0,
  one_party: 0,
  /** Наследственное право — самостоятельный источник, не производный от спектра. */
  dynastic_court: 5,
  /** Религиозный мандат — тоже собственный источник. */
  clerical: 3,
  /** Право держится на человеке, а не на институте: уходит вместе с ним. */
  personalist: -5,
  /** Пришли силой, гражданского мандата не получали. */
  military: -8,
  /** Мандат заведомо временный — до учредительных выборов. */
  provisional_coalition: -10,
  /** Легитимировать нечего: единой власти нет. */
  fragmented: -12,
  /** Власть метрополии над чужим населением. */
  colonial_administration: -18,
  /** Власть победителя — минимум мандата из возможных. */
  occupation_administration: -22,
};

/** Утечка казны из-за коррупции: доля ВВП в месяц на единицу коррупции. При corruption=50, GDP=1 трлн → 2.5 млрд/мес утечки. */
export const CORRUPTION_TREASURY_DRAIN = 0.00005;

// --- corruptionEquilibrium ---
/**
 * Коррупция страны без размеченной формы власти (сценарии без `government.json`:
 * `powerStructure` опционален). Именно фолбэк, а не «средний режим»: страна с
 * разметкой берёт свой базис из `POWER_STRUCTURE_CORRUPTION_BASE`.
 */
export const CORRUPTION_EQUILIBRIUM_DEFAULT = 35;
export const CORRUPTION_LOW_STABILITY_THRESHOLD = 40;
export const CORRUPTION_LOW_STABILITY_PENALTY = 15;
export const CORRUPTION_HIGH_STABILITY_THRESHOLD = 70;
export const CORRUPTION_HIGH_STABILITY_ADJUSTMENT = -5;
/** Низкие расходы на образование (доля дохода) → слабые институты → рост коррупции. */
export const CORRUPTION_LOW_EDUCATION_SHARE_THRESHOLD = 0.05;
export const CORRUPTION_LOW_EDUCATION_PENALTY = 10;

// --- stabilityEquilibrium ---
export const STABILITY_EQUILIBRIUM_DEFAULT = 50;
export const STABILITY_LOW_UNEMPLOYMENT_THRESHOLD = 5;
export const STABILITY_LOW_UNEMPLOYMENT_BONUS = 15;
export const STABILITY_HIGH_UNEMPLOYMENT_THRESHOLD = 15;
export const STABILITY_HIGH_UNEMPLOYMENT_PENALTY = -15;
export const STABILITY_BALANCED_BUDGET_BONUS = 5;
export const STABILITY_SEVERE_DEFICIT_GDP_SHARE = 0.05;
export const STABILITY_SEVERE_DEFICIT_PENALTY = -20;
export const STABILITY_MILD_DEFICIT_PENALTY = -10;
export const STABILITY_HIGH_INFLATION_THRESHOLD = 20;
export const STABILITY_HIGH_INFLATION_PENALTY = -5;
/** Высокая коррупция подтачивает институты — давит на stability. */
export const STABILITY_HIGH_CORRUPTION_THRESHOLD = 60;
export const STABILITY_HIGH_CORRUPTION_PENALTY = -10;

// --- governmentSupportEquilibrium ---
export const GOV_SUPPORT_EQUILIBRIUM_DEFAULT = 50;
export const GOV_SUPPORT_LOW_UNEMPLOYMENT_THRESHOLD = 5;
export const GOV_SUPPORT_LOW_UNEMPLOYMENT_BONUS = 10;
export const GOV_SUPPORT_HIGH_UNEMPLOYMENT_THRESHOLD = 15;
export const GOV_SUPPORT_HIGH_UNEMPLOYMENT_PENALTY = -10;
export const GOV_SUPPORT_DEFICIT_PENALTY = -5;
/** Щедрые социальные расходы (доля сверх пола) поддерживают рейтинг. */
export const GOV_SUPPORT_GENEROUS_WELFARE_FLOOR_RATIO = 1.5;
export const GOV_SUPPORT_GENEROUS_WELFARE_BONUS = 5;

// --- legitimacyBase ---
// Отдельного фолбэка у легитимности нет — и не нужен: координаты резолвятся
// всегда (страна без явных получает их по ярлыку либо центр спектра,
// `resolveIdeologyCoordinates`), а центр спектра и есть база
// `LEGITIMACY_SPECTRUM_BASE`. Прежняя `LEGITIMACY_DEFAULT = 55` удалена вместе
// с таблицей по ярлыку: она означала «ярлык неизвестен», а неизвестных ярлыков
// больше нет — есть известная точка спектра.

// --- скорость дрейфа к равновесию (politicsTick) ---
export const CORRUPTION_DRIFT_RATE = 0.003;
export const STABILITY_DRIFT_RATE = 0.05;
export const GOV_SUPPORT_DRIFT_RATE = 0.08;
export const LEGITIMACY_DRIFT_RATE = 0.005;

/**
 * Порог кризисного (не просто "низкого") stability — детекция
 * политического кризиса/переворота (SimulationEngine.ts::pendingWorldFacts,
 * "того же паттерна", что пересечение тира технологий, 2026-07-06). Ниже
 * уже существующего "низкого" порога (STABILITY_LOW=40, shared/defines/ai.ts,
 * управляет рутинным AI-нуджем Правила C) — кризис-факт реже рутинной
 * подстройки бюджета, не дублирует её частоту.
 */
export const POLITICAL_CRISIS_STABILITY_THRESHOLD = 20;
