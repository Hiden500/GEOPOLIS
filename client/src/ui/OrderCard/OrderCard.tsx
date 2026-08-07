import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../Button/Button";
import { IconClose, IconDrag } from "../icons";
import { cx } from "../cx";
import styles from "./OrderCard.module.css";

export interface OrderCardProps {
  /** Ровно то, что написал игрок. Клиент текст не переписывает. */
  text: string;
  /** Порядковый номер: приказы применяются сверху вниз. */
  index: number;
  onRemove?: () => void;
}

export function OrderCard({ text, index, onRemove }: OrderCardProps) {
  const { t } = useTranslation("ui");
  const textRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);

  /*
   * Кнопку «развернуть» показываем только когда текст реально не помещается:
   * иначе у каждого однострочного приказа висел бы мёртвый переключатель.
   */
  useLayoutEffect(() => {
    const node = textRef.current;
    if (node === null) return;
    setClampable(node.scrollHeight > node.clientHeight + 1);
  }, [text]);

  return (
    <li className={styles.card}>
      <span className={styles.handle} title={t("order.drag")} aria-hidden="true">
        <IconDrag />
      </span>

      <div>
        <p ref={textRef} className={cx(styles.text, !expanded && styles.clamped)}>
          <span className={styles.index}>{index}. </span>
          {text}
        </p>
        {(clampable || expanded) && (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? t("order.collapse") : t("order.expand")}
          </button>
        )}
      </div>

      {onRemove !== undefined && (
        <Button variant="quiet" size="sm" iconOnly onClick={onRemove} aria-label={t("order.remove")}>
          <IconClose />
        </Button>
      )}
    </li>
  );
}
