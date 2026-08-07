import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { HexMap } from "./HexMap";
import { CountryDetail, LedgerBody, RegionDetail, TomeBody } from "./panels";
import {
  COUNTRIES,
  INITIAL_EVENTS,
  IRREVERSIBLE_WORDS,
  MONTHS,
  MONTHS_NOMINATIVE,
  REGION_TABS,
  REGIONS,
  type CountryId,
  type LedgerTabId,
  type MapModeId,
  type ProtoEvent,
  type RegionTab,
  type TomeId,
} from "./data";
import styles from "./Prototype.module.css";

/**
 * Кликабельный макет интерфейса. Настоящей карты и сервера нет, данные
 * шаблонные — проверяется ПОВЕДЕНИЕ рамы и поверхностей.
 *
 * Правило одной тяжёлой поверхности выполняется СОСТОЯНИЕМ: `yashik` —
 * одно значение, поэтому два тома открытыми быть не могут физически.
 */

type Yashik =
  | { kind: "none" }
  | { kind: "tome"; id: TomeId }
  | { kind: "country"; id: CountryId };

interface Order {
  id: string;
  text: string;
}

const PLAYER: CountryId = "SUN";

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

const MODES: Array<{ id: MapModeId; name: string; icon: React.ReactNode }> = [
  { id: "powers", name: "Державы", icon: <IconFlagMode /> },
  { id: "blocs", name: "Блоки", icon: <IconBlocs /> },
  { id: "population", name: "Население", icon: <IconPeople /> },
  { id: "discontent", name: "Недовольство", icon: <IconUnrest /> },
  { id: "industry", name: "Промышленность", icon: <IconEconomy /> },
  { id: "resources", name: "Ресурсы", icon: <IconResources /> },
  { id: "armies", name: "Армии", icon: <IconArmies /> },
  { id: "terrain", name: "Рельеф", icon: <IconTerrain /> },
];

