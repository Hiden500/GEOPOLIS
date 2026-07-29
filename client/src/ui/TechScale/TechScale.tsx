import { useTranslation } from "react-i18next";
import { cx } from "../cx";
import styles from "./TechScale.module.css";

export interface TechScaleProps {
  /** Имя слота. Слот стабилен всю партию, меняется только его поколение. */
  name: string;
  /** Сколько ступеней поколений показывает шкала. */
  generations: number;
  /** Среднее поколение произведённого парка. */
  readiness: number;
  /** Тир домена: что держава умеет проектировать. */
  capability: number;
  /** С какого поколения доктрина запрещает ставить в строй. */
  forbiddenFrom?: number;
  /** Второй указатель для сравнения с чужой державой. */
  rival?: { label: string; readiness: number };
}

export function TechScale({
  name,
  generations,
  readiness,
  capability,
  forbiddenFrom,
  rival,
}: TechScaleProps) {
  const { t } = useTranslation("ui");
  const behind = Math.max(0, Math.round(capability - readiness));

  const segments = Array.from({ length: generations }, (_, index) => {
    const step = index + 1;
    if (forbiddenFrom !== undefined && step >= forbiddenFrom) return "forbidden" as const;
    if (step <= readiness) return "filled" as const;
    if (step <= capability) return "gap" as const;
    return "empty" as const;
  });

  const percent = (step: number) => `${(step / generations) * 100}%`;

  return (
    <div className={styles.row}>
      <span className={styles.name}>{name}</span>

      <div className={styles.track}>
        {segments.map((kind, index) => (
          <span
            key={index}
            className={cx(styles.segment, kind !== "empty" && styles[kind])}
          />
        ))}

        <span
          className={styles.capability}
          style={{ left: percent(capability) }}
          title={t("capability")}
        />

        {rival !== undefined && (
          <span
            className={styles.rival}
            style={{ left: percent(rival.readiness) }}
            title={`${rival.label}: ${t("readiness")}`}
          />
        )}
      </div>

      <span className={cx(styles.note, behind > 0 && styles.behind)}>
        {forbiddenFrom !== undefined
          ? t("forbidden")
          : behind > 0
            ? t("gap", { count: behind })
            : t("even")}
      </span>
    </div>
  );
}
