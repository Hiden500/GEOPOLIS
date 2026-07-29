import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, EventItem, OrderCard, Panel, ResourceBar, Stat, TechScale } from "../ui";
import styles from "./SystemShowcase.module.css";

/**
 * Витрина дизайн-системы. Открывается вне игрового потока через
 * ?showcase=ui (main.tsx) — живая документация системы и место, где видно
 * все состояния сразу.
 *
 * Подписи здесь намеренно без i18n: это инструмент разработки, а не
 * интерфейс игрока (тот же приём, что у существующей PrimitivesShowcase).
 */

const PALETTES = [
  { id: "graphite", name: "Графит", note: "нейтральный серый · бирюза" },
  { id: "steel", name: "Сталь", note: "холодный серый · голубой" },
  { id: "ink", name: "Тушь", note: "почти чёрный · индиго" },
  { id: "khaki", name: "Хаки", note: "тёплый серый · латунь" },
] as const;

const SCALES = ["auto", "1", "1.15", "1.25", "1.4"] as const;

const SURFACES = [
  ["--surface-sunken", "фон приложения"],
  ["--surface", "панель"],
  ["--surface-raised", "вложенный блок"],
  ["--divider", "разделитель"],
] as const;

const MEANING = [
  ["--accent", "выделено, активно"],
  ["--rise", "рост"],
  ["--fall", "падение"],
  ["--near", "у порога"],
  ["--over", "за порогом"],
] as const;

const TEXT = [
  ["--text", "основной"],
  ["--text-dim", "второстепенный"],
  ["--text-faint", "погашенный"],
] as const;

const TYPE_SCALE = [
  ["--text-2xl", "34", "Заголовок кампании"],
  ["--text-xl", "24", "Крупный показатель"],
  ["--text-lg", "18", "Показатель"],
  ["--text-md", "15", "Интерфейс и нарратив"],
  ["--text-sm", "13", "Списки и приписки"],
  ["--text-xs", "11", "Ярлыки и дельты"],
] as const;

const SPACE_SCALE = [
  ["--space-1", 4],
  ["--space-2", 8],
  ["--space-3", 12],
  ["--space-4", 16],
  ["--space-5", 24],
  ["--space-6", 32],
  ["--space-7", 48],
] as const;

const RESOURCES = [
  { id: "coal", label: "Уголь", amount: "412", delta: { text: "+8", tone: "good" as const } },
  { id: "oil", label: "Нефть", amount: "96", delta: { text: "−4", tone: "bad" as const } },
  { id: "steel", label: "Сталь", amount: "188", delta: { text: "+2", tone: "good" as const } },
  { id: "alu", label: "Алюминий", amount: "54", delta: { text: "+1", tone: "good" as const } },
  { id: "rubber", label: "Каучук", amount: "7", delta: { text: "−1", tone: "bad" as const }, shortage: true },
  { id: "tungsten", label: "Вольфрам", amount: "3", delta: { text: "0", tone: "neutral" as const }, shortage: true },
];

