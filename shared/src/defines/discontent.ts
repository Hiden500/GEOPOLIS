import { type IdeologyCoordinates } from "../types/politics/Ideology";

/**
 * Баланс-константы недовольства и примитивов воздействия
 * (docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md, сессия A; docs/CONCEPT.md §4.2, §5.2).
 *
 * ВСЕ числа ниже — стартовые плейсхолдеры, подлежащие калибровке на живых
 * прогонах (дизайн намеренно их не детерминировал). Ориентир, по которому они
 * выбраны: прибалтийские регионы СССР 1946 устойчиво стоят выше кризисного
 * порога, контрольные славянские регионы — устойчиво ниже, а три ответа игрока
 * (`repress`/`grant_autonomy`/`enact_reform`) через год расходятся заметно.
 *
 * Файл живёт в `shared/src/defines/`, а не рядом с тиком, потому что
 * fitness-функция «правило 4» запрещает числовые литералы баланса в
 * `server/src/simulation/**` (server/src/__tests__/architecture.test.ts).
 */

/**
 * Фолбэк координат по именованному ярлыку `PoliticsState.ideology` для стран
 * без явных координат в сценарных данных (покрытие частичное). Ключи — реальные
 * пять ярлыков сценария 1946 (server/data/scenarios/1946/countries.json).
 * Это именно фолбэк-читалка ярлыка, а не источник истины: страна с явными
 * координатами их и использует.
 */
export const IDEOLOGY_LABEL_COORDINATES: Record<string, IdeologyCoordinates> = {
  "Communism": { economic: -0.90, political: -0.80 },
  "Liberal Democracy": { economic: 0.35, political: 0.75 },
  "Traditionalism": { economic: 0.20, political: -0.45 },
  "Nationalism": { economic: 0.10, political: -0.60 },
  "Authoritarianism": { economic: 0.00, political: -0.75 },
};

/** Ярлык неизвестен — центр спектра, нейтральная позиция без выдуманного уклона. */
export const IDEOLOGY_FALLBACK_COORDINATES: IdeologyCoordinates = { economic: 0, political: 0 };

// --- формула недовольства группы (shared/src/utils/discontent.ts) ---

/** Фоновое недовольство: даже полностью совпадающая с властью группа не идеально довольна. */
export const DISCONTENT_BASE = 0.05;

/** Вклад нормированной идеологической дистанции «власть ↔ группа» — главный член. */
export const DISCONTENT_DISTANCE_WEIGHT = 0.9;

/** Вклад экономической обездоленности региона (1 − относительное благосостояние). */
export const DISCONTENT_WELFARE_WEIGHT = 0.25;

/** Вклад «осмелели» (подстрекательство, уступка соседям). */
export const DISCONTENT_EMBOLDENMENT_WEIGHT = 0.3;

/** Насколько репрессии давят недовольство вниз, пока след свеж. */
export const DISCONTENT_SUPPRESSION_WEIGHT = 0.5;

/** Насколько уступки давят недовольство вниз. */
export const DISCONTENT_CONCESSION_WEIGHT = 0.4;

/**
 * Насколько отчуждение прибавляется к идеологической дистанции. Это и есть
 * «загнал вглубь»: `suppression` гаснет за пару месяцев, а прибавка к дистанции
 * остаётся и поднимает равновесное недовольство выше исходного.
 */
export const ALIENATION_DISTANCE_WEIGHT = 0.3;

/**
 * Относительный ВВП на душу, при котором регион считается вполне благополучным
 * (1.0 = средний по стране-владельцу). Выше — благосостояние клампится в 1,
 * ниже — падает линейно. Мера относительная, а не абсолютная: недовольство даёт
 * отставание от своей же страны, а не курс доллара 1946 года.
 */
export const WELFARE_COUNTRY_PARITY_RATIO = 1;

// --- затухание памяти воздействий (доля, теряемая за месяц) ---

/** Репрессии выдыхаются быстро — период полураспада ~2.4 месяца. */
export const SUPPRESSION_DECAY_RATE = 0.25;

/** Отчуждение почти не уходит — период полураспада ~11.5 лет. */
export const ALIENATION_DECAY_RATE = 0.005;

/** Уступки помнят долго, но не вечно — период полураспада ~17 месяцев. */
export const CONCESSION_DECAY_RATE = 0.04;

/** Смелость угасает за полгода-год — период полураспада ~6.6 месяца. */
export const EMBOLDENMENT_DECAY_RATE = 0.1;

/** Ниже этого значения след считается затухшим; пустая запись памяти удаляется. */
export const IMPACT_MEMORY_EPSILON = 0.001;

// --- порог кризиса региона ---

/** Недовольство региона, с которого движок выдаёт факт «кризис в регионе X». */
export const REGION_CRISIS_DISCONTENT_THRESHOLD = 0.5;

/**
 * Гистерезис снятия кризиса: латч отпускается только ниже
 * (порог − гистерезис), иначе регион на грани мигал бы кризисом каждый месяц.
 */
export const REGION_CRISIS_RELEASE_HYSTERESIS = 0.05;

// --- предпосылки примитивов (docs/PRIMITIVES.md §2) ---

/** `incite_unrest`: минимальная нормированная дистанция «власть ↔ группа». */
export const INCITE_UNREST_MIN_DISTANCE = 0.35;

/** `spawn_incident`: минимальное недовольство региона (нужен контекст, а не пустое место). */
export const SPAWN_INCIDENT_MIN_DISCONTENT = 0.4;

/** `enact_reform`: политическая цена по карману только при такой поддержке правительства (0..100). */
export const ENACT_REFORM_MIN_GOVERNMENT_SUPPORT = 25;

// --- магнитуды эффектов (движок, не LLM) ---

export const REPRESS_SUPPRESSION_BASE = 0.6;
export const REPRESS_ALIENATION_BASE = 0.15;

export const GRANT_AUTONOMY_CONCESSION_BASE = 0.45;
/** Уступка в регионе X делает ту же группу смелее в соседних регионах. */
export const GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_BASE = 0.2;

export const INCITE_UNREST_EMBOLDENMENT_BASE = 0.25;

export const SPAWN_INCIDENT_EMBOLDENMENT_BASE = 0.1;

/** Шаг сдвига координат власти за одну реформу (по каждой затронутой оси). */
export const ENACT_REFORM_COORDINATE_STEP = 0.1;

/** Списание governmentSupport (0..100) за реформу — та самая «политическая цена». */
export const ENACT_REFORM_POLITICAL_COST = 8;

/**
 * Качественный хинт интенсивности от LLM → множитель магнитуды. LLM задаёт
 * только направление/характер («мягко»/«жёстко»), числа считает движок
 * (docs/PRIMITIVES.md §1). Хинт отсутствует — «moderate».
 */
export const PRIMITIVE_INTENSITY_MULTIPLIER: Record<string, number> = {
  mild: 0.5,
  moderate: 1,
  severe: 1.5,
};

export const PRIMITIVE_DEFAULT_INTENSITY = "moderate";

// --- капы батча примитивов (docs/PRIMITIVES.md §4) ---

/** Максимум мягких примитивов в одном ответе. */
export const MAX_SOFT_PRIMITIVES_PER_BATCH = 10;

/** Максимум структурных примитивов в одном ответе. */
export const MAX_STRUCTURAL_PRIMITIVES_PER_BATCH = 1;
