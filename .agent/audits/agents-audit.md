# Аудит agent-конфигурации — Phase 1

Дата: 2026-07-15
Область: repository-local инструкции и конфигурация Codex, Claude, Gemini, MCP, skills, Git hooks и experiment boundary.
Режим: read-only аудит; этот файл — единственный артефакт Phase 1, созданный после анализа. Подготовительные коммиты ветки рассматривались как baseline, а не как заведомо правильные решения.

Метки доказательности:

- **VERIFIED** — подтверждено чтением файла, Git/config-командой или синтаксическим парсингом.
- **INFERRED** — вывод из нескольких проверенных фактов, но без живого прогона клиента.
- **UNKNOWN** — нет достаточного runtime evidence.

## Краткий вывод

**VERIFIED:** система перегружена несколькими конкурирующими слоями. Root `AGENTS.md`, `docs/agent/MASTER_PROMPT.md`, `PROTOCOLS.md`, `.gemini/GEMINI.md`, клиентские agent definitions и старые worktree-копии дублируют workflow и противоречат друг другу по путям, ownership и freeze-состояниям. Самый опасный конфликт — `MASTER_PROMPT.md:3-6`, где обычный tracked doc объявляет себя более приоритетным, чем `AGENTS.md`, хотя его правило 2 ссылается на несуществующий `shared/src/sim/commands/`.

**VERIFIED:** `.codex/config.toml` и JSON-конфиги синтаксически корректны, но `model_verbosity` фактически вложен в `shell_environment_policy`, а не находится на верхнем уровне. Repo-local skills и MCP-инструменты не были представлены в каталоге текущей сессии; их структура существует, но операционность не подтверждена.

**VERIFIED:** human-owned experiment boundary отсутствует: нет `.agent/CHARTER.proposed.md`, `.agent/PLANS.md`, public evals, run schema и Codex rules/hooks. Появившийся параллельно `.agent/audits/baseline.md` относится к Phase 0 и не закрывает эти пробелы.

## Инвентарь и иерархия

### Инструкции

- **VERIFIED:** tracked `AGENTS.md` только один — корневой, 21 355 байт. Tracked nested `AGENTS.md` и `AGENTS.override.md` отсутствуют.
- **VERIFIED:** `docs/agent/` содержит пять instruction-like документов: `MASTER_PROMPT.md`, `PROTOCOLS.md`, `STACK_PLAYBOOK.md`, `ARCHITECTURE_GUARDRAILS.md`, `TEMPLATES.md`.
- **VERIFIED:** `.claude/CLAUDE.md` — always-loaded Claude adapter с большим auto-generated Repowise protocol; `.gemini/settings.json` перечисляет `GEMINI.md` и `AGENTS.md` как context files.
- **VERIFIED:** зарегистрированы два отдельных Git worktree под `.claude/worktrees/`; это не nested hierarchy текущего checkout, но их старые root `AGENTS.md` становятся активными при запуске агента внутри worktree.
  - `loving-clarke-e6395e`: `AGENTS.md` 18 015 байт, старое эксклюзивное владение картой Gemini; worktree содержит незакоммиченный UI-дифф.
  - `strategy-game-ui-design-91419b`: `AGENTS.md` 21 370 байт, также не совпадает с текущим root.

### Skills и agents

- **VERIFIED:** `.agents/skills/`: `investigate`, `plan-challenger`, `qa`, `security-audit`, `token-audit`, `verify-change`; первые пять имеют `agents/openai.yaml`.
- **VERIFIED:** `.agents/skills/verify-change/SKILL.md` и `.claude/skills/verify-change/SKILL.md` byte-for-byte одинаковы.
- **VERIFIED:** `.codex/agents/ui-designer.toml` и `.claude/agents/ui-designer.md` содержат одну роль с тремя намеренными client-specific различиями (`Codex`/`Claude`, `Codex Browser`/`Claude Browser`). TOML имеет обязательные `name`, `description`, `developer_instructions`.
- **UNKNOWN:** repo-local skills и custom UI-agent не прошли fresh-session loading/spawn test. В skill catalog текущей сессии новые skills отсутствовали.

