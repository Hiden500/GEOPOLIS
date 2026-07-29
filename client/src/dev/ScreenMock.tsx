import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  EventItem,
  IconArrowRight,
  IconLock,
  IconSearch,
  Panel,
  ResourceBar,
  ShapedBar,
  Stat,
} from "../ui";
import styles from "./ScreenMock.module.css";

/**
 * Макет игрового экрана. Открывается через ?showcase=screen — витрина
 * системы встраивает его в iframe заданного размера, чтобы медиазапросы,
 * автомасштаб и rem отработали от НАСТОЯЩЕЙ ширины окна, а не от
 * уменьшенной картинки.
 *
 * Данные подставные: это проверка раскладки и читаемости панелей поверх
 * карты, а не рабочий экран.
 */

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

const MAP_MODES = ["Державы", "Блоки", "Население", "Недовольство", "Промышленность", "Ресурсы", "Армии", "Рельеф"];

const RESOURCES = [
  { id: "coal", label: "Уголь", amount: "412", delta: { text: "+8", tone: "good" as const } },
  { id: "oil", label: "Нефть", amount: "96", delta: { text: "−4", tone: "bad" as const } },
  { id: "steel", label: "Сталь", amount: "188", delta: { text: "+2", tone: "good" as const } },
  { id: "rubber", label: "Каучук", amount: "7", delta: { text: "−1", tone: "bad" as const }, shortage: true },
];

