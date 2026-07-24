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

## 2026-07-19 — `map-session-recurring-failures`

Problem evidence (сессия правки Ближнего Востока/Кипра, ветка
`codex/1946-country-borders`, повторяющиеся паттерны за один день):

1. **Вывод «данных нет» по одному тегу.** Кипр проверен только по
   `iso_a2 == "CY"` → заключение «Кирении нет в game_map.json» → внешний
   geoBoundaries-графт + буферный мост → уродливый шов, отклонено
   пользователем. Полный Northern Cyprus лежал в том же файле под
   `iso_a2 == "-1"` (тот же провенанс, стык с 5 округами — 0.0 разрыва).
   Повтор уже зафиксированного пользователем паттерна «ищи существующее до
   альтернатив» (та же ошибка ранее с trade-off вариантами по инфраструктуре).
2. **Кураторство сверх запроса.** Историческая реконструкция Палестины (16
   подрайонов из чужого источника) и Ливана (5 мухафаз) сделана как
   «улучшение», пользователь потребовал откат на сырые провинции
   game_map.json: решения о числе/составе регионов — его, не агента.
3. **ExecPlan-формат игнорировался.** `.agent/plans/1946-country-borders.md`
   вёлся как нарративный журнал; структура из `.agent/PLANS.md`
   (Status/Progress/Decision log/Validation/Rollback) не выполнялась, хотя
   `AGENTS.md` делает её обязательной для крупных рефакторингов.
4. **Позиционные файлы рассинхронизировались многократно** (`names_ru.json`/
   `ownership_1946.json`/`occupation_overlay.json`: Азия «-c», Европа «-h»),
   каждый раз обнаруживалось поздно, вручную, по жалобе пользователя.
5. **(Добавлено по факту исполнения того же дня.) Живая проверка отвечала
   зомби-процессом.** Первая проверка `/game/start` после отката показала
   неверные данные (1365 регионов вместо 1310, новый регион отсутствует) —
   сервер на порту 3000 оказался процессом с НАЧАЛА сессии; `ps aux` в Git
   Bash на Windows даёт wrapper-PID, не настоящий Windows PID — `kill` по
   нему не трогает реальный процесс. Только `netstat -ano | grep :3000` +
   `taskkill //F //PID <реальный>` решило. Выглядело как настоящий баг
   геометрии, пока не проверил PID.

Layer changed (самые узкие слои, по прямому разрешению пользователя
создавать skills/agents/инфраструктуру для проекта):

- `scripts/map/AGENTS.md` — подробные map-правила по пунктам 1-2 (поиск по
  `iso_a2="-1"` до вывода "не существует"; решения о делении — за
  пользователем; каскад region_id + ExecPlan);
- корневой `AGENTS.md` — явное описание `.agent/` (раньше папка была
  упомянута только косвенно, через 3 разрозненные ссылки);
- новый скилл `.claude/skills/find-existing-solutions/` (+ канонический
  `.agents/skills/`) — обязательный протокол поиска существующего решения
  ДО внешнего источника/новой реализации/вывода «не существует»;
- новый ExecPlan `.agent/plans/middle-east-raw-provinces-revert.md` по
  формату `.agent/PLANS.md` (пункт 3 — реально применено, не только
  продекларировано: Status/Progress/Discoveries/Decision log/Validation
  велись по ходу исполнения, не задним числом);
- `.claude/skills/map-geometry-qa/SKILL.md` + `scripts/map/README.md` —
  пункт 5 (сверять `netstat`, не доверять `ps aux`/своим PID в живой
  проверке) добавлен в чек-лист верификации.

Expected benefit: прекращение повторов этих 5 классов ошибок без
напоминания пользователем; решения о курации остаются за человеком.

Risks and containment: рост инструкций — детали уведены в nested
`scripts/map/AGENTS.md` и скилл (progressive disclosure), root получил только
короткое описание `.agent/`.