### Config, MCP и hooks

- **VERIFIED:** существуют `.codex/config.toml`, `.mcp.json`, `.claude/settings.json`, ignored `.claude/settings.local.json`, `.claude/launch.json`, `.gemini/settings.json`.
- **VERIFIED:** `.codex/rules/` и `.codex/hooks/` отсутствуют.
- **VERIFIED:** MCP Repowise продублирован в `.codex/config.toml` и `.mcp.json` с абсолютным `D:/Pax Historia LOCAL`; Context7 также объявлен в обоих client formats.
- **VERIFIED:** единственный активный Git hook — `.git/hooks/post-commit`; он фоново и non-blocking запускает PATH-resolved `repowise update`, пишет только в ignored `.repowise/` и скрывает ошибки. Остальные 14 файлов — стандартные инертные `*.sample`.
- **VERIFIED:** `core.hooksPath` не настроен; используется локальный `.git/hooks`, поэтому hook не переносится в новый clone.

## Находки по серьёзности

### CRITICAL

1. **Tracked doc самоназначает себе instruction precedence.**
   **VERIFIED:** `docs/agent/MASTER_PROMPT.md:3-6` требует применять себя поверх `AGENTS.md` и побеждать при конфликте. `AGENTS.md:44` дополнительно объявляет любой будущий файл в `docs/` авторитетным. Это нарушает trust hierarchy и позволяет обычному продуктному документу расширить полномочия агента.
   Рекомендация: удалить precedence-формулировку; `docs/` считать спецификациями/evidence, но не instruction layer.

2. **Human-owned experiment boundary отсутствует.**
   **VERIFIED:** не найдены charter, protected paths, run schema, public agent-config evals или внешне immutable policy. Текстовые запреты агент может изменить в том же writable workspace.
   Рекомендация: создать `.agent/CHARTER.proposed.md` с явной пометкой «proposal», а реальную неизменяемость обеспечить вне agent-writable repository.

### HIGH

3. **Конкурирующие источники истины уже содержат прямые конфликты.**
   - `AGENTS.md:26` говорит, что war не построен; `WarTick.ts`, `WarService.ts` и `docs/WAR.md:5` подтверждают Phase 1 и часть Phase 2.
   - `AGENTS.md:35` помечает карту frozen, но `AGENTS.md:304-310` снимает freeze в том же файле.
   - `GEMINI.md:10-17` назначает `client/` Gemini; `AGENTS.md:297-318` и `DECISIONS.md:58-78` — Claude/Codex.
   - `GEMINI.md:87,145-149,205` сохраняет снятое требование Zustand, старые UI/map freeze и единый `App.css`; фактически в `client/src` уже много CSS modules/token files.
   - `MASTER_PROMPT.md:42` требует несуществующий `shared/src/sim/commands/`; реальный слой — `server/src/commands/`. Конфликт сознательно записан в `DECISIONS.md:758-769`, но permanent source не исправлен.

4. **Наиболее строгая concurrency-защита указывает не на тот каталог.**
   **VERIFIED:** `AGENTS.md:299,349-362` и `GEMINI.md:16,228,237` запрещают параллельно менять `shared/types/`, которого нет; реальный путь — `shared/src/types/`.

5. **Startup protocol небезопасен для автономных/worktree-сессий.**
   **VERIFIED:** `AGENTS.md:343`, `PROTOCOLS.md:9` и `GEMINI.md:27` требуют unconditional `git checkout main && git pull`. Это мутирует checkout/remote state до проверки dirty worktree и противоречит изолированной task-ветке. Один зарегистрированный worktree уже dirty.
   Рекомендация: startup должен начинаться с `git status`, branch/log/worktree inspection; fetch/pull/switch — только когда они нужны и разрешены.

6. **Codex config содержит семантически неверную область ключа.**
   **VERIFIED:** `tomllib` вывел top-level keys только `mcp_servers` и `shell_environment_policy`; `model_verbosity` находится внутри последнего. В официальном Codex config reference это top-level key. Runtime effect **UNKNOWN**.

