import { type ReactNode } from "react";
import styles from "./Chip.module.css";

export type ChipTone = "neutral" | "ok" | "warn" | "crit";

export interface ChipProps {
  icon?: ReactNode;
  code: string;
  value: ReactNode;
  /** Полное название — уходит в title (биржевой паттерн: код виден, имя по hover). */
  title: string;
  tone?: ChipTone;
  className?: string;
}

export function Chip({ icon, code, value, title, tone = "neutral", className }: ChipProps) {
  const classes = [styles.chip, styles[tone], className].filter(Boolean).join(" ");
  return (
    <span className={classes} title={title}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.code}>{code}</span>
      <span className={styles.value}>{value}</span>
    </span>
  );
}