Validation: `python .agent/evals/public/run_public_evals.py` после правок
(140 passed, 0 failed); откат Ближнего Востока/Кипра проведён В ТОТ ЖЕ
день с использованием нового ExecPlan-формата и `find-existing-solutions`
де-факто (Northern Cyprus найден многоключевым поиском, не внешним
источником) — оба пункта 1 и 3 подтверждены на реальной задаче, не только
теоретически.
Fresh-session status: pending — срабатывание скилла/ExecPlan-привычки в
СЛЕДУЮЩЕЙ, отдельной сессии ещё не проверено (в этой сессии оно применено
тем же агентом, который его завёл).
Decision: keep (по прямому требованию пользователя «ты должен развиваться»).

## 2026-07-22 — `missing-land-diagnostic-permanent`

Дата / change id: 2026-07-22 / missing-land-diagnostic-permanent

Problem evidence: стабильное ограничение, не единичный случай. За сессию
тихо-пропавшая суша всплыла минимум трижды и только по случайной жалобе
пользователя: Akrotiri (adm0_a3=WSB — вообще никогда не была в карте с
момента написания обработки Кипра), Мальдивы (21 фича выпала целиком),
Нормандские о-ва/Мэн/Сен-Бартелеми и др. (11 территорий подтверждено).
Пользователь прямо: "не могу физически каждый клочок проверять" — ручной
визуальный обход мира по каждой мелкой прибрежной фиче нереален, а
существующие проверки (overlap/gap-полигонизация, пофичевые рендеры) этот
класс не ловят: они смотрят на СТЫКИ имеющихся полигонов, а не на то, что
исходной фичи в выходе нет вовсе.

Layer changed (самый узкий): добавлен разовый диагностический скрипт
`scripts/map/build/diagnose_missing_land.py` (НЕ шаг пайплайна, не в
FULL_REBUILD_STEPS — как `diagnose_global_gaps.py`), + шаг 3b в verification
recipe скилла `map-geometry-qa` и урок в его bullet-списке. Пайплайн/данные/
границы не тронуты.

Expected benefit: пропажа целой территории при country-filtered сборке
обнаруживается автоматически сразу после build, а не через сессии по
случайной жалобе. Скрипт сценарио-независим (пути параметризуемы, дефолт
1946) — переиспользуем для будущих сценариев (прямой ответ на вопрос
пользователя «помогут ли скрипты в других сценариях»).

Risks and containment: диагностика read-only, ничего не меняет; ложные
срабатывания (приозёрные районы, центр которых попал в вырезанное озеро)
не устранены полностью, но помечены [LAKE] отдельным слоем, чтобы их не
принимали за пропажу. Порог покрытия (folded>=0.8 / missing<0.1) —
эмпирический, промежуточные значения печатаются как "частично N%" для
ручного разбора, не классифицируются автоматически.

Validation: прогон на текущем 1946-мире — 11 реальных пропаж в слоях 1-2,
корректное отделение влитого Израиля (99%) и приозёрных [LAKE]-ложных
(Ликома/Kalangala и т.п.) в слое 3; проверено, что уже исправленная Akrotiri
теперь показывает 100% покрытия (не ложно-положительна после фикса).

Fresh-session status: pending — привычка запускать 3b в СЛЕДУЮЩЕЙ отдельной
сессии не проверена (в этой применено тем же агентом).

Decision: keep (по прямому запросу пользователя зафиксировать находки и
инструмент; решения о ДОБАВЛЕНИИ найденной суши остаются за пользователем —
диагностика только сообщает, не курирует).


## 2026-07-23 — `agent-os-partial-integration`

Problem evidence: два независимых аудита
(`.agent/audits/agent-system-audit-2026-07-23.md`,
`documentation-audit-2026-07-23.md`): bootstrap-слой 8 дней не смержен, при
этом `main` жил со старой системой — Claude не получал `AGENTS.md`
автоматически (в сессии 07-23 автозагружен только `.claude/CLAUDE.md`;
официальная документация подтверждает отсутствие нативной поддержки),
checkout-протокол в 3 файлах конфликтовал с живой параллельной сессией в
основном checkout (наблюдён новый commit чужой сессии во время аудита),
Codex отсутствовал в правилах координации, память Claude несла проектные
правила, невидимые другим инструментам.

