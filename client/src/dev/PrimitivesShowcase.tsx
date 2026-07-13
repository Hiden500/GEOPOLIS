import { Button, Chip, IconButton, Legend, Meter, Panel, Stat, Tag } from "../primitives";
import styles from "./PrimitivesShowcase.module.css";

const TONES = ["neutral", "ok", "warn", "crit"] as const;

/**
 * Витрина примитивов (Срез 1, docs/plans/12_UI_REDESIGN.md §4). Открывается
 * отдельно от игры через ?showcase=primitives (main.tsx) — не часть игрового
 * потока, только для визуального QA и как живая документация примитивов.
 */
export function PrimitivesShowcase() {
  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Примитивы — витрина</h1>
      <p className={styles.subheading}>
        Срез 1, docs/plans/12_UI_REDESIGN.md · тема 1946 (data-era="1946")
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Button</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>variant</span>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>size</span>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>disabled</span>
          <Button variant="primary" disabled>
            Primary
          </Button>
          <Button variant="secondary" disabled>
            Secondary
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>focus</span>
          <Button variant="secondary" autoFocus>
            Tab сюда попадёт первым
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>IconButton</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>state</span>
          <IconButton aria-label="Обычная">⚙</IconButton>
          <IconButton aria-label="Активная" active>
            ⚙
          </IconButton>
          <IconButton aria-label="Недоступна" disabled>
            ⚙
          </IconButton>
          <IconButton aria-label="Маленькая" size="sm">
            ⚙
          </IconButton>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Stat (только icon+value, подпись — в title/aria)</h2>
        <div className={styles.row}>
          {TONES.map((tone) => (
            <Stat key={tone} icon="💰" value="1 280" label={`Казна (${tone})`} tone={tone} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Chip</h2>
        <div className={styles.row}>
          {TONES.map((tone) => (
            <Chip key={tone} icon="🛢️" code="OIL" value="42.3K" title={`Нефть (${tone})`} tone={tone} />
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Panel</h2>
        <div className={styles.panelGrid}>
          <Panel title="Default">
            <p>Базовая карточка секции.</p>
          </Panel>
          <Panel title="Raised" variant="raised">
            <p>Приподнятый вариант — чуть светлее фон.</p>
          </Panel>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Meter</h2>
        <div className={styles.meterRow}>
          <Meter value={72} label="Стабильность (neutral)" />
        </div>
        <div className={styles.meterRow}>
          <Meter value={90} tone="ok" label="Легитимность (ok)" />
        </div>
        <div className={styles.meterRow}>
          <Meter value={55} tone="warn" label="Коррупция (warn)" />
        </div>
        <div className={styles.meterRow}>
          <Meter value={12} tone="crit" label="Госдолг/ВВП (crit)" />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Tag</h2>
        <div className={styles.row}>
          <span className={styles.rowLabel}>pill</span>
          {TONES.map((tone) => (
            <Tag key={tone} tone={tone} variant="pill">
              {tone}
            </Tag>
          ))}
          <Tag tone="accent" variant="pill">
            accent
          </Tag>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>stamp</span>
          <Tag variant="stamp" tone="ok">
            Готово
          </Tag>
          <Tag variant="stamp" tone="crit">
            Тревога
          </Tag>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Legend</h2>
        <Legend
          title="Политический режим"
          items={[
            { swatch: "#7aa653", label: "Демократия" },
            { swatch: "#c9762a", label: "Авторитаризм" },
            { swatch: "#cf4436", label: "Военная хунта" },
          ]}
        />
      </section>
    </div>
  );
}