7. **Структурное наличие skills/MCP ошибочно принято за операционность.**
   **VERIFIED:** `DECISIONS.md:33-36` заявляет лишь локальную структурную проверку и честно отмечает провал official validator из-за PyYAML. В текущей сессии отсутствовали repo-local skills, Repowise и Context7 tools.
   Рекомендация: fresh-session instruction/skill/MCP smoke обязателен до статуса operational.

### MEDIUM

8. **Повторный context cost несоразмерен большинству задач.**
   Root требует всегда читать полный `TODO.md` и `DECISIONS.md`; вместе с root это примерно 41 955 токенов по грубой оценке `bytes/4`, ещё до domain docs и кода.

9. **`verify-change` неполон относительно реального CI.**
   **VERIFIED:** skill запускает typecheck+tests, но пропускает client lint, правило `shared/ -> оба workspace`, data validator/unit test и agent-config validation. `.github/workflows/ci.yml:19-62` содержит более полный набор.

10. **Архитектурные fitness claims шире фактического покрытия.**
    **VERIFIED:** `architecture.test.ts` покрывает правила 1, 5, 10, 6 частично, 2 частично и 4. Правила 3, 7, 8, 9 не имеют эквивалентной автоматической проверки; JSON round-trip не обнаруживает производные plain arrays/objects, поэтому утверждение, что rule 1 покрывает rule 9, неверно.

11. **UI-agent одновременно reviewer и writer.**
    **VERIFIED:** он требует mandatory read-only Phase 1 и остановку для любого UI-запроса, затем Phase 2 с write tools. Это нельзя надёжно выразить одним постоянным `sandbox_mode`, блокирует прямые явно заказанные мелкие UI-правки и ссылается на недоступные в текущей сессии `preview_*`/design skills.
    Рекомендация: отдельный read-only `ui-reviewer`; реализация — main/worker после уже существующего product direction.

12. **MCP-конфиг непереносим и не описывает data-egress boundary.**
    **VERIFIED:** абсолютный Windows path продублирован в двух конфигурациях. `repowise mcp --help` подтверждает, что path необязателен и current directory поддерживается; также Repowise загружает `.repowise/.env`. Context7 — remote HTTP MCP. Нет описания, какие repository fragments допустимо отправлять наружу.

13. **Git hook нельзя считать control.**
    **VERIFIED:** background update не блокирует commit, скрывает failures, наследует environment, разрешает binary через PATH и не переносится в clone. Он годится только как machine-local convenience.

### LOW

14. `DECISIONS.md:38-56` утверждает, что общий слой соглашений находится в root `AGENTS.md`; commit `470a719` удалил этот слой, но correction-entry нет.
15. `.claude/CLAUDE.md:40-45` говорит, что self-reported `verified` Repowise response заменяет source read, что конфликтует с его же `:16-17` и maximum-honesty trust model.
16. `.claude/launch.json` использует server port 3000 корректно, но `autoPort=true` не проверен совместно с фиксированным client proxy `localhost:3000`.

## KEEP / REWRITE / MOVE / DELETE

