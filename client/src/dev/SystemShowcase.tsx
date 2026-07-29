import { Button, EventItem, OrderCard, Panel, Stat, TechScale } from "../ui";
import styles from "./SystemShowcase.module.css";

/**
 * Витрина дизайн-системы. Открывается вне игрового потока через
 * ?showcase=ui (main.tsx) — живая документация системы и место, где видно
 * все состояния сразу, до того как появятся экраны.
 *
 * Подписи здесь намеренно без i18n: это инструмент разработки, а не
 * интерфейс игрока (тот же приём, что у существующей PrimitivesShowcase).
 */

const SURFACES = [
  ["--surface", "панель"],
  ["--surface-raised", "вложенный блок"],
  ["--surface-sunken", "фон приложения"],
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
  ["--text-2xl", "34px", "Заголовок кампании"],
  ["--text-xl", "24px", "Крупный показатель"],
  ["--text-lg", "18px", "Показатель"],
  ["--text-md", "15px", "Интерфейсный текст"],
  ["--text-sm", "13px", "Нарратив и списки"],
  ["--text-xs", "11px", "Ярлыки и дельты"],
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

export function SystemShowcase() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Дизайн-система</h1>
      <p className={styles.subheading}>
        Пересборка интерфейса · тема 1946 (data-era=&quot;1946&quot;) · desktop-контракт 1366×768
      </p>

      {/* ── Цвет ─────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Цвет</h2>
        <p className={styles.note}>
          Цвет принадлежит карте: восьми режимам раскраски нужно много различимых оттенков,
          поэтому хрома почти бесцветна. Цветов смысла ровно пять — шестой обязан объяснить,
          какого смысла ему не хватило среди этих.
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
          Шесть ступеней, седьмой нет. IBM Plex Sans закрывает показатели, ярлыки и интерфейс —
          у него полная кириллица и табличные цифры. Нарратив пока набирается той же гарнитурой
          и отличается размером, интерлиньяжем и шириной колонки.
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
          Всё кратно четырём. Значений между ступенями не бывает: как только появляется 10px,
          шкала перестаёт держать ритм.
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
          Один контейнер на всё: том, реестр, лента, лист приказов и полоса региона — это одна
          панель с разным содержимым. Плотность выбирается по содержимому, а не по вкусу.
        </p>
        <div className={styles.panels}>
          <Panel title="Приборы" density="instrument">
            <div className={styles.row} style={{ marginBottom: 0 }}>
              <Stat label="ВВП" value="1,46T" delta={{ text: "+3,2%", tone: "good" }} />
              <Stat label="Долг" value="0,94" delta={{ text: "+0,03", tone: "bad" }} threshold="near" />
            </div>
          </Panel>

          <Panel title="Управление" meta="плотность control" density="control">
            <div className={styles.row} style={{ marginBottom: 0 }}>
              <Button variant="order" size="sm">
                Подавить
              </Button>
              <Button variant="order" size="sm">
                Уступить
              </Button>
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
          <Button variant="primary" size="lg">
            Кнопка хода
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>недоступна</span>
          <Button variant="primary" disabled>
            Режиссёр думает…
          </Button>
          <Button variant="default" disabled>
            Обычная
          </Button>
          <Button variant="order" disabled>
            Подавить
          </Button>
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
          Слева — откуда событие взялось, справа — насколько подтверждено. Левая колонка отведена
          всегда, поэтому точки складываются в ряд и месяц читается одним взглядом. Точка нажимается:
          показывает, какой именно приказ это породил.
        </p>
        <div className={styles.narrow}>
          <Panel title="Этот ход" meta="март 1946" density="flush">
            <div style={{ padding: "0 var(--space-3)" }}>
              <EventItem
                title="Волнения в Сааремаа подавлены"
                body="Эстонские общины замкнулись: недовольство спало, отчуждение выросло."
                order={{ text: "Усилить контроль в Прибалтике, но без массовых репрессий" }}
              />
              <EventItem title="Фултонская речь" />
              <EventItem title="Забастовки во Франции" factuality="partial" />
              <EventItem title="Слухи о разладе в Политбюро" factuality="unconfirmed" />
            </div>
          </Panel>
        </div>
      </section>

      {/* ── Шкала техники ────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Шкала техники</h2>
        <p className={styles.note}>
          Дерева нет: игрок не выбирает узлы, он двигает фокус по доменам. Драма в разрыве между
          «умею проектировать» и «есть в парке» — разрыв виден как пустота, и он стоит денег.
        </p>
        <div className={styles.wide}>
          <Panel title="Оборона" meta="слоты и парк" density="control">
            <TechScale name="Средний танк" generations={6} readiness={3} capability={4} />
            <TechScale name="Тактическая авиация" generations={6} readiness={2} capability={4} />
            <TechScale name="Эсминец" generations={6} readiness={4} capability={4} />
            <TechScale name="Ракета средней дальности" generations={6} readiness={2} capability={5} forbiddenFrom={3} />
            <TechScale
              name="Стратегический бомбардировщик"
              generations={6}
              readiness={3}
              capability={3}
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
