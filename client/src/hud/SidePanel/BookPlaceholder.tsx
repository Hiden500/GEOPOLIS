import { useTranslation } from "react-i18next";
import styles from "./BookPlaceholder.module.css";

/**
 * Честная заглушка для книг без реального контента в Срезе 2
 * (Промышленность/Население/Политика/Дипломатия/Разведка — наполнение
 * реальными данными в Срезе 3, docs/plans/12_UI_REDESIGN.md). Не пустая
 * панель (список "не возвращать" §2) — есть текст, просто не выдуманные данные.
 */
export function BookPlaceholder() {
  const { t } = useTranslation("hud");
  return (
    <div className={styles.placeholder}>
      <p className={styles.title}>{t("bookPlaceholder.title")}</p>
      <p className={styles.body}>{t("bookPlaceholder.body")}</p>
    </div>
  );
}
