import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  EventItem,
  IconBalance,
  IconBlocs,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconDebt,
  IconDefence,
  IconDiplomacy,
  IconEconomy,
  IconFlagMode,
  IconGoals,
  IconInfrastructure,
  IconLedger,
  IconLegitimacy,
  IconLock,
  IconMenu,
  IconOutput,
  IconPeople,
  IconPolitics,
  IconResources,
  IconSave,
  IconScience,
  IconSearch,
  IconStability,
  IconUnrest,
  OrderCard,
  Panel,
  ShapedBar,
  Stat,
  Tooltip,
  cx,
} from "../ui";
import { legendForMode, type LegendLabel } from "./mapModeColors";
import { CountryDetail, LedgerBody, RegionDetail, TomeBody } from "./panels";
import {
  REGION_TAB_IDS,
  TOME_IDS,
  ScreenActionsProvider,
  ScreenModelProvider,
  type LedgerTabId,
  type MapMode,
  type ScreenActions,
  type ScreenLlmResult,
  type RegionTab,
  type ScreenModel,
  type ScreenStat,
  type TomeId,
} from "./model";
import styles from "./Screen.module.css";

/**
 * ЭКРАН — вся рама игры: ШАПКА, ХОД, ЯЩИК, ПОЛОСА, ЛИСТ, ЛЕНТА, РЕЖИМЫ,
 * РЕЕСТР. Про источник данных не знает ничего: получает модель и слот карты.
 *
 * Источников два — настоящее состояние партии и шаблонные данные песочницы.
 * Раньше это были два разных экрана, и любая правка формы жила в двух местах;
 * теперь разойтись они не могут физически.
 *
 * Правило одной тяжёлой поверхности выполняется СОСТОЯНИЕМ: `yashik` — одно
 * значение, поэтому два тома открытыми быть не могут.
 */

/** Приказ в том виде, в каком экран отдаёт его наружу. */
export interface ScreenOrder {
  text: string;
  primitives?: unknown[];
  idempotencyKey: string;
}

export interface ScreenProps {
  model: ScreenModel;
  /** Что экран умеет попросить сделать. Пусто — органы управления скрыты. */
  actions?: ScreenActions;
  /** Карта: настоящая MapLibre в игре, гекс-сетка в песочнице. */
  mapSlot: ReactNode;
  /**
   * Ход. Приказы уходят ПАЧКОЙ (docs/PRIMITIVES.md §1) — экран отдаёт их
   * список и ждёт; пока ждёт, показывает, что режиссёр думает.
   */
  onAdvance: (orders: ScreenOrder[]) => Promise<void> | void;
  /**
   * Выбор режима карты живёт снаружи: раскраску считает не интерфейс. Тип —
   * `MapMode`, а не `string`: приведение на границе прятало ровно тот дефект,
   * из-за которого кнопки режимов оставались без иконок (см. `model.ts`).
   */
  mapMode: MapMode;
  onMapMode: (mode: MapMode) => void;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string | null) => void;
}

type Yashik =
  | { kind: "none" }
  | { kind: "tome"; id: TomeId }
  | { kind: "country"; id: string };

/**
 * Приказ в ЛИСТЕ. Две дороги к одному движку (docs/PRIMITIVES.md §1): то, что
 * движок распознал, уходит примитивами и даёт гарантию; остальное уходит
 * текстом режиссёру и гарантии не даёт. Игрок видит, КАКОЙ дорогой пойдёт его
 * приказ, до хода — но не видит, ЧТО изменится: величин до применения не
 * существует.
 */
interface Order {
  id: string;
  text: string;
  /** Как поняли. Пусто — не распознано, приказ уйдёт режиссёру текстом. */
  recognized?: string[];
  primitives?: unknown[];
  /**
   * Ключ идемпотентности рождается вместе с приказом и переживает повторную
   * ОТПРАВКУ: после сетевого сбоя тот же приказ уходит с тем же ключом, и
   * сервер узнаёт дубль вместо того, чтобы применить приказ дважды.
   */
  idempotencyKey: string;
}

function newOrderKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `order-${Math.random().toString(36).slice(2)}`;
}

/*
 * ПРИБОРЫ сгруппированы по смыслу: деньги · сила · прочность. Подписей у
 * ПОКАЗАТЕЛЕЙ нет, поэтому позиция в группе работает вторым носителем
 * смысла помимо рисунка иконки — иначе «71» и «83» под похожими значками
 * неотличимы.
 */
/**
 * Оформление ПРИБОРА: иконка, куда ведёт нажатие и в какой группе он стоит.
 * Значения приходят моделью, а вот группировка по смыслу (деньги · сила ·
 * прочность) и рисунок — знание интерфейса: позиция в группе работает вторым
 * носителем смысла помимо иконки, иначе «71» и «83» под похожими значками
 * неотличимы. Ключ не найден — прибор всё равно покажется, просто без иконки.
 */
const PRIBOR_META: Record<string, { icon: React.ReactNode; tome?: TomeId; group: number }> = {
  gdp: { icon: <IconOutput />, tome: "economy", group: 0 },
  balance: { icon: <IconBalance />, tome: "economy", group: 0 },
  treasury: { icon: <IconBalance />, tome: "economy", group: 0 },
  debt: { icon: <IconDebt />, tome: "economy", group: 0 },
  pop: { icon: <IconPeople />, group: 1 },
  rank: { icon: <IconPeople />, group: 1 },
  stab: { icon: <IconStability />, tome: "politics", group: 2 },
  legit: { icon: <IconLegitimacy />, tome: "politics", group: 2 },
};

const TOME_ICONS: Record<TomeId, React.ReactNode> = {
  economy: <IconEconomy />,
  politics: <IconPolitics />,
  defence: <IconDefence />,
  science: <IconScience />,
  diplomacy: <IconDiplomacy />,
  goals: <IconGoals />,
};

/**
 * Рисунок кнопки РЕЖИМА. `Record<MapMode, …>` исчерпывающий нарочно: пропущенный
 * режим — ошибка компиляции, а не кнопка без иконки на карте у игрока.
 */
const MODE_ICONS: Record<MapMode, React.ReactNode> = {
  powers: <IconFlagMode />,
  industry: <IconEconomy />,
  resources: <IconResources />,
  population: <IconPeople />,
  unrest: <IconUnrest />,
  relations: <IconBlocs />,
  infrastructure: <IconInfrastructure />,
};

