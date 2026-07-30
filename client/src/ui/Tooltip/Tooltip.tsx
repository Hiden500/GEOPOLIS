import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  /** Текст подсказки. */
  label: string;
  children: ReactNode;
  className?: string;
}

interface Anchor {
  cx: number;
  top: number;
  bottom: number;
}

const GAP = 8;

/**
 * Подсказка при наведении и при фокусе с клавиатуры.
 *
 * Появляется и от фокуса тоже: иконка без подписи, доступная только мышью,
 * необучаема с клавиатуры — а по спискам и таблицам игры без клавиатуры не
 * пройти.
 *
 * Положение считается в ДВА шага: сначала запоминается место элемента, затем
 * пузырёк измеряется и зажимается в окно по своей фактической ширине.
 * Прикидка «зажать центр на 100px от края» не работает: ширина пузырька
 * зависит от текста, и у крайних иконок он уезжал за край.
 */
export function Tooltip({ label, children, className }: TooltipProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    const node = hostRef.current;
    if (node === null) return;
    const box = node.getBoundingClientRect();
    setAnchor({ cx: box.left + box.width / 2, top: box.top, bottom: box.bottom });
    setPlace(null);
  }, []);

  const hide = useCallback(() => {
    setAnchor(null);
    setPlace(null);
  }, []);

  useLayoutEffect(() => {
    if (anchor === null) return;
    const bubble = bubbleRef.current;
    if (bubble === null) return;
    const box = bubble.getBoundingClientRect();

    const half = box.width / 2;
    const left = Math.min(Math.max(anchor.cx, half + GAP), window.innerWidth - half - GAP);
    // Не хватает места внизу — переворачиваем вверх, а не упираемся в край.
    const below = anchor.bottom + GAP;
    const top = below + box.height > window.innerHeight - GAP ? anchor.top - box.height - GAP : below;

    setPlace({ left, top });
  }, [anchor, label]);

  return (
    <span
      ref={hostRef}
      className={cx(styles.wrap, className)}
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {anchor !== null && (
        <span
          ref={bubbleRef}
          className={styles.bubble}
          role="tooltip"
          style={
            place === null
              ? // Первый кадр: пузырёк уже в потоке, но невидим — иначе он
                // мигнёт в неверном месте до замера.
                { left: 0, top: 0, visibility: "hidden" }
              : { left: place.left, top: place.top }
          }
        >
          {label}
        </span>
      )}
    </span>
  );
}
