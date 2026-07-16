import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type Country } from "@shared/types/Country";
import { ResourceType } from "@shared/types/resources/ResourcesType";
import { RESOURCE_CODES, RESOURCE_ICONS, formatCompactCurrency, formatResourceAmount } from "../../utils/resourceDisplay";
import { BOOK_ORDER, type BookId } from "../types";
import { IconBell, IconGdp, IconHelp, IconLegitimacy, IconLedgers, IconMenu, IconMilitary, IconPopulation, IconSearch, IconSettings, IconStability, IconTreasury } from "../icons";
import { BOOK_ICONS } from "../bookIcons";
import styles from "./Header.module.css";

const HEADER_RESOURCE_TYPES = [
  ResourceType.Oil,
  ResourceType.Coal,
  ResourceType.Iron,
  ResourceType.Food,
] as const;

export interface HeaderProps {
  country: Country;
  currentDate: string;
  llmTurn: number;
  llmRespondedThisTurn: boolean;
  loading: boolean;
  activeBook: BookId | null;
  onTabClick: (book: BookId) => void;
  onNextTurn: () => void;
  onOpenLlmCycle: () => void;
  onOpenCountryOverview: () => void;
  onOpenOnboarding: () => void;
  onResetWindowLayout: () => void;
  /** Пункт «Меню» тула — единственный сохранённый выход в ScenarioSelector (было .back-button в TopStatBar). */
  onBackToMenu: () => void;
}

