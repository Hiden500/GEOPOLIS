import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  EventItem,
  IconArmies,
  IconBalance,
  IconBlocs,
  IconChevronDown,
  IconChevronUp,
  IconClose,
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
  REGIONS,
  type CountryId,
  type LedgerTabId,
  type MapModeId,
  type ProtoEvent,
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
  | { kind: "ledger" }
  | { kind: "country"; id: CountryId }
  | { kind: "region"; id: string };

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
  const [compareId, setCompareId] = useState<CountryId | null>(null);
  const [mapMode, setMapMode] = useState<MapModeId>("powers");
  const [legendOpen, setLegendOpen] = useState(false);
  const [lentaOpen, setLentaOpen] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [feedWidth, setFeedWidth] = useState<number | null>(null);
  const [yashikWidth, setYashikWidth] = useState<number | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  /** C3: наука отдельным ТОМОМ или внутри ОБОРОНЫ — смотрим оба варианта. */
  const [scienceSeparate, setScienceSeparate] = useState(true);

  const shellRef = useRef<HTMLDivElement>(null);
  const shapkaRef = useRef<HTMLDivElement>(null);
  const hodRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lentaRef = useRef<HTMLDivElement>(null);
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
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (shapkaRef.current !== null) observer.observe(shapkaRef.current);
    if (hodRef.current !== null) observer.observe(hodRef.current);
    if (bottomRef.current !== null) observer.observe(bottomRef.current);
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
      if (yashik.kind !== "none") return setYashik({ kind: "none" });
      if (selectedRegionId !== null || selectedCountryId !== null) {
        setSelectedRegionId(null);
        setSelectedCountryId(null);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, menuOpen, searchOpen, yashik, selectedRegionId, selectedCountryId]);

  /* ── Ручки ширины ───────────────────────────────────────────── */
  const rootSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

  /*
   * Цель перетаскивания читается из data-атрибута кнопки, а не замыкается
   * в фабрике обработчиков: обработчик, созданный на рендере, трогал бы ref
   * во время рендера — это то, что запрещает react-hooks/refs.
   */
  const onDragStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const target = event.currentTarget.dataset.target;
    dragTarget.current = target === "yashik" ? "yashik" : "lenta";
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onDragMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragTarget.current === null) return;
    const unit = rootSize();
    if (dragTarget.current === "lenta" && lentaRef.current !== null) {
      const right = lentaRef.current.getBoundingClientRect().right;
      setFeedWidth(Math.max(17 * unit, Math.min(right - event.clientX, window.innerWidth * 0.45)));
      return;
    }
    if (dragTarget.current === "yashik" && yashikRef.current !== null) {
      const left = yashikRef.current.getBoundingClientRect().left;
      const feed = lentaRef.current?.getBoundingClientRect().width ?? 0;
      // Потолок: ЯЩИК не имеет права дойти до ЛЕНТЫ — карта не должна исчезать.
      const cap = window.innerWidth - feed - 4 * unit;
      setYashikWidth(Math.max(24 * unit, Math.min(event.clientX - left, cap)));
    }
  }, []);

  const onDragEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragTarget.current = null;
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
      setPinned(false);
      setSelectedRegionId(id);
      setSelectedCountryId(null);
      setYashik({ kind: "region", id });
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
          tabOffset={32}
          tab={
            <button
              type="button"
              className={styles.rankBox}
              title="Ранг по совокупной мощи — открыть реестр держав"
              onClick={() => {
                setLedgerTab("powers");
                setYashik({ kind: "ledger" });
              }}
            >
              <span className={styles.rankLabel}>в мире</span>
              <span className={styles.rank}>{COUNTRIES[PLAYER].rank}</span>
            </button>
          }
        >
          <div className={styles.shapkaInner}>
            <div className={styles.flagCell}>
              <button
                type="button"
                className={styles.flagButton}
                title={`${COUNTRIES[PLAYER].short} — панель державы`}
                onClick={() => selectCountry(PLAYER)}
              >
                <span className={styles.flag}>
                  <FlagSU />
                </span>
              </button>
            </div>

            <div className={styles.shapkaRows}>
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

              <div className={styles.koreshki}>
                {tomes.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    iconOnly
                    aria-label={TOME_NAMES[id]}
                    title={TOME_NAMES[id]}
                    variant={yashik.kind === "tome" && yashik.id === id ? "order" : "quiet"}
                    onClick={() =>
                      setYashik((prev) => (prev.kind === "tome" && prev.id === id ? { kind: "none" } : { kind: "tome", id }))
                    }
                  >
                    {TOME_ICONS[id]}
                  </Button>
                ))}
                <span className={styles.koreshkiSplit} />
                <Button
                  size="sm"
                  iconOnly
                  aria-label="Реестр"
                  title="Реестр"
                  variant={yashik.kind === "ledger" ? "order" : "quiet"}
                  onClick={() => setYashik((prev) => (prev.kind === "ledger" ? { kind: "none" } : { kind: "ledger" }))}
                >
                  <IconLedger />
                </Button>
              </div>
            </div>
          </div>
        </ShapedBar>
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
            <Button size="sm" variant="quiet" iconOnly aria-label="Сохранить" title="Сохранить">
              <IconSave />
            </Button>
            <Button size="sm" variant="quiet" iconOnly aria-label="Поиск" title="Поиск" onClick={() => setSearchOpen(true)}>
              <IconSearch />
            </Button>
            <Button size="sm" variant="quiet" iconOnly aria-label="Меню" title="Меню" onClick={() => setMenuOpen(true)}>
              <IconMenu />
            </Button>
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
          className={styles.yashik}
          style={{
            width:
              yashikWidth !== null
                ? `${yashikWidth}px`
                : yashik.kind === "ledger"
                  ? "var(--ledger-width)"
                  : "clamp(var(--surface-min), 34vw, var(--surface-max))",
          }}
        >
          <button
            type="button"
            className={styles.resizerRight}
            aria-label="Ширина панели"
            data-target="yashik"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
          />

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

          {yashik.kind === "ledger" && (
            <Panel title="Реестр" onClose={() => setYashik({ kind: "none" })} density="control" scroll className={styles.yashikPanel}>
              <LedgerBody
                tab={ledgerTab}
                onTab={setLedgerTab}
                onSelectCountry={selectCountry}
                onSelectRegion={(regionId) => {
                  setPinned(false);
                  setSelectedRegionId(regionId);
                  setYashik({ kind: "region", id: regionId });
                }}
                events={events}
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

          {yashik.kind === "region" && (
            <Panel
              title={REGIONS[yashik.id].name}
              meta={COUNTRIES[REGIONS[yashik.id].owner].short}
              onClose={() => setYashik({ kind: "none" })}
              density="control"
              scroll
              className={styles.yashikPanel}
            >
              <RegionDetail region={REGIONS[yashik.id]} onSelectCountry={selectCountry} />
            </Panel>
          )}
        </div>
      )}

      {/* ── ЛЕНТА и РЕЖИМЫ ──────────────────────────────────── */}
      <div className={styles.rightStack}>
        <div ref={lentaRef} className={cx(styles.lenta, !lentaOpen && styles.lentaCollapsed)}>
          <button
            type="button"
            className={styles.resizerLeft}
            aria-label="Ширина ленты"
            data-target="lenta"
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
          />
          <Panel
            title="Этот ход"
            meta={`${events.length} событий`}
            density="flush"
            scroll={lentaOpen}
            className={styles.lentaPanel}
            actions={
              <Button
                size="sm"
                variant="quiet"
                iconOnly
                aria-label={lentaOpen ? "Свернуть ленту" : "Развернуть ленту"}
                title={lentaOpen ? "Свернуть" : "Развернуть"}
                onClick={() => setLentaOpen((open) => !open)}
              >
                {lentaOpen ? <IconChevronUp /> : <IconChevronDown />}
              </Button>
            }
          >
            {lentaOpen && (
              <div className={styles.lentaBody}>
                {events.map((event) => (
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
            )}
          </Panel>
        </div>

        {legendOpen && legend !== undefined && (
          <Panel density="instrument" className={styles.legenda}>
            <div className={styles.legendaRamp} style={{ background: legend.ramp }} />
            <div className={styles.legendaEnds}>
              <span>{legend.from}</span>
              <span>{legend.to}</span>
            </div>
          </Panel>
        )}

        <Panel density="instrument" className={styles.rezhimy}>
          <div className={styles.rezhimyGrid}>
            {MODES.map((mode) => (
              <Button
                key={mode.id}
                size="sm"
                iconOnly
                aria-label={mode.name}
                title={
                  mode.id === mapMode && LEGENDS[mode.id] !== undefined
                    ? `${mode.name} — нажмите ещё раз для легенды`
                    : mode.name
                }
                variant={mode.id === mapMode ? "order" : "quiet"}
                onClick={() => {
                  if (mode.id === mapMode) setLegendOpen((open) => !open);
                  else {
                    setMapMode(mode.id);
                    setLegendOpen(false);
                  }
                }}
              >
                {mode.icon}
              </Button>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Низ: ПОЛОСА и ЛИСТ ──────────────────────────────── */}
      <div className={styles.bottom}>
        <div ref={bottomRef} className={styles.bottomInner}>
          {selectedRegion !== null && (
            <div className={styles.polosa}>
              <span className={styles.polosaName}>{selectedRegion.name}</span>
              <div className={styles.polosaFacts}>
                <span className={styles.fact}>{COUNTRIES[selectedRegion.owner].short}</span>
                <span className={styles.fact}>{selectedRegion.population}</span>
                <span className={styles.fact}>
                  {selectedRegion.groups[0].name} {Math.round(selectedRegion.groups[0].share * 100)}%
                </span>
                <span className={styles.fact}>недовольство {selectedRegion.discontent.toFixed(2)}</span>
              </div>
              <span className={styles.grow} />
              <Button
                size="sm"
                variant={pinned ? "order" : "quiet"}
                iconOnly
                aria-label={pinned ? "Открепить" : "Закрепить"}
                title={pinned ? "Открепить" : "Закрепить"}
                onClick={() => setPinned((prev) => !prev)}
              >
                <IconLock />
              </Button>
              <Button size="sm" variant="default" onClick={() => setYashik({ kind: "region", id: selectedRegion.id })}>
                Подробно
              </Button>
              <Button
                size="sm"
                variant="quiet"
                iconOnly
                aria-label="Снять выделение"
                onClick={() => {
                  setSelectedRegionId(null);
                  setPinned(false);
                }}
              >
                <IconClose />
              </Button>
            </div>
          )}

          <Panel
            title="Приказы"
            meta={orders.length === 0 ? monthLabel.toLowerCase() : `${monthLabel.toLowerCase()} · ${orders.length} из 10`}
            density="control"
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
