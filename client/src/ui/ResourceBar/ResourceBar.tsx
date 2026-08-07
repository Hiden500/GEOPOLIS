import { useTranslation } from "react-i18next";
import { IconWarning } from "../icons";
import { cx } from "../cx";
import type { DeltaTone } from "../Stat/Stat";
import styles from "./ResourceBar.module.css";

export interface ResourceItem {
  id: string;
  /** Локализованное имя ресурса. Приходит готовым, клиент не переводит id. */
  label: string;
  /** Запас, уже отформатированный движком. */
  amount: string;
  delta?: { text: string; tone: DeltaTone };
  /**
   * Гейт сырья: ключевого ресурса нет, и производство встанет. Это не
   * «сильно отрицательная дельта», а другое состояние — запас может даже
   * расти, оставаясь ниже порога потребления.
   */
  shortage?: boolean;
}

export interface ResourceBarProps {
  items: ResourceItem[];
  /** `row` — строка в раме, `list` — колонка в томе. */
  layout?: "row" | "list";
  /** `sm` — фоновая сводка в раме, `md` — предмет разбора в томе. */
  size?: "sm" | "md";
  className?: string;
}

export function ResourceBar({ items, layout = "row", size = "md", className }: ResourceBarProps) {
  const { t } = useTranslation("ui");

  return (
    <div className={cx(styles[layout], size === "sm" && styles.sm, className)}>
      {items.map((item) => (
        <div
          key={item.id}
          className={cx(styles.item, item.shortage === true && styles.shortage)}
          title={item.shortage === true ? t("resources.shortage") : t("resources.stock")}
        >
          <span className={styles.label}>{item.label}</span>
          <span className={styles.figures}>
            <span className={styles.amount}>{item.amount}</span>
            {item.delta !== undefined && (
              <span className={cx(styles.delta, styles[item.delta.tone])}>{item.delta.text}</span>
            )}
            {item.shortage === true && (
              <span className={styles.warning}>
                <IconWarning />
                <span className="sr-only">{t("resources.shortage")}</span>
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
