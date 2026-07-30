import { useCallback, useRef, useState, type ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  /** Текст подсказки. Он же уходит в aria-label обёртки. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Подсказка при наведении и при фокусе с клавиатуры.
 *
 * Появляется и от фокуса тоже: иконка без подписи, доступная только мышью,
 * необучаема с клавиатуры — а по спискам и таблицам игры без клавиатуры не
 * пройти.
 */
export function Tooltip({ label, children, className }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  const show = useCallback(() => {
    const node = ref.current;
    if (node === null) return;
    const box = node.getBoundingClientRect();
    // Центр зажимается в окно: у крайней иконки пузырёк иначе уезжает за край.
    const x = Math.min(Math.max(box.left + box.width / 2, 100), window.innerWidth - 100);
    setPoint({ x, y: box.bottom + 8 });
  }, []);

  const hide = useCallback(() => setPoint(null), []);

  return (
    <span
      ref={ref}
      className={cx(styles.wrap, className)}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {point !== null && (
        <span className={styles.bubble} style={{ left: point.x, top: point.y }} role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}
