import { useTranslation } from "react-i18next";
import { type Region } from "@shared/types/map/Region";
import { Meter } from "../../../primitives";
import { RESOURCE_CODES, RESOURCE_ICONS, formatResourceAmount } from "../../../utils/resourceDisplay";
import styles from "./bookLayout.module.css";

export interface IndustryBookProps {
  regions: Region[];
}

interface Composition {
  agriculture: number;
  industry: number;
  mining: number;
  services: number;
}

/**
 * Промышленность (docs/plans/12_UI_REDESIGN.md, Срез 3в) — состав экономики
 * регионов игрока (Region.economy, взвешено по gdp региона) + запасы/
 * добывающие мощности (Region.deposits/extraction). Не пытается вычислить
 * "выпуск в месяц" — эта формула живёт в ResourceTick.ts (сервер), клиент
 * её не дублирует (принцип "движок — бухгалтер", AGENTS.md).
 */
export function IndustryBook({ regions }: IndustryBookProps) {
  const { t } = useTranslation(["hud", "resourceTicker"]);

  const totalGdp = regions.reduce((sum, r) => sum + r.gdp, 0);
  const composition: Composition = { agriculture: 0, industry: 0, mining: 0, services: 0 };
  if (totalGdp > 0) {
    for (const r of regions) {
      if (!r.economy) continue;
      const weight = r.gdp / totalGdp;
      composition.agriculture += r.economy.agriculture * weight;
      composition.industry += r.economy.industry * weight;
      composition.mining += r.economy.mining * weight;
      composition.services += r.economy.services * weight;
    }
  }

  const deposits = new Map<string, number>();
  const extraction = new Map<string, number>();
  for (const r of regions) {
    for (const [resource, amount] of Object.entries(r.deposits)) {
      deposits.set(resource, (deposits.get(resource) ?? 0) + (amount ?? 0));
    }
    for (const [resource, level] of Object.entries(r.extraction)) {
      extraction.set(resource, (extraction.get(resource) ?? 0) + (level ?? 0));
    }
  }
  const resourceList = [...deposits.keys()].sort((a, b) => (deposits.get(b) ?? 0) - (deposits.get(a) ?? 0));

  return (
    <>
      <div className={styles.headline}>
        <span className={styles.headlineBig}>{regions.length}</span>
        <span className={styles.headlineCap}>{t("books.industry.regionsCaption")}</span>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("books.industry.composition")}</h3>
        {(Object.keys(composition) as (keyof Composition)[]).map(key => (
          <div className={styles.stat2} key={key}>
            <div className={styles.stat2Top}>
              <span className={styles.stat2Label}>{t(`books.industry.sectors.${key}`)}</span>
              <span className={styles.stat2Value}>{Math.round(composition[key] * 100)}%</span>
            </div>
            <Meter value={composition[key] * 100} label={t(`books.industry.sectors.${key}`)} tone="neutral" />
          </div>
        ))}
      </div>

      {resourceList.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("books.industry.deposits")}</h3>
          <div className={styles.list}>
            {resourceList.map(resource => (
              <div className={styles.row} key={resource}>
                <span className={styles.rowName}>
                  <span aria-hidden="true">{RESOURCE_ICONS[resource as keyof typeof RESOURCE_ICONS] ?? "•"}</span>
                  {t(`resourceTicker:resources.${resource}`, {
                    defaultValue: RESOURCE_CODES[resource as keyof typeof RESOURCE_CODES] ?? resource,
                  })}
                </span>
                <span className={styles.kpiValue}>{formatResourceAmount(deposits.get(resource) ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