function FlagSU() {
  const { t } = useTranslation("screen");
  return (
    <svg viewBox="0 0 90 60" width="90" height="60" role="img" aria-label={t("playerFlag")}>
      <rect width="90" height="60" fill="#c1272d" />
      <g fill="#f0c14b">
        <path d="M18 13l1.7 4.9h5.1l-4.1 3 1.6 4.9-4.3-3-4.3 3 1.6-4.9-4.1-3h5.1z" />
        <path d="M16.5 29.5c3.9 0 6.9 2.8 6.9 6.4 0 2.6-1.4 4.5-3.4 5.6l-1.2-2c1.4-.8 2.3-2 2.3-3.6 0-2.4-2-4.2-4.6-4.2v-2.2z" />
        <path d="M22 31.7l2.2 2.2-10.1 10.1-2.2-2.2z" />
        <path d="M13.2 40h6.7v2.4h-6.7z" transform="rotate(-45 16.5 41.2)" />
      </g>
    </svg>
  );
}

export function Screen({
  model,
  actions = {},
  mapSlot,
  onAdvance,
  mapMode,
  onMapMode,
  selectedRegionId,
  onSelectRegion,
}: ScreenProps) {
  const { t } = useTranslation("screen");
  /** Имя активного режима служит и заголовком, и названием ЛЕГЕНДЫ — нужен id. */
  const modeTitleId = useId();
  const { monthIndex, year, events } = model;
  const [orders, setOrders] = useState<Order[]>([]);
  const [draft, setDraft] = useState("");
  /** Приказы, по которым идёт распознавание. */
  const [recognizing, setRecognizing] = useState<string[]>([]);
  const [yashik, setYashik] = useState<Yashik>({ kind: "none" });
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null);
  /*
   * ЗАМОК. Карта живёт снаружи и о замке не знает — она просто сообщает о
   * клике. Поэтому замок держит СВОЙ снимок региона: пока он закрыт, ПОЛОСА
   * показывает закреплённое, что бы ни выбирали на карте. Иначе пришлось бы
   * учить каждый источник выделения про состояние одной панели.
   */
  /** Осколок, по которому идёт запрос: второй клик должен быть невозможен. */
  const [succeeding, setSucceeding] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [pinnedRegionId, setPinnedRegionId] = useState<string | null>(null);
  const [ledgerTab, setLedgerTab] = useState<LedgerTabId>("powers");
  /*
   * РЕЕСТР — отдельное ОКНО, а не поверхность ЯЩИКА. Он не привязан ни к
   * ЛЕНТЕ, ни к левому краю: его открывают, чтобы сверить мир с тем, что
   * открыто рядом, поэтому он и живёт поверх, и уживается с ТОМОМ.
   * Это сознательное исключение из правила «одна тяжёлая поверхность за раз».
   */
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerPos, setLedgerPos] = useState<{ x: number; y: number } | null>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const ledgerDrag = useRef<{ dx: number; dy: number } | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [lentaOpen, setLentaOpen] = useState(true);
  /** Мир и свои приказы — разные вопросы, поэтому вкладки, а не один список. */
  const [lentaTab, setLentaTab] = useState<"all" | "world" | "mine">("all");
  const [listOpen, setListOpen] = useState(true);
  const [polosaTab, setPolosaTab] = useState<RegionTab>("obzor");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [feedWidth, setFeedWidth] = useState<number | null>(null);
  /** C3: наука отдельным ТОМОМ или внутри ОБОРОНЫ — смотрим оба варианта. */
  const [scienceSeparate, setScienceSeparate] = useState(true);
  /*
   * Плавность S-сопряжения ШАПКИ. Вынесена в состояние и в МЕНЮ, чтобы её
   * крутил пользователь и называл число, — подбирать такое на глаз перепиской
   * дороже, чем дать ползунок.
   */
  const [slant, setSlant] = useState(() => {
    const raw = Number(new URLSearchParams(window.location.search).get("slant"));
    return Number.isFinite(raw) && raw > 0 ? raw : 70;
  });

  const shellRef = useRef<HTMLDivElement>(null);
  const shapkaRef = useRef<HTMLDivElement>(null);
  const hodRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lentaRef = useRef<HTMLDivElement>(null);
  const polosaRef = useRef<HTMLDivElement>(null);
  const yashikRef = useRef<HTMLDivElement>(null);
  const dragTarget = useRef<"lenta" | "yashik" | null>(null);
  const dragOrder = useRef<number | null>(null);
  const seq = useRef(0);
  const nextId = (prefix: string) => {
    seq.current += 1;
    return `${prefix}${seq.current}`;
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const palette = params.get("palette");
    const scale = params.get("scale");
    if (palette !== null) document.documentElement.dataset.palette = palette;
    if (scale !== null) document.documentElement.style.setProperty("--ui-scale", scale);
  }, []);

  /*
   * Высота рамы. ШАПКА и ХОД выровнены по ОБЩЕЙ высоте, и это делается
   * замером обеих с выбором максимума, а не min-height от одной к другой:
   * `min-height` умеет только растить, поэтому более высокая панель всё
   * равно оставалась бы выше — те самые «94 против 97», которые читаются
   * как небрежность.
   *
   * Цикла нет: после применения обе сообщают максимум, и максимум остаётся
   * тем же.
   *
   * Забить числом нельзя вовсе — высота зависит от масштаба, локали и
   * содержимого.
   */
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const apply = () => {
      const shapka = shapkaRef.current?.offsetHeight ?? 0;
      const hod = hodRef.current?.offsetHeight ?? 0;
      const frame = Math.max(shapka, hod);
      if (frame > 0) shell.style.setProperty("--frame-h", `${frame}px`);
      if (bottomRef.current !== null) {
        shell.style.setProperty("--bottom-h", `${bottomRef.current.offsetHeight}px`);
      }
      // ЯЩИК останавливается над ПОЛОСОЙ: обе панели живут у левого края.
      shell.style.setProperty("--polosa-h", `${polosaRef.current?.offsetHeight ?? 0}px`);
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (shapkaRef.current !== null) observer.observe(shapkaRef.current);
    if (hodRef.current !== null) observer.observe(hodRef.current);
    if (bottomRef.current !== null) observer.observe(bottomRef.current);
    if (polosaRef.current !== null) observer.observe(polosaRef.current);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  });

  const monthLabel = `${model.monthsNominative[monthIndex]} ${year}`;

  /*
   * Пустые группы выпадают: разделитель между приборами имеет смысл только
   * когда по обе стороны от него что-то есть.
   */
  const priborGroups = useMemo(() => {
    const groups: ScreenStat[][] = [[], [], []];
    for (const stat of model.stats) {
      const group = (stat.key === undefined ? undefined : PRIBOR_META[stat.key]?.group) ?? 2;
      groups[group].push(stat);
    }
    return groups.filter((group) => group.length > 0);
  }, [model.stats]);

  /*
   * Состав КОРЕШКОВ — из одного списка (`TOME_IDS`), а не из двух рукописных:
   * второй список тех же томов расходился бы с первым при добавлении тома.
   * Вариант «наука внутри обороны» убирает ровно один корешок.
   */
  const tomes: TomeId[] = scienceSeparate
    ? [...TOME_IDS]
    : TOME_IDS.filter((id) => id !== "science");

  /*
   * Имена ТОМОВ и вкладок региона — исчерпывающим `Record` с ЛИТЕРАЛЬНЫМИ
   * ключами, а не `t(\`tomes.${id}\`)`: собранный в рантайме ключ не видит ни
   * компилятор (пропущенный том), ни `localeKeys.test.ts` (он читает только
   * литеральные вызовы `t`). Тот же приём, что у подписей легенды ниже.
   */
  const tomeNames = useMemo<Record<TomeId, string>>(
    () => ({
      economy: t("tomes.economy"),
      politics: t("tomes.politics"),
      defence: t("tomes.defence"),
      science: t("tomes.science"),
      diplomacy: t("tomes.diplomacy"),
      goals: t("tomes.goals"),
    }),
    [t],
  );

  const regionTabNames = useMemo<Record<RegionTab, string>>(
    () => ({
      obzor: t("regionTabs.obzor"),
      lyudi: t("regionTabs.lyudi"),
      hozyaystvo: t("regionTabs.hozyaystvo"),
      istoriya: t("regionTabs.istoriya"),
    }),
    [t],
  );

  /* ── Esc снимает верхний слой по одному ─────────────────────── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirming !== null) return setConfirming(null);
      if (llmOpen) return setLlmOpen(false);
      if (menuOpen) return setMenuOpen(false);
      if (searchOpen) return setSearchOpen(false);
      if (ledgerOpen) return setLedgerOpen(false);
      if (yashik.kind !== "none") return setYashik({ kind: "none" });
      if (selectedRegionId !== null || selectedCountryId !== null) {
        onSelectRegion(null);
        setSelectedCountryId(null);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, llmOpen, menuOpen, searchOpen, ledgerOpen, yashik, selectedRegionId, selectedCountryId, onSelectRegion]);

  /* ── Ручки ширины ───────────────────────────────────────────── */
  const rootSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

  /*
   * Цель перетаскивания читается из data-атрибута кнопки, а не замыкается
   * в фабрике обработчиков: обработчик, созданный на рендере, трогал бы ref
   * во время рендера — это то, что запрещает react-hooks/refs.
   */
  const onDragStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragTarget.current = "lenta";
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onDragMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragTarget.current === null || lentaRef.current === null) return;
    const unit = rootSize();
    const right = lentaRef.current.getBoundingClientRect().right;
    // Потолок — половина окна: дальше ЛЕНТА душит карту.
    setFeedWidth(Math.max(17 * unit, Math.min(right - event.clientX, window.innerWidth * 0.45)));
  }, []);

  const onDragEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragTarget.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const onLedgerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const node = ledgerRef.current;
    if (node === null) return;
    /*
     * Нажатие по кнопке в шапке не начинает перетаскивание: захват указателя
     * уводил последующий клик на шапку, и крестик переставал закрывать окно.
     */
    if ((event.target as HTMLElement).closest("button") !== null) return;
    const box = node.getBoundingClientRect();
    ledgerDrag.current = { dx: event.clientX - box.left, dy: event.clientY - box.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onLedgerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = ledgerDrag.current;
    const node = ledgerRef.current;
    if (drag === null || node === null) return;
    const box = node.getBoundingClientRect();
    // Окно не выпускается за экран целиком: заголовок обязан остаться видимым.
    const x = Math.max(8 - box.width + 80, Math.min(event.clientX - drag.dx, window.innerWidth - 80));
    const y = Math.max(0, Math.min(event.clientY - drag.dy, window.innerHeight - 48));
    setLedgerPos({ x, y });
  }, []);

  const onLedgerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    ledgerDrag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  /* ── Выделение ──────────────────────────────────────────────── */
  const selectCountry = (countryId: string) => {
    setSelectedCountryId(countryId);
    setCompareId(null);
    setYashik({ kind: "country", id: countryId });
  };

  const openTag = (id: string) => {
    if (id in model.countries) selectCountry(id);
    else if (id in model.regions) {
      // Регион живёт в ПОЛОСЕ, а не в ЯЩИКЕ: отдельного «подробно» больше нет.
      setPinned(false);
      onSelectRegion(id);
      setSelectedCountryId(null);
    }
  };

  /*
   * Сворачивание по всему заголовку, а не только по кнопке у края: до кнопки
   * в углу панели надо тянуться курсором через полпанели. Кнопка осталась —
   * она несёт подсказку и работает с клавиатуры. Клик внутри кнопки сюда не
   * доходит, иначе крестик сначала срабатывал бы, а потом панель схлопывалась.
   */
  const foldOnHeader = (fold: () => void) => ({
    className: styles.foldHeader,
    title: t("fold"),
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("button") !== null) return;
      fold();
    },
  });

  /* ── Приказы ────────────────────────────────────────────────── */
  /*
   * Добавление приказа спрашивает движок, как он его понял. Ответ показывается
   * рядом с приказом — это единственное место петли, где возможна ошибка
   * ПОНИМАНИЯ, и увидеть её игрок обязан ДО хода, а не после.
   */
  const addOrder = () => {
    const text = draft.trim();
    if (text === "") return;
    const order: Order = { id: nextId("o"), text, idempotencyKey: newOrderKey() };
    setOrders((prev) => [...prev, order]);
    setDraft("");

    if (actions.recognizeOrder === undefined) return;
    setRecognizing((prev) => [...prev, order.id]);
    void actions
      .recognizeOrder(text, pinned ? pinnedRegionId : selectedRegionId)
      .then((result) => {
        setOrders((prev) =>
          prev.map((item) =>
            item.id === order.id
              ? { ...item, recognized: result.recognized, primitives: result.primitives }
              : item,
          ),
        );
      })
      .catch(() => {
        // Молча: нераспознанный приказ — не ошибка, он просто уйдёт режиссёру.
      })
      .finally(() => setRecognizing((prev) => prev.filter((id) => id !== order.id)));
  };

  const moveOrder = (from: number, to: number) => {
    setOrders((prev) => {
      const next = prev.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const irreversible = useMemo(
    () => orders.find((order) => model.isIrreversible(order.text)),
    [orders, model],
  );

  /*
   * Ход. Приказы уходят пачкой и разом — до этого момента игрок не видит их
   * последствий, и это не недоработка интерфейса, а правило игры
   * (docs/PRIMITIVES.md §1). Экран только собирает список и ждёт; что с ним
   * сделают — не его дело.
   */
  const advance = () => {
    setThinking(true);
    setConfirming(null);
    void Promise.resolve(onAdvance(orders))
      .finally(() => {
        setOrders([]);
        setThinking(false);
      });
  };

  const onTurn = () => {
    if (irreversible !== undefined) {
      setConfirming(irreversible.text);
      return;
    }
    advance();
  };

  /* ── Поиск ──────────────────────────────────────────────────── */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    const countries = Object.values(model.countries)
      .filter((country) => country.short.toLowerCase().includes(q))
      .map((country) => ({ id: country.id, label: country.short, kind: t("search.kindCountry") }));
    const regions = Object.values(model.regions)
      .filter((region) => region.name.toLowerCase().includes(q))
      .map((region) => ({ id: region.id, label: region.name, kind: t("search.kindRegion") }));
    return [...countries, ...regions].slice(0, 12);
  }, [query, model.countries, model.regions, t]);

  const shownRegionId = pinned ? pinnedRegionId : selectedRegionId;
  const selectedRegion = shownRegionId === null ? null : (model.regions[shownRegionId] ?? null);

  /*
   * ЛЕГЕНДА приходит оттуда же, откуда цвет (`mapModeColors.ts`), — иначе
   * расшифровка и раскраска расходятся молча. Пустой список означает «цвет
   * здесь не величина» (режим держав): градаций не будет, но КОРОБКА легенды
   * рисуется всё равно — иначе панель прыгает при переключении режима.
   */
  const legend = legendForMode(mapMode);
  /*
   * Имя активного режима — ВИДИМЫЙ заголовок панели, а не только подсказка
   * кнопки: кнопки `iconOnly`, а «Промышленность» и «Инфраструктура» красятся
   * одной зелёной тройкой и дают одинаковые подписи в легенде. Без заголовка
   * игрок переключает режим и не получает ни одного подтверждения, что
   * что-то изменилось. Имя берётся из модели — там оно уже локализовано.
   */
  const activeModeName = model.mapModes.find((mode) => mode.id === mapMode)?.name ?? "";
  /*
   * Подписи градаций — исчерпывающим `Record`, а не шаблонным ключом: так
   * пропущенную подпись видит компилятор, а отсутствие строки в словаре —
   * `localeKeys.test.ts` (он читает только литеральные вызовы `t`).
   */
  const legendLabels = useMemo<Record<LegendLabel, string>>(
    () => ({
      high: t("legend.high"),
      medium: t("legend.medium"),
      moderate: t("legend.moderate"),
      low: t("legend.low"),
      calm: t("legend.calm"),
      tense: t("legend.tense"),
      unrest: t("legend.unrest"),
      dense: t("legend.dense"),
      sparse: t("legend.sparse"),
      rich: t("legend.rich"),
      poor: t("legend.poor"),
      own: t("legend.own"),
      ally: t("legend.ally"),
      neutral: t("legend.neutral"),
      hostile: t("legend.hostile"),
    }),
    [t],
  );

  const shellStyle: React.CSSProperties = {
    ["--feed-col" as string]: feedWidth === null ? "var(--feed-width)" : `${feedWidth}px`,
    // Ряд КОРЕШКОВ сдвигается вправо ровно на размах сопряжения: иначе первые
    // кнопки попадают в клин, где полосы ещё нет.
    ["--band-slant" as string]: `${slant}px`,
  };

  return (
    <ScreenModelProvider value={model}>
    <ScreenActionsProvider value={actions}>
    <div ref={shellRef} className={styles.shell} style={shellStyle}>
      {mapSlot}

      {/*
        ── ШАПКА ──────────────────────────────────────────────
        Ссылка стоит на САМОЙ панели, а не на обёртке вокруг неё. Обёртка была
        и сплющивалась в ноль: панель приклеена к краю (`absolute`), то есть
        вышла из потока, и высота обёртки перестала бы что-либо значить — а по
        ней считается общая высота рамы.
      */}
      <ShapedBar
        ref={shapkaRef}
        className={styles.shapka}
        tabOffset={0}
        tabRound
        bandTint
        bandSlant={slant}
        left={
          <div className={styles.flagCell}>
            <Tooltip label={t("playerPanel", { country: model.countries[model.playerId].short })}>
              <button type="button" className={styles.flagButton} onClick={() => selectCountry(model.playerId)}>
                <span className={styles.flag}>
                  <FlagSU />
                </span>
              </button>
            </Tooltip>
          </div>
        }
        tab={
          <Tooltip label={t("rankHint")}>
            <button
              type="button"
              className={styles.rankBox}
              onClick={() => {
                setLedgerTab("powers");
                setLedgerOpen(true);
              }}
            >
              <span
                className={cx(
                  styles.rankDisc,
                  model.playerRank <= 3 && styles.rankGold,
                  model.playerRank > 3 && model.playerRank <= 10 && styles.rankSilver,
                )}
              >
                {model.playerRank}
              </span>
            </button>
          </Tooltip>
        }
        top={
          <div className={styles.pribory}>
            {priborGroups.map((group, groupIndex) => (
              <div key={groupIndex} className={styles.priboryGroup}>
                {groupIndex > 0 && <span className={styles.priborySplit} />}
                {group.map((stat) => {
                  const meta = stat.key === undefined ? undefined : PRIBOR_META[stat.key];
                  // Локальная константа, иначе сужение типа не доживает
                  // до тела замыкания и `tome` остаётся возможно-undefined.
                  const tome = meta?.tome;
                  return (
                    <Stat
                      key={stat.key ?? stat.label}
                      label={stat.label}
                      value={stat.value}
                      delta={stat.delta}
                      threshold={stat.threshold}
                      icon={meta?.icon}
                      labelMode="hidden"
                      onClick={tome === undefined ? undefined : () => setYashik({ kind: "tome", id: tome })}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        }
        bottom={
          <div className={styles.koreshki}>
            {tomes.map((id) => (
              <Tooltip key={id} label={tomeNames[id]}>
                <Button
                  size="md"
                  iconOnly
                  aria-label={tomeNames[id]}
                  variant={yashik.kind === "tome" && yashik.id === id ? "order" : "quiet"}
                  onClick={() =>
                    setYashik((prev) =>
                      prev.kind === "tome" && prev.id === id ? { kind: "none" } : { kind: "tome", id },
                    )
                  }
                >
                  {TOME_ICONS[id]}
                </Button>
              </Tooltip>
            ))}
            <span className={styles.koreshkiSplit} />
            <Tooltip label={t("ledger.hint")}>
              <Button
                size="md"
                iconOnly
                aria-label={t("ledger.title")}
                variant={ledgerOpen ? "order" : "quiet"}
                onClick={() => setLedgerOpen((open) => !open)}
              >
                <IconLedger />
              </Button>
            </Tooltip>
          </div>
        }
      />

      {/* ── ХОД ──────────────────────────────────────────────── */}
      <div ref={hodRef} className={styles.hod}>
        <div className={styles.hodTop}>
          <span className={styles.date}>{monthLabel}</span>
          <span
            className={cx(styles.rezhisser, thinking && styles.rezhisserBusy)}
            title={thinking ? t("director.busy") : t("director.ready")}
          />
          <div className={styles.instruments}>
            <Tooltip label={t("save.hint")}>
              <Button size="sm" variant="quiet" iconOnly aria-label={t("save.label")}>
                <IconSave />
              </Button>
            </Tooltip>
            <Tooltip label={t("search.hint")}>
              <Button size="sm" variant="quiet" iconOnly aria-label={t("search.label")} onClick={() => setSearchOpen(true)}>
                <IconSearch />
              </Button>
            </Tooltip>
            <Tooltip label={t("menu.label")}>
              <Button size="sm" variant="quiet" iconOnly aria-label={t("menu.label")} onClick={() => setMenuOpen(true)}>
                <IconMenu />
              </Button>
            </Tooltip>
          </div>
        </div>

        <Button variant="primary" size="lg" className={styles.knopka} disabled={thinking} onClick={onTurn}>
          {thinking ? t("turn.thinking") : t("turn.advance", { n: orders.length })}
        </Button>
      </div>

      {/* ── ЯЩИК ─────────────────────────────────────────────── */}
      {yashik.kind !== "none" && (
        <div
          ref={yashikRef}
          className={cx(styles.yashik, styles.yashikDock)}
        >
          {yashik.kind === "tome" && (
            <Panel
              title={tomeNames[yashik.id]}
              onClose={() => setYashik({ kind: "none" })}
              density="control"
              scroll
              className={styles.yashikPanel}
            >
              <TomeBody
                id={yashik.id}
                withScience={yashik.id === "defence" && !scienceSeparate}
                onSelectCountry={selectCountry}
              />
            </Panel>
          )}

          {yashik.kind === "country" && (
            <Panel
              title={model.countries[yashik.id].short}
              meta={model.countries[yashik.id].tier}
              onClose={() => setYashik({ kind: "none" })}
              density="control"
              scroll
              className={styles.yashikPanel}
            >
              <CountryDetail
                country={model.countries[yashik.id]}
                rival={compareId === null ? null : model.countries[compareId]}
                onCompare={setCompareId}
                onClearCompare={() => setCompareId(null)}
              />
            </Panel>
          )}

        </div>
      )}

      {/* ── РЕЕСТР: самостоятельное окно ─────────────────────── */}
      {ledgerOpen && (
        <div
          ref={ledgerRef}
          className={cx(styles.ledgerWindow, ledgerPos !== null && styles.ledgerMoved)}
          style={ledgerPos === null ? undefined : { left: ledgerPos.x, top: ledgerPos.y }}
        >
          <Panel
            title={t("ledger.title")}
            meta={t("ledger.meta")}
            onClose={() => setLedgerOpen(false)}
            density="control"
            className={styles.ledgerPanel}
            headerProps={{
              className: styles.ledgerHeader,
              onPointerDown: onLedgerDown,
              onPointerMove: onLedgerMove,
              onPointerUp: onLedgerUp,
            }}
          >
            <LedgerBody
              tab={ledgerTab}
              onTab={setLedgerTab}
              onSelectCountry={selectCountry}
              onSelectRegion={(regionId) => {
                setPinned(false);
                onSelectRegion(regionId);
              }}
              events={events}
            />
          </Panel>
        </div>
      )}

      {/* ── ЛЕНТА и РЕЖИМЫ ──────────────────────────────────── */}
      <div className={styles.rightStack}>
        {lentaOpen ? (
          <div ref={lentaRef} className={styles.lenta}>
            <button
              type="button"
              className={styles.resizerLeft}
              aria-label={t("lenta.resize")}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
            />
            <Panel
              title={t("lenta.title")}
              meta={monthLabel.toLowerCase()}
              density="flush"
              scroll
              className={styles.lentaPanel}
              headerProps={foldOnHeader(() => setLentaOpen(false))}
              actions={
                <Tooltip label={t("lenta.collapseHint")}>
                  <Button size="sm" variant="quiet" iconOnly aria-label={t("lenta.collapse")} onClick={() => setLentaOpen(false)}>
                    <IconChevronRight />
                  </Button>
                </Tooltip>
              }
            >
              <div className={styles.lentaTabs}>
                {([
                  ["all", t("lenta.tabAll", { n: events.length })],
                  ["world", t("lenta.tabWorld")],
                  ["mine", t("lenta.tabMine")],
                ] as const).map(([id, name]) => (
                  <Button key={id} size="sm" variant={lentaTab === id ? "order" : "quiet"} onClick={() => setLentaTab(id)}>
                    {name}
                  </Button>
                ))}
              </div>
              <div className={styles.lentaBody}>
                {events
                  .filter((event) =>
                    lentaTab === "all" ? true : lentaTab === "mine" ? event.order !== undefined : event.order === undefined,
                  )
                  .map((event) => (
                    <EventItem
                      key={event.id}
                      date={event.date}
                      title={event.title}
                      body={event.body}
                      factuality={event.factuality}
                      dated={event.dated}
                      order={event.order === undefined ? undefined : { text: event.order }}
                      tags={event.tags}
                      onTagClick={openTag}
                    />
                  ))}
              </div>
            </Panel>
          </div>
        ) : (
          <Tooltip label={t("lenta.expandHint", { n: events.length })}>
            <button type="button" className={styles.lentaTab} aria-label={t("lenta.expand")} onClick={() => setLentaOpen(true)}>
              <IconChevronLeft />
              <span className={styles.lentaTabCount}>{events.length}</span>
            </button>
          </Tooltip>
        )}

        <Panel density="instrument" className={styles.rezhimy}>
          <div className={styles.rezhimyStack}>
            <p className={styles.rezhimyTitle} id={modeTitleId}>
              {activeModeName}
            </p>
            {/*
              * Коробка ЛЕГЕНДЫ здесь ВСЕГДА, даже когда градаций нет. Раньше
              * она рендерилась по условию `legend.length > 0`, и `min-height`,
              * добавленный против дыхания панели, применять было не к чему: у
              * «Держав» — режима по умолчанию — легенды нет вовсе, элемента в
              * разметке тоже, и первое же переключение режима поднимало верхний
              * край панели на высоту легенды с зазором (замер: 35px). Пустая
              * коробка держит место, и высота панели одна во всех режимах.
              *
              * Имя режима — ЖЕ и название легенды (`aria-labelledby`), а не
              * второе слово «Легенда»: две подписи об одном заставляли бы
              * скринридер читать лишнее, а видимого имени у панели всё равно
              * не было. Пустая коробка не называется ничем и скрыта от
              * скринридера: списка из нуля пунктов игрок услышать не должен.
              */}
            <ul
              className={styles.legenda}
              aria-labelledby={legend.length > 0 ? modeTitleId : undefined}
              aria-hidden={legend.length === 0 || undefined}
            >
              {legend.map((item) => (
                <li key={item.labelKey} className={styles.legendaItem}>
                  <span className={styles.legendaSwatch} style={{ background: item.swatch }} />
                  {legendLabels[item.labelKey]}
                </li>
              ))}
            </ul>
            {/*
              * `role="group"` с именем и `aria-pressed` на кнопках: смысл,
              * который несёт вид нажатой кнопки, обязан дублироваться
              * доступным именем (`docs/UI_DESIGN.md` §9). Без этого скринридер
              * слышит семь равноправных кнопок и не знает, какая включена.
              */}
            <div className={styles.rezhimyGrid} role="group" aria-label={t("mapModesGroup")}>
              {model.mapModes.map((mode) => (
                <Tooltip key={mode.id} label={mode.name}>
                  <Button
                    size="sm"
                    iconOnly
                    aria-label={mode.name}
                    aria-pressed={mode.id === mapMode}
                    variant={mode.id === mapMode ? "order" : "quiet"}
                    onClick={() => onMapMode(mode.id)}
                  >
                    {MODE_ICONS[mode.id]}
                  </Button>
                </Tooltip>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {/*
        * ПОЛОСА — регион. Раньше это была тонкая строка внизу с четырьмя
        * фактами и кнопкой «Подробно»; шаг «выделил → нажал → открылось» ничего
        * не давал, кроме лишнего клика на самом частом действии в игре. Теперь
        * ЛКМ по карте сразу открывает регион подробно, панелью в левом нижнем
        * углу, а разделы разведены вкладками, чтобы панель не росла.
        */}
      {selectedRegion !== null && (
        <div ref={polosaRef} className={styles.polosa}>
          <Panel
            title={selectedRegion.name}
            meta={model.countries[selectedRegion.owner].short}
            density="control"
            className={styles.polosaPanel}
            bodyClassName={styles.polosaBody}
            onClose={() => {
              onSelectRegion(null);
              setPinned(false);
            }}
            actions={
              <Tooltip label={pinned ? t("polosa.unpin") : t("polosa.pinHint")}>
                <Button
                  size="sm"
                  variant={pinned ? "order" : "quiet"}
                  iconOnly
                  aria-label={pinned ? t("polosa.unpin") : t("polosa.pin")}
                  onClick={() => {
                    setPinnedRegionId(selectedRegion.id);
                    setPinned((prev) => !prev);
                  }}
                >
                  <IconLock />
                </Button>
              </Tooltip>
            }
          >
            <div className={styles.polosaTabs}>
              {REGION_TAB_IDS.map((id) => (
                <Button
                  key={id}
                  size="sm"
                  variant={polosaTab === id ? "order" : "quiet"}
                  onClick={() => setPolosaTab(id)}
                >
                  {regionTabNames[id]}
                </Button>
              ))}
            </div>
            <div className={styles.polosaScroll}>
              <RegionDetail region={selectedRegion} tab={polosaTab} onSelectCountry={selectCountry} />
            </div>
          </Panel>
        </div>
      )}

      {/* ── ЛИСТ: низ по центру ─────────────────────────────── */}
      <div className={styles.bottom}>
        <div ref={bottomRef} className={styles.bottomInner}>
        {listOpen ? (
          <Panel
            title={t("orders.title")}
            meta={
              orders.length === 0
                ? monthLabel.toLowerCase()
                : t("orders.meta", {
                    month: monthLabel.toLowerCase(),
                    n: orders.length,
                    max: model.ordersPerTurn,
                  })
            }
            density="control"
            headerProps={foldOnHeader(() => setListOpen(false))}
            actions={
              <Tooltip label={t("orders.collapseHint")}>
                <Button size="sm" variant="quiet" iconOnly aria-label={t("orders.collapse")} onClick={() => setListOpen(false)}>
                  <IconChevronDown />
                </Button>
              </Tooltip>
            }
          >
            {orders.length > 0 && (
              <ul className={styles.orderList}>
                {orders.map((order, index) => (
                  <li
                    key={order.id}
                    draggable
                    onDragStart={() => {
                      dragOrder.current = index;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragOrder.current !== null && dragOrder.current !== index) moveOrder(dragOrder.current, index);
                      dragOrder.current = null;
                    }}
                  >
                    <OrderCard
                      index={index + 1}
                      text={order.text}
                      recognized={order.recognized}
                      pending={recognizing.includes(order.id)}
                      onRemove={() => setOrders((prev) => prev.filter((item) => item.id !== order.id))}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.vvod}>
              <input
                className={styles.field}
                placeholder={t("orders.placeholder")}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addOrder();
                }}
              />
              <Button variant="order" size="sm" onClick={addOrder} disabled={draft.trim() === ""}>
                {t("orders.add")}
              </Button>
            </div>
          </Panel>
        ) : (
          <button type="button" className={styles.listTab} onClick={() => setListOpen(true)}>
            <IconChevronUp />
            {t("orders.title")}
            <span className={styles.listTabCount}>{orders.length}</span>
          </button>
        )}
        </div>
      </div>

      {/*
        * КАМПАНИЯ — распад державы или конец партии. Перекрывает всё и не
        * закрывается: пока осколок не выбран, играть нечем, а выбор осколка
        * необратим (docs/CONCEPT.md §7.1), поэтому ни крестика, ни таймаута
        * здесь нет — подтверждение с таймаутом подтверждением не является.
        */}
      {model.campaign !== null && (
        <div className={cx(styles.scrim, styles.scrimCampaign)}>
          <Panel title={model.campaign.title} density="prose" className={styles.modal}>
            <p className={styles.modalText}>{model.campaign.lead}</p>
            {model.campaign.successors.length > 0 && (
              <div className={styles.successors}>
                {model.campaign.successors.map((successor) => (
                  <Button
                    key={successor.id}
                    variant="order"
                    disabled={succeeding !== null}
                    onClick={() => {
                      if (actions.chooseSuccessor === undefined) return;
                      setSucceeding(successor.id);
                      void actions.chooseSuccessor(successor.id).finally(() => setSucceeding(null));
                    }}
                  >
                    {successor.label}
                  </Button>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ── ПОДТВЕРЖДЕНИЕ ───────────────────────────────────── */}
      {confirming !== null && (
        <div className={styles.scrim}>
          <Panel title={t("confirm.title")} density="prose" className={styles.modal}>
            <p className={styles.modalText}>
              {t("confirm.text", { month: monthLabel.toLowerCase(), order: confirming })}
            </p>
            <div className={styles.modalActions}>
              <Button variant="default" onClick={() => setConfirming(null)}>
                {t("confirm.back")}
              </Button>
              <Button variant="danger" onClick={advance}>
                {t("confirm.send")}
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {/* ── ПОИСК ───────────────────────────────────────────── */}
      {searchOpen && (
        <div className={styles.searchWrap} onClick={() => setSearchOpen(false)}>
          <div className={styles.searchPanel} onClick={(event) => event.stopPropagation()}>
            <Panel title={t("search.title")} onClose={() => setSearchOpen(false)} density="control">
              <input
                className={styles.field}
                autoFocus
                placeholder={t("search.placeholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                style={{ width: "100%" }}
              />
              <div className={styles.searchResults}>
                {searchResults.map((result) => (
                  <button
                    key={`${result.kind}-${result.id}`}
                    type="button"
                    className={styles.searchItem}
                    onClick={() => {
                      openTag(result.id);
                      setSearchOpen(false);
                    }}
                  >
                    <span>{result.label}</span>
                    <span className={styles.searchKind}>{result.kind}</span>
                  </button>
                ))}
                {query.trim() !== "" && searchResults.length === 0 && (
                  <p className={styles.empty}>{t("search.empty")}</p>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ── МЕНЮ: тумблеры макета ───────────────────────────── */}
      {menuOpen && (
        <div className={styles.searchWrap} onClick={() => setMenuOpen(false)}>
          <div className={styles.searchPanel} onClick={(event) => event.stopPropagation()}>
            <Panel
              title={t("menu.title")}
              meta={t("menu.meta")}
              onClose={() => setMenuOpen(false)}
              density="control"
            >
              {(actions.getLlmPrompt !== undefined ||
                actions.submitLlmResponse !== undefined ||
                actions.runLlmCycle !== undefined) && (
                <div style={{ marginBottom: "var(--space-4)" }}>
                  <p className={styles.empty}>{t("menu.diagnosticsNote")}</p>
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      setMenuOpen(false);
                      setLlmOpen(true);
                    }}
                  >
                    {t("menu.llmCycle")}
                  </Button>
                </div>
              )}

              <p className={styles.empty}>{t("menu.scienceNote")}</p>
              <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-4)" }}>
                <Button size="sm" variant={scienceSeparate ? "order" : "quiet"} onClick={() => setScienceSeparate(true)}>
                  {t("menu.scienceSeparate")}
                </Button>
                <Button size="sm" variant={!scienceSeparate ? "order" : "quiet"} onClick={() => setScienceSeparate(false)}>
                  {t("menu.scienceTogether")}
                </Button>
              </div>

              <p className={styles.empty}>{t("menu.slantNote", { value: slant })}</p>
              <input
                type="range"
                min={8}
                max={96}
                step={2}
                value={slant}
                aria-label={t("menu.slantLabel")}
                onChange={(event) => setSlant(Number(event.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)", marginBottom: "var(--space-4)" }}
              />

              <p className={styles.empty}>{t("menu.skinNote")}</p>
              <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
                {[
                  ["flat", t("menu.skins.flat")],
                  ["bare", t("menu.skins.bare")],
                  ["print", t("menu.skins.print")],
                  ["glow", t("menu.skins.glow")],
                  ["gauge", t("menu.skins.gauge")],
                ].map(([id, name]) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={(document.documentElement.dataset.skin ?? "flat") === id ? "order" : "quiet"}
                    onClick={() => {
                      if (id === "flat") delete document.documentElement.dataset.skin;
                      else document.documentElement.dataset.skin = id;
                      setMenuOpen(false);
                    }}
                  >
                    {name}
                  </Button>
                ))}
              </div>

              <p className={styles.empty}>{t("menu.paletteNote")}</p>
              <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
                {[
                  ["graphite", t("menu.palettes.graphite")],
                  ["steel", t("menu.palettes.steel")],
                  ["ink", t("menu.palettes.ink")],
                  ["khaki", t("menu.palettes.khaki")],
                ].map(([id, name]) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={document.documentElement.dataset.palette === id ? "order" : "quiet"}
                    onClick={() => {
                      document.documentElement.dataset.palette = id;
                      setMenuOpen(false);
                    }}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ── ИИ-РЕЖИССЁР: ручной цикл, диагностика ────────────── */}
      {llmOpen && (
        <div className={styles.searchWrap} onClick={() => setLlmOpen(false)}>
          <div className={cx(styles.searchPanel, styles.llmPanel)} onClick={(event) => event.stopPropagation()}>
            <LlmCycleWindow actions={actions} onClose={() => setLlmOpen(false)} />
          </div>
        </div>
      )}
    </div>
    </ScreenActionsProvider>
    </ScreenModelProvider>
  );
}

/**
 * Ручной цикл ИИ-режиссёра (диагностика). Обычный ход прогоняет тот же
 * серверный цикл сам (`onAdvance` → `runLlmCycle` внутри `GameShell`) — тут
 * то же самое доступно вручную: увидеть промт, подставить ответ, обойти
 * автоматический ключ. Действие не задано — соответствующая секция не
 * рисуется (правило органов управления, `model.ts`).
 */
function LlmCycleWindow({ actions, onClose }: { actions: ScreenActions; onClose: () => void }) {
  const { t } = useTranslation("screen");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [result, setResult] = useState<ScreenLlmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGetPrompt = () => {
    if (actions.getLlmPrompt === undefined) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    void actions
      .getLlmPrompt()
      .then(({ prompt: text }) => {
        setPrompt(text);
        return navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          // Буфер обмена недоступен (нет прав / не-secure context) — промт
          // всё равно показан ниже, можно скопировать вручную.
          () => setCopied(false),
        );
      })
      .catch((err: unknown) => {
        console.error(err);
        setError(t("llm.errorPrompt"));
      })
      .finally(() => setBusy(false));
  };

  const handleApply = () => {
    if (actions.submitLlmResponse === undefined) return;
    setBusy(true);
    setError(null);
    setResult(null);
    void actions
      .submitLlmResponse(responseText)
      .then((res) => {
        setResult(res);
        if (res.success) setResponseText("");
      })
      .catch((err: unknown) => {
        console.error(err);
        setError(t("llm.errorApply"));
      })
      .finally(() => setBusy(false));
  };

  const handleAuto = () => {
    if (actions.runLlmCycle === undefined) return;
    setBusy(true);
    setError(null);
    setResult(null);
    void actions
      .runLlmCycle()
      .then(setResult)
      .catch((err: unknown) => {
        console.error(err);
        setError(t("llm.errorAuto"));
      })
      .finally(() => setBusy(false));
  };

  return (
    <Panel title={t("llm.title")} meta={t("llm.meta")} onClose={onClose} density="control">
      {actions.runLlmCycle !== undefined && (
        <section className={styles.llmSection}>
          <h3 className={styles.llmSectionTitle}>{t("llm.autoTitle")}</h3>
          <Button variant="order" size="sm" onClick={handleAuto} disabled={busy}>
            {t("llm.autoRun")}
          </Button>
        </section>
      )}

      {actions.getLlmPrompt !== undefined && (
        <section className={styles.llmSection}>
          <h3 className={styles.llmSectionTitle}>{t("llm.promptTitle")}</h3>
          <Button variant="quiet" size="sm" onClick={handleGetPrompt} disabled={busy}>
            {copied ? t("llm.promptCopied") : t("llm.promptGet")}
          </Button>
          {prompt !== null && (
            <textarea
              className={styles.llmField}
              aria-label={t("llm.promptLabel")}
              readOnly
              value={prompt}
              rows={6}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </section>
      )}

      {actions.submitLlmResponse !== undefined && (
        <section className={styles.llmSection}>
          <h3 className={styles.llmSectionTitle}>{t("llm.responseTitle")}</h3>
          <textarea
            className={styles.llmField}
            aria-label={t("llm.responseLabel")}
            placeholder={t("llm.responsePlaceholder")}
            value={responseText}
            onChange={(event) => setResponseText(event.target.value)}
            rows={6}
          />
          <Button variant="order" size="sm" onClick={handleApply} disabled={busy || responseText.trim() === ""}>
            {t("llm.responseApply")}
          </Button>
        </section>
      )}

      {error !== null && <p className={styles.llmError}>{error}</p>}

      {result !== null && result.success && <LlmCycleOutcome result={result} />}
    </Panel>
  );
}

function LlmCycleOutcome({ result }: { result: ScreenLlmResult }) {
  const { t } = useTranslation("screen");
  return (
    <section className={cx(styles.llmSection, styles.llmResult)}>
      {result.narrativeCanonized ? (
        <>
          <h3 className={styles.llmSectionTitle}>{result.title ?? t("llm.resultFallback")}</h3>
          {result.factuality !== undefined && (
            <p className={styles.llmFactuality} role="note">
              {result.factuality === "partial" ? t("llm.partial") : t("llm.unconfirmed")}
            </p>
          )}
          {result.descriptions !== undefined && <p className={styles.modalText}>{result.descriptions}</p>}
        </>
      ) : (
        <>
          <h3 className={styles.llmSectionTitle}>{t("llm.impossibleTitle")}</h3>
          <p role="status" className={styles.modalText}>
            {t("llm.impossibleText")}
          </p>
        </>
      )}

      <p className={styles.empty}>
        {t("llm.countApplied", { n: result.applied.length })}
        {result.rejected.length > 0 && t("llm.countRejected", { n: result.rejected.length })}
      </p>

      {result.applied.length > 0 && (
        <section aria-label={t("llm.appliedTitle")}>
          <h4 className={styles.llmSectionTitle}>{t("llm.appliedTitle")}</h4>
          <ul className={styles.llmList}>
            {result.applied.map((record, index) => (
              <li key={index}>
                {record.headline}
                {record.details.length > 0 && (
                  <ul>
                    {record.details.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.rejected.length > 0 && (
        <section aria-label={t("llm.rejectedTitle")}>
          <h4 className={styles.llmSectionTitle}>{t("llm.rejectedTitle")}</h4>
          <ul className={styles.llmList}>
            {result.rejected.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
