# Shared rules

Применяется к `shared/` вместе с корневым `AGENTS.md`.

- Shared state — plain JSON-serializable data без классов, методов, runtime
  dependencies и client/server imports.
- Новые user-facing names используют `LocalizedText`, не plain `string`.
- Сохраняй совместимость loaders, schemas, saves и обоих consumers. Изменение
  public type требует поиска всех client/server consumers и обеих typechecks.
- `shared/src/types/` не меняется параллельно в нескольких ветках; сначала
  проверь другие worktrees и координационные записи.

После изменения запусти typecheck и тесты обоих workspaces согласно
`.agents/skills/verify-change/SKILL.md`.
