import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Tag, type TagKind } from "../Tag/Tag";
import { cx } from "../cx";
import styles from "./EventItem.module.css";

/**
 * Степень подтверждённости приходит с сервера в квитанции события
 * (`Event.receipt.factuality`, docs/PRIMITIVES.md §3) и ВЫВОДИТСЯ движком из
 * чисел применённого и отклонённого — клиент её не вычисляет и не
 * интерпретирует, только показывает.
 */
export type Factuality = "confirmed" | "partial" | "unconfirmed";

export interface EventItemProps {
  /**
   * День события, уже отформатированный вызывающим. Лента группируется по
   * ходу, но месяц вмещает несколько остановок движка — «когда именно»
   * часть факта.
   */
  date?: string;
  title: ReactNode;
  body?: ReactNode;
  factuality?: Factuality;
  /**
   * Заполняется ТОЛЬКО когда движок знает связь как факт: событие несёт
   * применённый примитив, источником которого был приказ игрока. Косвенные
   * связи («мир ответил на твой шаг») сюда не попадают — их может утверждать
   * лишь модель, а её утверждения фактом не считаются.
   */
  order?: { text: string };
  /**
   * Ярлыки перехода: регион на карте, держава, объект. Заполняются из
   * ФАКТИЧЕСКИ применённого (затронутые регионы, страна-источник, созданный
   * объект), а не разбором текста модели — поэтому они есть не у каждого
   * события, и это правильно: чистый нарратив никуда не ведёт.
   */
  tags?: Array<{ id: string; label: string; kind: TagKind }>;
  onTagClick?: (id: string) => void;
}

export function EventItem({
  date,
  title,
  body,
  factuality = "confirmed",
  order,
  tags,
  onTagClick,
}: EventItemProps) {
  const { t } = useTranslation("ui");
  const [revealed, setRevealed] = useState(false);

  return (
    <article className={styles.item}>
      <div className={styles.gutter}>
        {order !== undefined && (
          <button
            type="button"
            className={styles.dot}
            onClick={() => setRevealed((open) => !open)}
            aria-expanded={revealed}
            aria-label={`${t("byOrder.mark")} — ${t("byOrder.reveal")}`}
          />
        )}
      </div>

      <div className={styles.content}>
        {date !== undefined && <time className={styles.date}>{date}</time>}
        <p className={styles.title}>{title}</p>
        {body !== undefined && <div className={styles.body}>{body}</div>}
        {tags !== undefined && tags.length > 0 && (
          <div className={styles.tags}>
            {tags.map((tag) => (
              <Tag
                key={tag.id}
                label={tag.label}
                kind={tag.kind}
                onClick={onTagClick === undefined ? undefined : () => onTagClick(tag.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.mark}>
        {factuality !== "confirmed" && (
          <span
            className={cx(styles.factuality, styles[factuality])}
            title={t(`factuality.${factuality}`)}
          >
            <span aria-hidden="true">{factuality === "partial" ? "~" : "?"}</span>
            <span className="sr-only">{t(`factuality.${factuality}`)}</span>
          </span>
        )}
      </div>

      {order !== undefined && revealed && (
        <div className={styles.reveal}>
          <p className={styles.orderText}>
            <span className={styles.orderPrefix}>{t("byOrder.prefix")}</span>
            {order.text}
          </p>
        </div>
      )}
    </article>
  );
}
