import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Инициализация react-i18next (независимый гейм-дизайн разбор, 2026-07-06,
 * docs/LOCALIZATION.md) — namespace на компонент, не единый монолитный
 * файл на локаль. Ресурсы импортируются статически (объём небольшой, не
 * нужен http-backend с ленивой подгрузкой).
 *
 * Namespace здесь ровно столько, сколько запрашивает живой код: словарь,
 * который никто не читает, со временем расходится с интерфейсом молча, и
 * первым это замечает игрок. Проверку держит `__tests__/localeKeys.test.ts`.
 *
 * `researchPanel` пережил свою панель намеренно: имена доменов науки взяты
 * оттуда (`GameShell.tsx`), и заводить им второй список значило бы получить
 * два словаря на одни и те же домены.
 */
import ruCommon from "./locales/ru/common.json";
import ruApp from "./locales/ru/app.json";
import ruErrorBoundary from "./locales/ru/errorBoundary.json";
import ruPrimitiveOutcome from "./locales/ru/primitiveOutcome.json";
import ruPrimitiveRejection from "./locales/ru/primitiveRejection.json";
import ruResearchPanel from "./locales/ru/researchPanel.json";
import ruScenarioSelector from "./locales/ru/scenarioSelector.json";
import ruScreen from "./locales/ru/screen.json";
import ruUi from "./locales/ru/ui.json";

import enCommon from "./locales/en/common.json";
import enApp from "./locales/en/app.json";
import enErrorBoundary from "./locales/en/errorBoundary.json";
import enPrimitiveOutcome from "./locales/en/primitiveOutcome.json";
import enPrimitiveRejection from "./locales/en/primitiveRejection.json";
import enResearchPanel from "./locales/en/researchPanel.json";
import enScenarioSelector from "./locales/en/scenarioSelector.json";
import enScreen from "./locales/en/screen.json";
import enUi from "./locales/en/ui.json";

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
      errorBoundary: ruErrorBoundary,
      primitiveOutcome: ruPrimitiveOutcome,
      primitiveRejection: ruPrimitiveRejection,
      researchPanel: ruResearchPanel,
      scenarioSelector: ruScenarioSelector,
      screen: ruScreen,
      ui: ruUi,
    },
    en: {
      common: enCommon,
      app: enApp,
      errorBoundary: enErrorBoundary,
      primitiveOutcome: enPrimitiveOutcome,
      primitiveRejection: enPrimitiveRejection,
      researchPanel: enResearchPanel,
      scenarioSelector: enScenarioSelector,
      screen: enScreen,
      ui: enUi,
    },
  },
});

export default i18n;
