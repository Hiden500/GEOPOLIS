import { forwardRef, type ButtonHTMLAttributes } from "react";
import styles from "./IconButton.module.css";

export type IconButtonSize = "sm" | "md";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Обязателен: у IconButton нет текстовой подписи — это единственное описание для скринридера. */
  "aria-label": string;
  size?: IconButtonSize;
  /** Кнопка представляет включённое состояние (активный mapmode, открытая панель и т.п.). */
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = "md", active = false, className, type = "button", ...rest },
  ref,
) {
  const classes = [styles.iconButton, styles[size], active ? styles.active : "", className]
    .filter(Boolean)
    .join(" ");
  return <button ref={ref} type={type} className={classes} aria-pressed={active} {...rest} />;
});