export function Header({
  country,
  currentDate,
  llmTurn,
  llmRespondedThisTurn,
  loading,
  activeBook,
  onTabClick,
  onNextTurn,
  onOpenLlmCycle,
  onOpenCountryOverview,
  onOpenOnboarding,
  onResetWindowLayout,
  onBackToMenu,
}: HeaderProps) {
  const { t, i18n } = useTranslation(["hud", "resourceTicker"]);

  const dateLabel = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(
    new Date(currentDate),
  ).toUpperCase();

  const secondaryResources = Object.entries(country.stockpile).filter(
    ([resource, amount]) => !HEADER_RESOURCE_TYPES.includes(resource as (typeof HEADER_RESOURCE_TYPES)[number]) && amount > 0,
  );
  const currencyUnits = { trillion: t("units.trillion"), billion: t("units.billion"), million: t("units.million") };

  return (
    <header className={styles.top}>
      <div className={styles.hleft}>
        <div className={`${styles.cluster} ${styles.cluStats}`}>
          <div className={styles.flag}>
            <button
              type="button"
              title={t("flag.overview")}
              aria-label={t("flag.overview")}
              onClick={onOpenCountryOverview}
              style={{ backgroundColor: country.color }}
            />
          </div>
          <div className={styles.stats}>
            <div className={`${styles.statrow} ${styles.r1}`} aria-label={t("panel.stateLabel")} data-onboarding="stats">
              <StatButton icon={<IconGdp />} value={formatCompactCurrency(country.economy.gdp, currencyUnits, i18n.language)} title={t("statHelp.gdp")} onClick={() => onTabClick("economy")} />
              <StatButton icon={<IconTreasury />} value={formatCompactCurrency(country.economy.treasury, currencyUnits, i18n.language)} title={t("statHelp.treasury")} onClick={() => onTabClick("economy")} />
              <StatButton icon={<IconPopulation />} value={`${(country.population / 1e6).toFixed(1)}${t("units.million")}`} title={t("statHelp.population")} onClick={() => onTabClick("population")} />
              <StatButton icon={<IconMilitary />} value={`${(country.military.manpower / 1e6).toFixed(2)}${t("units.million")}`} title={t("statHelp.military")} onClick={() => onTabClick("industry")} />
              <StatButton
                icon={<IconStability />}
                value={`${Math.round(country.politics.stability)}`}
                title={t("statHelp.stability")}
                tone={country.politics.stability < 40 ? "crit" : country.politics.stability < 60 ? "warn" : "neutral"}
                onClick={() => onTabClick("politics")}
              />
              <StatButton
                icon={<IconLegitimacy />}
                value={`${Math.round(country.politics.legitimacy)}%`}
                title={t("statHelp.legitimacy")}
                tone={country.politics.legitimacy < 40 ? "crit" : country.politics.legitimacy < 60 ? "warn" : "neutral"}
                onClick={() => onTabClick("politics")}
              />
            </div>
            <div className={`${styles.statrow} ${styles.r2}`} aria-label={t("resourceRow.ariaLabel")}>
              {HEADER_RESOURCE_TYPES.map(resource => {
                  const amount = country.stockpile[resource] ?? 0;
                  const code = RESOURCE_CODES[resource] ?? resource.slice(0, 3).toUpperCase();
                  const icon = RESOURCE_ICONS[resource] ?? "•";
                  const title = `${t(`resources.${resource}`, { ns: "resourceTicker" })}: ${Math.round(amount).toLocaleString(i18n.language)}`;
                  return (
                    <button key={resource} type="button" className={styles.st} title={title} aria-label={title}>
                      <span aria-hidden="true">{icon}</span>
                      <span className={styles.resourceCode}>{code}</span>
                      <span className={styles.v}>{formatResourceAmount(amount)}</span>
                    </button>
                  );
                })}
              {secondaryResources.length > 0 && (
                <details className={styles.resourceMore}>
                  <summary aria-label={t("resourceRow.more", { count: secondaryResources.length })}>
                    +{secondaryResources.length}
                  </summary>
                  <div className={styles.resourceMenu}>
                    {secondaryResources.map(([resource, amount]) => {
                      const code = RESOURCE_CODES[resource as keyof typeof RESOURCE_CODES] ?? resource.slice(0, 3).toUpperCase();
                      const icon = RESOURCE_ICONS[resource as keyof typeof RESOURCE_ICONS] ?? "•";
                      const title = t(`resources.${resource}`, { ns: "resourceTicker", defaultValue: resource });
                      return (
                        <div key={resource} className={styles.resourceMenuRow} title={`${title}: ${Math.round(amount).toLocaleString(i18n.language)}`}>
                          <span aria-hidden="true">{icon}</span>
                          <span className={styles.resourceCode}>{code}</span>
                          <span className={styles.v}>{formatResourceAmount(amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>

        <nav className={styles.tabs} aria-label={t("tabsAriaLabel")} data-onboarding="books">
          {BOOK_ORDER.map((book, i) => {
            const Icon = BOOK_ICONS[book];
            return (
              <button
                key={book}
                type="button"
                className={`${styles.navbtn} ${activeBook === book ? styles.active : ""}`}
                data-t={t(`tabs.${book}`)}
                onClick={() => onTabClick(book)}
              >
                <Icon className={styles.navIcon} />
                <span className={styles.kb}>{i + 1}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className={styles.spacer} />

      <button type="button" className={styles.statuspill} onClick={onOpenLlmCycle} data-onboarding="llm" aria-live="polite">
        <span className={`${styles.pulse} ${llmRespondedThisTurn ? styles.pulseReady : styles.pulseWaiting}`} />
        {llmRespondedThisTurn ? t("statusPill.ready") : t("statusPill.waiting")}
        <em className={styles.turnNo}>{t("statusPill.turnLabel", { turn: llmTurn })}</em>
      </button>

      <div className={styles.hright}>
        <div className={`${styles.cluster} ${styles.cluTurn}`}>
          <div className={styles.date}>
            <b>{dateLabel}</b>
          </div>
          <button
            type="button"
            className={styles.endturn}
            onClick={onNextTurn}
            disabled={loading || !llmRespondedThisTurn}
            title={!llmRespondedThisTurn ? t("turn.blockedReason") : undefined}
            data-onboarding="turn"
          >
            {loading ? t("turn.simulating") : t("turn.next")}
          </button>
        </div>
        <div className={styles.tools}>
          <ToolButton icon={<IconSearch />} title={t("tools.search")} disabled />
          <ToolButton icon={<IconLedgers />} title={t("tools.ledgers")} disabled />
          <ToolButton icon={<IconBell />} title={t("tools.notifications")} disabled />
          <ToolButton icon={<IconSettings />} title={t("tools.resetWindowLayout")} onClick={onResetWindowLayout} />
          <ToolButton icon={<IconHelp />} title={t("tools.help")} onClick={onOpenOnboarding} dataOnboarding="help" />
          <ToolButton icon={<IconMenu />} title={t("tools.menu")} onClick={onBackToMenu} />
        </div>
      </div>
    </header>
  );
}

function StatButton({
  icon,
  value,
  title,
  tone = "neutral",
  onClick,
}: {
  icon: ReactNode;
  value: string;
  title: string;
  tone?: "neutral" | "warn" | "crit";
  onClick: () => void;
}) {
  return (
    <button type="button" className={`${styles.st} ${tone !== "neutral" ? styles[tone] : ""}`} title={title} onClick={onClick}>
      <span className={styles.ico} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.v}>{value}</span>
    </button>
  );
}

function ToolButton({
  icon,
  title,
  disabled,
  onClick,
  dataOnboarding,
}: {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
  dataOnboarding?: string;
}) {
  return (
    <button type="button" className={styles.tbtn} title={title} aria-label={title} disabled={disabled} onClick={onClick} data-onboarding={dataOnboarding}>
      {icon}
    </button>
  );
}
