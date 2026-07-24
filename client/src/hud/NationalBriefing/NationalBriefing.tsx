import { useTranslation } from "react-i18next";
import type { Country } from "@shared/types/Country";
import type { LastTurnReport, PlayerStanding, TurnMetricChange } from "@shared/types/GameState";
import type { StrategicGoal } from "@shared/types/GrandStrategy";
import styles from "./NationalBriefing.module.css";

interface NationalBriefingProps {
  country: Country;
  standing: PlayerStanding;
  report?: LastTurnReport;
}

function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function goalLabel(goal: StrategicGoal, locale: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (goal.title) return goal.title;
  switch (goal.kind) {
    case "reach_gdp":
      return t("briefing.goal.reachGdp", { target: formatCompact(goal.target, locale) });
    case "reach_power_rank":
      return t("briefing.goal.reachPowerRank", { target: goal.targetRank });
    case "control_regions":
      return t("briefing.goal.controlRegions", { target: goal.targetCount });
    case "reach_tech_tier":
      return t("briefing.goal.reachTechTier", { domain: goal.domain, target: goal.targetTier });
  }
}

function changeTone(change: TurnMetricChange): "positive" | "negative" | "neutral" {
  if (change.before === change.after) return "neutral";
  const improved = change.metric === "rank" ? change.after < change.before : change.after > change.before;
  return improved ? "positive" : "negative";
}

function formatMetricValue(change: TurnMetricChange, value: number, locale: string): string {
  if (["rank", "regions"].includes(change.metric)) return Math.round(value).toLocaleString(locale);
  if (["stability", "legitimacy"].includes(change.metric)) return value.toFixed(1);
  return formatCompact(value, locale);
}

export function NationalBriefing({ country, standing, report }: NationalBriefingProps) {
  const { t, i18n } = useTranslation("gameView");
  const completedGoals = country.goals.filter(goal => goal.completed).length;
  const nextGoal = country.goals.find(goal => !goal.completed);
  const visibleChanges = report?.changes.slice(0, 3) ?? [];

  return (
    <details className={styles.briefing} open data-testid="national-briefing">
      <summary className={styles.summary}>
        <span className={styles.eyebrow}>{t("briefing.title")}</span>
        <strong>{t("briefing.rank", { rank: standing.rank, total: standing.total })}</strong>
        <span className={styles.power}>{t("briefing.power", { power: formatCompact(standing.power, i18n.language) })}</span>
      </summary>

      <div className={styles.body}>
        <div className={styles.goals}>
          <span>{t("briefing.goals", { completed: completedGoals, total: country.goals.length })}</span>
          <span className={styles.goalText}>
            {nextGoal ? goalLabel(nextGoal, i18n.language, t) : t(country.goals.length > 0 ? "briefing.allGoalsComplete" : "briefing.noGoals")}
          </span>
        </div>

        <div className={styles.turnReport} aria-live="polite">
          <span className={styles.sectionTitle}>
            {report
              ? t("briefing.lastTurn", { from: report.fromDate, to: report.toDate })
              : t("briefing.noTurnReport")}
          </span>
          {report && visibleChanges.length === 0 && report.completedGoalIds.length === 0 && (
            <span className={styles.quiet}>{t("briefing.noSignificantChanges")}</span>
          )}
          {visibleChanges.map(change => (
            <div key={change.metric} className={`${styles.change} ${styles[changeTone(change)]}`}>
              <span>{t(`briefing.metric.${change.metric}`)}</span>
              <span className={styles.changeValue}>
                {formatMetricValue(change, change.before, i18n.language)} → {formatMetricValue(change, change.after, i18n.language)}
              </span>
            </div>
          ))}
          {report && report.changes.length > visibleChanges.length && (
            <span className={styles.quiet}>{t("briefing.moreChanges", { count: report.changes.length - visibleChanges.length })}</span>
          )}
          {report && report.completedGoalIds.length > 0 && (
            <span className={styles.completed}>{t("briefing.completedGoals", { count: report.completedGoalIds.length })}</span>
          )}
        </div>
      </div>
    </details>
  );
}
