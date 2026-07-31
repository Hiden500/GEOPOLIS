import { useTranslation } from "react-i18next";
import { type Country } from "@shared/types/Country";
import { type IdeologyAnchor } from "@shared/types/politics/IdeologyAnchor";
import { useIdeologyLabel } from "../../../i18n/ideologyLabel";
import { useGovernmentLabel } from "../../../i18n/governmentLabel";
import { Meter } from "../../../primitives";
import styles from "./bookLayout.module.css";

export interface PoliticsBookProps {
  country: Country;
  /** Каталог именованных зон партии: ярлык вычисляется, а не хранится. */
  ideologyAnchors: readonly IdeologyAnchor[];
  /**
   * Ростер партии — нужен, чтобы назвать метрополию по `politics.overlordIds`
   * её собственным именем, а не кодом страны. Книга показывает страну игрока,
   * и она может быть зависимой (сценарий 1946 даёт 89 таких субъектов).
   */
  countries: readonly Country[];
}

/**
 * Политика (docs/plans/12_UI_REDESIGN.md, Срез 3в) — реальные
 * Country.politics.*, включая поля, которых нет больше нигде в HUD
 * (corruption, governmentSupport, ideology, форма власти и статус).
 */
export function PoliticsBook({ country, ideologyAnchors, countries }: PoliticsBookProps) {
  const { t } = useTranslation("hud");
  const ideologyLabel = useIdeologyLabel();
  const governmentLabel = useGovernmentLabel();
  const { politics } = country;
  const ideology = ideologyLabel(politics, ideologyAnchors);
  const govLabel = [ideology, governmentLabel(politics, countries)].filter(Boolean).join(" · ");

  return (
    <>
      <div className={styles.headline}>
        <span className={styles.headlineBig}>{Math.round(politics.stability)}</span>
        <span className={styles.headlineCap}>{t("books.politics.stabilityCaption")}</span>
      </div>
      {govLabel && <p className={styles.stat2Label}>{govLabel}</p>}

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{t("books.politics.legitimacy")}</span>
          <span className={styles.kpiValue}>{Math.round(politics.legitimacy)}%</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{t("books.politics.governmentSupport")}</span>
          <span className={styles.kpiValue}>{Math.round(politics.governmentSupport)}%</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{t("books.politics.corruption")}</span>
          <span className={styles.kpiValue}>{Math.round(politics.corruption)}%</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{t("books.politics.ideology")}</span>
          <span className={styles.kpiValue} style={{ fontSize: 13 }}>
            {ideology || "—"}
          </span>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("books.politics.overview")}</h3>
        <div className={styles.stat2}>
          <div className={styles.stat2Top}>
            <span className={styles.stat2Label}>{t("books.politics.stability")}</span>
            <span className={styles.stat2Value}>{Math.round(politics.stability)}/100</span>
          </div>
          <Meter
            value={politics.stability}
            label={t("books.politics.stability")}
            tone={politics.stability < 40 ? "crit" : politics.stability < 60 ? "warn" : "ok"}
          />
        </div>
        <div className={styles.stat2}>
          <div className={styles.stat2Top}>
            <span className={styles.stat2Label}>{t("books.politics.legitimacy")}</span>
            <span className={styles.stat2Value}>{Math.round(politics.legitimacy)}%</span>
          </div>
          <Meter value={politics.legitimacy} label={t("books.politics.legitimacy")} tone="neutral" />
        </div>
        <div className={styles.stat2}>
          <div className={styles.stat2Top}>
            <span className={styles.stat2Label}>{t("books.politics.corruption")}</span>
            <span className={styles.stat2Value}>{Math.round(politics.corruption)}%</span>
          </div>
          <Meter
            value={politics.corruption}
            label={t("books.politics.corruption")}
            tone={politics.corruption > 60 ? "crit" : politics.corruption > 35 ? "warn" : "ok"}
          />
        </div>
      </div>
    </>
  );
}
