import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { type Country } from "@shared/types/Country";
import { getText } from "@shared/types/i18n/LocalizedText";
import { RESOURCE_CODES, RESOURCE_ICONS, formatResourceAmount } from "../../utils/resourceDisplay";
import { Meter, Tag } from "../../primitives";
import { type Selection } from "../types";
import { IconClose } from "../icons";
import styles from "./ContextPanel.module.css";

export interface ContextPanelProps {
  selection: Selection | null;
  game: GameState;
  onClose: () => void;
  onSelectCountry: (countryId: string) => void;
  onCompare: () => void;
}

/**
 * Правая контекст-панель — показывается только при выделении региона/страны
 * (docs/plans/12_UI_REDESIGN.md §1), не висит. Заменяет InspectorPanel как
 * основной способ показать объект; InspectorPanel остаётся для сценария
 * "сравнить" (плавающее окно, useWindows).
 */
export function ContextPanel({ selection, game, onClose, onSelectCountry, onCompare }: ContextPanelProps) {
  const open = selection !== null;

  return (
    <aside className={`${styles.panel} ${open ? styles.open : ""}`} aria-labelledby="context-panel-title" aria-hidden={!open} inert={!open}>
      {selection?.type === "region" && (
        <RegionContext regionId={selection.regionId} game={game} onClose={onClose} onSelectCountry={onSelectCountry} onCompare={onCompare} />
      )}
      {selection?.type === "country" && (
        <CountryContext countryId={selection.countryId} game={game} onClose={onClose} onSelectCountry={onSelectCountry} onCompare={onCompare} />
      )}
    </aside>
  );
}

function Head({
  eyebrow,
  title,
  onClose,
  closeLabel,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  closeLabel: string;
}) {
  return (
    <div className={styles.head}>
      <button type="button" className={styles.close} aria-label={closeLabel} onClick={onClose}>
        <IconClose />
      </button>
      <div className={styles.eyebrow}>{eyebrow}</div>
      <h2 id="context-panel-title" className={styles.title}>
        {title}
      </h2>
    </div>
  );
}

function Actions({ onCompare, compareLabel }: { onCompare: () => void; compareLabel: string }) {
  return (
    <div className={styles.actions}>
      <button type="button" className={styles.actionBtn} onClick={onCompare}>
        {compareLabel}
      </button>
    </div>
  );
}

