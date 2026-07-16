# Evidence-gated evolution

Этот журнал фиксирует изменения persistent agent system, а не историю feature-
разработки. Он не заменяет Git и не даёт агенту права самостоятельно менять
границы из `CHARTER.proposed.md`.

## Правило изменения

Durable изменение допустимо, когда одновременно есть:

1. повторяющийся failure, измеряемая потеря или стабильное ограничение;
2. evidence из repository/runtime, а не единичное предпочтение;
3. выбран самый узкий слой;
4. определены expected benefit и regression risk;
5. есть validation или честный future-session gate;
6. человек сохраняет контроль над security/product boundaries.

Не оптимизировать по скрытому benchmark, числу артефактов, объёму prompt или
одному self-reported success. Автоматическое изменение charter, permissions,
approval/network/sandbox policy запрещено.

## Шаблон записи

```text
Дата / change id:
Problem evidence:
Layer changed:
Expected benefit:
Risks and containment:
Validation:
Fresh-session status:
Decision: keep | revise | revert | pending human review
```

## 2026-07-15 — `bootstrap-global-audit-2026-07-15`

Observed problem: persistent agent layers конфликтовали и не имели общего
проверяемого run/eval contract.

Evidence: root instructions 21,355 bytes; обязательная тройка
AGENTS+TODO+DECISIONS оценена примерно в 42k tokens (`chars/4`); prompt/docs
конфликтовали по precedence, ownership, freeze и путям; `verify-change` не
соответствовал CI; Codex key был в неверном TOML scope.

Root-cause hypothesis: process/domain/history были продублированы в always-
loaded и provider-specific prompts, а structural presence ошибочно заменяла
runtime validation.

Changed files/layers:

- `AGENTS.md` и `client/`, `server/`, `shared/`, `scripts/map/AGENTS.md`;
- `.agents/skills/*`, Claude mirror `verify-change`;
- `.codex/config.toml`, `.codex/agents/ui-reviewer.toml`, Claude reviewer,
  `.gemini/GEMINI.md`, `.mcp.json`;
- `.agent/{CHARTER.proposed,PLANS,EVOLUTION}.md`, audits, plan, schema, runs,
  public eval;
- `.github/workflows/doc-guardrails.yml`, onboarding и подтверждённо stale
  canonical/historical docs из Phase 2.

Expected benefit: меньше always-loaded context, безопаснее Git startup,
явные module checks, машино-проверяемые config regressions и честная граница
между static presence и fresh-session operational status.

Risks and containment: provider loading semantics могут отличаться; changes
остаются task-branch-local. Codex rules/hooks не добавлены без executable
effect validation. Proposed charter не выдаётся за immutable control.

Verification method: compare context bytes, parse TOML/JSON, run public eval,
project regression matrix, Markdown link check, diff review и independent
adversarial review. Fresh-session status: pending.

Result: static/config validation, project regression matrix и независимый
adversarial review завершены без новых failures. Итоговая запись:
`.agent/runs/bootstrap-final.json`.

Fresh-session status: pending — repo-local Codex loading и MCP/custom-agent
spawn нельзя подтвердить в текущей сессии из-за недоступного `codex.exe`.

Decision: `KEEP`. Human review of charter remains separate from this technical
decision.

## 2026-07-16 — `ui-wireframe-approval-before-layout`

Problem evidence: P1-компоновка Header была реализована до согласования
геометрии с пользователем. В результате «мостик» ошибочно растянулся на весь
viewport, а зона кнопок заняла пространство сверх фактического числа кнопок;
пользователь отклонил итерацию и потребовал откат.

Layer changed: `client/AGENTS.md`, потому что правило относится только к
user-facing UI-компоновке, а не ко всей инженерной работе репозитория.

Expected benefit: до CSS/React-изменений стороны одинаково понимают границы,
content-sized/fixed/stretch поведение и целевые viewport; меньше дорогих
визуальных откатов после реализации.

Risks and containment: обязательное согласование замедляет мелкие UI-правки.
Правило ограничено нетривиальной компоновкой; read-only review, точечные
доступностные исправления и возврат явно отклонённой итерации не требуют новой
схемы.

Validation: public agent eval и diff review после изменения инструкции.
Fresh-session status: pending — загрузка правила подтвердится следующей сессией.
Decision: keep по прямому требованию пользователя.

## 2026-07-16 — `strategy-game-ui-codex-adaptation`

Problem evidence: существующие repo-local workflows не покрывали scenario-first
UI/UX discovery, strategy-game information architecture, design-plan review и
rendered visual QA единым Codex-compatible skill. Запрошенные upstream packs
содержат Claude slash commands, fixed agent hierarchies, hooks, telemetry,
home-directory artifacts и фиксированные GDD paths, несовместимые с текущими
repository boundaries.

Layer changed: добавлен только `.agents/skills/strategy-game-ui/**`; root/nested
`AGENTS.md`, product docs, игровой UI и код не изменялись. Skill использует
progressive disclosure, read-only audit default и repository-first discovery.

Expected benefit: интерфейсные сценарии выводятся из механик и кода, а не из
предзаданного списка экранов; UX review, visual QA и plan review используют общий
evidence/state/accessibility contract без установки внешних packs.

Risks and containment: адаптация может потерять часть узких upstream эвристик;
сохранены exact revisions, MIT notices и mapping принятых/отклонённых механизмов.
Scores запрещены без полного evidence coverage; runtime claims остаются
`PARTIAL/UNKNOWN` без скриншотов или живого flow.

Validation: official `quick_validate.py` — `Skill is valid!`; public agent eval —
132 passed, 0 failed; локальные Markdown links разрешились; executable
Claude/Bun/provider-only directive scan не нашёл совпадений. Fresh-context Codex
обнаружил `$strategy-game-ui`, загрузил references/templates и выполнил узкий
read-only mini-audit без изменений файлов.

Fresh-session status: verified for skill discovery and explicit invocation;
runtime/visual-QA capability проверяется отдельно на реальном проекте.
Decision: keep.
