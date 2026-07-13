import styles from "./Legend.module.css";

export interface LegendItem {
  swatch: string;
  label: string;
}

export interface LegendProps {
  items: LegendItem[];
  title?: string;
  className?: string;
}

/**
 * Список цвет+подпись — mapmodes/легенда карты (Срез 2, docs/plans/12_UI_REDESIGN.md §1).
 * Сейчас нет живого потребителя, примитив готов заранее под каркас HUD.
 */
export function Legend({ items, title, className }: LegendProps) {
  const classes = [styles.legend, className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {title && <div className={styles.title}>{title}</div>}
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.label} className={styles.item}>
            <span className={styles.swatch} style={{ backgroundColor: item.swatch }} aria-hidden="true" />
            <span className={styles.label}>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
