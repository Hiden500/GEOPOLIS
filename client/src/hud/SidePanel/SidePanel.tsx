import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type BookId } from "../types";
import { IconClose } from "../icons";
import styles from "./SidePanel.module.css";

export interface SidePanelProps {
  book: BookId | null;
  countryName: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Выдвижная левая панель — основной способ показать раздел ("книгу")
 * (docs/plans/12_UI_REDESIGN.md §1). Остаётся в DOM и при закрытии (только
 * translateX за экран, как в эталоне) — держит последний открытый раздел на
 * время анимации закрытия, не схлопывается в пустоту.
 */
export function SidePanel({ book, countryName, onClose, children }: SidePanelProps) {
  const { t } = useTranslation("hud");

  // "Adjusting state when a prop changes" во время рендера, не в эффекте
  // (react-hooks/set-state-in-effect) — держит последнюю открытую книгу на
  // время transform-анимации закрытия, не даёт панели схлопнуться в пустоту.
  const [displayedBook, setDisplayedBook] = useState<BookId | null>(book);
  const [prevBook, setPrevBook] = useState<BookId | null>(book);
  if (book !== prevBook) {
    setPrevBook(book);
    if (book !== null) setDisplayedBook(book);
  }

  const open = book !== null;

  return (
    <section
      className={`${styles.panel} ${open ? styles.open : ""}`}
      aria-labelledby="side-panel-title"
      aria-hidden={!open}
      inert={!open}
    >
      <div className={styles.head}>
        <div>
          <div className={styles.sub}>
            {t("panel.stateLabel")} · {countryName}
          </div>
          <h2 id="side-panel-title" className={styles.title}>
            {displayedBook ? t(`tabs.${displayedBook}`) : ""}
          </h2>
        </div>
        <button type="button" className={styles.close} aria-label={t("panel.close")} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
