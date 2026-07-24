import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { Tag } from "../../../primitives";
import styles from "./bookLayout.module.css";

export interface DiplomacyBookProps {
  country: Country;
  game: GameState;
  onSelectCountry: (countryId: string) => void;
}

/**
 * Дипломатия (docs/plans/12_UI_REDESIGN.md, Срез 3в) — полный список
 * отношений (ContextPanel показывает только топ-6), плюс союзники/соперники/
 * марионетки/сфера влияния/санкции — реальные поля DiplomacyState, нигде
 * больше в HUD целиком не показаны.
 */
export function DiplomacyBook({ country, game, onSelectCountry }: DiplomacyBookProps) {
  const { t, i18n } = useTranslation("hud");
  const locale = i18n.language as Locale;
  const countryById = new Map(game.countries.map(c => [c.id, c]));
  const { diplomacy } = country;

  const relationEntries = Object.entries(diplomacy.relations)
    .map(([id, value]) => ({ id, value, other: countryById.get(id) }))
    .filter((e): e is { id: string; value: number; other: Country } => e.other != null)
    .sort((a, b) => b.value - a.value);

  const nameList = (ids: string[]) =>
    ids
      .map(id => {
        const other = countryById.get(id);
        return other ? getText(other.shortName, locale) : id;
      })
      .filter(Boolean)
      .join(", ");

  return (
    <>
      <div className={styles.headline}>
        <span className={styles.headlineBig}>{relationEntries.length}</span>
        <span className={styles.headlineCap}>{t("books.diplomacy.activeRelations")}</span>
      </div>

      {(diplomacy.allies.length > 0 || diplomacy.rivals.length > 0) && (
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>{t("books.diplomacy.allies")}</span>
            <span className={styles.kpiValue} style={{ fontSize: 13 }}>
              {diplomacy.allies.length > 0 ? nameList(diplomacy.allies) : "—"}
            </span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiLabel}>{t("books.diplomacy.rivals")}</span>
            <span className={styles.kpiValue} style={{ fontSize: 13 }}>
              {diplomacy.rivals.length > 0 ? nameList(diplomacy.rivals) : "—"}
            </span>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("books.diplomacy.relations")}</h3>
        {relationEntries.length === 0 ? (
          <p className={styles.empty}>{t("books.diplomacy.noRelations")}</p>
        ) : (
          <div className={styles.list}>
            {relationEntries.map(({ id, value, other }) => (
              <button
                key={id}
                type="button"
                className={`${styles.row} ${styles.rowButton}`}
                onClick={() => onSelectCountry(id)}
              >
                <span className={styles.rowName}>
                  <span className={styles.swatch} style={{ backgroundColor: other.color }} />
                  {getText(other.shortName, locale)}
                </span>
                <span className={value >= 0 ? styles.positive : styles.negative}>{Math.round(value)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {diplomacy.sphereOfInfluence.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("books.diplomacy.sphereOfInfluence")}</h3>
          <div className={styles.tagRow}>
            {diplomacy.sphereOfInfluence.map(id => (
              <Tag key={id} variant="pill">
                {countryById.get(id) ? getText(countryById.get(id)!.shortName, locale) : id}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {diplomacy.puppets.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("books.diplomacy.puppets")}</h3>
          <div className={styles.tagRow}>
            {diplomacy.puppets.map(id => (
              <Tag key={id} variant="pill" tone="accent">
                {countryById.get(id) ? getText(countryById.get(id)!.shortName, locale) : id}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {Object.keys(diplomacy.sanctions).length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>{t("books.diplomacy.sanctions")}</h3>
          <div className={styles.tagRow}>
            {Object.entries(diplomacy.sanctions).map(([id, types]) => (
              <Tag key={id} variant="pill" tone="crit">
                {countryById.get(id) ? getText(countryById.get(id)!.shortName, locale) : id} ({types.length})
              </Tag>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