export function ScreenMock() {
  const params = new URLSearchParams(window.location.search);
  const palette = params.get("palette");
  const scale = params.get("scale");

  useEffect(() => {
    if (palette !== null) document.documentElement.dataset.palette = palette;
    if (scale !== null) document.documentElement.style.setProperty("--ui-scale", scale);
  }, [palette, scale]);

  // Ширина ленты: по умолчанию из окна (clamp в tokens.css), дальше — рука игрока.
  const [feedWidth, setFeedWidth] = useState<number | null>(null);
  const dragging = useRef(false);
  const columnRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current || columnRef.current === null) return;
    const right = columnRef.current.getBoundingClientRect().right;
    // Коридор: уже 17rem лента бессмысленна, шире половины окна — душит карту.
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    setFeedWidth(Math.max(17 * rootSize, Math.min(right - event.clientX, window.innerWidth * 0.5)));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div className={styles.shell}>
      <div className={styles.map} />
      <div className={styles.graticule} />

      {/* ── Верхняя панель ─────────────────────────────────────── */}
      <ShapedBar
        className={styles.topLeft}
        tabOffset={28}
        tab={
          <div className={styles.rankBox}>
            <span className={styles.rankLabel}>в мире</span>
            <span className={styles.rank}>2</span>
          </div>
        }
      >
        <div className={styles.topInner}>
        <div className={styles.flagCell}>
          <button type="button" className={styles.flagButton} title="Панель державы">
            <span className={styles.flag}>
              <FlagSU />
            </span>
          </button>
        </div>

        <div className={styles.statsCell}>
          <div className={styles.stats}>
            <Stat label="ВВП" value="1,46T" delta={{ text: "+3,2%", tone: "good" }} labelMode="wide" />
            <Stat label="Баланс" value="+12,4B" delta={{ text: "+1,8B", tone: "good" }} labelMode="wide" />
            <Stat label="Население" value="170,5M" delta={{ text: "+0,6M", tone: "good" }} labelMode="wide" />
            <Stat label="Стабильность" value="71" delta={{ text: "−1", tone: "bad" }} labelMode="wide" />
            <Stat label="Легитимность" value="83" delta={{ text: "+2", tone: "good" }} labelMode="wide" />
            <Stat label="Долг" value="0,94" delta={{ text: "+0,03", tone: "bad" }} threshold="near" labelMode="wide" />
          </div>

          <ResourceBar items={RESOURCES} size="sm" />

          <div className={styles.books}>
            <Button size="sm" variant="quiet">Экономика</Button>
            <Button size="sm" variant="quiet">Политика</Button>
            <Button size="sm" variant="quiet">Оборона</Button>
            <Button size="sm" variant="quiet">Наука</Button>
            <Button size="sm" variant="quiet">Дипломатия</Button>
            <Button size="sm" variant="quiet">Цели</Button>
            <Button size="sm" variant="quiet">Реестры</Button>
          </div>
        </div>
        </div>
      </ShapedBar>

      {/* ── Правая колонка ─────────────────────────────────────── */}
      <div
        ref={columnRef}
        className={styles.rightColumn}
        style={feedWidth === null ? undefined : { width: `${feedWidth}px` }}
      >
        <button
          type="button"
          className={styles.resizer}
          aria-label="Ширина ленты"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />

        <div className={styles.turnBlock}>
          <Panel density="control">
            <div className={styles.turnMeta}>
              <span className={styles.date}>Март 1946</span>
              <span className={styles.modelState}>
                <span className={styles.modelDot} />
                режиссёр готов
              </span>
            </div>
            <Button variant="primary" size="lg" style={{ width: "100%", marginTop: "var(--space-2)" }}>
              Продолжить · 3 <IconArrowRight />
            </Button>
            <div className={styles.tools} style={{ marginTop: "var(--space-2)" }}>
              <Button size="sm" variant="default">Сохранить</Button>
              <Button size="sm" variant="default">Меню</Button>
              <Button size="sm" variant="default" iconOnly aria-label="Поиск">
                <IconSearch />
              </Button>
            </div>
          </Panel>
        </div>

        <Panel title="Этот ход" meta="5 событий" density="flush" scroll className={styles.feed}>
          <div className={styles.feedBody}>
            <EventItem
              date="5 марта"
              title="Речь в Фултоне"
              body="Черчилль говорил о железном занавесе, опустившемся от Штеттина до Триеста. Вашингтон промолчал, но не возразил."
              tags={[
                { id: "gbr", label: "Великобритания", kind: "country" },
                { id: "usa", label: "США", kind: "country" },
              ]}
              onTagClick={() => undefined}
            />
            <EventItem
              date="9 марта"
              title="Волнения в Сааремаа подавлены"
              body="Гарнизон занял портовый посёлок без стрельбы. Недовольство спало почти вдвое, но эстонские общины замкнулись."
              order={{ text: "Усилить контроль в Прибалтике, но без массовых репрессий" }}
              tags={[
                { id: "saare", label: "Сааремаа", kind: "region" },
                { id: "kuressaare", label: "Порт Курессааре", kind: "object" },
              ]}
              onTagClick={() => undefined}
            />
            <EventItem
              date="14 марта"
              title="Забастовки на верфях Марселя"
              body="Профсоюзы требуют пересмотра тарифов. Коммунисты в правительстве колеблются между поддержкой и порядком."
              factuality="partial"
              tags={[{ id: "fra", label: "Франция", kind: "country" }]}
              onTagClick={() => undefined}
            />
            <EventItem
              date="21 марта"
              title="Конструкторские бюро объединены"
              body="Три коллектива сведены под общее руководство. Первый эскизный проект обещан к осени."
              order={{ text: "Создать единое конструкторское бюро перспективной бронетехники" }}
            />
            <EventItem
              date="28 марта"
              title="Слухи о разладе в Политбюро"
              body="Иностранные корреспонденты пишут о споре вокруг сроков четвёртой пятилетки. Подтверждений нет."
              factuality="unconfirmed"
            />
          </div>
        </Panel>

        <Panel title="Режим карты" meta="Недовольство" density="control" className={styles.mapModes}>
          <div className={styles.modeList}>
            {MAP_MODES.map((mode) => (
              <Button key={mode} size="sm" variant={mode === "Недовольство" ? "order" : "quiet"}>
                {mode}
              </Button>
            ))}
          </div>
        </Panel>
      </div>

      {/* ── Нижняя стопка ──────────────────────────────────────── */}
      <div className={styles.bottom}>
        <div className={styles.regionStrip}>
          <span className={styles.regionName}>Сааремаа</span>
          <div className={styles.regionFacts}>
            <span className={styles.regionFact}>СССР</span>
            <span className={styles.regionFact}>21 тыс.</span>
            <span className={styles.regionFact}>эстонцы 87%</span>
            <span className={styles.regionFact}>недовольство 0,42</span>
          </div>
          <span className={styles.grow} />
          <Button size="sm" variant="quiet" iconOnly aria-label="Закрепить">
            <IconLock />
          </Button>
          <Button size="sm" variant="default">Подробно</Button>
        </div>

        <Panel title="Приказы" meta="март 1946 · составлено 2 из 10" density="control" className={styles.orders}>
          <ul className={styles.orderList}>
            <li>
              <div className={styles.regionFact}>1. Усилить контроль в Прибалтике, но без массовых репрессий</div>
            </li>
            <li>
              <div className={styles.regionFact}>2. Ускорить программу реактивной авиации</div>
            </li>
          </ul>
          <div className={styles.input} style={{ marginTop: "var(--space-2)" }}>
            <input className={styles.field} placeholder="Введите приказ…" />
            <Button variant="order" size="sm">Добавить</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
