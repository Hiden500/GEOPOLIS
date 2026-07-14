import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type Country } from "@shared/types/Country";
import { RESOURCE_CODES, RESOURCE_ICONS, formatCompactCurrency, formatResourceAmount } from "../../utils/resourceDisplay";
import { BOOK_ORDER, type BookId } from "../types";
import { IconBell, IconGdp, IconLegitimacy, IconLedgers, IconMenu, IconMilitary, IconPopulation, IconSearch, IconSettings, IconStability, IconTreasury } from "../icons";
import { BOOK_ICONS } from "../bookIcons";
import styles from "./Header.module.css";

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
  onBackToMenu,
}: HeaderProps) {
  const { t, i18n } = useTranslation("hud");

  const dateLabel = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(
    new Date(currentDate),
  ).toUpperCase();

  const stockpileEntries = Object.entries(country.stockpile).filter(([, amount]) => amount > 0);
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
            <div className={`${styles.statrow} ${styles.r1}`} aria-label={t("panel.stateLabel")}>
              <StatButton icon={<IconGdp />} value={formatCompactCurrency(country.economy.gdp, currencyUnits, i18n.language)} title={t("stats.gdp")} onClick={() => onTabClick("economy")} />
              <StatButton icon={<IconTreasury />} value={formatCompactCurrency(country.economy.treasury, currencyUnits, i18n.language)} title={t("stats.treasury")} onClick={() => onTabClick("economy")} />
              <StatButton icon={<IconPopulation />} value={`${(country.population / 1e6).toFixed(1)}${t("units.million")}`} title={t("stats.population")} onClick={() => onTabClick("population")} />
              <StatButton icon={<IconMilitary />} value={`${(country.military.manpower / 1e6).toFixed(2)}${t("units.million")}`} title={t("stats.military")} onClick={() => onTabClick("industry")} />
              <StatButton
                icon={<IconStability />}
                value={`${Math.round(country.politics.stability)}`}
                title={t("stats.stability")}
                tone={country.politics.stability < 40 ? "crit" : country.politics.stability < 60 ? "warn" : "neutral"}
                onClick={() => onTabClick("politics")}
              />
              <StatButton icon={<IconLegitimacy />} value={`${Math.round(country.politics.legitimacy)}%`} title={t("stats.legitimacy")} onClick={() => onTabClick("politics")} />
            </div>
            {stockpileEntries.length > 0 && (
              <div className={`${styles.statrow} ${styles.r2}`} aria-label={t("resourceRow.ariaLabel")}>
                {stockpileEntries.map(([resource, amount]) => {
                  const code = RESOURCE_CODES[resource as keyof typeof RESOURCE_CODES] ?? resource.slice(0, 3).toUpperCase();
                  const icon = RESOURCE_ICONS[resource as keyof typeof RESOURCE_ICONS] ?? "•";
                  return (
                    <button key={resource} type="button" className={styles.st} title={code}>
                      <span aria-hidden="true">{icon}</span>
                      <span className={styles.v}>{formatResourceAmount(amount)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <nav className={styles.tabs} aria-label={t("tabsAriaLabel")}>
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

      <button type="button" className={styles.statuspill} onClick={onOpenLlmCycle}>
        <span className={`${styles.pulse} ${llmRespondedThisTurn ? styles.pulseReady : styles.pulseWaiting}`} />
        {llmRespondedThisTurn ? t("statusPill.ready") : t("statusPill.waiting")}
        <em className={styles.turnNo}>{t("statusPill.turnLabel", { turn: llmTurn })}</em>
      </button>

      <div className={styles.hright}>
        <div className={`${styles.cluster} ${styles.cluTurn}`}>
          <div className={styles.date}>
            <b>{dateLabel}</b>
          </div>
          <button type="button" className={styles.endturn} onClick={onNextTurn} disabled={loading}>
            {loading ? t("turn.simulating") : t("turn.next")}
          </button>
        </div>
        <div className={styles.tools}>
          <ToolButton icon={<IconSearch />} title={t("tools.search")} disabled />
          <ToolButton icon={<IconLedgers />} title={t("tools.ledgers")} disabled />
          <ToolButton icon={<IconBell />} title={t("tools.notifications")} disabled />
          <ToolButton icon={<IconSettings />} title={t("tools.settings")} disabled />
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
}: {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={styles.tbtn} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {icon}
    </button>
  );
}
