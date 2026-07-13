import { type ReactNode } from "react";
import styles from "./Tag.module.css";

export type TagTone = "neutral" | "ok" | "warn" | "crit" | "accent";
export type TagVariant = "pill" | "stamp";

export interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  /** "stamp" — канцелярский штамп с поворотом (статусные пометки), "pill" — обычная метка. */
  variant?: TagVariant;
  className?: string;
}

export function Tag({ children, tone = "neutral", variant = "pill", className }: TagProps) {
  const classes = [styles.tag, styles[variant], styles[tone], className].filter(Boolean).join(" ");
  return <span className={classes}>{children}</span>;
}