| Источник | Классификация | Решение |
|---|---|---|
| `AGENTS.md:1-53` | `REWRITE` | Оставить язык, миссию и компактный routing только к явно названным canonical docs; удалить текущие статусы и blanket authority всех docs. |
| `AGENTS.md:55-70` | `REWRITE` | Docs footprint обязателен только при изменении поведения, архитектуры, решения или backlog; read-only работа не должна автоматически мутировать docs. |
| `AGENTS.md:74-106` | `MOVE_TO_DOCS` | Конвенции TODO/DECISIONS должны жить в заголовках этих файлов или docs-maintenance skill. |
| `AGENTS.md:110-121` | `MOVE_TO_SKILL` | Подробный Repowise protocol условный; root оставляет «используй, если доступен». |
| `AGENTS.md:125-148` | `DELETE` | Generic understand/reuse уже покрыты higher-level working agreements. |
| `AGENTS.md:152-181` | `MOVE_TO_NESTED_AGENTS` | `client/AGENTS.md` + `shared/AGENTS.md`, с canonical ссылкой на `LOCALIZATION.md`. |
| `AGENTS.md:185-195` | `KEEP`/`REWRITE` | Сохранить compact maximum-honesty/professional judgment; approval только для реально неразрешённых material decisions. |
| `AGENTS.md:199-266,278-284` | `MOVE_TO_DOCS` | Game-design, scale, regions, economy, diplomacy и sourcing уже имеют профильные docs. |
| `AGENTS.md:267-274` | `MOVE_TO_NESTED_AGENTS` | LLM determinism boundary — `server/AGENTS.md` + `LLM_RULES.md`. |
| `AGENTS.md:288-330` | `DELETE`/`MOVE_TO_DOCS` | История model ownership/MAS не должна быть always-loaded. |
| `AGENTS.md:332-369` | `REWRITE` | Оставить worktree isolation и реальный `shared/src/types`; branch startup вынести в skill. |
| `AGENTS.md:373-393` | `KEEP`/`REWRITE` | Exact verification, local-commit authorization, запрет push/rewrite; убрать Repowise как причину обязательного коммита. |
| `AGENTS.md:397-405` | `DELETE` | Response template — не repository architecture. |
| `MASTER_PROMPT.md:3-6` | `DELETE` | Удалить self-precedence. |
| Конституция `MASTER_PROMPT.md` | `REWRITE`/`MOVE_TO_NESTED_AGENTS` | Сохранить доказанные plain-JSON, determinism, LLM/Zod и layer rules; исправить commands path; сузить blanket modifier/registry/derived-state правила. |
| Workflow/autonomy в `MASTER_PROMPT.md` | `MOVE_TO_SKILL`/`REWRITE` | Conditional feature workflow — skill; autonomy boundary — коротко root; stale freeze удалить. |
| `PROTOCOLS.md` startup/analysis/feature/refactor/data | `MOVE_TO_SKILL` | Это условные повторяемые процедуры, не always-loaded authority. |
| `PROTOCOLS.md` UI regression | `MOVE_TO_AGENT`/`MOVE_TO_PLAN` | Durable UI reviewer rules и конкретные live specs; удалить hardcoded model/reasoning и саморедактирование без evidence. |
| `STACK_PLAYBOOK.md` | `KEEP`/`MOVE_TO_DOCS` | Оставить explanatory stack/commands, выводимые из manifests/CI; verification перенести в skill, stale freeze исправить. |
| `ARCHITECTURE_GUARDRAILS.md` | `KEEP`/`REWRITE` | Реестр implemented/planned/manual fitness checks; periodic report без scheduler/consumer — `MOVE_TO_PLAN` или `DELETE`. |
| `TEMPLATES.md` | `MOVE_TO_SKILL`/`MOVE_TO_PLAN`/`DELETE` | TDD/bug/review — skill; Task Breakdown — ExecPlan; canned completion/proposal — удалить. |
| `investigate`, `plan-challenger`, `qa`, `security-audit`, `token-audit` | `KEEP`/`REWRITE` | Узкие read-only triggers оправданы; сузить обязательные full-doc reads, mutation scope и unavailable-tool assumptions. |
| Два `verify-change` | `REWRITE` | Один канонический workflow с cross-client parity check и реальным CI matrix. |
| `.codex/config.toml` | `REWRITE` | Исправить key scope, portability, safe defaults; не добавлять непроверенные функции. |
| Codex/Claude UI agents | `MOVE_TO_AGENT`/`REWRITE` | Один read-only reviewer contract; writer остаётся main/worker; parity проверяется автоматически. |
| `.claude/CLAUDE.md` generated tool protocol | `MOVE_TO_SKILL`/`REWRITE` | Wrapper к root оставить, tool details загружать условно, self-reported verification не считать authority. |
| `.claude/settings.json`, ignored local permissions | `KEEP` | Узкие, без явных секретов; local file не трекать. |
| `.gemini/GEMINI.md` | `REWRITE` | Оставить только реально Gemini-specific capabilities; workflow/commands/docs/Git не дублировать. |
| `.mcp.json` | `REWRITE` | Убрать absolute path и описать trust/network boundary; новых providers не добавлять. |
| `.git/hooks/post-commit` | `KEEP` | Только локальное удобство, не enforcement. |
| `*.sample` hooks | `DELETE` из логической архитектуры | Инертные Git templates, действий не требуют. |

