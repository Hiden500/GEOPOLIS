import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "default" | "quiet" | "danger" | "order";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Кнопка без подписи. Требует `aria-label` — иначе она немая для скринридера. */
  iconOnly?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "default",
  size = "md",
  iconOnly = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        iconOnly && styles.iconOnly,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