function RegionContext({
  regionId,
  game,
  onClose,
  onSelectCountry,
  onCompare,
}: {
  regionId: number;
  game: GameState;
  onClose: () => void;
  onSelectCountry: (id: string) => void;
  onCompare: () => void;
}) {
  const { t, i18n } = useTranslation("hud");
  const region = game.regions.find(r => r.id === regionId);
  if (!region) return null;
  const owner = game.countries.find(c => c.id === region.ownerCountryId);
  const features = game.mapFeatures.filter(f => f.regionId === regionId);
  const featureCounts = groupFeatureCounts(features);
  const resourceEntries = Object.entries(region.deposits).filter(([, v]) => (v ?? 0) > 0);

  return (
    <>
      <Head eyebrow={t("context.regionEyebrow")} title={getText(region.names)} onClose={onClose} closeLabel={t("context.close")} />
      <div className={styles.body}>
        {owner && (
          <button type="button" className={styles.owner} onClick={() => onSelectCountry(owner.id)}>
            <span className={styles.swatch} style={{ backgroundColor: owner.color }} />
            {owner.name}
          </button>
        )}

        {/* region.stability/development/infrastructure — дробная шкала 0..1 в
            рантайме (в отличие от Country.politics.*, которая уже 0..100,
            см. server/src/simulation/politics/PoliticsTick.ts clamp(0,100)
            против server/src/game/CreateGame.ts авторских долей) — приводим
            к 0..100 здесь, не выше по цепочке. */}
        <Stat2
          label={t("context.region.population")}
          value={region.population.toLocaleString(i18n.language)}
          pct={Math.min(100, (region.population / 3_000_000) * 100)}
          tone="neutral"
        />
        <Stat2
          label={t("context.region.stability")}
          value={`${Math.round(region.stability * 100)}/100`}
          pct={region.stability * 100}
          tone={region.stability < 0.4 ? "crit" : region.stability < 0.6 ? "warn" : "ok"}
        />
        <Stat2
          label={t("context.region.development")}
          value={`${Math.round(region.development * 100)}/100`}
          pct={region.development * 100}
          tone="neutral"
        />

        {resourceEntries.length > 0 && (
          <Section title={t("context.region.resources")}>
            <div className={styles.chips}>
              {resourceEntries.map(([resource, amount]) => (
                <div key={resource} className={styles.chip}>
                  <span aria-hidden="true">{RESOURCE_ICONS[resource as keyof typeof RESOURCE_ICONS] ?? "•"}</span>
                  <span>{RESOURCE_CODES[resource as keyof typeof RESOURCE_CODES] ?? resource.slice(0, 3).toUpperCase()}</span>
                  <span className={styles.chipValue}>{formatResourceAmount(amount ?? 0)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {featureCounts.length > 0 && (
          <Section title={t("context.region.features")}>
            <div className={styles.tags}>
              {featureCounts.map(({ type, count }) => (
                <Tag key={type} variant="pill">
                  {count} {t(`context.featureTypes.${type}`, { defaultValue: type })}
                </Tag>
              ))}
            </div>
          </Section>
        )}

        <Actions onCompare={onCompare} compareLabel={t("context.compare")} />
      </div>
    </>
  );
}

function CountryContext({
  countryId,
  game,
  onClose,
  onSelectCountry,
  onCompare,
}: {
  countryId: string;
  game: GameState;
  onClose: () => void;
  onSelectCountry: (id: string) => void;
  onCompare: () => void;
}) {
  const { t, i18n } = useTranslation("hud");
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return null;
  const govLabel = [country.politics.ideology, country.politics.governmentType].filter(Boolean).join(" · ");
  const relationEntries = Object.entries(country.diplomacy.relations)
    .map(([id, value]) => ({ id, value, other: game.countries.find(c => c.id === id) }))
    .filter((e): e is { id: string; value: number; other: Country } => e.other != null)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  return (
    <>
      <Head eyebrow={t("context.countryEyebrow")} title={country.name} onClose={onClose} closeLabel={t("context.close")} />
      <div className={styles.body}>
        {govLabel && <div className={styles.owner}>{govLabel}</div>}

        <div className={styles.kpis}>
          <Kpi label={t("context.country.gdp")} value={`${(country.economy.gdp / 1e12).toFixed(2)}Т`} />
          <Kpi label={t("context.country.population")} value={`${(country.population / 1e6).toFixed(1)}М`} />
          <Kpi label={t("context.country.treasury")} value={Math.round(country.economy.treasury).toLocaleString(i18n.language)} />
          <Kpi
            label={t("context.country.budgetBalance")}
            value={Math.round(country.economy.budgetBalance).toLocaleString(i18n.language)}
            tone={country.economy.budgetBalance >= 0 ? "ok" : "crit"}
          />
        </div>

        <Stat2
          label={t("context.country.stability")}
          value={`${Math.round(country.politics.stability)}/100`}
          pct={country.politics.stability}
          tone={country.politics.stability < 40 ? "crit" : country.politics.stability < 60 ? "warn" : "ok"}
        />
        <Stat2 label={t("context.country.legitimacy")} value={`${Math.round(country.politics.legitimacy)}%`} pct={country.politics.legitimacy} tone="neutral" />

        {relationEntries.length > 0 && (
          <Section title={t("context.country.relations")}>
            <div className={styles.relations}>
              {relationEntries.map(({ id, value, other }) => (
                <button key={id} type="button" className={styles.relationRow} onClick={() => onSelectCountry(id)}>
                  <span className={styles.relationName}>
                    <span className={styles.swatch} style={{ backgroundColor: other.color }} />
                    {other.shortName}
                  </span>
                  <span className={value >= 0 ? styles.positive : styles.negative}>{Math.round(value)}</span>
                </button>
              ))}
            </div>
          </Section>
        )}

        <Actions onCompare={onCompare} compareLabel={t("context.compare")} />
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  );
}

function Stat2({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: string;
  pct: number;
  tone: "neutral" | "ok" | "warn" | "crit";
}) {
  return (
    <div className={styles.stat2}>
      <div className={styles.stat2Top}>
        <span className={styles.stat2Label}>{label}</span>
        <span className={styles.stat2Value}>{value}</span>
      </div>
      <Meter value={pct} label={label} tone={tone} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "ok" | "crit" }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue} ${tone === "ok" ? styles.positive : tone === "crit" ? styles.negative : ""}`}>{value}</span>
    </div>
  );
}

function groupFeatureCounts(features: GameState["mapFeatures"]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of features) {
    counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