Layer changed: интеграция bootstrap-инфраструктуры и док-фиксов в
task-ветку `claude/agent-infrastructure-audit-4335d1` **частями**.
Исключено из переноса (остаётся только на ветках, отдельное ревью):
`server/src/services/GameService.ts` (+тест), `shared/src/types/GameState.ts`,
весь `client/src/**` diff (включая `hud/Onboarding/`, `hud/NationalBriefing/`,
правки `Window`/`useWindows`/`MapView`/`GeometryEngine`, i18n-неймспейсы
onboarding), а также статусные версии `docs/TODO.md`/`docs/DECISIONS.md`/
`docs/plans/12_UI_REDESIGN.md`/секции UI_DESIGN, описывающие этот код.
Записи журнала 2026-07-15..17 выше описывают контекст bootstrap-ветки
целиком — к составу этого дерева применима только настоящая запись.
Плюс дельты: `@../AGENTS.md`-импорт в
`.claude/CLAUDE.md` (синтаксис сверен с официальной документацией: relative
paths resolve relative to the file containing the import), секция «Worktree и
параллельная работа» + роли + профиль пользователя в корневом `AGENTS.md`;
статусные доки (`TODO`/`UI_DESIGN`/план 12) приведены к состоянию `main`.

Expected benefit: один канонический слой правил, доставляемый всем трём
инструментам штатными механизмами загрузки; worktree-протокол вместо
опасного checkout-протокола; честные статусы доков (код замороженной ветки
не выдаётся за состояние `main`).

Risks and containment: (а) `@`-импорт не проверен в свежей сессии — в
адаптере оставлена явная fallback-инструкция «прочитай AGENTS.md, если
раздел не в контексте»; (б) частичная интеграция оставляет на ветках
продуктовый код — зафиксировано в `docs/DECISIONS.md` и `docs/TODO.md`;
(в) сама интеграция выполнена третьей стороной (Claude) поверх работы
Codex — независимое ревью diff заказано через `codex review --base main`.

Validation: public eval 132/132 PASS; data-валидатор + 9 unit-тестов PASS;
решения пользователя (вариант A частями, заморозка обеих UI-линий,
инструментарий на усмотрение агента) записаны в `docs/DECISIONS.md`
2026-07-23.

Fresh-session status: pending — `@`-импорт Claude (`/context` в свежей
сессии), загрузка repo-local `.codex/` в доверенном worktree.

Decision: keep (по явному утверждению пользователя); влитие в `main` —
отдельное решение пользователя.

## 2026-07-23 — `worktree-guard-hook`

Problem evidence: worktree-протокол существовал только текстом; аудит
2026-07-23 наблюдал живую параллельную сессию в основном checkout, а прежний
checkout-протокол в 3 файлах прямо предписывал его переключать. Ручные правки
генерируемых данных запрещены `scripts/map/AGENTS.md`, но ничем не
блокировались. Пользователь явно утвердил внедрение guard-хука.

Layer changed: `scripts/hooks/guard.mjs` (общий Node-скрипт, fail-open) +
регистрации PreToolUse в `.claude/settings.json` (проект) и `.codex/hooks.json`;
public eval расширен проверками наличия/регистрации/парсинга. Формат событий
Codex клонирует Claude (официальная дока hooks, GA c 2026-05; Windows-quoting
исправлен в CLI 0.145.0).

Expected benefit: физическая блокировка (exit 2) правок в основном checkout,
ручных правок `server/data/scenarios/**`/`scripts/map/out/**`, а также
`git push --force` (кроме `--force-with-lease`), `git reset --hard`,
`git clean -f`, `rm -rf` — вместо надежды на дисциплину.

Risks and containment: fail-open по построению (ошибка хука не блокирует
работу); command-правила regex-грубые — возможны редкие ложные срабатывания,
причина всегда печатается в stderr; Codex применяет repo-hooks только в
trusted-проекте после одобрения хэша через `/hooks`.