/** ЛЕГЕНДА есть только у режимов, где цвет означает величину. */
const LEGENDS: Partial<Record<MapModeId, { from: string; to: string; ramp: string }>> = {
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

export function Prototype() {
  const [monthIndex, setMonthIndex] = useState(2);
  const year = 1946;
  const [events, setEvents] = useState<ProtoEvent[]>(INITIAL_EVENTS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [draft, setDraft] = useState("");
  const [yashik, setYashik] = useState<Yashik>({ kind: "none" });
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<CountryId | null>(null);
  const [pinned, setPinned] = useState(false);
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
  const [compareId, setCompareId] = useState<CountryId | null>(null);
  const [mapMode, setMapMode] = useState<MapModeId>("powers");
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
  const [turnCount, setTurnCount] = useState(0);
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

  const monthLabel = `${MONTHS_NOMINATIVE[monthIndex]} ${year}`;

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
        setSelectedRegionId(null);
        setSelectedCountryId(null);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, menuOpen, searchOpen, ledgerOpen, yashik, selectedRegionId, selectedCountryId]);

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
  const selectRegion = (regionId: string) => {
    if (pinned) return;
    setSelectedRegionId(regionId);
    setSelectedCountryId(null);
  };

  const selectCountry = (countryId: CountryId) => {
    setSelectedCountryId(countryId);
    setCompareId(null);
    setYashik({ kind: "country", id: countryId });
  };

  const openTag = (id: string) => {
    if (id in COUNTRIES) selectCountry(id as CountryId);
    else if (id in REGIONS) {
      // Регион живёт в ПОЛОСЕ, а не в ЯЩИКЕ: отдельного «подробно» больше нет.
      setPinned(false);
      setSelectedRegionId(id);
      setSelectedCountryId(null);
    }
  };

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
    () => orders.find((order) => IRREVERSIBLE_WORDS.some((word) => order.text.toLowerCase().includes(word))),
    [orders],
  );

  const advance = () => {
    setThinking(true);
    setConfirming(null);
    window.setTimeout(() => {
      const nextMonth = (monthIndex + 1) % 12;
      const day = 4 + ((turnCount * 7) % 20);
      const produced: ProtoEvent[] = orders.map((order, index) => {
        // Каждый третий приказ отклоняется — иначе не увидеть, как выглядит
        // отказ, а он такая же часть правды, как исполнение.
        const rejected = index > 0 && index % 3 === 2;
        return {
          id: nextId("e"),
          date: `${day + index} ${MONTHS[nextMonth]}`,
          title: rejected ? "Приказ не выполнен" : "Распоряжение исполнено",
          body: rejected
            ? "Регион не под вашим контролем — распоряжение отклонено до применения."
            : "Наркоматы приступили к исполнению. Изменения отразятся в следующей сводке.",
          factuality: rejected ? "partial" : "confirmed",
          order: order.text,
        };
      });

      const worldIndex = turnCount % 4;
      const worldCountry = (["GBR", "TUR", "FRA", "USA"] as CountryId[])[worldIndex];
      const worldEvent: ProtoEvent = {
        id: nextId("e"),
        date: `${day + 12} ${MONTHS[nextMonth]}`,
        title: ["Нота из Лондона", "Переговоры в Анкаре", "Забастовки в Лионе", "Испытания в Неваде"][worldIndex],
        body: "Мир продолжает двигаться сам: державы преследуют свои цели, не спрашивая вашего согласия.",
        tags: [{ id: worldCountry, label: COUNTRIES[worldCountry].short, kind: "country" }],
      };

      setEvents([...produced, worldEvent]);
      setOrders([]);
      setMonthIndex(nextMonth);
      setTurnCount((prev) => prev + 1);
      setThinking(false);
    }, 650);
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
    const countries = Object.values(COUNTRIES)
      .filter((country) => country.short.toLowerCase().includes(q))
      .map((country) => ({ id: country.id as string, label: country.short, kind: "держава" }));
    const regions = Object.values(REGIONS)
      .filter((region) => region.name.toLowerCase().includes(q))
      .map((region) => ({ id: region.id, label: region.name, kind: "регион" }));
    return [...countries, ...regions].slice(0, 12);
  }, [query]);

  const selectedRegion = selectedRegionId === null ? null : REGIONS[selectedRegionId];
  const legend = LEGENDS[mapMode];

  const shellStyle: React.CSSProperties = {
    ["--feed-col" as string]: feedWidth === null ? "var(--feed-width)" : `${feedWidth}px`,
    // Ряд КОРЕШКОВ сдвигается вправо ровно на размах сопряжения: иначе первые
    // кнопки попадают в клин, где полосы ещё нет.
    ["--band-slant" as string]: `${slant}px`,
  };

  return (
    <div ref={shellRef} className={styles.shell} style={shellStyle}>
      <HexMap
        mode={mapMode}
        selectedRegionId={selectedRegionId}
        selectedCountryId={selectedCountryId}
        onSelectRegion={selectRegion}
        onSelectCountry={selectCountry}
      />

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
              <Tooltip label={`${COUNTRIES[PLAYER].short} — панель державы`}>
                <button type="button" className={styles.flagButton} onClick={() => selectCountry(PLAYER)}>
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
                    COUNTRIES[PLAYER].rank <= 3 && styles.rankGold,
                    COUNTRIES[PLAYER].rank > 3 && COUNTRIES[PLAYER].rank <= 10 && styles.rankSilver,
                  )}
                >
                  {COUNTRIES[PLAYER].rank}
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
              title={COUNTRIES[yashik.id].short}
              meta={COUNTRIES[yashik.id].tier}
              onClose={() => setYashik({ kind: "none" })}
              density="control"
              scroll
              className={styles.yashikPanel}
            >
              <CountryDetail
                country={COUNTRIES[yashik.id]}
                rival={compareId === null ? null : COUNTRIES[compareId]}
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
                setSelectedRegionId(regionId);
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
              {MODES.map((mode) => (
                <Tooltip key={mode.id} label={mode.name}>
                  <Button
                    size="sm"
                    iconOnly
                    aria-label={mode.name}
                    variant={mode.id === mapMode ? "order" : "quiet"}
                    onClick={() => setMapMode(mode.id)}
                  >
                    {mode.icon}
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
            meta={COUNTRIES[selectedRegion.owner].short}
            density="control"
            scroll
            className={styles.polosaPanel}
            onClose={() => {
              setSelectedRegionId(null);
              setPinned(false);
            }}
            actions={
              <Tooltip label={pinned ? "Открепить" : "Закрепить: не сбрасывать при клике по карте"}>
                <Button
                  size="sm"
                  variant={pinned ? "order" : "quiet"}
                  iconOnly
                  aria-label={pinned ? "Открепить" : "Закрепить"}
                  onClick={() => setPinned((prev) => !prev)}
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
            <RegionDetail region={selectedRegion} tab={polosaTab} onSelectCountry={selectCountry} />
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
  );
}
