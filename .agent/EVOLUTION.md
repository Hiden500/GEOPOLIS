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
