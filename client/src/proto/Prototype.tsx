import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  EventItem,
  IconArrowRight,
  IconClose,
  IconLock,
  IconSearch,
  IconWarning,
  OrderCard,
  Panel,
  ResourceBar,
  ShapedBar,
  Stat,
  cx,
} from "../ui";
import { HexMap } from "./HexMap";
import { CountryDetail, LedgerBody, RegionDetail, TomeBody } from "./panels";
import {
  COUNTRIES,
  INITIAL_EVENTS,
  IRREVERSIBLE_WORDS,
  MAP_MODES,
  MONTHS,
  MONTHS_NOMINATIVE,
  REGIONS,
  RESOURCES,
  TOMES,
  type CountryId,
  type LedgerTabId,
  type MapModeId,
  type ProtoEvent,
  type TomeId,
} from "./data";
import styles from "./Prototype.module.css";

/**
 * Кликабельный макет интерфейса. Настоящей карты и сервера здесь нет,
 * данные шаблонные — проверяется ПОВЕДЕНИЕ: что откуда выдвигается, что
 * чем закрывается, что куда ведёт, как выглядит ход и кризис.
 *
 * Правило одной тяжёлой поверхности выполняется состоянием, а не
 * дисциплиной: `surface` — одно значение, поэтому два тома открытыми быть
 * не могут физически.
 */

type Surface =
  | { kind: "none" }
  | { kind: "tome"; id: TomeId }
  | { kind: "ledger" }
  | { kind: "country"; id: CountryId }
  | { kind: "region"; id: string };

interface Order {
  id: string;
  text: string;
}

interface Crisis {
  id: string;
  title: string;
  body: string;
  regionId: string;
  options: string[];
}

const PLAYER: CountryId = "SUN";

function FlagSU() {
  return (
    <svg viewBox="0 0 84 56" width="100%" height="100%" role="img" aria-label="Флаг СССР">
      <rect width="84" height="56" fill="#c1272d" />
      <g fill="#f0c14b">
        <path d="M17 12l1.6 4.6H23l-3.6 2.8 1.4 4.5-3.8-2.8-3.8 2.8 1.4-4.5-3.6-2.8h4.4z" />
        <path d="M15.5 27.5c3.6 0 6.4 2.6 6.4 6 0 2.4-1.3 4.2-3.2 5.2l-1.1-1.9c1.3-.7 2.1-1.8 2.1-3.3 0-2.2-1.8-3.9-4.2-3.9v-2.1z" />
        <path d="M20.6 29.6l2 2-9.4 9.4-2-2z" />
        <path d="M12.4 37.2h6.2v2.2h-6.2z" transform="rotate(-45 15.5 38.3)" />
      </g>
    </svg>
  );
}

