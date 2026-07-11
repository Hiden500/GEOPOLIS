/**
 * Единый слой мутации GameState (docs/plans/03_MODIFIERS_COMMANDS.md,
 * MASTER_PROMPT.md правило 2). Команда — функция `(game, ...params) =>
 * CommandResult`; LLM-действия, роуты игрока и AiBehaviorTick вызывают одни
 * и те же команды вместо прямой мутации полей или разрозненных вызовов
 * сервисов. Расположение — `server/src/commands/`, не `shared/src/sim/
 * commands/` (буква правила 2): весь слой тиков сегодня физически живёт в
 * `server/src/simulation/`, не в `shared/src/sim/` (такой директории не
 * существует) — решение зафиксировано в docs/DECISIONS.md.
 */
export interface CommandResult {
  success: boolean;
  error?: string;
}
