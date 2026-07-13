import { type ReactNode } from "react";
import styles from "./Panel.module.css";

export type PanelVariant = "default" | "raised";

export interface PanelProps {
  title?: ReactNode;
  children: ReactNode;
  variant?: PanelVariant;
  className?: string;
}

/**
 * Визуальная рамка карточки/секции (фон, граница, радиус, отступы).
 * Не отвечает за перетаскивание/ресайз — это поведение остаётся у Window.tsx
 * (Срез 2 сузит его до сценария «сравнить два объекта», docs/plans/12_UI_REDESIGN.md §4).
 */
export function Panel({ title, children, variant = "default", className }: PanelProps) {
  const classes = [styles.panel, styles[variant], className].filter(Boolean).join(" ");
  return (
    <section className={classes}>
      {title && <h3 className={styles.title}>{title}</h3>}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