export function Prototype() {
  const params = new URLSearchParams(window.location.search);

  useEffect(() => {
    const palette = params.get("palette");
    const scale = params.get("scale");
    if (palette !== null) document.documentElement.dataset.palette = palette;
    if (scale !== null) document.documentElement.style.setProperty("--ui-scale", scale);
    // params читается один раз при монтировании: адрес макета не меняется на лету.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [monthIndex, setMonthIndex] = useState(2); // март
  const year = 1946;
  const [events, setEvents] = useState<ProtoEvent[]>(INITIAL_EVENTS);
  const [orders, setOrders] = useState<Order[]>([]);
  const [draft, setDraft] = useState("");
  const [surface, setSurface] = useState<Surface>({ kind: "none" });
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedCountryId, setSelectedCountryId] = useState<CountryId | null>(null);
  const [pinned, setPinned] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<LedgerTabId>("powers");
  const [compareId, setCompareId] = useState<CountryId | null>(null);
  const [mapMode, setMapMode] = useState<MapModeId>("powers");
  const [crisis, setCrisis] = useState<Crisis | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [feedWidth, setFeedWidth] = useState<number | null>(null);
  const [turnCount, setTurnCount] = useState(0);

  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragOrder = useRef<number | null>(null);
  /*
   * Счётчики id живут в ref, а не в модульной переменной: модульная
   * переживает размонтирование и общая для всех экземпляров, а её правка
   * во время рендера — побочный эффект (react-hooks/globals это и ловит).
   */
  const seq = useRef(0);
  const nextId = (prefix: string) => {
    seq.current += 1;
    return `${prefix}${seq.current}`;
  };

  /*
   * Высоты рамы измеряются, а не забиваются числом: они зависят от
   * масштаба, локали и числа показателей. Выдвижная поверхность встаёт
   * между ними и потому обязана знать обе.
   */
  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const apply = () => {
      if (topRef.current !== null) {
        shell.style.setProperty("--top-h", `${topRef.current.offsetHeight}px`);
      }
      if (bottomRef.current !== null) {
        shell.style.setProperty("--bottom-h", `${bottomRef.current.offsetHeight}px`);
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    if (topRef.current !== null) observer.observe(topRef.current);
    if (bottomRef.current !== null) observer.observe(bottomRef.current);
    return () => observer.disconnect();
  });

  const monthLabel = `${MONTHS_NOMINATIVE[monthIndex]} ${year}`;

  /* ── Esc снимает верхний слой по одному ─────────────────────── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirming !== null) return setConfirming(null);
      if (searchOpen) return setSearchOpen(false);
      if (surface.kind !== "none") return setSurface({ kind: "none" });
      if (selectedRegionId !== null || selectedCountryId !== null) {
        setSelectedRegionId(null);
        setSelectedCountryId(null);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, searchOpen, surface, selectedRegionId, selectedCountryId]);

  /* ── Ширина ленты ───────────────────────────────────────────── */
  const onResizeDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onResizeMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current || columnRef.current === null) return;
    const right = columnRef.current.getBoundingClientRect().right;
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    setFeedWidth(Math.max(17 * rootSize, Math.min(right - event.clientX, window.innerWidth * 0.5)));
  }, []);

  const onResizeUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  /* ── Выделение на карте ─────────────────────────────────────── */
  const selectRegion = (regionId: string) => {
    if (pinned) return;
    setSelectedRegionId(regionId);
    setSelectedCountryId(null);
  };

  const selectCountry = (countryId: CountryId) => {
    setSelectedCountryId(countryId);
    setCompareId(null);
    setSurface({ kind: "country", id: countryId });
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
    () =>
      orders.find((order) =>
        IRREVERSIBLE_WORDS.some((word) => order.text.toLowerCase().includes(word)),
      ),
    [orders],
  );

  /* ── Ход ────────────────────────────────────────────────────── */
  const advance = () => {
    setThinking(true);
    setConfirming(null);
    window.setTimeout(() => {
      const nextMonth = (monthIndex + 1) % 12;
      const day = 4 + ((turnCount * 7) % 20);
      const produced: ProtoEvent[] = orders.map((order, index) => {
        // Каждый третий приказ прототип отклоняет — иначе не увидеть, как
        // выглядит отказ, а он тут такая же часть правды, как исполнение.
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

      const worldEvent: ProtoEvent = {
        id: nextId("e"),
        date: `${day + 12} ${MONTHS[nextMonth]}`,
        title: ["Нота из Лондона", "Переговоры в Анкаре", "Забастовки в Лионе", "Испытания в Неваде"][
          turnCount % 4
        ],
        body: "Мир продолжает двигаться сам: державы преследуют свои цели, не спрашивая вашего согласия.",
        tags: [{ id: (["GBR", "TUR", "FRA", "USA"] as CountryId[])[turnCount % 4], label: COUNTRIES[(["GBR", "TUR", "FRA", "USA"] as CountryId[])[turnCount % 4]].short, kind: "country" }],
      };

      setEvents([...produced, worldEvent]);
      setOrders([]);
      setMonthIndex(nextMonth);
      setTurnCount((prev) => prev + 1);
      setThinking(false);

      // Каждый второй ход мир поднимает кризис — чтобы состояние «требуется
      // решение» можно было увидеть, а не поверить на слово.
      if (turnCount % 2 === 1) {
        setCrisis({
          id: `c${turnCount}`,
          title: "Волнения в Эстонии",
          body: "Забастовка на сланцевых рудниках переросла в уличные шествия. Местный совет просит указаний, гарнизон ждёт приказа.",
          regionId: "r25",
          options: ["Подавить", "Дать автономию", "Ничего не делать"],
        });
      }
    }, 650);
  };

  const onTurn = () => {
    if (crisis !== null) return;
    if (irreversible !== undefined) {
      setConfirming(irreversible.text);
      return;
    }
    advance();
  };

  const resolveCrisis = (option: string) => {
    if (crisis === null) return;
    setEvents((prev) => [
      {
        id: nextId("e"),
        date: `${20} ${MONTHS[monthIndex]}`,
        title: `Кризис в Эстонии: ${option.toLowerCase()}`,
        body:
          option === "Ничего не делать"
            ? "Указаний не поступило. Давление никуда не делось и вернётся сильнее."
            : "Решение принято и исполнено. Последствия отразятся в состоянии региона.",
        order: option,
        tags: [{ id: crisis.regionId, label: REGIONS[crisis.regionId].name, kind: "region" }],
      },
      ...prev,
    ]);
    setCrisis(null);
  };

  /* ── Поиск ──────────────────────────────────────────────────── */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    const countries = Object.values(COUNTRIES)
      .filter((country) => country.short.toLowerCase().includes(q))
      .map((country) => ({ id: country.id, label: country.short, kind: "держава" as const }));
    const regions = Object.values(REGIONS)
      .filter((region) => region.name.toLowerCase().includes(q))
      .map((region) => ({ id: region.id, label: region.name, kind: "регион" as const }));
    return [...countries, ...regions].slice(0, 12);
  }, [query]);

  const openTag = (id: string) => {
    if (id in COUNTRIES) selectCountry(id as CountryId);
    else if (id in REGIONS) {
      setPinned(false);
      setSelectedRegionId(id);
      setSelectedCountryId(null);
      setSurface({ kind: "region", id });
    }
  };

  const turnLabel = thinking
    ? "Режиссёр думает…"
    : crisis !== null
      ? "Требуется решение"
      : `Продолжить · ${orders.length}`;

  const selectedRegion = selectedRegionId === null ? null : REGIONS[selectedRegionId];

  return (
    <div
      ref={shellRef}
      className={styles.shell}
      style={feedWidth === null ? { ["--feed-col" as string]: "var(--feed-width)" } : { ["--feed-col" as string]: `${feedWidth}px` }}
    >
      <HexMap
        mode={mapMode}
        selectedRegionId={selectedRegionId}
        selectedCountryId={selectedCountryId}
        onSelectRegion={selectRegion}
        onSelectCountry={selectCountry}
      />

      {/* ── Верхняя панель ───────────────────────────────────── */}
      <div ref={topRef}>
        <ShapedBar
          className={styles.topLeft}
          tabOffset={28}
          tab={
            <button
              type="button"
              className={styles.rankBox}
              title="Ранг по совокупной мощи — открыть реестр держав"
              onClick={() => {
                setLedgerTab("powers");
                setSurface({ kind: "ledger" });
              }}
            >
              <span className={styles.rankLabel}>в мире</span>
              <span className={styles.rank}>{COUNTRIES[PLAYER].rank}</span>
            </button>
          }
        >
          <div className={styles.topInner}>
            <div className={styles.flagCell}>
              <button
                type="button"
                className={styles.flagButton}
                title="Панель державы"
                onClick={() => selectCountry(PLAYER)}
              >
                <span className={styles.flag}>
                  <FlagSU />
                </span>
              </button>
            </div>

            <div className={styles.statsCell}>
              <div className={styles.stats}>
                <Stat label="ВВП" value="1,46T" delta={{ text: "+3,2%", tone: "good" }} labelMode="wide" onClick={() => setSurface({ kind: "tome", id: "economy" })} />
                <Stat label="Баланс" value="+12,4B" delta={{ text: "+1,8B", tone: "good" }} labelMode="wide" onClick={() => setSurface({ kind: "tome", id: "economy" })} />
                <Stat label="Население" value="170,5M" delta={{ text: "+0,6M", tone: "good" }} labelMode="wide" />
                <Stat label="Стабильность" value="71" delta={{ text: "−1", tone: "bad" }} labelMode="wide" onClick={() => setSurface({ kind: "tome", id: "politics" })} />
                <Stat label="Легитимность" value="83" delta={{ text: "+2", tone: "good" }} labelMode="wide" onClick={() => setSurface({ kind: "tome", id: "politics" })} />
                <Stat label="Долг" value="0,94" delta={{ text: "+0,03", tone: "bad" }} threshold="near" labelMode="wide" onClick={() => setSurface({ kind: "tome", id: "economy" })} />
              </div>

              <ResourceBar items={RESOURCES} size="sm" />

              <div className={styles.books}>
                {TOMES.map((tome) => (
                  <Button
                    key={tome.id}
                    size="sm"
                    variant={surface.kind === "tome" && surface.id === tome.id ? "order" : "quiet"}
                    onClick={() =>
                      setSurface((prev) =>
                        prev.kind === "tome" && prev.id === tome.id
                          ? { kind: "none" }
                          : { kind: "tome", id: tome.id },
                      )
                    }
                  >
                    {tome.name}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={surface.kind === "ledger" ? "order" : "quiet"}
                  onClick={() =>
                    setSurface((prev) => (prev.kind === "ledger" ? { kind: "none" } : { kind: "ledger" }))
                  }
                >
                  Реестры
                </Button>
              </div>
            </div>
          </div>
        </ShapedBar>
      </div>

      {/* ── Выдвижная поверхность ────────────────────────────── */}
      {surface.kind !== "none" && (
        <div className={cx(styles.surface, surface.kind === "ledger" ? styles.ledgerSurface : styles.drawer)}>
          {surface.kind === "tome" && (
            <Panel
              title={TOMES.find((tome) => tome.id === surface.id)?.name ?? ""}
              onClose={() => setSurface({ kind: "none" })}
              density="control"
              scroll
              className={styles.grow}
            >
              <TomeBody id={surface.id} onSelectCountry={selectCountry} />
            </Panel>
          )}

          {surface.kind === "ledger" && (
            <Panel
              title="Реестр"
              onClose={() => setSurface({ kind: "none" })}
              density="control"
              scroll
              className={styles.grow}
            >
              <LedgerBody
                tab={ledgerTab}
                onTab={setLedgerTab}
                onSelectCountry={selectCountry}
                onSelectRegion={(regionId) => {
                  setPinned(false);
                  setSelectedRegionId(regionId);
                  setSurface({ kind: "region", id: regionId });
                }}
                events={events}
              />
            </Panel>
          )}

          {surface.kind === "country" && (
            <Panel
              title={COUNTRIES[surface.id].short}
              meta={COUNTRIES[surface.id].tier}
              onClose={() => setSurface({ kind: "none" })}
              density="control"
              scroll
              className={styles.grow}
            >
              <CountryDetail
                country={COUNTRIES[surface.id]}
                rival={compareId === null ? null : COUNTRIES[compareId]}
                onCompare={setCompareId}
                onClearCompare={() => setCompareId(null)}
              />
            </Panel>
          )}

          {surface.kind === "region" && (
            <Panel
              title={REGIONS[surface.id].name}
              meta={COUNTRIES[REGIONS[surface.id].owner].short}
              onClose={() => setSurface({ kind: "none" })}
              density="control"
              scroll
              className={styles.grow}
            >
              <RegionDetail region={REGIONS[surface.id]} onSelectCountry={selectCountry} />
            </Panel>
          )}
        </div>
      )}

      {/* ── Правая колонка ───────────────────────────────────── */}
      <div ref={columnRef} className={styles.rightColumn}>
        <button
          type="button"
          className={styles.resizer}
          aria-label="Ширина ленты"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
        />

        <Panel density="control">
          <div className={styles.turnMeta}>
            <span className={styles.date}>{monthLabel}</span>
            <span className={styles.modelState}>
              <span className={cx(styles.modelDot, thinking && styles.modelDotBusy)} />
              {thinking ? "режиссёр думает" : "режиссёр готов"}
            </span>
          </div>
          <Button
            variant="primary"
            size="lg"
            className={styles.turnButton}
            disabled={thinking}
            onClick={onTurn}
          >
            {turnLabel} {crisis === null && !thinking && <IconArrowRight />}
          </Button>
          <div className={styles.tools}>
            <Button size="sm" variant="default">Сохранить</Button>
            <Button size="sm" variant="default">Меню</Button>
            <Button size="sm" variant="default" iconOnly aria-label="Поиск" onClick={() => setSearchOpen(true)}>
              <IconSearch />
            </Button>
          </div>
        </Panel>

        <Panel
          title="Этот ход"
          meta={`${events.length} событий`}
          density="flush"
          scroll
          className={styles.feed}
        >
          {crisis !== null && (
            <div className={styles.crisis}>
              <p className={styles.crisisTitle}>
                <IconWarning /> {crisis.title}
              </p>
              <p className={styles.crisisBody}>{crisis.body}</p>
              <div className={styles.crisisOptions}>
                {crisis.options.map((option) => (
                  <Button key={option} variant="order" size="sm" onClick={() => resolveCrisis(option)}>
                    {option}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.feedBody}>
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
        </Panel>

        <Panel title="Режим карты" meta={MAP_MODES.find((mode) => mode.id === mapMode)?.name} density="control">
          <div className={styles.modeList}>
            {MAP_MODES.map((mode) => (
              <Button
                key={mode.id}
                size="sm"
                variant={mode.id === mapMode ? "order" : "quiet"}
                onClick={() => setMapMode(mode.id)}
              >
                {mode.name}
              </Button>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Нижняя стопка ────────────────────────────────────── */}
      <div className={styles.bottom}>
        <div ref={bottomRef} className={styles.bottomInner}>
          {selectedRegion !== null && (
            <div className={styles.regionStrip}>
              <span className={styles.regionName}>{selectedRegion.name}</span>
              <div className={styles.regionFacts}>
                <span className={styles.regionFact}>{COUNTRIES[selectedRegion.owner].short}</span>
                <span className={styles.regionFact}>{selectedRegion.population}</span>
                <span className={styles.regionFact}>
                  {selectedRegion.groups[0].name} {Math.round(selectedRegion.groups[0].share * 100)}%
                </span>
                <span className={styles.regionFact}>
                  недовольство {selectedRegion.discontent.toFixed(2)}
                </span>
              </div>
              <span className={styles.grow} />
              <Button
                size="sm"
                variant={pinned ? "order" : "quiet"}
                iconOnly
                aria-label={pinned ? "Открепить" : "Закрепить"}
                onClick={() => setPinned((prev) => !prev)}
              >
                <IconLock />
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={() => setSurface({ kind: "region", id: selectedRegion.id })}
              >
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
            meta={`${monthLabel.toLowerCase()} · составлено ${orders.length} из 10`}
            density="control"
          >
            {orders.length === 0 ? (
              <p className={styles.empty}>Приказов пока нет. Напишите, что делает держава.</p>
            ) : (
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
                      if (dragOrder.current !== null && dragOrder.current !== index) {
                        moveOrder(dragOrder.current, index);
                      }
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

            <div className={styles.input}>
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

      {/* ── Подтверждение необратимого ───────────────────────── */}
      {confirming !== null && (
        <div className={styles.scrim}>
          <Panel title="Необратимое решение" density="prose" className={styles.modal}>
            <p className={styles.modalText}>
              Среди приказов на {monthLabel.toLowerCase()} есть необратимое: «{confirming}».
              Отменить это будет нельзя.
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

      {/* ── Поиск ────────────────────────────────────────────── */}
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
                {query.trim() !== "" && searchResults.length === 0 && (
                  <p className={styles.empty}>Ничего не найдено.</p>
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
