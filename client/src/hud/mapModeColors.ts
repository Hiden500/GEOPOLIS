import { type Region } from "@shared/types/map/Region";
import { type Country } from "@shared/types/Country";

export type MapMode = "pol" | "eco" | "res" | "pop" | "sta" | "dip" | "mil" | "inf";

export const MAP_MODE_ORDER: MapMode[] = ["pol", "eco", "res", "pop", "sta", "dip", "mil", "inf"];

export interface LegendItem {
  swatch: string;
  labelKey: string;
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
const STEEL_3 = "#263329";
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
  if (mode === "pol") return null;

  const countryById = new Map(countries.map(c => [c.id, c]));
  const colors: Record<number, string> = {};

  for (const r of regions) {
    switch (mode) {
      case "eco":
        colors[r.id] = tierDev(r.development);
        break;
      case "inf":
        colors[r.id] = tierDev(r.infrastructure);
        break;
      case "sta":
        colors[r.id] = r.stability < 0.4 ? CRIT : r.stability < 0.6 ? WARN : OK;
        break;
      case "pop":
        colors[r.id] =
          r.population >= POPULATION_DENSE ? OK : r.population >= POPULATION_MEDIUM ? OK_MID : OK_DIM;
        break;
      case "res": {
        const total = Object.values(r.deposits).reduce((s: number, v) => s + (v ?? 0), 0);
        colors[r.id] = total >= DEPOSITS_RICH ? ACCENT : total >= DEPOSITS_MEDIUM ? ACCENT_DIM : HAIRLINE_2;
        break;
      }
      case "dip": {
        if (r.ownerCountryId === playerCountryId) {
          colors[r.id] = ACCENT;
          break;
        }
        const owner = countryById.get(r.ownerCountryId);
        const relation = owner?.diplomacy.relations[playerCountryId] ?? 0;
        colors[r.id] = relation > 20 ? OK : relation < -20 ? CRIT : PAPER_DIM;
        break;
      }
      case "mil":
        // Упрощённая эвристика (нет прямого аналога фронт/тыл/гарнизон в
        // данных, см. решение пользователя 2026-07-13): оккупирован → фронт,
        // иначе тыл. Уточнится, когда появится реальная линия фронта.
        colors[r.id] = r.occupiedBy ? CRIT : STEEL_3;
        break;
    }
  }
  return colors;
}

export function legendForMode(mode: MapMode): LegendItem[] {
  switch (mode) {
    case "pol":
      return [];
    case "eco":
    case "inf":
      return [
        { swatch: OK, labelKey: "high" },
        { swatch: OK_MID, labelKey: "medium" },
        { swatch: OK_DIM, labelKey: "low" },
      ];
    case "sta":
      return [
        { swatch: OK, labelKey: "calm" },
        { swatch: WARN, labelKey: "tense" },
        { swatch: CRIT, labelKey: "unrest" },
      ];
    case "pop":
      return [
        { swatch: OK, labelKey: "dense" },
        { swatch: OK_MID, labelKey: "medium" },
        { swatch: OK_DIM, labelKey: "sparse" },
      ];
    case "res":
      return [
        { swatch: ACCENT, labelKey: "rich" },
        { swatch: ACCENT_DIM, labelKey: "medium" },
        { swatch: HAIRLINE_2, labelKey: "poor" },
      ];
    case "dip":
      return [
        { swatch: ACCENT, labelKey: "own" },
        { swatch: OK, labelKey: "ally" },
        { swatch: PAPER_DIM, labelKey: "neutral" },
        { swatch: CRIT, labelKey: "hostile" },
      ];
    case "mil":
      return [
        { swatch: CRIT, labelKey: "front" },
        { swatch: STEEL_3, labelKey: "rear" },
      ];
  }
}