## Context cost и autonomy blockers

Грубая оценка `bytes / 4`, не tokenizer output:

| Контекст | Примерная стоимость |
|---|---:|
| root `AGENTS.md` | 5 339 токенов |
| `TODO.md` | 8 780 |
| `DECISIONS.md` | 27 836 |
| Обязательная тройка до domain docs | 41 955 |
| root + `.claude/CLAUDE.md` | 7 141 |
| root + `.gemini/GEMINI.md` | 8 892 |
| UI-agent body | ~2 200 условных |

**VERIFIED:** root сам по себе ниже официального Codex default `project_doc_max_bytes = 32 KiB`, поэтому не обрезается. Проблема — не hard limit, а повторная семантическая нагрузка и обязательное чтение 111 KB append-only decision history.

Основные autonomy blockers:

- остановка при любом doc↔code конфликте, хотя текущая система уже содержит несколько известных конфликтов;
- unconditional checkout/pull и branch creation;
- mandatory full TODO/DECISIONS reads даже при явной пользовательской задаче;
- mandatory UI Phase 1 pause даже для прямой реализации;
- запрет Gemini реализовывать фичу вне TODO, конфликтующий с приоритетом явного запроса;
- требование закончить с чистым worktree, способное подтолкнуть к вмешательству в чужие изменения;
- universal approval gates для уже явно заказанных reversible changes.

## Safety gaps и подтверждённые controls

### Пробелы

- **VERIFIED:** нет human-reviewed immutable charter и protected experiment paths.
- **VERIFIED:** нет repo-local Codex rules/hooks и их тестов.
- **VERIFIED:** нет append-only run schema/history и public evals agent workflow.
- **VERIFIED:** нет MCP data-egress/allowlist policy.
- **VERIFIED:** root придаёт instruction authority всему `docs/`.
- **INFERRED:** agent-editable policy не может быть единственной границей безопасности даже после создания charter proposal/rules.

### Controls

- **VERIFIED:** `.codex/config.toml` использует `shell_environment_policy.inherit = "core"`.
- **VERIFIED:** `.env`, local env variants и `.repowise/` игнорируются Git.
- **VERIFIED:** в просмотренных tracked config нет очевидных literal credentials; полноценный secret scan в Phase 1 не запускался.
- **VERIFIED:** пять новых audit/QA skills read-only по умолчанию.
- **VERIFIED:** CI содержит TruffleHog secret scan; `npm audit` jobs non-blocking и не являются gate.
- **VERIFIED:** текущий managed runtime использовал workspace-scoped write и approval boundary, но это внешняя защита, не свойство репозитория.

## Недостающая верификация

- Fresh Codex session: список загруженных instruction sources, skills, MCP и custom agents.
- Fresh Gemini/Claude sessions: порядок `GEMINI.md`/`AGENTS.md`, Claude skill loading и client-specific agent spawn.
- `codex execpolicy check` для любых будущих `.rules`.
- Official skill validator; текущая запись в DECISIONS честно фиксирует отсутствие PyYAML.
- Browser-tool availability и реальный UI-agent QA flow.
- MCP startup/network/trust behavior и timeout/failure paths.
- Git hook concurrency, PATH provenance и failure observability.
- CI/public check для TOML/JSON, skill frontmatter/unique names, stale paths, instruction byte budget и duplicate parity.

**VERIFIED:** TOML и JSON были синтаксически распарсены успешно через Python `tomllib`/`json`.
**UNKNOWN:** full Codex load validation — `codex.exe` найден, но `codex --version`/`--help` завершились `Access denied`.

