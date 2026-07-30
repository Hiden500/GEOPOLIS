import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../Tooltip/Tooltip";
import { cx } from "../cx";
import styles from "./Stat.module.css";

/**
 * Тон дельты задаёт ВЫЗЫВАЮЩИЙ, а не знак числа. Рост долга и рост ВВП —
 * оба «плюс», но один хороший, другой плохой; выводить тон из знака
 * значило бы красить дефолт зелёным.
 */
export type DeltaTone = "good" | "bad" | "neutral";
export type ThresholdState = "near" | "over";

export interface StatProps {
  /** Всегда обязателен: даже когда подпись скрыта, её читает скринридер. */
  label: string;
  /**
   * Значение приходит УЖЕ отформатированным. Клиент числа не пересчитывает
   * и не переформатирует — форматирует движок (docs/PRIMITIVES.md §3).
   */
  value: string;
  delta?: { text: string; tone: DeltaTone };
  threshold?: ThresholdState;
  icon?: ReactNode;
  size?: "md" | "lg";
  /** `wide` — подпись появляется только на широком окне (верхняя панель). */
  labelMode?: "always" | "wide" | "hidden";
  /** `table` — значение в колонке фиксированной ширины, подписи выравниваются. */
  layout?: "inline" | "table";
  onClick?: () => void;
  className?: string;
}

export function Stat({
  label,
  value,
  delta,
  threshold,
  icon,
  size = "md",
  labelMode = "always",
  layout = "inline",
  onClick,
  className,
}: StatProps) {
  const { t } = useTranslation("ui");

  const content = (
    <>
      {icon !== undefined && <span className={styles.icon}>{icon}</span>}
      <span className={styles.figures}>
        <span className={cx(styles.value, threshold && styles[threshold])}>
          {value}
          {threshold !== undefined && (
            <span className="sr-only"> ({t(`threshold.${threshold}`)})</span>
          )}
        </span>
        {delta !== undefined && (
          <span className={cx(styles.delta, styles[delta.tone])}>
            {delta.text}
            <span className="sr-only"> ({t(`delta.${delta.tone}`)})</span>
          </span>
        )}
      </span>
      {labelMode === "hidden" ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span className={cx(styles.label, labelMode === "wide" && styles.labelWide)}>{label}</span>
      )}
    </>
  );

  const rootClass = cx(styles.stat, styles[size], layout === "table" && styles.table, className);

  const body =
    onClick !== undefined ? (
      <button type="button" className={cx(rootClass, styles.interactive)} onClick={onClick}>
        {content}
      </button>
    ) : (
      <div className={rootClass}>{content}</div>
    );

  /*
   * Когда подпись скрыта, подсказка — единственный способ узнать, что это за
   * число, поэтому она системная (оформленная и читаемая), а не браузерная.
   * При видимой подписи подсказка была бы дублем.
   */
  return labelMode === "hidden" ? <Tooltip label={label}>{body}</Tooltip> : body;
}
