import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  Button,
  EventItem,
  IconArmies,
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
  IconTerrain,
  IconUnrest,
  OrderCard,
  Panel,
  ShapedBar,
  Stat,
  Tooltip,
  cx,
  type DeltaTone,
  type ThresholdState,
} from "../ui";
import { CountryDetail, LedgerBody, RegionDetail, TomeBody } from "./panels";
import {
  REGION_TABS,
  ScreenModelProvider,
  type LedgerTabId,
  type RegionTab,
  type ScreenModel,
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

export interface ScreenProps {
  model: ScreenModel;
  /** Карта: настоящая MapLibre в игре, гекс-сетка в песочнице. */
  mapSlot: ReactNode;
  /**
   * Ход. Приказы уходят ПАЧКОЙ (docs/PRIMITIVES.md §1) — экран отдаёт их
   * список и ждёт; пока ждёт, показывает, что режиссёр думает.
   */
  onAdvance: (orders: string[]) => Promise<void> | void;
  /** Выбор режима карты живёт снаружи: раскраску считает не интерфейс. */
  mapMode: string;
  onMapMode: (mode: string) => void;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string | null) => void;
}

type Yashik =
  | { kind: "none" }
  | { kind: "tome"; id: TomeId }
  | { kind: "country"; id: string };

interface Order {
  id: string;
  text: string;
}

/*
 * ПРИБОРЫ сгруппированы по смыслу: деньги · сила · прочность. Подписей у
 * ПОКАЗАТЕЛЕЙ нет, поэтому позиция в группе работает вторым носителем
 * смысла помимо рисунка иконки — иначе «71» и «83» под похожими значками
 * неотличимы.
 */
interface Pribor {
  key: string;
  /** Подпись не видна, но её читает скринридер и показывает подсказка. */
  label: string;
  value: string;
  delta: { text: string; tone: DeltaTone };
  threshold?: ThresholdState;
  icon: React.ReactNode;
  /** Куда ведёт нажатие. У производных показателей тома может не быть. */
  tome?: TomeId;
}

const PRIBORY_GROUPS: Pribor[][] = [
  [
    { key: "gdp", label: "ВВП", value: "1,46T", delta: { text: "+3,2%", tone: "good" as const }, icon: <IconOutput />, tome: "economy" as TomeId },
    { key: "balance", label: "Баланс", value: "+12,4B", delta: { text: "+1,8B", tone: "good" as const }, icon: <IconBalance />, tome: "economy" as TomeId },
    { key: "debt", label: "Долг к ВВП", value: "0,94", delta: { text: "+0,03", tone: "bad" as const }, threshold: "near" as const, icon: <IconDebt />, tome: "economy" as TomeId },
  ],
  [
    { key: "pop", label: "Население", value: "170,5M", delta: { text: "+0,6M", tone: "good" as const }, icon: <IconPeople />, tome: undefined },
  ],
  [
    { key: "stab", label: "Стабильность", value: "71", delta: { text: "−1", tone: "bad" as const }, icon: <IconStability />, tome: "politics" as TomeId },
    { key: "legit", label: "Легитимность", value: "83", delta: { text: "+2", tone: "good" as const }, icon: <IconLegitimacy />, tome: "politics" as TomeId },
  ],
];

const TOME_ICONS: Record<TomeId, React.ReactNode> = {
  economy: <IconEconomy />,
  politics: <IconPolitics />,
  defence: <IconDefence />,
  science: <IconScience />,
  diplomacy: <IconDiplomacy />,
  goals: <IconGoals />,
};

const TOME_NAMES: Record<TomeId, string> = {
  economy: "Экономика",
  politics: "Политика",
  defence: "Оборона",
  science: "Наука",
  diplomacy: "Дипломатия",
  goals: "Цели",
};

const MODE_ICONS: Record<string, React.ReactNode> = {
  powers: <IconFlagMode />,
  blocs: <IconBlocs />,
  population: <IconPeople />,
  discontent: <IconUnrest />,
  industry: <IconEconomy />,
  resources: <IconResources />,
  armies: <IconArmies />,
  terrain: <IconTerrain />,
};

/** ЛЕГЕНДА есть только у режимов, где цвет означает величину. */
const LEGENDS: Record<string, { from: string; to: string; ramp: string }> = {
  discontent: { from: "спокойно", to: "на грани", ramp: "linear-gradient(90deg, rgb(46,62,58), rgb(214,84,62))" },
  industry: { from: "слабая", to: "сильная", ramp: "linear-gradient(90deg, rgb(40,48,58), rgb(92,176,214))" },
  population: { from: "мало", to: "много", ramp: "linear-gradient(90deg, rgb(44,50,44), rgb(148,190,120))" },
};

