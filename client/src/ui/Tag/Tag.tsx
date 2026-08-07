import { useTranslation } from "react-i18next";
import { cx } from "../cx";
import styles from "./Tag.module.css";

/** Род цели: куда приведёт нажатие. */
export type TagKind = "region" | "country" | "object";

export interface TagProps {
  label: string;
  kind: TagKind;
  onClick?: () => void;
  className?: string;
}

export function Tag({ label, kind, onClick, className }: TagProps) {
  const { t } = useTranslation("ui");
  const kindName = t(`tag.${kind}`);
  const rootClass = cx(styles.tag, onClick !== undefined && styles.interactive, className);

  const content = (
    <>
      <span className={cx(styles.kind, styles[kind])} aria-hidden="true" />
      {label}
      <span className="sr-only"> — {kindName}</span>
    </>
  );

  if (onClick === undefined) {
    return (
      <span className={rootClass} title={kindName}>
        {content}
      </span>
    );
  }

  return (
    <button type="button" className={rootClass} onClick={onClick} title={kindName}>
      {content}
    </button>
  );
}
