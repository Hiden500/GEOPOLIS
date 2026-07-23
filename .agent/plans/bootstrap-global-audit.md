# Global audit и минимальная agent OS

Status: complete
Owner: Codex `/root`
Starting commit: `470a719748c3aab3a73d82f213706f0fd3e60abf`

## Objective and observable outcome

Выполнить `docs/tasks/GLOBAL_AUDIT.md`: получить доказательный baseline,
независимые audits, минимальную проверяемую repository-local agent OS,
public regression suite и честный итог без push/merge/deploy.

## Scope and constraints

В scope: instructions, skills, custom agents, Codex/MCP adapters, docs truth,
evals, run records и CI guardrail. Application behavior не меняется. Секреты,
production, remote Git и hidden benchmark исключены. Чужие worktrees не
редактируются.

## Assumptions and unknowns

- Managed session policy наблюдаема, exact model/reasoning/token cost — unknown.
- Repo-local Codex loading требует fresh trusted session.
- `codex.exe` есть, но CLI execution blocked by Windows access control.
- Client lint имеет documented baseline из 20 errors.

## Alternatives and selected decision

Выбрана компактная root policy + четыре path-scoped instructions + шесть узких
skills + один read-only reviewer + stdlib public eval. Не выбраны новые MCP,
agent packs, dependencies, Codex hooks и rules: пользы сверх существующих
controls нет либо runtime effect нельзя валидировать в текущей сессии.

## Progress

- [x] Baseline inventory и реальные проверки.
- [x] Независимый audit agent-конфигурации.
- [x] Независимый audit документации.
- [x] Проектирование target architecture.
- [x] Реализация config/docs/evals.
- [x] Targeted и regression validation.
- [x] Independent final review, docs footprint, commits и итоговый run record.

## Discoveries

- Всегда загружаемый контекст требовал полный append-only decision log.
- `model_verbosity` был вложен не в тот TOML section.
- Старые prompt/docs конфликтовали по ownership, freeze и реальным путям.
- Map rebuild не воспроизводим: нет Python manifest/PyShp; CLI help ломается в
  Windows encoding.
- Local `codex` CLI недоступен, поэтому new rules/hooks нельзя валидировать.

## Decision log

- 2026-07-15: nested instructions оправданы разными commands/invariants четырёх
  модулей; остальные каталоги используют root.
- 2026-07-15: UI custom agent разделён на read-only reviewer; writer остаётся
  main agent.
- 2026-07-15: no hooks/rules until a consumer/effect test exists.
- 2026-07-15: public eval не добавляет dependencies и запускается в CI.

## Validation

Обязательны: TOML/JSON parse, public eval, Markdown links, `git diff --check`,
client/server typecheck+tests, client lint/build, data validators, npm audits и
final diff review. Fresh-session loading остаётся отдельным requirement.

## Rollback / containment

Все изменения repository-local и отделены в task branch. Откат — обычный revert
логических commits; чужие worktrees/remote refs не затрагиваются.

## Final outcome

Минимальная repository-local agent OS реализована и зафиксирована коммитом
`bea1b7dbb25782c72064ac2d13f0ab8d9da7e0a5`. Public eval, regression matrix,
data validators, config parsing и independent adversarial review пройдены без
новых failures. Предсуществующие client lint errors, bundle warning и LOW
root npm advisory сохранены как baseline. Fresh-session loading, Node 22 CI,
browser flow и полный map rebuild остаются явно непроверенными.