Validation: 8 синтетических кейсов через stdin — блокирует: правку в основном
checkout, запись в генерируемые данные, force-push, reset --hard; пропускает:
правку в своём worktree, `--force-with-lease`, обычные команды, мусор в stdin
(fail-open). Public eval после расширения зелёный.

Fresh-session status: pending — срабатывание в живой Claude-сессии (хук
проектного уровня подхватится со следующей) и одобрение хэша в Codex `/hooks`.

Decision: keep (явное утверждение пользователя).

**Поправка (2026-07-23, тот же день):** live-срабатывание в Claude-сессии
подтверждено раньше ожидаемого (хук подхватился без рестарта) — и первым же
срабатыванием стал **false positive**: правило `rm -rf` совпало с упоминанием
строки в *тексте* PR-описания (`gh pr create --body "... rm -rf ..."`).
Правило сужено до командной позиции (начало строки / после `;`, `&`, `|`,
`$(`); регресс: реальные `rm -rf` (напрямую и после `&&`) блокируются,
упоминание в аргументе-прозе — проходит. Fresh-session gate по Claude закрыт;
остаётся Codex `/hooks`.

## 2026-07-23 — `prompt-architect-skill`

Problem evidence: пользователь регулярно готовит крупные задания для разных
моделей через внешний метапромт (им порождён и bootstrap-промт аудита
2026-07-23 — структура «Альтернативный вариант / Тестовые случаи / Критерии
0–4» совпадает) и явно попросил закрепить его как skill. Повторяемая
процедура со стабильными шагами и проверяемым результатом — проходит
критерии нового skill.

Layer changed: `.agents/skills/prompt-architect/` (канон + `agents/openai.yaml`)
+ зеркало `.claude/skills/prompt-architect/`; parity-проверка eval обобщена с
хардкода verify-change на любую пару канон↔зеркало.

Отличия от исходного метапромта (4 улучшения): (1) промт сверяется с
реальными возможностями целевого исполнителя; (2) существенные предположения
встраиваются в текст промта, не только в сопроводительную секцию; (3) явное
требование минимально достаточной длины порождаемого промта; (4) критерии
сравнения — якорная шкала 0–4. Плюс un-trigger: игровые LLM-промты Geopolis
(`docs/LLM_RULES.md`) — не область этого skill.

Expected benefit: воспроизводимое качество заданий для Codex/Claude/Gemini
без копипаста метапромта из внешних заметок; доступен обоим инструментам.

Risks and containment: пересечение с plan-challenger минимально (тот
атакует план, этот строит промт); skill условной загрузки — постоянный
контекст не растёт.

Validation: public eval (структура skill, уникальность имён, parity зеркала,
openai.yaml ключи) зелёный после добавления.

Fresh-session status: pending — discovery в свежих сессиях Codex
(`$prompt-architect`) и Claude (auto-trigger по описанию).

Decision: keep (по явной просьбе пользователя).

**Поправка (2026-07-23, тот же день):** независимое ревью самого skill
(GPT-5.6, «годен с правками») подтвердило системный пробел, проявившийся на
живом использовании: чек-лист ловил статические дефекты промта, но не
lifecycle долгоживущих агентных ролей — именно этот класс (границы полноты,
стоп-точки, resume после compaction, бюджет) в промте «дизайн-партнёр» нашло
только внешнее ревью. Внесено 6 правок из 7: расширенный description с
встроенными не-триггерами (авто-подбор в обеих средах); проверка
возможностей целевого исполнителя по evidence, не по памяти; условный
lifecycle-чек для длительных агентных промтов; тесты с oracle (ожидаемое +
запрещённое поведение, dry run при доступном исполнителе); независимое
ревью/review packet + статус UNVERIFIED для важных промтов; шапка
версии/changelog для повторно используемых. Отклонено частично: слияние §4 с
Verification (секция обязательна по структуре eval) — вместо слияния убрано
дублирование; шкала 0–4 заякорена полностью. Validation: eval 150/150,
parity зеркала сохранена.
