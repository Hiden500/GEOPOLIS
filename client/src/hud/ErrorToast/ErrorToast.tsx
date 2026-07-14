import { useTranslation } from "react-i18next";
import styles from "./ErrorToast.module.css";

export interface ErrorToastProps {
  message: string | null;
  onDismiss: () => void;
}

/**
 * Плавающий тост поверх карты (docs/plans/12_UI_REDESIGN.md — живой QA-фидбек
 * 2026-07-13). Раньше ошибка рендерилась инлайн-параграфом между Header и
 * game-content — это меняло flex-высоту .game-content и "сдвигало" карту
 * (MapLibre canvas не получал ресайз), обнажая тёмный фон снизу. Тост не
 * участвует в потоке — карта никогда не меняет размер из-за ошибки.
 */
export function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  const { t } = useTranslation("hud");

  if (!message) return null;

  return (
    <div className={styles.toast} role="alert">
      <span className={styles.text}>{message}</span>
      <button type="button" className={styles.close} onClick={onDismiss} aria-label={t("errorToast.dismiss")}>
        ×
      </button>
    </div>
  );
}