## Минимальная target architecture

1. **Root `AGENTS.md`, ориентир 100–150 строк.** Только trust/experiment boundary, mission, компактный module routing, honesty, worktree safety, completion criteria, plan/delegation triggers, conditional docs footprint и Git authorization.
2. **Четыре scoped instruction files:**
   - `client/AGENTS.md`: i18n UI, визуальный QA, accessibility, map-geometry boundary, client checks;
   - `server/AGENTS.md`: determinism, commands path, LLM/Zod boundary, server checks;
   - `shared/AGENTS.md`: plain JSON, imports, LocalizedText, проверка обоих workspace, concurrency;
   - `scripts/map/AGENTS.md`: generated-data pipeline, historical sourcing и validators.
3. **Root явно маршрутизирует чтение nested files.** Официальный Codex loader автоматически собирает nested `AGENTS` только по пути repo root → текущий `cwd`, а не по каждому редактируемому файлу.
4. **`docs/agent/MASTER_PROMPT.md` больше не instruction authority.** Подтверждённые архитектурные факты мигрируют в canonical docs/nested instructions; legacy workflow помечается superseded или архивируется.
5. **Skills:** сохранить пять узких read-only workflows после tightening; переписать `verify-change` по CI. Новые широкие framework/agent packs не добавлять.
6. **Agent:** один `ui-reviewer` с `sandbox_mode = "read-only"`; реализация остаётся main/worker. Claude/Codex variants должны генерироваться из одного источника либо проходить parity eval.
7. **Codex config:** исправить top-level key, portable MCP args и только проверяемые safe defaults. Сохранить существующие Repowise/Context7; не добавлять второго repository/docs provider.
8. **Experiment layer:** `.agent/CHARTER.proposed.md`, `.agent/PLANS.md`, audits, run schema и public stdlib eval. Charter явно остаётся proposal до human review и external protection.
9. **Public eval:** TOML/JSON parse, skill metadata/unique names, known-path checks, stale forbidden strings (`shared/types/`, старые freeze/ownership, unconditional pull), root byte budget, duplicate parity, обязательные experiment files. Подключить к `doc-guardrails.yml`.
10. **Намеренно не создавать сейчас:** Codex hooks без consumer; rules без возможности выполнить официальный `codex execpolicy check`; новые MCP; второй general-purpose agent framework; hardcoded model names.

## Evidence для решений

Исполненные read-only проверки включали:

- `git status --short --branch`, `git log --oneline -10`, `git worktree list --porcelain`;
- `git ls-files` и hidden inventory для `AGENTS`, `.agents`, `.codex`, `.claude`, `.gemini`, `.mcp.json`, `docs/agent`, hooks;
- построчное чтение всех перечисленных instruction/config файлов;
- `Test-Path` для упомянутых путей и сравнение с реальным layout;
- чтение `package.json` scripts, `.github/workflows/ci.yml`, `doc-guardrails.yml`, фактических ports;
- Python `tomllib`/`json` parse и parity comparison;
- `repowise --version` и `repowise mcp --help`;
- проверка фактически реализованных `architecture.test.ts` suites;
- попытка `codex --version`/`--help` — заблокирована `Access denied`.

Актуальная внешняя спецификация сверялась только с официальными материалами OpenAI:

- <https://developers.openai.com/codex/config-reference>
- <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
- <https://learn.chatgpt.com/docs/agent-configuration/subagents>
- <https://learn.chatgpt.com/docs/agent-configuration/rules>
- <https://learn.chatgpt.com/docs/hooks>

## Уверенность

- **Высокая:** inventory, conflicts, nonexistent/stale paths, TOML scope, context-size estimates, Git/worktree/hook state, CI-versus-skill gaps.
- **Средняя:** итоговая target architecture — она минимальна и опирается на найденные recurring failures, но требует проверки после реализации.
- **Низкая/UNKNOWN:** фактическая загрузка repo-local skills/MCP/custom agents в fresh Codex, Claude и Gemini sessions; текущая сессия не дала положительного runtime evidence.
