/**
 * Замер дипломатической динамики на ЖИВОМ сценарии 1946.
 *
 * ЗАЧЕМ. Порог перехода (соперничество, союз, война) — это ветка, которая при
 * недостижимом пороге просто не берётся: код выглядит исправным, поведения нет.
 * Поэтому вопрос здесь не «работает ли функция», а «сколько раз мир реально
 * пересёк порог за партию» — и обратимо ли пересечение.
 *
 * Появился при независимой проверке ветки `claude/diplomacy-thresholds`
 * (2026-07-31) и сразу показал то, чего не видел ни один отчёт: числа
 * дипломатии, снятые ДО влития правок экономики, после них не воспроизводятся.
 * Причина — `nationalPower` считается от бюджета, а от неё зависит, кого
 * «доминирует игрок» в Правиле B, то есть кому раздаётся контр-блок. Дипломатию
 * нужно мерить на актуальной базе, а не ссылаться на прошлый замер.
 *
 * Запуск:  npx tsx scripts/probeDiplomacy.ts
 */
import { createGame } from "../src/game/CreateGame";
import { simulateMonth } from "../src/simulation/SimulationEngine";
import { type GameState } from "@shared/types/GameState";

interface Counts {
  rivals: number;
  allies: number;
  wars: number;
  rivalPairs: Set<string>;
}

/**
 * Записи ДВУСТОРОННИЕ: пара кладётся обеим сторонам, поэтому «36 записей» — это
 * 18 пар. Пары собираются отдельным множеством, чтобы не делить на два в уме.
 */
function counts(game: GameState): Counts {
  let rivals = 0;
  let allies = 0;
  const rivalPairs = new Set<string>();

  for (const country of game.countries) {
    rivals += country.diplomacy.rivals?.length ?? 0;
    allies += country.diplomacy.allies?.length ?? 0;
    for (const rival of country.diplomacy.rivals ?? []) {
      rivalPairs.add([country.id, rival].sort().join("-"));
    }
  }

  const wars = game.wars?.filter(war => war.active !== false).length ?? 0;
  return { rivals, allies, wars, rivalPairs };
}

function relationSpread(game: GameState): { min: number; max: number; count: number } {
  const values: number[] = [];
  for (const country of game.countries) {
    for (const value of Object.values(country.diplomacy.relations ?? {})) {
      if (typeof value === "number") values.push(value);
    }
  }
  return values.length
    ? { min: Math.min(...values), max: Math.max(...values), count: values.length }
    : { min: Number.NaN, max: Number.NaN, count: 0 };
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "n/a";
}

function main(): void {
  const game = createGame("1946", "USA");
  const checkpoints = [0, 12, 60, 120];
  const firstSeen = new Map<string, number>();
  let simulated = 0;

  for (const checkpoint of checkpoints) {
    for (; simulated < checkpoint; simulated++) simulateMonth(game);

    const current = counts(game);
    const spread = relationSpread(game);
    for (const pair of current.rivalPairs) {
      if (!firstSeen.has(pair)) firstSeen.set(pair, checkpoint);
    }

    console.log(
      `месяц ${String(checkpoint).padStart(3)}: ` +
      `соперничеств ${String(current.rivals).padStart(4)} | ` +
      `союзов ${String(current.allies).padStart(4)} | ` +
      `войн ${current.wars} | ` +
      `записей отношений ${String(spread.count).padStart(5)} | ` +
      `диапазон ${fmt(spread.min)}…${fmt(spread.max)}`
    );
  }

  // Обратимость: соперничество, из которого никто не выходит, — не отношение, а
  // несмываемая метка. Разница «побывало» против «осталось» и есть проверка того,
  // что порог примирения достижим не только на бумаге.
  const finalPairs = counts(game).rivalPairs;
  const stillRivals = [...firstSeen.keys()].filter(pair => finalPairs.has(pair)).length;
  const lastCheckpoint = checkpoints[checkpoints.length - 1];
  console.log(
    `\nпар побывало в соперничестве: ${firstSeen.size}, ` +
    `из них остались к ${lastCheckpoint}-му месяцу: ${stillRivals}`
  );
}

main();
