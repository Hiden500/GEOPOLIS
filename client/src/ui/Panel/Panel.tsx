import type { HTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../Button/Button";
import { IconClose } from "../icons";
import { cx } from "../cx";
import styles from "./Panel.module.css";

/**
 * Плотность выбирается по содержимому, а не по вкусу:
 * `instrument` — числа и таблицы, читают взглядом;
 * `control` — кнопки, поля, вкладки, ловят курсором;
 * `prose` — нарратив и приказы, читают абзацами;
 * `flush` — содержимое само отвечает за поля (списки во всю ширину).
 */
export type PanelDensity = "instrument" | "control" | "prose" | "flush";

export interface PanelProps {
  title?: ReactNode;
  /** Мелкая приписка рядом с заголовком: месяц, счётчик, статус. */
  meta?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  density?: PanelDensity;
  /** Прокрутка внутри панели, а не рост наружу. */
  scroll?: boolean;
  className?: string;
  bodyClassName?: string;
  /** Атрибуты шапки: за неё таскают окно, поэтому обработчики нужны именно там. */
  headerProps?: HTMLAttributes<HTMLElement>;
  children: ReactNode;
}

export function Panel({
  title,
  meta,
  actions,
  onClose,
  density = "control",
  scroll = false,
  className,
  bodyClassName,
  headerProps,
  children,
}: PanelProps) {
  const { t } = useTranslation("ui");
  const hasHeader = title !== undefined || meta !== undefined || actions !== undefined || onClose !== undefined;

  return (
    <section className={cx(styles.panel, className)}>
      {hasHeader && (
        <header {...headerProps} className={cx(styles.header, headerProps?.className)}>
          {title !== undefined && <h2 className={styles.title}>{title}</h2>}
          {meta !== undefined && <span className={styles.meta}>{meta}</span>}
          <span className={styles.spacer} />
          {actions}
          {onClose !== undefined && (
            <Button variant="quiet" size="sm" iconOnly onClick={onClose} aria-label={t("close")}>
              <IconClose />
            </Button>
          )}
        </header>
      )}
      <div className={cx(styles.body, styles[density], scroll && styles.scroll, bodyClassName)}>
        {children}
      </div>
    </section>
  );
}