function FlagSU() {
  return (
    <svg viewBox="0 0 90 60" width="90" height="60" role="img" aria-label="Флаг СССР">
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
  mapSlot,
  onAdvance,
  mapMode,
  onMapMode,
  selectedRegionId,
  onSelectRegion,
}: ScreenProps) {
  const { monthIndex, year, events } = model;
  const [orders, setOrders] = useState<Order[]>([]);
  const [draft, setDraft] = useState("");
  const [yashik, setYashik] = useState<Yashik>({ kind: "none" });
  const [selectedCountryId, setSelectedCountryId] = useState<string | null>(null);
  /*
   * ЗАМОК. Карта живёт снаружи и о замке не знает — она просто сообщает о
   * клике. Поэтому замок держит СВОЙ снимок региона: пока он закрыт, ПОЛОСА
   * показывает закреплённое, что бы ни выбирали на карте. Иначе пришлось бы
   * учить каждый источник выделения про состояние одной панели.
   */
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

  const tomes: TomeId[] = scienceSeparate
    ? ["economy", "politics", "defence", "science", "diplomacy", "goals"]
    : ["economy", "politics", "defence", "diplomacy", "goals"];

  /* ── Esc снимает верхний слой по одному ─────────────────────── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirming !== null) return setConfirming(null);
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
  }, [confirming, menuOpen, searchOpen, ledgerOpen, yashik, selectedRegionId, selectedCountryId, onSelectRegion]);

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
    title: "Свернуть",
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest("button") !== null) return;
      fold();
    },
  });

  /* ── Приказы ────────────────────────────────────────────────── */
  const addOrder = () => {
    const text = draft.trim();
    if (text === "") return;
    setOrders((prev) => [...prev, { id: nextId("o"), text }]);
    setDraft("");
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
    void Promise.resolve(onAdvance(orders.map((order) => order.text)))
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
      .map((country) => ({ id: country.id, label: country.short, kind: "держава" }));
    const regions = Object.values(model.regions)
      .filter((region) => region.name.toLowerCase().includes(q))
      .map((region) => ({ id: region.id, label: region.name, kind: "регион" }));
    return [...countries, ...regions].slice(0, 12);
  }, [query, model.countries, model.regions]);

  const shownRegionId = pinned ? pinnedRegionId : selectedRegionId;
  const selectedRegion = shownRegionId === null ? null : (model.regions[shownRegionId] ?? null);
  const legend = LEGENDS[mapMode];

  const shellStyle: React.CSSProperties = {
    ["--feed-col" as string]: feedWidth === null ? "var(--feed-width)" : `${feedWidth}px`,
    // Ряд КОРЕШКОВ сдвигается вправо ровно на размах сопряжения: иначе первые
    // кнопки попадают в клин, где полосы ещё нет.
    ["--band-slant" as string]: `${slant}px`,
  };

  return (
    <ScreenModelProvider value={model}>
    <div ref={shellRef} className={styles.shell} style={shellStyle}>
      {mapSlot}

      {/* ── ШАПКА ────────────────────────────────────────────── */}
      <div ref={shapkaRef}>
        <ShapedBar
          className={styles.shapka}
          tabOffset={0}
          tabRound
          bandTint
          bandSlant={slant}
          left={
            <div className={styles.flagCell}>
              <Tooltip label={`${model.countries[model.playerId].short} — панель державы`}>
                <button type="button" className={styles.flagButton} onClick={() => selectCountry(model.playerId)}>
                  <span className={styles.flag}>
                    <FlagSU />
                  </span>
                </button>
              </Tooltip>
            </div>
          }
          tab={
            <Tooltip label={`Место в мире по совокупной мощи — открыть реестр держав`}>
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
                    model.countries[model.playerId].rank <= 3 && styles.rankGold,
                    model.countries[model.playerId].rank > 3 && model.countries[model.playerId].rank <= 10 && styles.rankSilver,
                  )}
                >
                  {model.countries[model.playerId].rank}
                </span>
              </button>
            </Tooltip>
          }
          top={
            <div className={styles.pribory}>
              {PRIBORY_GROUPS.map((group, groupIndex) => (
                <div key={groupIndex} className={styles.priboryGroup}>
                  {groupIndex > 0 && <span className={styles.priborySplit} />}
                  {group.map((stat) => {
                    // Локальная константа, иначе сужение типа не доживает
                    // до тела замыкания и `tome` остаётся возможно-undefined.
                    const tome = stat.tome;
                    return (
                      <Stat
                        key={stat.key}
                        label={stat.label}
                        value={stat.value}
                        delta={stat.delta}
                        threshold={stat.threshold}
                        icon={stat.icon}
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
                <Tooltip key={id} label={TOME_NAMES[id]}>
                  <Button
                    size="md"
                    iconOnly
                    aria-label={TOME_NAMES[id]}
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
              <Tooltip label="Реестр — таблицы мира">
                <Button
                  size="md"
                  iconOnly
                  aria-label="Реестр"
                  variant={ledgerOpen ? "order" : "quiet"}
                  onClick={() => setLedgerOpen((open) => !open)}
                >
                  <IconLedger />
                </Button>
              </Tooltip>
            </div>
          }
        />
      </div>

      {/* ── ХОД ──────────────────────────────────────────────── */}
      <div ref={hodRef} className={styles.hod}>
        <div className={styles.hodTop}>
          <span className={styles.date}>{monthLabel}</span>
          <span
            className={cx(styles.rezhisser, thinking && styles.rezhisserBusy)}
            title={thinking ? "режиссёр думает" : "режиссёр готов"}
          />
          <div className={styles.instruments}>
            <Tooltip label="Сохранить партию">
              <Button size="sm" variant="quiet" iconOnly aria-label="Сохранить">
                <IconSave />
              </Button>
            </Tooltip>
            <Tooltip label="Поиск по державам и регионам">
              <Button size="sm" variant="quiet" iconOnly aria-label="Поиск" onClick={() => setSearchOpen(true)}>
                <IconSearch />
              </Button>
            </Tooltip>
            <Tooltip label="Меню">
              <Button size="sm" variant="quiet" iconOnly aria-label="Меню" onClick={() => setMenuOpen(true)}>
                <IconMenu />
              </Button>
            </Tooltip>
          </div>
        </div>

        <Button variant="primary" size="lg" className={styles.knopka} disabled={thinking} onClick={onTurn}>
          {thinking ? "Режиссёр думает…" : `Продолжить · ${orders.length}`}
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
              title={TOME_NAMES[yashik.id]}
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
            title="Реестр"
            meta="окно · тащить за шапку"
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
              aria-label="Ширина ленты"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
            />
            <Panel
              title="Этот ход"
              meta={monthLabel.toLowerCase()}
              density="flush"
              scroll
              className={styles.lentaPanel}
              headerProps={foldOnHeader(() => setLentaOpen(false))}
              actions={
                <Tooltip label="Убрать ленту к правому краю">
                  <Button size="sm" variant="quiet" iconOnly aria-label="Свернуть ленту" onClick={() => setLentaOpen(false)}>
                    <IconChevronRight />
                  </Button>
                </Tooltip>
              }
            >
              <div className={styles.lentaTabs}>
                {([
                  ["all", `Всё · ${events.length}`],
                  ["world", "Мир"],
                  ["mine", "Мои приказы"],
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
                      order={event.order === undefined ? undefined : { text: event.order }}
                      tags={event.tags}
                      onTagClick={openTag}
                    />
                  ))}
              </div>
            </Panel>
          </div>
        ) : (
          <Tooltip label={`Развернуть ленту · событий: ${events.length}`}>
            <button type="button" className={styles.lentaTab} aria-label="Развернуть ленту" onClick={() => setLentaOpen(true)}>
              <IconChevronLeft />
              <span className={styles.lentaTabCount}>{events.length}</span>
            </button>
          </Tooltip>
        )}

        <Panel density="instrument" className={styles.rezhimy}>
          <div className={styles.rezhimyRow}>
            {legend !== undefined && (
              <div className={styles.legenda}>
                <div className={styles.legendaRamp} style={{ background: legend.ramp }} />
                <div className={styles.legendaEnds}>
                  <span>{legend.from}</span>
                  <span>{legend.to}</span>
                </div>
              </div>
            )}
            <div className={styles.rezhimyGrid}>
              {model.mapModes.map((mode) => (
                <Tooltip key={mode.id} label={mode.name}>
                  <Button
                    size="sm"
                    iconOnly
                    aria-label={mode.name}
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
              <Tooltip label={pinned ? "Открепить" : "Закрепить: не сбрасывать при клике по карте"}>
                <Button
                  size="sm"
                  variant={pinned ? "order" : "quiet"}
                  iconOnly
                  aria-label={pinned ? "Открепить" : "Закрепить"}
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
              {REGION_TABS.map(([id, name]) => (
                <Button
                  key={id}
                  size="sm"
                  variant={polosaTab === id ? "order" : "quiet"}
                  onClick={() => setPolosaTab(id)}
                >
                  {name}
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
            title="Приказы"
            meta={orders.length === 0 ? monthLabel.toLowerCase() : `${monthLabel.toLowerCase()} · ${orders.length} из 10`}
            density="control"
            headerProps={foldOnHeader(() => setListOpen(false))}
            actions={
              <Tooltip label="Свернуть лист приказов">
                <Button size="sm" variant="quiet" iconOnly aria-label="Свернуть приказы" onClick={() => setListOpen(false)}>
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
                      onRemove={() => setOrders((prev) => prev.filter((item) => item.id !== order.id))}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.vvod}>
              <input
                className={styles.field}
                placeholder="Введите приказ…"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addOrder();
                }}
              />
              <Button variant="order" size="sm" onClick={addOrder} disabled={draft.trim() === ""}>
                Добавить
              </Button>
            </div>
          </Panel>
        ) : (
          <button type="button" className={styles.listTab} onClick={() => setListOpen(true)}>
            <IconChevronUp />
            Приказы
            <span className={styles.listTabCount}>{orders.length}</span>
          </button>
        )}
        </div>
      </div>

      {/* ── ПОДТВЕРЖДЕНИЕ ───────────────────────────────────── */}
      {confirming !== null && (
        <div className={styles.scrim}>
          <Panel title="Необратимое решение" density="prose" className={styles.modal}>
            <p className={styles.modalText}>
              Среди приказов на {monthLabel.toLowerCase()} есть необратимое: «{confirming}». Отменить это будет нельзя.
            </p>
            <div className={styles.modalActions}>
              <Button variant="default" onClick={() => setConfirming(null)}>
                Вернуться
              </Button>
              <Button variant="danger" onClick={advance}>
                Отправить
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {/* ── ПОИСК ───────────────────────────────────────────── */}
      {searchOpen && (
        <div className={styles.searchWrap} onClick={() => setSearchOpen(false)}>
          <div className={styles.searchPanel} onClick={(event) => event.stopPropagation()}>
            <Panel title="Поиск" onClose={() => setSearchOpen(false)} density="control">
              <input
                className={styles.field}
                autoFocus
                placeholder="Держава или регион…"
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
                {query.trim() !== "" && searchResults.length === 0 && <p className={styles.empty}>Ничего не найдено.</p>}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ── МЕНЮ: тумблеры макета ───────────────────────────── */}
      {menuOpen && (
        <div className={styles.searchWrap} onClick={() => setMenuOpen(false)}>
          <div className={styles.searchPanel} onClick={(event) => event.stopPropagation()}>
            <Panel title="Меню" meta="тумблеры макета" onClose={() => setMenuOpen(false)} density="control">
              <p className={styles.empty}>Наука отдельным томом или внутри обороны — смотрим оба варианта.</p>
              <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-4)" }}>
                <Button size="sm" variant={scienceSeparate ? "order" : "quiet"} onClick={() => setScienceSeparate(true)}>
                  Отдельно
                </Button>
                <Button size="sm" variant={!scienceSeparate ? "order" : "quiet"} onClick={() => setScienceSeparate(false)}>
                  Вместе с обороной
                </Button>
              </div>

              <p className={styles.empty}>Плавность сопряжения ШАПКИ: {slant} px</p>
              <input
                type="range"
                min={8}
                max={96}
                step={2}
                value={slant}
                aria-label="Плавность сопряжения"
                onChange={(event) => setSlant(Number(event.target.value))}
                style={{ width: "100%", accentColor: "var(--accent)", marginBottom: "var(--space-4)" }}
              />

              <p className={styles.empty}>Оформление — материал панелей, а не цвет.</p>
              <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
                {[
                  ["flat", "Панель"],
                  ["bare", "Без рам"],
                  ["print", "Печать"],
                  ["glow", "Свет"],
                  ["gauge", "Прибор"],
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

              <p className={styles.empty}>Палитра — решение отложено до подключения карты.</p>
              <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
                {[
                  ["graphite", "Графит"],
                  ["steel", "Сталь"],
                  ["ink", "Тушь"],
                  ["khaki", "Хаки"],
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
    </div>
    </ScreenModelProvider>
  );
}
