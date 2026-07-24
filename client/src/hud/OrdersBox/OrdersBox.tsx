import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconOrders } from "../icons";
import styles from "./OrdersBox.module.css";

export interface OrdersBoxProps {
  children: ReactNode;
}

/**
 * Окно приказов — левый нижний угол, сворачивается
 * (docs/plans/12_UI_REDESIGN.md §1). Оборачивает PlayerIntentPanel (реальная
 * логика @mention-автокомплита и сохранения не меняется, только новая рамка).
 */
export function OrdersBox({ children }: OrdersBoxProps) {
  const { t } = useTranslation("hud");
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className={styles.orders} aria-label={t("orders.title")} data-onboarding="orders">
      <button
        type="button"
        className={styles.head}
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
      >
        <span className={styles.headTitle}>
          <IconOrders className={styles.headIcon} />
          {t("orders.title")}
        </span>
        <span className={`${styles.chev} ${collapsed ? styles.chevCollapsed : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>
      {!collapsed && <div className={styles.body}>{children}</div>}
    </section>
  );
}
