import { type ReactNode } from "react";
import styles from "./Stat.module.css";

export type StatTone = "neutral" | "ok" | "warn" | "crit";

export interface StatProps {
  icon: ReactNode;
  value: ReactNode;
  /**
   * Название стата — уходит только в title/aria-label, не рендерится текстом.
   * Список «не возвращать» (docs/plans/12_UI_REDESIGN.md §2): подписи у статов
   * в шапке не нужны, понятность даёт слой онбординга + tooltip, не текст.
   */
  label: string;
  tone?: StatTone;
  className?: string;
}

export function Stat({ icon, value, label, tone = "neutral", className }: StatProps) {
  const classes = [styles.stat, styles[tone], className].filter(Boolean).join(" ");
  return (
    <div className={classes} title={label} aria-label={label}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
