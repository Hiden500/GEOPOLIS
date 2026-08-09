import { type Region } from "@shared/types/map/Region";
import { type Country } from "@shared/types/Country";
import { type MapMode } from "./model";

/**
 * Подпись ЛЕГЕНДЫ. Союз, а не `string`: экран переводит подписи исчерпывающим
 * `Record`, поэтому новая градация без строки в словаре — ошибка компиляции, а
 * не пустое место в углу карты.
 *
 * `medium` и `moderate` — одна и та же середина шкалы, но РАЗНОГО согласования:
 * ряд внутри одной легенды обязан быть однородным по части речи, а ряды разных
 * режимов однородными быть не обязаны. «Развитая · средняя · слабая»
 * (прилагательные ж. р.) и «многолюдно · средне · малолюдно» (наречия) одной
 * строкой словаря не покрываются: русское прилагательное согласуется, наречие —
 * нет. Один ключ на оба ряда давал «богато · средняя · бедно».
 */
export type LegendLabel =
  | "high"
  | "medium"
  | "moderate"
  | "low"
  | "calm"
  | "tense"
  | "unrest"
  | "dense"
  | "sparse"
  | "rich"
  | "poor"
  | "own"
  | "ally"
  | "neutral"
  | "hostile";

export interface LegendItem {
  swatch: string;
  labelKey: LegendLabel;
}

// Палитра — значения токенов темы 1946 (client/src/styles/tokens-1946.css),
// не отдельная выдуманная палитра; MapLibre paint не читает CSS var().
const OK = "#7aa653";
const OK_MID = "#5c7a3f";
const OK_DIM = "#374a30";
const WARN = "#c9762a";
const CRIT = "#cf4436";
const ACCENT = "#e6a338";
const ACCENT_DIM = "#8a6a2a";
const HAIRLINE_2 = "#3a4b3d";
const PAPER_DIM = "#9ba08c";

/**
 * region.stability/development/infrastructure — дробная шкала 0..1 в
 * рантайме (проверено на живом GameState, docs/plans/12_UI_REDESIGN.md
 * Срез 2 — см. ContextPanel.tsx), не 0..100 как Country.politics.*.
 * Пороги ниже — на той же 0..1 шкале.
 */
const DEV_HIGH = 0.6;
const DEV_MID = 0.35;

// Реальные перцентили deposits/population на живом сценарии 1946 (см. отчёт
// Среза 2в): deposits p25≈280, p75≈1650; population p25≈300К, p75≈1.5М.
const DEPOSITS_RICH = 1500;
const DEPOSITS_MEDIUM = 250;
const POPULATION_DENSE = 1_500_000;
const POPULATION_MEDIUM = 300_000;

function tierDev(value: number): string {
  if (value >= DEV_HIGH) return OK;
  if (value >= DEV_MID) return OK_MID;
  return OK_DIM;
}

export function computeMapModeColors(
  mode: MapMode,
  regions: Region[],
  countries: Country[],
  playerCountryId: string,
): Record<number, string> | null {
  if (mode === "powers") return null;

  const countryById = new Map(countries.map(c => [c.id, c]));
  const colors: Record<number, string> = {};

  for (const r of regions) {
    switch (mode) {
      case "industry":
        colors[r.id] = tierDev(r.development);
        break;
      case "infrastructure":
        colors[r.id] = tierDev(r.infrastructure);
        break;
      case "unrest":
        // Красится ОБРАТНОЙ величиной: поля «недовольство» в данных нет, есть
        // `stability`, поэтому низкая устойчивость даёт красный. Это не мнимая
        // инверсия — «починив» её, режим начнёт врать.
        colors[r.id] = r.stability < 0.4 ? CRIT : r.stability < 0.6 ? WARN : OK;
        break;
      case "population":
        colors[r.id] =
          r.population >= POPULATION_DENSE ? OK : r.population >= POPULATION_MEDIUM ? OK_MID : OK_DIM;
        break;
      case "resources": {
        const total = Object.values(r.deposits).reduce((s: number, v) => s + (v ?? 0), 0);
        colors[r.id] = total >= DEPOSITS_RICH ? ACCENT : total >= DEPOSITS_MEDIUM ? ACCENT_DIM : HAIRLINE_2;
        break;
      }
      case "relations": {
        // ПАРНОЕ отношение владельца региона к игроку, не членство в блоке:
        // двух чужих блоков между собой этот режим не показывает и показать не
        // может — поэтому он и называется «Отношения» (docs/IDEAS.md о настоящих
        // блоках).
        if (r.ownerCountryId === playerCountryId) {
          colors[r.id] = ACCENT;
          break;
        }
        const owner = countryById.get(r.ownerCountryId);
        const relation = owner?.diplomacy.relations[playerCountryId] ?? 0;
        colors[r.id] = relation > 20 ? OK : relation < -20 ? CRIT : PAPER_DIM;
        break;
      }
    }
  }
  return colors;
}

/**
 * ЛЕГЕНДА живёт рядом с раскраской нарочно: цвет и его объяснение меняются
 * одной правкой. Прежняя вторая легенда сидела в `Screen.tsx`, описывала
 * непрерывный градиент, которого раскраска не даёт, и ключевана была чужим
 * словарём — то есть не показывалась вовсе.
 *
 * Возврат `[]` — «цвет здесь не означает величину», и экран легенду не рисует.
 */
export function legendForMode(mode: MapMode): LegendItem[] {
  switch (mode) {
    case "powers":
      return [];
    case "industry":
    case "infrastructure":
      return [
        { swatch: OK, labelKey: "high" },
        { swatch: OK_MID, labelKey: "medium" },
        { swatch: OK_DIM, labelKey: "low" },
      ];
    case "unrest":
      return [
        { swatch: OK, labelKey: "calm" },
        { swatch: WARN, labelKey: "tense" },
        { swatch: CRIT, labelKey: "unrest" },
      ];
    case "population":
      return [
        { swatch: OK, labelKey: "dense" },
        { swatch: OK_MID, labelKey: "moderate" },
        { swatch: OK_DIM, labelKey: "sparse" },
      ];
    case "resources":
      return [
        { swatch: ACCENT, labelKey: "rich" },
        { swatch: ACCENT_DIM, labelKey: "moderate" },
        { swatch: HAIRLINE_2, labelKey: "poor" },
      ];
    case "relations":
      return [
        { swatch: ACCENT, labelKey: "own" },
        { swatch: OK, labelKey: "ally" },
        { swatch: PAPER_DIM, labelKey: "neutral" },
        { swatch: CRIT, labelKey: "hostile" },
      ];
  }
}