function Swatches({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className={styles.grid}>
      {items.map(([token, role]) => (
        <div key={token} className={styles.swatch}>
          <span className={styles.chip} style={{ background: `var(${token})` }} />
          <span>
            <span className={styles.swatchName}>{token}</span>
            <span className={styles.swatchRole}>{role}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Макет экрана показывается в iframe НАСТОЯЩЕГО размера, уменьшенном
 * трансформацией. Отрисовать его просто в уменьшенном блоке нельзя:
 * медиазапросы и автомасштаб читают ширину окна, и раскладка 1366 внутри
 * страницы 1920 оказалась бы враньём.
 */
function ScreenFrame({
  width,
  height,
  label,
  palette,
  scale,
}: {
  width: number;
  height: number;
  label: string;
  palette: string;
  scale: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [factor, setFactor] = useState(1);

  useLayoutEffect(() => {
    const node = holder.current;
    if (node === null) return;
    const measure = () => setFactor(Math.min(1, node.clientWidth / width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);

  const src = `/?showcase=screen&palette=${palette}${scale === "auto" ? "" : `&scale=${scale}`}`;

  return (
    <figure className={styles.screen}>
      <figcaption className={styles.screenLabel}>
        {label} <span className={styles.screenZoom}>· показан в {Math.round(factor * 100)}%</span>
      </figcaption>
      <div ref={holder} className={styles.screenHolder} style={{ height: height * factor }}>
        <iframe
          className={styles.screenFrame}
          title={label}
          src={src}
          style={{ width, height, transform: `scale(${factor})` }}
        />
      </div>
    </figure>
  );
}

export function SystemShowcase() {
  const [palette, setPalette] = useState<string>("graphite");
  const [scale, setScale] = useState<string>("auto");

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
  }, [palette]);

  useEffect(() => {
    if (scale === "auto") document.documentElement.style.removeProperty("--ui-scale");
    else document.documentElement.style.setProperty("--ui-scale", scale);
  }, [scale]);

  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Палитра</span>
          {PALETTES.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={item.id === palette ? "order" : "quiet"}
              onClick={() => setPalette(item.id)}
              title={item.note}
            >
              {item.name}
            </Button>
          ))}
        </div>
        <div className={styles.controlGroup}>
          <span className={styles.controlLabel}>Масштаб</span>
          {SCALES.map((item) => (
            <Button
              key={item}
              size="sm"
              variant={item === scale ? "order" : "quiet"}
              onClick={() => setScale(item)}
            >
              {item === "auto" ? "авто" : `×${item}`}
            </Button>
          ))}
        </div>
      </div>

      <h1 className={styles.heading}>Дизайн-система</h1>
      <p className={styles.subheading}>
        Пересборка интерфейса · эпоха 1946 · палитра «{PALETTES.find((p) => p.id === palette)?.name}»
      </p>

      {/* ── Экран ────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Экран целиком</h2>
        <p className={styles.note}>
          Оба макета — настоящие окна выбранного размера, уменьшенные для страницы. Автомасштаб,
          медиазапросы и подписи у показателей отрабатывают от собственной ширины окна, а не от
          страницы витрины. Ленту справа можно тянуть за левый край.
        </p>
        <div className={styles.screens}>
          <ScreenFrame width={1366} height={768} label="1366 × 768" palette={palette} scale={scale} />
          <ScreenFrame width={1920} height={1080} label="1920 × 1080" palette={palette} scale={scale} />
        </div>
      </section>

      {/* ── Цвет ─────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Цвет</h2>
        <p className={styles.note}>
          Подложка во всех палитрах нейтральная: цветной фон конкурирует с раскраской карты и заодно
          красит все панели в свой оттенок. Цветов смысла ровно пять, и акцент нигде не совпадает по
          тону с порогом — иначе «активное» и «тревожное» читаются одинаково.
        </p>
        <div className={styles.row}>
          <span className={styles.rowLabel}>поверхности</span>
        </div>
        <Swatches items={SURFACES} />
        <div className={styles.row} style={{ marginTop: "var(--space-4)" }}>
          <span className={styles.rowLabel}>смысл</span>
        </div>
        <Swatches items={MEANING} />
        <div className={styles.row} style={{ marginTop: "var(--space-4)" }}>
          <span className={styles.rowLabel}>текст</span>
        </div>
        <Swatches items={TEXT} />
      </section>

      {/* ── Типографика ──────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Типографика</h2>
        <p className={styles.note}>
          Шесть ступеней, седьмой нет. Размеры заданы в rem и умножаются на масштаб интерфейса —
          поэтому 4K лечится одним числом, а не правкой сотни значений. Цифры в подписи ниже — это
          размер при масштабе 1.
        </p>
        {TYPE_SCALE.map(([token, size, sample]) => (
          <div key={token} className={styles.typeRow}>
            <span className={styles.typeMeta}>
              {token} · {size}
            </span>
            <span style={{ fontSize: `var(${token})` }}>{sample} · 1 946 · 1,46T</span>
          </div>
        ))}
      </section>

      {/* ── Отступы ──────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Отступы</h2>
        <p className={styles.note}>
          Всё кратно четырём при масштабе 1. Значений между ступенями не бывает: как только
          появляется 10px, шкала перестаёт держать ритм.
        </p>
        {SPACE_SCALE.map(([token, px]) => (
          <div key={token} className={styles.spaceRow}>
            <span className={styles.spaceName}>
              {token} · {px}
            </span>
            <span className={styles.spaceBar} style={{ width: `var(${token})` }} />
          </div>
        ))}
      </section>

      {/* ── Панель ───────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Панель</h2>
        <p className={styles.note}>
          Один контейнер на всё: том, реестр, лента, лист приказов и полоса региона — это одна панель
          с разным содержимым. Плотность выбирается по содержимому, а не по вкусу.
        </p>
        <div className={styles.panels}>
          <Panel title="Приборы" density="instrument">
            <div className={styles.row} style={{ marginBottom: 0 }}>
              <Stat label="ВВП" value="1,46T" delta={{ text: "+3,2%", tone: "good" }} />
              <Stat label="Долг" value="0,94" delta={{ text: "+0,03", tone: "bad" }} threshold="near" />
            </div>
          </Panel>

          <Panel title="Управление" meta="control" density="control">
            <div className={styles.row} style={{ marginBottom: 0 }}>
              <Button variant="order" size="sm">Подавить</Button>
              <Button variant="order" size="sm">Уступить</Button>
            </div>
          </Panel>

          <Panel title="Текст" density="prose" onClose={() => undefined}>
            <p className={styles.prose}>
              Речь в Фултоне произнесена. Отношения с Британией ухудшились, а нейтральные державы
              впервые заговорили о двух лагерях вслух.
            </p>
          </Panel>
        </div>
      </section>

      {/* ── Ресурсы ──────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Ресурсы</h2>
        <p className={styles.note}>
          Главное здесь не число, а гейт: сырьё потребляется бинарно — нет ключевого ресурса, и слот
          техники просто не производится. Поэтому дефицит это отдельное состояние, а не «плохая
          дельта»: запас вольфрама не падает, но производство всё равно встанет.
        </p>
        <div className={styles.row}>
          <span className={styles.rowLabel}>строкой</span>
        </div>
        <ResourceBar items={RESOURCES} />
        <div className={styles.narrow} style={{ marginTop: "var(--space-4)" }}>
          <Panel title="Сырьё" meta="запас и приход за месяц" density="control">
            <ResourceBar items={RESOURCES} layout="list" />
          </Panel>
        </div>
      </section>

      {/* ── Кнопки ───────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Кнопки</h2>
        <p className={styles.note}>
          Кнопка — механизм: нажал, произойдёт ровно это. Противоположный канал — поле свободного
          текста, где происходит то, как тебя поняли. Заливку акцентом на экране носит ровно одна
          кнопка, сейчас это кнопка хода.
        </p>
        <div className={styles.row}>
          <span className={styles.rowLabel}>вариант</span>
          <Button variant="primary">Продолжить · 3</Button>
          <Button variant="default">Обычная</Button>
          <Button variant="quiet">Тихая</Button>
          <Button variant="danger">Объявить войну</Button>
          <Button variant="order">Подавить</Button>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>размер</span>
          <Button size="sm">Малая</Button>
          <Button size="md">Средняя</Button>
          <Button variant="primary" size="lg">Кнопка хода</Button>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>недоступна</span>
          <Button variant="primary" disabled>Режиссёр думает…</Button>
          <Button variant="default" disabled>Обычная</Button>
          <Button variant="order" disabled>Подавить</Button>
        </div>
      </section>

      {/* ── Показатель ───────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Показатель</h2>
        <p className={styles.note}>
          Два независимых сигнала не делят один канал: направление изменения красит дельту,
          состояние относительно порога подчёркивает значение. Иначе долг растёт зелёными шагами
          прямо к дефолту.
        </p>
        <div className={styles.row}>
          <span className={styles.rowLabel}>в норме</span>
          <Stat label="ВВП" value="1,46T" delta={{ text: "+3,2%", tone: "good" }} size="lg" />
          <Stat label="Население" value="170,5M" delta={{ text: "+0,6M", tone: "good" }} size="lg" />
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>у порога</span>
          <Stat label="Безработица" value="9,4%" delta={{ text: "+0,8", tone: "bad" }} threshold="near" size="lg" />
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>за порогом</span>
          <Stat label="Дефицит" value="−12,4%" delta={{ text: "−1,8", tone: "bad" }} threshold="over" size="lg" />
          <Stat label="Промвыпуск" value="28%" delta={{ text: "+2", tone: "good" }} threshold="over" size="lg" />
        </div>
      </section>

      {/* ── Событие ──────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Событие</h2>
        <p className={styles.note}>
          Слева — откуда событие взялось, справа — насколько подтверждено, снизу — ярлыки перехода:
          к региону на карте, к державе, к объекту. Ярлыки ставит движок из фактически применённого,
          поэтому они есть не у каждого события: чистый нарратив никуда не ведёт.
        </p>
        <div className={styles.feed}>
          <Panel title="Этот ход" meta="март 1946" density="flush">
            <div style={{ padding: "0 var(--space-3)" }}>
              <EventItem
                date="5 марта"
                title="Речь в Фултоне"
                body="Черчилль говорил о железном занавесе, опустившемся от Штеттина до Триеста. Вашингтон промолчал, но не возразил. Нейтральные столицы впервые обсуждают два лагеря вслух."
                tags={[
                  { id: "gbr", label: "Великобритания", kind: "country" },
                  { id: "usa", label: "США", kind: "country" },
                ]}
                onTagClick={() => undefined}
              />
              <EventItem
                date="9 марта"
                title="Волнения в Сааремаа подавлены"
                body="Гарнизон занял портовый посёлок без стрельбы. Недовольство спало почти вдвое, но эстонские общины замкнулись: отчуждение выросло, и следующая уступка будет стоить дороже."
                order={{ text: "Усилить контроль в Прибалтике, но без массовых репрессий" }}
                tags={[
                  { id: "saare", label: "Сааремаа", kind: "region" },
                  { id: "port", label: "Порт Курессааре", kind: "object" },
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
                body="Три коллектива сведены под общее руководство. Первый эскизный проект перспективного среднего танка обещан к осени."
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
        </div>
      </section>

      {/* ── Шкала техники ────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Шкала техники</h2>
        <p className={styles.note}>
          Дерева нет: игрок не выбирает узлы, он двигает фокус по доменам. Драма в разрыве между
          «умею проектировать» и «есть в парке». Количество стоит отдельной колонкой: триста
          устаревших танков и три современных — разные державы при похожей шкале.
        </p>
        <div className={styles.wide}>
          <Panel title="Оборона" meta="слоты, парк и количество" density="control">
            <TechScale name="Средний танк" generations={6} readiness={3} capability={4} count="4 120" />
            <TechScale name="Тактическая авиация" generations={6} readiness={2} capability={4} count="2 380" />
            <TechScale name="Эсминец" generations={6} readiness={4} capability={4} count="34" />
            <TechScale name="Ракета средней дальности" generations={6} readiness={2} capability={5} count="0" forbiddenFrom={3} />
            <TechScale
              name="Стратегический бомбардировщик"
              generations={6}
              readiness={3}
              capability={3}
              count="210"
              rival={{ label: "США", readiness: 5 }}
            />
          </Panel>
        </div>
      </section>

      {/* ── Карточка приказа ─────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Карточка приказа</h2>
        <p className={styles.note}>
          Только слова игрока — результата здесь нет: приказы уходят пачкой при нажатии
          «Продолжить», и до этого момента ничего не произошло. Порядок значим, поэтому у карточки
          есть ручка перетаскивания.
        </p>
        <div className={styles.narrow}>
          <Panel title="Приказы" meta="март 1946 · составлено 3 из 10" density="control">
            <ul className={styles.list}>
              <OrderCard index={1} text="Усилить контроль в Прибалтике, но без массовых репрессий" onRemove={() => undefined} />
              <OrderCard index={2} text="Ускорить программу реактивной авиации" onRemove={() => undefined} />
              <OrderCard
                index={3}
                text="Создать единое конструкторское бюро перспективной бронетехники. Начать разработку нового среднего танка следующего поколения. Приоритеты: стабилизатор вооружения, ночные приборы наблюдения, дальномер, повышение точности огня на ходу. Все новые разработки завершить не позднее 1956 года."
                onRemove={() => undefined}
              />
            </ul>
          </Panel>
        </div>
      </section>
    </div>
  );
}
