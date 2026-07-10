import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Инициализация react-i18next (независимый гейм-дизайн разбор, 2026-07-06,
 * docs/LOCALIZATION.md) — namespace на компонент, не единый монолитный
 * файл на локаль. Ресурсы импортируются статически (объём небольшой, не
 * нужен http-backend с ленивой подгрузкой).
 */
import ruCommon from "./locales/ru/common.json";
import ruApp from "./locales/ru/app.json";
import ruBudgetPanel from "./locales/ru/budgetPanel.json";
import ruErrorBoundary from "./locales/ru/errorBoundary.json";
import ruEventTimelinePanel from "./locales/ru/eventTimelinePanel.json";
import ruGameView from "./locales/ru/gameView.json";
import ruInspectorPanel from "./locales/ru/inspectorPanel.json";
import ruLlmPanel from "./locales/ru/llmPanel.json";
import ruPlayerIntentPanel from "./locales/ru/playerIntentPanel.json";
import ruResearchPanel from "./locales/ru/researchPanel.json";
import ruResourceTicker from "./locales/ru/resourceTicker.json";
import ruScenarioSelector from "./locales/ru/scenarioSelector.json";
import ruTerritoriesPanel from "./locales/ru/territoriesPanel.json";
import ruTopStatBar from "./locales/ru/topStatBar.json";
import ruWindow from "./locales/ru/window.json";
import ruWorldRankingPanel from "./locales/ru/worldRankingPanel.json";

import enCommon from "./locales/en/common.json";
import enApp from "./locales/en/app.json";
import enBudgetPanel from "./locales/en/budgetPanel.json";
import enErrorBoundary from "./locales/en/errorBoundary.json";
import enEventTimelinePanel from "./locales/en/eventTimelinePanel.json";
import enGameView from "./locales/en/gameView.json";
import enInspectorPanel from "./locales/en/inspectorPanel.json";
import enLlmPanel from "./locales/en/llmPanel.json";
import enPlayerIntentPanel from "./locales/en/playerIntentPanel.json";
import enResearchPanel from "./locales/en/researchPanel.json";
import enResourceTicker from "./locales/en/resourceTicker.json";
import enScenarioSelector from "./locales/en/scenarioSelector.json";
import enTerritoriesPanel from "./locales/en/territoriesPanel.json";
import enTopStatBar from "./locales/en/topStatBar.json";
import enWindow from "./locales/en/window.json";
import enWorldRankingPanel from "./locales/en/worldRankingPanel.json";

/** shared/src/types/i18n/LocalizedText.ts::DEFAULT_LOCALE — не дублируем константу, но держим то же значение. */
const DEFAULT_LOCALE = "ru";

void i18n.use(initReactI18next).init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: "common",
  interpolation: { escapeValue: false }, // React уже экранирует
  resources: {
    ru: {
      common: ruCommon,
      app: ruApp,
      budgetPanel: ruBudgetPanel,
      errorBoundary: ruErrorBoundary,
      eventTimelinePanel: ruEventTimelinePanel,
      gameView: ruGameView,
      inspectorPanel: ruInspectorPanel,
      llmPanel: ruLlmPanel,
      playerIntentPanel: ruPlayerIntentPanel,
      researchPanel: ruResearchPanel,
      resourceTicker: ruResourceTicker,
      scenarioSelector: ruScenarioSelector,
      territoriesPanel: ruTerritoriesPanel,
      topStatBar: ruTopStatBar,
      window: ruWindow,
      worldRankingPanel: ruWorldRankingPanel,
    },
    en: {
      common: enCommon,
      app: enApp,
      budgetPanel: enBudgetPanel,
      errorBoundary: enErrorBoundary,
      eventTimelinePanel: enEventTimelinePanel,
      gameView: enGameView,
      inspectorPanel: enInspectorPanel,
      llmPanel: enLlmPanel,
      playerIntentPanel: enPlayerIntentPanel,
      researchPanel: enResearchPanel,
      resourceTicker: enResourceTicker,
      scenarioSelector: enScenarioSelector,
      territoriesPanel: enTerritoriesPanel,
      topStatBar: enTopStatBar,
      window: enWindow,
      worldRankingPanel: enWorldRankingPanel,
    },
  },
});

export default i18n;
