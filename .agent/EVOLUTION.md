# Evidence-gated evolution

Этот журнал фиксирует изменения persistent agent system, а не историю feature-
разработки. Он не заменяет Git и не даёт агенту права самостоятельно менять
security/product границы из `AGENTS.md`.

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

## 2026-07-26 — `repowise-post-merge-hook`

Дата / change id: 2026-07-26 / repowise-post-merge-hook

Problem evidence: 26.07 предупреждение Repowise «Wiki is stale — last
indexed at commit X, HEAD is now Y» замечено сессией трижды за день после
интеграций в `main`. Проверкой `git log` установлено, что симптом системный,
не одноразовый: с даты установки хука (25 июня) до сегодняшнего фикса в
`main` влито не менее 22 merge-коммитов, из них 12 — сегодня же, до 17:00
(дважды design-partner-audit, docs-hygiene, legacy-cleanup,
capital-region-invariant, milestone-0-core, 4 dependabot-PR и др.) — то есть
десинхронизация индекса шла весь месяц, а «трижды за день» — это лишь
сколько раз кто-то из сессий успел заметить предупреждение, а не сколько
раз оно фактически возникало. Сам `.repowise/.update.log` — самоусекающийся
операционный лог с пометкой `(log truncated)` первой строкой, поэтому число
merge-коммитов проверено по `git log`, а не по логу. Хрупкость самого слоя
уже была независимо отмечена раньше: `.agent/audits/agents-audit.md`
(2026-07-23, стр. 44-45) — единственный активный git-hook это
`post-commit`, `core.hooksPath` не настроен, хук «не переносится в новый
clone»; что он вдобавок не покрывает `git merge`, замечено не было.

Root cause (проверено по коду хука, не со слов): `repowise hook install`
ставит только `.git/hooks/post-commit` (mtime `Jun 25 18:58` — файл вне
Git, поэтому mtime достоверен как дата установки). Git по своей семантике
вызывает `post-commit` после `git commit`, но не после `git merge` — для
merge существует отдельный хук `post-merge`, которого в репозитории не
было. Интеграция в `main` в этом проекте регулярно идёт через `git merge`
(см. выше), и ни один такой merge не мог вызвать `post-commit`.

Layer changed: `.git/hooks/post-merge` — **не версионируется Git** (живёт
только в `.git/hooks` этой рабочей копии, вне `core.hooksPath`; не появится
ни в `git diff`, ни в `git status`, ни в клоне на другой машине); создан
вручную в основной сессии сегодня (mtime `Jul 26 17:52`) как копия логики
`post-commit` с заменой `post-commit`→`post-merge` в тексте лог-баннера и
комментария. В этом коммите изменён только `.agent/EVOLUTION.md` — сам хук
уже применён отдельно от документирующей правки. В `AGENTS.md` изменений
нет: это факт инфраструктуры/runbook, не новое поведенческое правило для
агентов (ничего не требует ДЕЛАТЬ иначе), а `.agent/`-раздел там уже
указывает на `EVOLUTION.md` как канонический журнал; корневой файл к тому же
почти исчерпал eval-бюджет (14406 / 16384 байт).

Expected benefit: индекс Repowise синхронизируется в фоне и после `merge`,
не только после `commit`, без касания продуктового кода или agent-
конфигурации; следующий агент, увидевший то же предупреждение, находит
причину и готовую команду восстановления за секунды, а не переоткрывает
расследование.

Risks and containment: файл не восстановится при клонировании репозитория
на другую машину, при переустановке Repowise или при `repowise hook
uninstall`/`install` — поломка молча вернётся (тот же паттерн уже
предсказан в `agents-audit.md` для `post-commit`). Containment — команда
восстановления одной строкой (предполагает уже установленный
`post-commit`):

```sh
sed 's/post-commit hook fired/post-merge hook fired/; s/Auto-syncs repowise wiki after each commit/Auto-syncs repowise wiki after each merge/' .git/hooks/post-commit > .git/hooks/post-merge && chmod +x .git/hooks/post-merge
```

Побочно подтверждено (командами в этой сессии, не со слов): в linked
worktree хук безвреден. `git rev-parse --show-toplevel` внутри worktree
возвращает путь самого worktree, там нет каталога `.repowise` — оба хука
молча завершаются на строке `[ -d "$ROOT/.repowise" ] || exit 0`. Хуки
физически общие для всех worktree (`git rev-parse --git-common-dir` → `.git`
основного checkout), но именно этот guard делает коммиты агентов в своих
ветках безопасными для индекса.

Validation: после установки файла и мержа коммита `c1e2657c14c3032e...` в
`main` (совпадает с текущим `git log -1` основного checkout),
`.repowise/.update.log` получил строку (дословно, без правок):

```text
--- post-merge hook fired at Sun Jul 26 17:53:19 RTZ 2026 for HEAD c1e2657c14c3032e0115f12197413239c7b25a28 ---
```

Файл `.repowise/.update.queued` на момент проверки уже отсутствовал — не
противоречие: тот же лог тех же секунд содержит реальные
`gemini.generate.*`/`cost_tracker.record`/`hallucination_check` записи, то
есть фоновый `repowise update` не просто встал в очередь, а уже выполнялся.

Fresh-session status: структурно не может стать надёжно `verified` —
файл вне Git и поэтому отсутствует в любом новом clone или linked worktree
по построению (см. побочное наблюдение выше). Следующая сессия, увидевшая
«Wiki is stale» после merge, проверяет `ls .git/hooks/post-merge`; если
файла нет — применяет команду восстановления выше вместо повторного
расследования причины.

Decision: keep (инфраструктурная правка, evidence-gate соблюдён: проблема
подтверждена как месячная, не однодневная, причина установлена по коду
хука и `git log`, а не по впечатлению; продуктовых/security границ правка
не касается).

## 2026-07-27 — `verification-threshold`

Дата / change id: 2026-07-27 / verification-threshold

Problem evidence: Милстоун 0 (26.07, ветка `claude/milestone-0-core`,
commits `76bf6c0`..`97dd496`, влита `c1e2657`) прошёл минимум 5 раундов
независимой проверки за один день — внешний аудит (Codex, read-only, на
`755d641`), закрытие того аудита (`06aa730`/`97dd496`) и три внутренних
«поправки по независимому ревью» внутри самой сессии A. Ниже — то, что
перепроверено независимо от текста задания прямым чтением `git log`,
`docs/DECISIONS.md` и исходников, а не принято со слов:

1. Отдача падает по раундам. Первый внешний аудит (на `755d641`) дал одну
   «главную» находку (скаляр `magnitude` прятал фактические эффекты —
   `repress` по насыщенному полю возвращал `magnitude=0`, реально сдвинув
   `alienation`) плюс 4 средних; закрытие того же аудита (`97dd496`) — уже
   «блокирующих находок нет», только 4 места, где реализация слабее
   собственного описания (сравнение по величинам вместо ключей, 4
   комментария приведены к коду, переформулировка теста порога восстания).
2. Негативный контроль дешевле и убедительнее повторного ревью. Тест
   инварианта недовольства «проверен двумя намеренными поломками механики
   (обнуление веса дистанции, инверсия знака веса благосостояния) — тест
   падает на обеих» (`docs/DECISIONS.md`, «Демо-срез 1946»); находки
   `97dd496` предъявлены тем же способом — откат гранулярности резюме к
   полю роняет 5 тестов, откат сверки к сравнению ключей роняет 2 и
   оставляет зелёным тест скрытого эффекта.
3. Три теста фиксировали факт, не инвариант — подтверждено по коду и
   `docs/DECISIONS.md`: `campaignSmoke` держал 3 захардкоженных списка
   `region_id`, сломался, когда уточнённые данные 1946 поставили
   Калининград (0.545) напряжённее Риги (0.505); тест пересечения
   `grant_autonomy`/`enact_reform` на 36-м месяце проверял конкретную точку
   — «производная плейсхолдерных коэффициентов»; тест покрытия `CHANNELS`
   строил фактическое множество из той же таблицы констант и сравнивал с
   захардкоженным списком тех же имён — ловил удаление строки, не
   появление нового канала, и именно через незамеченный седьмой канал
   (`GRANT_AUTONOMY_NEIGHBOR_EMBOLDENMENT_*`) прошёл обход коридора magnitude.
4. Утверждение сильнее гарантии — из пяти примеров задания независимо
   подтверждено чтением текущего кода минимум два: константа
   `MAX_PRIMITIVES_PER_TARGET_PER_TURN` держит кап локальным счётчиком
   `targetUses = new Map()` внутри одного вызова `applyPrimitiveBatch`
   (`server/src/primitives/PrimitiveEngine.ts:1174`) — «за вызов», а не «за
   ход», если движок вызывается несколько раз за ход; комментарий «скрытых
   эффектов теперь не бывает по построению» (исправление по аудиту на
   `755d641`) на деле держался только на канале памяти воздействий —
   координаты идеологии, политическая цена, объект карты и `nextFeatureId`
   вне рантайм-сверки, что явным текстом назвала следующая доводка
   (`97dd496`, `docs/PRIMITIVES.md` §4). Остальные примеры задания (шапка
   модуля со ссылкой на несуществующий тест; документ, канонизирующий сырой
   текст вместо подтверждённых заголовков) в этой ветке источником не
   найдены за отведённое время — не исключено, что из другой части того же
   дня вне `claude/milestone-0-core`.

Layer changed: только `AGENTS.md` — врезка в «Проверка» (порог остановки +
негативный контроль вместо повторной верификации закрытия) и два пункта в
«Инженерные правила» (тест держит свойство, не снимок; «никогда»/«всегда» —
только вместе с тестом-держателем). `.claude/`, `.agents/`, `docs/TODO.md`,
`docs/DECISIONS.md` не тронуты по прямому ограничению задачи — не
продуктовое решение и не backlog-задача.

Expected benefit: агент останавливает независимую проверку по фактической
отдаче раунда вместо инерции «ещё один проход на всякий случай»; закрытие
находки подтверждается тем же дешёвым и убедительным способом, который уже
стихийно применялся в этой сессии (временный откат + падающий тест), вместо
отдельного ревью-прохода; новый тест по умолчанию целится в свойство, а
формулировки «никогда»/«всегда» требуют теста-держателя — прямое покрытие
находок 3 и 4 выше.

Risks and containment: порог «мелкое не смотрим» может копить мелкие
расхождения до состояния, когда их сумма перестаёт быть мелочью — находка 4
выше это уже показывает: пять «мелких» несовпадений слов и кода по проекту
сложились в устойчивый паттерн, достаточный для durable-правки. Containment:
критерий «мелкое» — про ОДИНОЧНОЕ расхождение в одном месте; если один и тот
же класс находки (не формулировка, а класс — «утверждение сильнее
гарантии», «тест держит факт, не инвариант») всплывает второй раз в разных
местах или разных сессиях, он перестаёт квалифицироваться как «мелкое» этим
же правилом и переходит в backlog/durable-правку. Обнаружение второго
повторения — на ревьюере и на очередной `EVOLUTION.md`-ретроспективе;
автоматической проверки этому нет.

Validation: `python .agent/evals/public/run_public_evals.py` — 159 passed, 0
failed; `AGENTS.md` 14406 → 15633 байт (лимит 16384, запас 751); `git diff`
просмотрен — два добавленных фрагмента, ничего существующего не удалено.

Fresh-session status: pending — снижение доли раундов 4-5 до мелочей и
самопроизвольное использование негативного контроля вместо повторной
верификации в СЛЕДУЮЩЕЙ независимой сессии ещё не проверены (правило введено
в тот же день, что и подтверждающий его материал).

Decision: keep (evidence-gate соблюдён: 5 независимых раундов за один день с
измеримо падающей отдачей, паттерн «утверждение сильнее гарантии» и «тест
держит факт, не инвариант» перепроверен независимо от текста задания прямым
чтением кода и истории; слой — только `AGENTS.md`, два раздела; риск
накопления мелочей назван с конкретным критерием эскалации выше).

## 2026-07-27 — `prompt-architect-task-profiles`

Дата / change id: 2026-07-27 / prompt-architect-task-profiles

Problem evidence: работа над Милстоуном 0 дала повторяющиеся отказы в
заданиях, порождённых этим skill: исполнителю отдавалась задача на разведку
вместо её результатов; новые тесты не проверялись на способность падать;
критерии отмечались выполненными частично; baseline не давался числами, из-за
чего «зелёные проверки» ничего не значили. На стороне ревью тот же класс:
рецензент принимал тесты автора за доказательство, а класс «утверждение
сильнее гарантии» (комментарий/имя константы/док обещают больше, чем даёт код)
всплыл за милстоун не менее пяти раз и каждый раз находился только адресным
вопросом. Повторяемость по нескольким задачам — durable-правка допустима.

Layer changed: `.agents/skills/prompt-architect/SKILL.md` (канон) + побайтное
зеркало `.claude/skills/prompt-architect/SKILL.md`. Новый раздел
`Task profiles` между Workflow и Verification; шаг 3 получил строку-
маршрутизацию, Verification — пункт провала формата за пропущенный или
выхолощенный профиль. Четырёхшаговый Workflow и режимы БЫСТРЫЙ/ПРОВЕРЯЕМЫЙ
не тронуты; `agents/openai.yaml` и frontmatter `description` не менялись —
изменилось содержимое результата, не условие срабатывания.

Expected benefit: типовые отказы заданий закрываются на этапе порождения
промта, а не разбором постфактум; профиль ревью переводит найденный вручную
класс дефектов в постоянный адресный вопрос.

Risks and containment: рост skill с 141 до 199 строк — принят, так как
профили условны (применяются только к своему типу адресата) и не удлиняют
основной путь; риск превращения в методичку сдержан форматом двух блоков
без собственной процедуры.

Validation: public eval 159 passed / 0 failed до и после правки. Parity-чек
зеркала проверен негативным контролем: рассинхрон на один байт даёт
`158 passed, 1 failed` с `FAIL: Claude mirror matches canonical skill:
prompt-architect`; после восстановления — 159/0. sha256 канона и зеркала
совпадают.

Fresh-session status: pending — discovery и применимость блоков в свежей
сессии не проверялись.

Открытый пункт: закрыт в этой же правке (2026-07-27, ветка
`claude/milestone-0-closeout`) — `.claude/CLAUDE.md` раньше называл побайтным
только зеркало `verify-change`, хотя eval уже проверял любую пару канон↔
зеркало. Формулировка приведена к общему правилу (любая пара
`.claude/skills/<name>` с существующим каноном `.agents/skills/<name>`
обязана побайтно совпадать), не завязанному на конкретное число пар.

Decision: keep.

## 2026-07-29 — `map-geometry-qa` skill: composite positional shifts, majority-vote pitfall, render-tool recurrence

Problem evidence: same working session (Panama/Washington/Aral Sea fixes,
`docs/DECISIONS.md` 2026-07-29 entries) hit three new failure modes not yet
captured in the skill, plus found one already-documented lesson (interior-
ring render holes, Faroe Islands case) had recurred verbatim in the
PERMANENT `diagnose_coastline_gaps.py::render()` tool itself, proving the
existing writeup didn't generalize past its first fix site. Also found the
skill's `CAPITAL_REGION_OVERRIDES` note was stale (said "deferred, don't
fix" — this session fixed all 26 drifted entries using the anchor-name
protocol already built into the file).

Layer changed: `.claude/skills/map-geometry-qa/SKILL.md` +
`references/{build_pipeline_gotchas,cross_source_merging}.md` (Claude-local
skill, no `.agents/skills/map-geometry-qa` canonical counterpart — not
subject to the byte-parity eval check).

Expected benefit: (1) a future composite/non-uniform positional shift gets
fixed by content-matching immediately instead of after a failed
single-offset attempt is caught on re-verification; (2) ownership-repair
work doesn't trust majority-vote inside an already-corrupted bucket without
an independent ground truth; (3) `CAPITAL_REGION_OVERRIDES` drift gets
resynced via the existing anchor-name protocol instead of being silently
left growing past its documented (now stale) baseline; (4) any new render
function gets checked against the interior-ring-white-paint anti-pattern
before being trusted, not just the one instance already fixed; (5) a
manual `merge_world_1946.py` rerun is followed by `translate_world.py`
without needing to rediscover the dependency; (6) external reference
snapshots (D:\MAP) aren't assumed internally self-consistent just because
they're "the source of truth."

Risks and containment: additive only — no existing rule removed or
contradicted, one stale note corrected to match current reality. Skill grew
from 347 to ~410 lines (SKILL.md) plus two reference-file additions;
accepted per the file's own existing size (already the largest skill in
this repo) since each addition is a distinct failure mode with its own
trigger, not overlapping content.

Validation: `python .agent/evals/public/run_public_evals.py` run after the
edit (see session log). No canonical/mirror pair involves this skill, so
parity checks are not applicable here.

Fresh-session status: pending — not yet exercised by a session that hits
one of these five failure modes from a cold start.
Decision: keep.

## 2026-07-30 — `delegate-data-layer`

Дата / change id: 2026-07-30 / delegate-data-layer

Problem evidence: наполнение слоёв сценария 1946 внешней моделью прошло пять
заходов (демография 1399 регионов, каталог 460 групп, координаты идеологии,
формы правления, влияние 300 связей), и отказы повторялись классами, а не
случайно. (1) Слой наполнялся раньше своей сети: спот-чек исторических фактов
появился 2026-07-30, то есть через день после полной разметки — до его прогона
«воспроизводит статистику» и «правдоподобно выдумала» были неразличимы, и
сошлось это удачей. (2) Задание содержало утверждение, не проверенное по коду
(«влияние входит в оценку силы державы» — `getNationalPower` читает только ВВП,
армию, население, технологии). (3) Ручное преобразование списка
идентификаторов испортило вход: глобальный `replace(',', ' ')` для разрядов
населения слепил 42 территории в одну строку. (4) Файлы слоёв трижды попадали
под `.gitignore` (`ideology_zones.json`, `government.json`, `influence.json`) —
понадобился сторож `scenarioDataTracked.test.ts`. (5) Выдача приходила
порциями, и недосдача порции была видна только арифметикой покрытия.
Повторяемость по пяти заходам — durable-правка допустима.

Дополнительное основание: состав исполнителей сменился. Подписка OpenAI
закончилась (2026-07-30), ChatGPT и Codex недоступны, деревья Codex удалены
пользователем; наполнением данных занимаются Google AI Studio (оператор —
пользователь) и Antigravity. Прежний неписаный порядок работы был завязан на
чат-модель без структурированного вывода и без поиска; у AI Studio оба есть, и
это переносит часть защиты от формата промта в настройки инструмента.

Layer changed: новый канонический skill `.agents/skills/delegate-data-layer/`
(`SKILL.md` + `ai-studio-system-prompt.txt`). Зеркало в `.claude/skills/`
НЕ создано намеренно: процедуру исполняет ведущая сессия по запросу
пользователя, а не по автотриггеру, и парити-чек на такую пару не
распространяется (`.claude/CLAUDE.md`: правило действует для зеркала с
существующим каноном). Точечно поправлен drift состава агентов: `AGENTS.md`
(перечень моделей и префиксы ветвей — `codex/<task>` → `antigravity/<task>`) и
`.claude/CLAUDE.md` (кто нативно читает свод и монтирует скилы). Ни одно
правило процесса, ownership или проверок не менялось.

Expected benefit: пять названных классов отказа закрываются порядком работы, а
не разбором постфактум. Главный из них — «слой без сети»: правило «валидатор и
спот-чек до генерации» делает невозможным повторение ситуации, когда данные
приняты, а доказательства их историчности ещё не существует. Настройки AI
Studio (structured output + grounding + temperature 0) переносят борьбу с
форматом и выдумкой из текста промта в конфигурацию инструмента, где она не
зависит от послушности модели.

Risks and containment: skill 137 строк — на верхней границе приемлемого;
сдержано тем, что процедура условна (применяется только к делегированию
данных) и не удлиняет ни один существующий путь. Второй риск — устаревание
version-sensitive блока настроек AI Studio: помечен датой проверки и снабжён
обходным путём на случай, если схема и поиск перестанут совмещаться. Третий —
что новый skill примут за инструкцию к игровым промтам движка; закрыт разделом
«Когда не применять» с явной отсылкой к `docs/LLM_RULES.md`.

Validation: baseline в дереве — public eval 159 passed / 0 failed. Первая
редакция skill дала **161 passed / 6 failed**: eval требует шесть фиксированных
разделов (`## Trigger`, `## Do not trigger`, `## Required inputs`,
`## Workflow`, `## Verification and failure conditions`, `## Output`), а файл
был написан со своими заголовками. После приведения к структуре — 167 passed /
0 failed; прирост восьми проверок (имя↔папка, description, шесть разделов)
подтверждает, что skill попал под общий контур, а число, не выросшее на
парити-чек, — что пара канон↔зеркало не заведена.

Негативный контроль конструировать не понадобилось: eval упал на первой
редакции сам и назвал ровно недостающее. Это же показало, что проверка
структуры скилов не декоративна.

Baseline на `main` отличается — 158 passed / 1 failed, `Local Markdown links
resolve` на файлах `.reference/open-historia/docs/`. Предсуществующий и к
правке отношения не имеющий: каталог исключён локально через
`.git/info/exclude`, в репозитории и в дереве его нет.

Поправка (2026-07-30, в той же правке): первая редакция skill утверждала, что
`GEMINI.md` в проекте отсутствует. Неверно — есть `.gemini/GEMINI.md`, и eval
его читает (`active` в `run_public_evals.py`). Существенно то, что он первой
строкой отсылает к корневому `AGENTS.md` и явно отказывается от собственного
precedence: более высокий приоритет `GEMINI.md` у Antigravity безопасен по
построению, а не случайно. Формулировка skill исправлена, а свойство названо
хрупким — файл, который начнёт переопределять общие команды, молча получит
приоритет над сводом.

Fresh-session status: pending — срабатывание skill в свежей сессии и
пригодность системного промта на живой выдаче AI Studio не проверялись.
Первая проверка запланирована на малом объёме (шесть слабых точек демографии),
а не на новом слое.

Decision: keep.

## 2026-07-30 — `agents-md-trim`

Дата / change id: 2026-07-30 / agents-md-trim

Problem evidence: две измеренные вещи, обе про один файл. (1) Корневой
`AGENTS.md` подошёл к жёсткому лимиту: public eval проверяет
`stat().st_size <= 16_384` («Root AGENTS.md stays under 16 KiB»), а файл занимал
16 155 байт — запас 229 байт, то есть 1,4 %. Любая следующая правка правил
упиралась бы в лимит и провоцировала выбор «поднять порог», хотя порог стоит
именно против раздувания инструкций. (2) В таблице маршрутизации НЕ БЫЛО
`docs/CONCEPT.md` и `docs/PRIMITIVES.md` — двух документов, определяющих игру:
концепт и алфавит примитивов. Свежая сессия, идущая по таблице, попадала в
`ARCHITECTURE`/`PROJECT`, но не в ядро. Починить это без места было нельзя, и
одно упирается в другое: вот почему подчистка сделана сейчас, а не «когда
понадобится».

Layer changed: только корневой `AGENTS.md` (компрессия формулировок, слияние
строк таблицы, добавление строки CONCEPT/PRIMITIVES первой) плюс перенос ОДНОГО
абзаца — про убывающую отдачу независимых проверок — в
`.agents/skills/verify-change/SKILL.md` с побайтной синхронизацией зеркала
`.claude/skills/verify-change/SKILL.md`. Nested `AGENTS.md`, `.gemini/GEMINI.md`
и `.claude/CLAUDE.md` не менялись. Ни одно правило не удалено: принцип правки —
компрессия и вынос детали, а не сокращение свода.

Expected benefit: запас на добавление правил вырос с 229 до 1602 байт (в 7 раз),
и маршрутизация впервые ведёт свежую сессию в концепт и алфавит примитивов, а не
только в архитектуру.

Risks and containment: главный риск — потерять правило при переписывании,
особенно потому, что файл уже загружен живыми сессиями и изменение СМЫСЛА на
ходу опаснее изменения формы. Сдержано машинной проверкой: 75 маркеров
(по одному на каждое правило старой редакции) ищутся в новом своде или в скилле,
куда абзац перенесён осознанно; потерь нет. Второй риск — ловушка eval: он
запрещает подстроку `shared/types/`, тогда как правило говорит о
`shared/src/types/`; при переписывании `src/` сохранён, проверено отдельно.
Ориентир задания (~13,9 КБ) НЕ достигнут — итог 14 782 байта: дальнейшее
сжатие потребовало бы убирать правила или «почему» у опасных операций, что
противоречит принципу правки. Разница объясняется тем, что текст русский, а
кириллица в UTF-8 занимает два байта на символ, поэтому перефразирование даёт
меньше, чем кажется по числу слов.

Validation: public eval 167 passed / 0 failed после правки. Оба затронутых
гейта проверены на способность падать: рассинхрон зеркала на один байт даёт
`166 passed, 1 failed` с `FAIL: Claude mirror matches canonical skill:
verify-change`; файл, раздутый до 16 667 байт, даёт `166 passed, 1 failed` с
`FAIL: Root AGENTS.md stays under 16 KiB`. После восстановления — 167/0,
sha256 канона и зеркала совпадают.

Fresh-session status: pending — как свежая сессия пользуется новой таблицей
маршрутизации (доходит ли до CONCEPT/PRIMITIVES), не проверялось.

Decision: keep.

## 2026-07-30 — `living-docs-size-gate`

Дата / change id: 2026-07-30 / living-docs-size-gate

Problem evidence: правило «`docs/TODO.md` — только живой backlog,
`docs/DECISIONS.md` — только свежее плюс индекс открытых вопросов» существует с
2026-07-11, когда журнал вычистили с ~930 до ~560 строк. За три последующие
недели оно не выполнилось НИ РАЗУ: на момент правки журнал занимал 6724 строки и
103 записи (рост в двенадцать раз), архивный `docs/decisions/2026-07.md` не
пополнялся с 11 июля, а `TODO` держал 14 завершённых пунктов. Только в этой
сессии в журнал добавлено восемь записей и ни одной архивации.

Причина не в невнимательности конкретной сессии, а в размещении правила: оно
живёт в ШАПКЕ `DECISIONS.md`, а свод (`AGENTS.md`), который сессия читает перед
работой, говорит лишь «`docs/decisions/` и завершённые планы — история» и «внеси
датированную запись». Триггера «когда архивировать» в своде нет. Поэтому
исправно делалась первая половина работы и никогда — вторая. Это тот же класс,
что уже закрыт для корневого `AGENTS.md` лимитом 16 KiB: правило, которое некому
проверить, не выполняется.

Layer changed: `.agent/evals/public/run_public_evals.py` — новый валидатор
`validate_living_docs` (порог 2000 строк для `DECISIONS.md`, 1400 для `TODO.md`),
подключён в `main()`; `AGENTS.md` — одна строка в «Источники истины» о том, что
порог существует и что упёршийся порог лечится переносом, а не поднятием.
Пороги выбраны с запасом к состоянию после чистки (1613 и 1240), чтобы обычная
сессия не упиралась в них с первой записи.

Expected benefit: следующая сессия узнаёт о необходимости чистки от красного
теста, а не от внимательности пользователя. Правило перестаёт зависеть от того,
дочитал ли исполнитель шапку конкретного файла.

Risks and containment: главный риск — что порог начнут поднимать вместо чистки.
Сдержано формулировкой в обоих местах (докстринг валидатора и строка свода)
и тем, что сообщение теста называет фактическое число строк, то есть показывает
масштаб переноса. Второй риск — механический порог не отличает полезный рост от
мусорного; принят осознанно, потому что альтернатива (оценка содержания) не
автоматизируется, а трёхнедельная история показывает, что без механики не
работает ничего.

Validation: public eval 168 passed / 0 failed до правки, **170 passed / 0 failed**
после (плюс две новые проверки). Негативный контроль: журнал, раздутый до 2314
строк, даёт `169 passed, 1 failed` с сообщением
`FAIL: docs/DECISIONS.md stays under 2000 lines (now 2314)` — то есть проверка
называет и факт, и величину превышения. После восстановления — 170/0.

Сопутствующая чистка (не часть agent-конфигурации, но evidence для неё):
`DECISIONS.md` 6724 → 1613 строк, 76 записей за 2026-07-10…07-26 перенесены
дословно в `docs/decisions/2026-07.md`; целостность проверена подсчётом — 151
запись до переноса и 151 после, индекс открытых вопросов и шапка на месте.
`TODO.md` 1311 → 1240 строк, удалено 6 завершённых пунктов и 8 завершённых
подпунктов, зачёркнутых записей не осталось.

Fresh-session status: pending — как свежая сессия реагирует на срабатывание
порога (переносит или поднимает), не проверялось.

Decision: keep.

## 2026-07-30 — `docs-layout-and-two-rules`

Дата / change id: 2026-07-30 / docs-layout-and-two-rules

Problem evidence: (1) в корне `docs/` лежало 35 файлов трёх разных классов —
нормативные документы, провенанс данных (~1 МБ, пять файлов с ОДНОЙ входящей
ссылкой) и исторический слой; (2) `OBJECTIVES.md` имел 17 входящих ссылок и не
значился в таблице маршрутизации свода — то есть самый цитируемый документ был
для сессии, идущей по таблице, невидим; (3) `docs/agent/` (5 файлов, 6–10 ссылок
на каждый) не упоминался ни в `AGENTS.md`, ни в `.claude/CLAUDE.md`, ни в
`.agent/PLANS.md` — ноль раз; (4) правило о лицензиях покрывало зависимости, но
не данные, хотя за сессию найдены три несвободных источника, включая пакет со
скрытым от сканеров ODbL; (5) шесть дефектов формул оказались невидимы 1276
зелёным тестам, потому что тесты проверяют функцию на подобранной фикстуре, а не
на распределении живого мира.

Layer changed: `AGENTS.md` — строка `OBJECTIVES.md` в таблице маршрутизации,
две строки о статусе `docs/provenance/` и `docs/agent/`, расширение правила о
лицензиях на внешние данные, дополнение правила о тестах требованием прогона на
реальных данных. Раскладка `docs/`: девять файлов провенанса перенесены в
`docs/provenance/` через `git mv`, входящие ссылки в 12 файлах поправлены.

Expected benefit: сессия перестаёт спотыкаться о смешанные классы в `docs/` и
находит `OBJECTIVES.md` штатным путём; два класса дефектов, реально встреченных
за сессию (несвободный датасет, мёртвый вход формулы), получают правило вместо
устной договорённости.

Risks and containment: главный риск назван прямо — **свод снова у потолка:
16 182 байта при лимите 16 384, запас 202 байта**. Правка сама упёрлась в этот
порог (16 467 на первой редакции, `169 passed, 1 failed`) и потребовала сжатия
трёх формулировок — то есть механизм отработал на своём авторе. Следующая правка
свода потребует компрессии, а не дописывания. Второй риск — что перенос
провенанса порвёт ссылки; сдержан проверкой: после правки битых вхождений ноль.

Validation: public eval 170 passed / 0 failed. Негативный контроль лимита получен
не искусственно, а по факту: первая редакция превысила 16 KiB и уронила проверку
с называнием причины; после сжатия — зелёно.

Сопутствующее (вне репозитория, потому не покрыто eval): ревизия личной памяти
Claude — удалены две записи, полностью дублирующие `AGENTS.md`
(`beginner-programmer-context`, `autonomy-create-skills-agents`); потеря нулевая,
так как их содержание живёт в своде под git. Индекс сверен: 16 записей, 16
файлов, битых ссылок нет.

Fresh-session status: pending.

Decision: keep.

## 2026-07-30 — `ideas-registry`

Дата / change id: 2026-07-30 / ideas-registry

Problem evidence: пользователь прямо назвал дефицит — предложения по СОДЕРЖАНИЮ
проекта приходят от него, а не от исполнителя («это я предложил провести
исследование исторических моделей данных, а хочется, чтобы и ты подобные вещи
предлагал»). За всю сессию инициатива Claude ограничивалась процессом (аудиты,
чистки, проверки); ни одного предложения о механике игры не прозвучало, пока не
попросили. Причина установлена в разговоре: правила «меняй минимальный полный
scope» и «продуктовую семантику без решения пользователя не меняй» читались как
запрет на ПРЕДЛОЖЕНИЯ, хотя ограничивают ДЕЙСТВИЯ.

Второе основание — идея, высказанная в переписке, не переживает сессию, а
отклонённая предлагается заново: у проекта не было места, где предложение живёт
вместе со своим статусом.

Layer changed: новый `docs/IDEAS.md` (реестр с форматом и статусами, включая
`отклонено` с причиной) и одна строка в `AGENTS.md`, раздел «Git, документация и
завершение»: идея или риск вне scope — строкой в отчёт и в реестр, «предлагать ≠
делать». Плюс упоминание реестра в перечне ненормативных слоёв.

Expected benefit: наблюдения перестают теряться на границе сессии; отклонённое
не возвращается по второму кругу; у пользователя появляется список, из которого
он выбирает, вместо необходимости самому придумывать направления.

Risks and containment: главный риск — реестр превратится в свалку слабых
предложений и станет шумом. Первый же заход это подтвердил: все пять идей
пользователь оценил как слабые («идеи так себе»). Сдержано двумя решениями —
статус `отклонено` хранится вместе с формулировкой (чтобы не повторять), и в
шапке реестра открытым вопросом записано, что КРИТЕРИЙ сильной идеи для проекта
не сформулирован; до его уточнения раздел считается незакрытым. Второй риск —
рост свода: правка сама упёрлась в лимит 16 KiB (16 476 байт, `169 passed, 1
failed`) и потребовала сжатия трёх формулировок; итог 16 252 при запасе 132.

Validation: public eval 170 passed / 0 failed после сжатия. Негативный контроль
лимита снова получен по факту, а не искусственно.

Fresh-session status: pending — будет ли свежая сессия действительно заполнять
реестр без напоминания, не проверялось. Это главный открытый вопрос правки:
механизма, который бы это ПРОВЕРЯЛ, нет — в отличие от порогов размера.

Decision: keep.

## 2026-07-31 — `project-health-and-rot-checks`

Problem evidence: три независимых наблюдения одной и той же природы, накопленные
за одну сессию.

1. Правило чистки живых журналов существовало в своде три недели и не
   выполнилось ни разу: `DECISIONS.md` дорос до 6724 строк, `TODO.md` — до 1311.
   Исправлено не правилом, а порогом в eval — и только тогда сработало.
2. Аудит формул (`.agent/audits/formula-audit-2026-07-30.md`) нашёл шесть
   дефектов, невидимых 1276 зелёным тестам. Аудит случился потому, что
   пользователь его заказал; следующий не случился бы до следующего заказа.
3. Первый же прогон новой проверки на гниение нашёл 8 расхождений живых доков
   с деревом кода (`shared/defines/ai.ts` вместо `shared/src/defines/ai.ts` и
   т. п.). Ни одно из них не всплыло бы по дороге: доки читают выборочно.

Общий класс: правило, которое некому проверить, не выполняется. Аудит,
инициируемый человеком, — событие, а не свойство системы.

Layer changed: три слоя, ни одного нового правила в своде.

- `.agent/audits/registry.json` — машиночитаемый реестр областей: `maxAgeDays`,
  `lastAudited`, `report` и — главное — `hypotheses`, список того, что в этой
  области уже ломалось. Гипотезы важнее фантазии проверяющего: аудит без них
  возвращает общие слова.
- `run_public_evals.py`: `validate_rot` (ссылки живых доков на несуществующие
  файлы кода) и `validate_audit_freshness` (просрочка по реестру, `audit fresh:
  <область> (Nd / Md)`).
- `.agents/skills/project-health/SKILL.md` + побайтное зеркало в
  `.claude/skills/` — процедура: одна область за проход, число на каждую
  гипотезу, обязательно назвать и работающее, оценить, чинится ли находка
  проверкой, а не абзацем.

Expected benefit: аудит перестаёт зависеть от того, вспомнит ли о нём человек.
Eval сам называет просроченную область; скилл даёт вход, с которого начинать.

Risks and containment: `validate_rot` даёт ложные срабатывания на законных
упоминаниях отсутствующего («файл удалён», «создать»). Сдержано двумя
решениями: исключены исторические каталоги (`docs/decisions/`, `provenance/`,
`agent/`) и построчные маркеры намерения. Проверено на живом дереве: 8 находок,
5 оказались настоящими и починены, 3 — законными и отсечены маркерами. Второй
риск — реестр устареет сам: сдержано тем, что обновление `lastAudited` вынесено
в `## Output` скилла, а неисполнение краснит eval.

Правило в свод НЕ добавлено сознательно: механизм самодостаточен (краснеет и
называет область), а запас `AGENTS.md` — 132 байта.

Validation: public eval 190 passed / 0 failed. Негативный контроль обеих новых
проверок получен явно: `lastAudited` сдвинут на 2026-01-01 и в `docs/ECONOMY.md`
добавлена ссылка на несуществующий `server/src/nonexistent/ghost.ts` — `188
passed, 2 failed`, обе с ожидаемыми сообщениями; после восстановления снова
190/0.

Fresh-session status: pending — сработает ли триггер в свежей сессии, проверится
естественным путём: первая же просрочка (`agent-system`, 60 дней от 2026-07-23)
наступит около 2026-09-21.

Decision: keep.


## 2026-07-31 — `map-task-approval-gate`

Дата / change id: 2026-07-31 / map-task-approval-gate

Problem evidence: прямое требование пользователя («в прошлой сессии мы часто
действовали вслепую и чинили баги точечно») подтверждается историей репозитория,
а не только впечатлением. Три предыдущие записи этого журнала фиксируют тот же
класс на карте: `map-session-recurring-failures` (2026-07-19, пять повторяющихся
отказов за день), `missing-land-diagnostic-permanent` (2026-07-22, пропажа целых
территорий всплывала только по случайной жалобе), `map-geometry-qa` skill
(2026-07-29, три новых режима отказа плюс уже задокументированный урок,
повторившийся дословно в самом ПОСТОЯННОМ инструменте). Секция «Карта/регионы»
в `docs/TODO.md` на момент правки содержала 16 закрытых пунктов, и в нескольких
фикс порождал следующий дефект: точечный `unary_union` пробил дыру-донат в
Karakalpakstan, а первая версия защиты чуть не съела Байконур; первая «починка»
рендера Washington — San Juan скрыла два других бага. Дополнительно в самой
сессии: инструмент `Read` отдал 67-строчную версию `scripts/map/AGENTS.md` для
пути, где на диске лежало 126 строк, — расхождение поймано только сверкой
`wc -l`. Это ровно тот класс «действие на непроверенном состоянии».

Layer changed: два узких слоя. (1) Корневой `AGENTS.md` — ОДНА строка-триггер в
«Инженерных правилах»; корень нужен потому, что шаг «пересказ до изучения»
обязан сработать в первом же ходе, а nested `scripts/map/AGENTS.md` по
`.claude/CLAUDE.md` читается лишь перед правкой, то есть уже после исследования.
(2) `scripts/map/AGENTS.md` — полный протокол: четыре шага, гранулярность (гейт
на задачу, не на шаг внутри одобренного плана), список исключений и явное
указание, что гейт не заменяет ExecPlan и скилл `map-geometry-qa`. Код, данные,
скиллы и пайплайн не тронуты.

Expected benefit: правка карты перестаёт начинаться с догадки о причине.
Пользователь получает точку вмешательства ДО реализации, где расхождение в
понимании стоит одну реплику, а не откат сессии.

Risks and containment: (а) гейт замедляет мелкие правки — сдержано списком
исключений (read-only ответ, продолжение одобренного плана, откат только что
отклонённой итерации); (б) риск вырождения в ритуал — сдержан тем, что причина
записана в самом правиле, а шаг 3 требует назвать владеющий скрипт и прошлые
попытки, то есть проверяемое содержание, а не формальную фразу; (в) **бюджет
свода почти исчерпан: 16 348 из 16 384 байт, запас 36.** Следующая правка
корневого файла потребует компрессии — предупреждение из записи
`docs-layout-and-two-rules` (запас был 202) подтвердилось на первой же правке.

Validation: `python .agent/evals/public/run_public_evals.py` после правки.
Негативного контроля у текстового правила нет по построению — сработает или нет,
покажет поведение следующей сессии.

Fresh-session status: pending — правило введено той же сессией, которая его
пишет; срабатывание в СЛЕДУЮЩЕЙ независимой сессии не проверено.

Decision: keep (по прямому требованию пользователя).

## 2026-07-31 — `unchanged-measurement-means-wrong-path`

Дата / change id: 2026-07-31 / unchanged-measurement-means-wrong-path

Problem evidence (одна сессия, четыре независимых случая, все измеримые):

1. **Три правки подряд не сдвинули замер НИ НА ОДНУ ТОЧКУ.** Прибрежные хвосты
   линий раздела в `build_seas_from_iho.py`: Гибралтар 298 точек / 297 строго
   по осям. После правки «разрез линией делимитации» — 298/297. После правки
   «перебор пар вместо двух ближайших» — 298/297. Побайтно то же и у
   Восточно-Китайского (662/661) и Сев.–Норвежского (709/708). Каждый раз
   результат выяснялся ПОЛНОЙ пересборкой (5-8 минут), то есть цена одной
   непроверенной гипотезы — прогон.
2. **Изолированный тест вводил в заблуждение.** Воспроизведение того же куска
   в окне 1° давало `assign_by_divide -> True`, 2 чистых осколка — то есть
   «код работает». В живом прогоне тот же участок шёл другим путём: дефект был
   контекстным (кусок в реальном тайле имел другую форму и 3 кандидата).
3. **Инструментовка дала ответ ОДНОЙ строкой:** `кусок 2.744 км², кандидатов 3
   -> СЕТКА, осколков 869`. Причина оказалась не в механизме разреза, который
   правился трижды, а в обработке его отказа. После правки: 0/0 точек по осям,
   вершин в слое 288 498 против 674 275 (−57%), размер 27.5 → 11.7 МБ.
4. **Тот же класс, но с обратным знаком, в этой же сессии:** сборка упала на
   `UnboundLocalError`, а диагностика прочитала СТАРЫЙ выходной файл и выдала
   правдоподобные числа (`GAP 9134.74`, как и в прошлый раз). Едва не был сдан
   отчёт о результате несуществующего прогона; поймано только потому, что
   счётчик проходов напечатал «проход 1» и замолчал.

Общий корень: замер молчаливо относился не к тому, что правилось. В случаях
1-3 — правился путь, по которому данные не идут; в случае 4 — читался артефакт,
которого правка не касалась.

Layer changed: только запись в этом журнале. Durable-правило требует места, и
оно СЕЙЧАС НЕДОСТУПНО: корневой `AGENTS.md` — 16 348 из 16 384 байт, запас 36.
Правило общее (относится к любой отладке, не только к карте), поэтому
`scripts/map/AGENTS.md` для него — неверный слой, хотя все четыре случая
пришли оттуда. Решение о месте (сжать свод или принять узкий слой) остаётся за
пользователем; до него запись работает как evidence, а не как инструкция.

Формулировка правила: **повторный замер, не изменившийся после правки,
означает, что правится не тот путь. Следующий шаг — инструментовка живого
прогона, а не новая гипотеза.** И симметрично: **числа, снятые с артефакта, не
являются результатом прогона, пока не проверен его код возврата.**

Expected benefit: цена ошибочной гипотезы падает с полной пересборки до одной
отладочной строки. В этой сессии правило сэкономило бы два прогона из трёх.

Risks and containment: инструментовка добавляет код, живущий после отладки.
Сдержано тем, что она включается переменной окружения (`SEAS_DEBUG_POINT`) и в
обычном прогоне не печатает ничего. Второй риск — соблазн инструментировать
всё подряд вместо чтения кода; правило намеренно привязано к УСЛОВИЮ
(замер не изменился), а не к «когда непонятно».

Validation: правило выведено из измеримых фактов, а не из впечатления — числа
до/после приведены выше. Прямой проверки самого правила нет по построению:
оно про процесс, а не про код. Public eval 170/0 после правок сессии.

Fresh-session status: pending — сработает ли рефлекс «замер не изменился →
инструментировать» в СЛЕДУЮЩЕЙ независимой сессии, не проверено; в этой оно
применено тем же агентом, который его выводит, и лишь с третьего раза.

Decision: keep (по прямому требованию пользователя). Место для durable-правила
— открытый вопрос, см. Layer changed.
## 2026-08-01 — `session-handoff`: перенос работы в свежую сессию

Problem evidence: запрос пользователя («сессии не раздувались и ты не успевал
начать деградировать») плюс наблюдаемый случай в той же сессии, а не общее
опасение.

- В этой сессии я закрыл дефект «Правило C мертво» и назвал доказательством
  числа 81 → 68 → 48. Это были страны, ЗАДЕТЫЕ порогом, а не способные сдвинуть
  бюджет; последних 1 → 0 → 0, то есть дефект не был закрыт. Ошибка возникла на
  пересказе собственного раннего замера, а не на новом измерении, и продержалась
  до того, как живой guard-тест её обнаружил.
- Та же сессия ранее: обрезанный вывод `git merge` (`tail -6`) скрыл третий
  конфликт, и маркеры конфликта попали в `main`; данные прогона LLM удалены
  вместе с деревом. Оба случая — работа по неполной картине в длинной сессии.
- Сессия прошла сжатие контекста и сменила область более трёх раз (война →
  экономика → дипломатия → промт режиссёра → бюджет ИИ).

Layer changed: два места, оба узкие.

- `.agents/skills/session-handoff/SKILL.md` (+ побайтное зеркало в
  `.claude/skills/`) — проверка признаков и формат пакета передачи;
- `AGENTS.md`, раздел завершения: одна строка о том, когда скилл обязателен.
  Место под неё освобождено сжатием четырёх соседних формулировок, порог 16 384
  байта не поднимался (16 291 после правки).

Первая редакция скилла передавала ЗАДАЧУ, но не РОЛЬ: пропажу заметил
пользователь («а свою роль оркестрации передать?»), и это второе evidence того
же рода — роль ведущего не восстанавливается из репозитория. `git worktree list`
показывает деревья, но не показывает, какое ждёт интеграции, а какое брошено;
`Status: active` переживает влитую задачу (`government-forms.md` заявляет дерево
и ветку, которых нет, при работе в `main` с `d642a86`). Блок роли добавлен в
шаблон и в условия провала.

Expected benefit: числа, названные без замера, перестают переезжать из сессии в
сессию; новая сессия стартует с состоянием, приоритетами, очередью раздачи и
списком того, что нельзя цитировать без перезамера.

Regression risk: ритуальные переносы там, где работа шла нормально. Смягчено
разделом «Do not trigger» и требованием ЖЁСТКОГО признака или двух мягких.

Validation: `python .agent/evals/public/run_public_evals.py` — 210 passed, 0
failed (скилл проверен на обязательные разделы и parity зеркала).

Future-session gate: если за следующие сессии пакет передачи ни разу не
пригодится при старте — правило избыточно и подлежит снятию, а не расширению.

Гейт и путь заменены записью 2026-08-08 `handoff-per-branch`: один общий файл на
все сессии оказался неверным контейнером, пакет живёт в
`.agent/handoff/<ветка>.md`.

## 2026-07-31 — `integrate-branch`

Problem evidence: два случая за одну сессию, оба — на интеграции чужой ветки,
оба невидимы автору по построению.

1. Ветка `claude/diplomacy-thresholds` заявила в `IDEAS.md` «552 союзные записи
   к 13-му месяцу». На объединённой базе их 90 к 60-му и 0 к 12-му — разница
   вшестеро. Замер снимался ДО влития `claude/p0-simulation-fixes`, а
   `nationalPower` считается от бюджета, от неё же зависит, кого движок считает
   доминируемым игроком. Автор не мог этого знать: на его базе число было верным.
2. При интеграции той же ветки в `main` попал `docs/DECISIONS.md` с четырьмя
   маркерами конфликта и побайтно продублированной записью. Вывод `git merge`
   был обрезан `tail -6`, третий конфликт не замечен, `git add -A docs` внёс
   файл как есть. Пролежало три часа и пережило два последующих мержа, обрастая
   вложенными маркерами.

Общий класс: **дерево изолирует файлы, но не время.** Пока интеграция делается
«заодно, в конце», у неё нет ни своего входа, ни своих критериев провала — и
проверяется то, что бросается в глаза, а не то, что расходится.

Layer changed: новый `.agents/skills/integrate-branch/SKILL.md` + побайтное
зеркало в `.claude/skills/`. Ключевые требования процедуры: мерж в отдельном
дереве; вывод мержа читается целиком, а состояние проверяется ВТОРЫМ способом
(`git status` + `git grep` на маркеры); конфликты в журналах разрешаются по
смыслу со сверкой числа записей до и после; ключевые числа автора
перемеряются на объединённой базе, а не читаются из отчёта; негативный контроль
его тестов проводит интегратор своими руками.

Плюс машинная проверка `validate_no_conflict_markers` в public eval — она
закрывает второй случай целиком, независимо от внимательности интегратора.

Expected benefit: расхождения ловятся там, где возникают, а устаревшее число
правится в документе, где живёт, — не оседает как факт для следующих сессий.

Risks and containment: главный риск — процедура станет обрядом, который
исполняют формально («смержил, тесты зелёные»). Сдержано формулировкой условия
провала: **мерж, после которого нельзя назвать ни одного числа, проверенного
самостоятельно, считается несостоявшимся ревью.** Второй риск — рост стоимости
каждой интеграции; принят сознательно: обе находки этой сессии стоили дороже.

Validation: public eval 201 passed / 0 failed (структура скилла + parity
зеркала). Негативный контроль `validate_no_conflict_markers` получен явно:
внесённые маркеры дают FAIL с путём и строкой, снятие возвращает зелёный.

Fresh-session status: pending — сработает ли триггер без напоминания, проверится
на следующей готовой ветке параллельной сессии.

Decision: keep.

## 2026-07-31 — `scope-discipline`: защита объёма v1

Problem evidence: пользователь назвал свою склонность прямо и попросил
поправлять его — «хочется чтобы всё было идеально… а то проект будет
разрастаться и не закончится никогда». Это не наблюдение агента, а запрос
пользователя на изменение поведения агента, и он совпадает с тем, что видно в
самом репозитории:

- `docs/IDEAS.md` заведён 2026-07-30 как реестр предложений, но у записей не
  было ПРИОРИТЕТА относительно выпуска — только статус «предложено/отклонено».
  Идея, признанная разумной, ничем не отличалась от идеи, нужной для релиза;
- за 2026-07-31 backlog пополнился быстрее, чем закрывался: пять P0 закрыты, но
  добавлено семь новых пунктов (демографическая калибровка, мёртвый модификатор
  оккупации, статичная `region.stability`, перевес потока над запасом, два
  условия включения рецессии, осиротевшие `aiTraits`). Каждый обоснован
  числами — и именно поэтому список растёт быстрее, чем сокращается.

Layer changed: два места, оба узкие.

- `AGENTS.md`, раздел инженерных правил: «Защищай объём v1» — идея, без которой
  партия не проходится насквозь, идёт в реестр с горизонтом «после v1», а не в
  работу; агент обязан назвать это вслух и предложить минимальную версию.
  Правило потребовало сжатия двух других формулировок (роли, разрешение на
  инфраструктуру): свод упёрся в лимит — первая редакция дала 16 463 байта при
  пороге 16 384, итог 16 328.
- `docs/IDEAS.md`: обязательное поле ГОРИЗОНТ (`v1` / `после v1`) плюс критерий
  «что входит в v1» — начать партию, принять несколько осмысленных решений,
  увидеть последствия, дойти до вердикта. Двум живым развилкам горизонт
  проставлен сразу, иначе поле осталось бы декларацией.

Expected benefit: у агента появляется мандат возражать против усложнения — до
этого правила «меняй минимальный полный scope» хватало на объём ПРАВКИ, но не
на объём ПРОДУКТА. Идея не теряется и не превращается в работу автоматически.

Risks and containment: главный риск — правило станет предлогом отказываться от
нужного («это после v1»). Сдержано формулировкой: агент называет усложнение
одной фразой, предлагает минимальную версию и ПРОДОЛЖАЕТ; решение остаётся за
пользователем, спорить дальше его ответа правило не разрешает. Второй риск —
критерий v1 окажется размытым на практике; проверится на первой же спорной
идее, до тех пор считать формулировку черновой.

Validation: public eval 201 passed / 0 failed. Негативный контроль лимита свода
получен по факту: 16 463 → красный, после сжатия 16 328 → зелёный.

Fresh-session status: pending — сработает ли правило без напоминания, проверится
на первой же идее, которую пользователь предложит вне критического пути.

Decision: keep.

## 2026-07-31 — eval мерил платформу, а не проект

Problem evidence: public eval давал РАЗНЫЙ результат в основном checkout и в
linked worktree на одном и том же коммите. В деревьях 201/0, в `main` — 199/2, и
пользователь видел красный там, где агент отчитался зелёным. Две независимые
причины, обе одного класса: проверка оценивала рабочий каталог как есть, не
отличая содержимое от его представления и свой код от чужого.

1. **`AGENTS.md` мерился в байтах на диске.** При `core.autocrlf=true` git
   выгружает файлы с CRLF: 16 328 байт в репозитории против 16 526 на диске.
   Свод, влезавший в лимит по содержанию, его превышал по представлению — то
   есть проверка запрещала правила в зависимости от настройки git пользователя.
   В деревьях файл оказывался с LF (его писал агент), поэтому расхождение и не
   всплывало до влития.
2. **Проверка ссылок сканировала `.reference/`** — локальные клоны ЧУЖИХ
   репозиториев (разбор Open-Historia, 2026-07-30), исключённые через
   `.git/info/exclude`. Они существуют только в основном checkout, и их
   внутренние ссылки давали десять «битых» находок, к проекту не относящихся.

Layer changed: `.agent/evals/public/run_public_evals.py`.

- `normalized_size()` — размер по содержимому (CRLF → LF) вместо
  `stat().st_size`. Применён к лимиту свода;
- `SKIP_TREE_DIRS` — один список исключений на все обходы дерева, в нём
  `.reference` рядом с `.git`/`node_modules`/`dist`. Раньше у проверки ссылок и
  проверки маркеров были разные списки, и добавление каталога в один не
  закрывало второй.

Expected benefit: результат eval перестаёт зависеть от того, где он запущен и
как настроен git. Это условие доверия к нему: проверка, зелёная у агента и
красная у пользователя, хуже её отсутствия — она создаёт ложную уверенность.

Risks and containment: нормализация могла сделать лимит бесполезным. Негативный
контроль: свод, раздутый на 300 байт LF-содержимого, даёт FAIL; исходный —
PASS. Второй риск — `SKIP_TREE_DIRS` начнёт прятать настоящие каталоги проекта;
сдержано тем, что список короткий и каждый элемент обоснован в комментарии.

Validation: починенный eval прогнан НА РЕАЛЬНОМ `main`, где расхождение и
возникло: было 199 passed / 2 failed, стало 201 / 0. В дереве — 201 / 0.

Fresh-session status: подтверждено сразу — обе причины воспроизводились до
правки и исчезли после, на обоих деревьях.

Decision: keep.

## 2026-08-01 — необратимое выдаётся командой, а не описанием

Problem evidence: в сессии 2026-08-01 агент трижды описал СЛОВАМИ действия,
которые обязан был передать готовой строкой. Дерево `distance-thresholds` и
дерево `narrative-prompt` — влиты и чисты, вывод был «можно убирать» вместо
команды; очередь мержей готовых веток — «мержить в таком порядке» вместо строк.
Пользователь ответил тем, что собрал команды сам, и сформулировал правило как
постоянное: «твоя работа — не „можно убрать дерево X“, а готовая строка,
которую я запускаю не думая». Асимметрия здесь структурная, а не стилистическая:
эти действия агенту ЗАПРЕЩЕНЫ и разрешены только пользователю, поэтому описание
перекладывает на него сборку команды и путь к скрипту — работу, которую агент
уже проделал и выбросил.

Слабое место evidence названо прямо: три случая внутри ОДНОЙ сессии, не
многосессионная статистика. Вторая нога — не самонаблюдение агента, а прямое
указание пользователя, то есть human control над границей, а не оптимизация
агентом самого себя.

Layer changed: одна строка `AGENTS.md`, раздел «Git, документация и завершение»
— дописано к существующему пункту про push/merge, новый пункт не заводился.
Удаление веток и деревьев внесено в то же перечисление: оно той же природы
(прерогатива пользователя), и отдельного правила не требует.

Expected benefit: пользователь получает исполняемую строку вместо задачи по её
сборке; агент перестаёт терять уже установленное состояние (путь к скрипту,
имя ветки, флаги) на границе своей компетенции.

Risks and containment: команда, выданная без проверки состояния, может быть
запущена вслепую — например, на дереве с чужой живой работой. Сдержано тем, что
`scripts/worktree-drop.ps1` сам отказывает на незакоммиченном и невлитом, а
снять отказ можно только явным `-Force`. Правило требует ФОРМЫ вывода и не
ослабляет ни одного approval: запрет самому выполнять merge/push/удаление
остаётся на месте.

Бюджет свода: правило стоило около 160 байт при запасе 93. Порог 16 384 НЕ
поднимался — место освобождено сжатием соседей без потери смысла. Снято
настоящее дублирование: обязательность public eval при изменении
agent-конфигурации была записана дважды (разделы «Проверка» и «Планирование»),
осталась в «Проверке», во втором месте — ссылка. Второй источник — пункт про
`worktree-drop.ps1`, где перечисление отказов свёрнуто до «на незакоммиченном и
невлитом». Итог 16 307 байт, запас 77.

Validation: `python .agent/evals/public/run_public_evals.py` — 210 passed,
0 failed (в том числе проверка лимита свода по нормализованному размеру).

Fresh-session status: проверяется следующей сессией — правило про форму вывода
подтверждается тем, что необратимое приходит строкой без напоминания.

Decision: keep.


## 2026-08-01 — `map-geometry-design-skill`

Observed problem: агент, получивший задачу по геометрии карты, начинает править
полигоны раньше, чем установил, надо ли править. Пользователь вынужден
перепроверять и переобъяснять по нескольку раз за задачу.

Evidence:

1. Наблюдение пользователя по нескольким последним картографическим задачам —
   сформулировано как устойчивый режим. Ссылок на конкретные задачи, даты или
   коммиты в записи нет, и добыть их постфактум не удалось: планка журнала
   («evidence из repository/runtime, а не единичное предпочтение») этим пунктом
   НЕ берётся, и durable-правка держится на пунктах 2 и 3, а не на нём. Оставлен
   как контекст мотивации, не как доказательство (уточнено при интеграции
   2026-08-01).
2. Воспроизведено в той же сессии на самом агенте: площадь морских зон
   посчитана собственной сферической формулой и дала для Арктики 505 млн км²
   вместо 5,2 (кольцо охватывает полюс, формула возвращает дополнение) — при
   том, что в файле лежало готовое свойство `area_km2`. Цифра выглядела
   правдоподобно и попала бы в план, если бы не сверка суммы с площадью
   океанов Земли.
3. Протокол `find-existing-solutions` показал частичное покрытие: `investigate`
   (факты до фикса, но про сбои), `plan-challenger` (ревью готового плана),
   `delegate-data-layer` (делегирование, но данных и явно «не для
   проектирования механик»), `map-geometry-qa` (проверка ПОСЛЕ правок),
   `prompt-architect`, `verify-change`, `integrate-branch`. Фронт-энда «решить,
   менять ли и как» нет; вручную цепочку из шести скиллов никто не собирает.

Layer changed: канон `.agents/skills/map-geometry-design/SKILL.md` и побайтно
совпадающее зеркало `.claude/skills/map-geometry-design/SKILL.md`.

Размещение исправлено при интеграции 2026-08-01: ветка клала скилл ТОЛЬКО в
`.claude/`, обосновывая это аналогией — «Claude-local, как соседний
`map-geometry-qa`». Аналогия не выдержала проверки. `map-geometry-qa`
Claude-локален по содержанию: он опирается на `Read tool` и `Browser pane`,
инструменты именно Claude Code. У этого скилла ни одной Claude-специфичной
опоры нет, а шаг 5 маршрутизирует исполнение на «субагента» и «отдельную
сессию» и велит собирать бриф через `prompt-architect`, доступный обоим
инструментам, — то есть скилл сам рассчитан на межагентный сценарий, но лежал
там, где его увидит только Claude. Аналогия причиной размещения не считается.

Цена решения названа прямо: шаг 6 ссылается на `map-geometry-qa`, который
остаётся Claude-локальным. Агент другого инструмента прочитает его как
документ, но не вызовет как скилл. Переносить `map-geometry-qa` в канон эта
задача не бралась — там есть настоящая Claude-специфика, и её снятие требует
переписывания процедуры, а не копирования файла.

Expected benefit: структурный гейт вместо призыва «думай». Скилл запрещает себе
править геометрию, требует замера до мнения, делает отказ от перекройки
валидным итогом и маршрутизирует исполнение: мелкое — субагенту, комплексное —
отдельной сессии с отчётом обратно и артефактом-доказательством. Приёмка —
независимый перезамер, а не доверие отчёту.

Risks and containment: главный риск — ещё один скилл, дублирующий существующие.
Сдержано тем, что новый композирует (явно вызывает `find-existing-solutions`,
`plan-challenger`, `prompt-architect`, `map-geometry-qa`, `verify-change`,
`integrate-branch`), а не переописывает их. Второй риск — гейт затормозит
мелкие правки; сдержано маршрутизацией: механическая правка уходит субагенту
сразу, без сессии.

Validation: public eval — 219 passed, 0 failed на базе, объединённой с `main`
(число проверок выросло с 210, потому что новая пара канон/зеркало добавила
свои). Прежняя цифра 201 из этой записи снята на старой базе ветки и текущему
`main` не соответствует.

Негативный контроль появился вместе с каноном и относится к парности, а не к
содержанию скилла: лишний байт в `.agents/skills/map-geometry-design/SKILL.md`
даёт `FAIL: Claude mirror matches canonical skill: map-geometry-design`
(218/1), после восстановления снова 219/0 — то есть проверка на этой паре
реально включена, а не просто числится. Самому тексту скилла падать по-прежнему
не на чем: это инструкция, а не код.
Честный future-session gate: применить на ближайшей реальной задаче
(перенарезка шести океанских монолитов в морских зонах) и проверить, что план
пришёл раньше правок геометрии.

Fresh-session status: НЕ подтверждено — скилл ещё ни разу не применялся свежей
сессией, эффективность против исходной проблемы не измерена.

Decision: keep — при явном условии, что первое реальное применение считается
проверкой, и при провале скилл пересматривается, а не защищается.



## 2026-08-01 — штамп Last updated ограничен, дыра Гудхарта в лимите строк закрыта

Problem evidence: повторяющийся многосессионный дефект, найден внешним аудитом
по жалобе пользователя на нечитаемость живых доков. Лимит размера
`DECISIONS.md`/`TODO.md` в public eval меряет СТРОКИ, поэтому сводки сессий
переехали в однострочный штамп `Last updated:`: мержи параллельных веток
накапливали варианты строки вместо разрешения, и в `DECISIONS.md` скопилось
ПЯТЬ штампов по ~38 000 символов (в `TODO.md` — 9 400, в `POLITICS.md` —
1 100). Файлы нечитаемы, проверка зелёная: метрика провоцировала ровно то,
от чего защищала. Содержимое штампов дублировало обычные записи журнала
(проверено grep'ом по ключевым фактам до правки) — терялась читаемость,
не информация.

Layer changed: самый узкий — одна проверка в `validate_living_docs`
(`run_public_evals.py`): штамп `Last updated:` ≤ 300 символов и не больше
одного на файл по `docs/**` (архив/провенанс/bootstrap исключены — они
фиксируют прошлое). Три файла приведены к правилу одноразовым скриптом;
правило продублировано только внутри самих штампов `DECISIONS.md`/`TODO.md`
одной фразой, свод `AGENTS.md` не трогался.

Expected benefit: живые доки снова открываются и читаются; сводка сессии
может жить только записью журнала; мерж, сохранивший два штампа, немедленно
красный.

Risks and containment: legitimate-длинный штамп невозможен по построению —
это указатель свежести, не контент; порог 300 символов вмещает дату и одну
фразу. Проверка не трогает тело документов (там законные строки до ~1000
символов в таблицах).

Validation: негативный контроль показан в сессии — новая проверка запущена
ДО починки файлов: 219 passed / 1 failed с перечислением всех пяти штампов;
после починки — 220 passed / 0 failed.

Decision: keep.


## 2026-08-01 — внешний аудит инфраструктуры: система сокращена до используемого ядра

Problem evidence: заказан пользователем («сделай аудит агентной
инфраструктуры… можно оптимизировать, что-то убрать; действуй независимо»)
по повторяющейся проблеме: инфраструктура растёт быстрее, чем применяется,
и её обслуживание вытесняет работу над игрой. Замеры двух независимых
read-only инвентаризаций, факты перепроверены выборочно:

- 5 скиллов bootstrap-волны 2026-07-23 (`investigate`, `plan-challenger`,
  `qa`, `security-audit`, `token-audit`) — ноль применений за всю историю:
  0 коммитов, 0 упоминаний в планах и DECISIONS; вердикт «принять после
  ревью» из agents-audit 2026-07-23 так и не был исполнен;
- 27 планов `Status: complete` без единой входящей ссылки в плоском
  `.agent/plans/` (PLANS.md предписывает «краткий evidence record либо
  удаляется»); гейт на удаление проверен пофайлово: complete + 0 ссылок;
- `CHARTER.proposed.md` — статус PROPOSED без движения с 2026-07-23, все
  12 нормативных правил построчно дублируют AGENTS.md, human review из
  его же §6 не проводился; 3 assert'а public eval были завязаны на текст;
- `.claude/skills/map-geometry-qa-workspace/` — 3,2 МБ eval-артефактов
  (PNG/логи) в каталоге скиллов, без SKILL.md, вне какой-либо проверки;
- 3 плана со `Status: active`, не соответствующим факту
  (`government-forms` — работа влита 2026-07-29, заявленные ветка и дерево
  не существуют; `1946-country-borders`, `ui-onboarding-slice-4` — стоят
  из-за заморозки UI-трека, а не активны).

Layer changed: удаления (5 скиллов, 27 планов-сирот, charter, workspace)
исполняются командой пользователя — auto-классификатор Claude Code
блокирует массовое удаление агентом, команда выдана готовой строкой.
Правки агентом: статусы трёх планов приведены к факту; charter-проверки
удалены из `validate_experiment_layer` с объяснением в коде; пункт про
charter снят из AGENTS.md; шапка EVOLUTION указывает на AGENTS.md как
держателя границ.

Expected benefit: `.agent/plans/` сокращается с 46 до 19 файлов и снова
читается как список задач; каталог скиллов содержит только применяемое;
единственный держатель границ — AGENTS.md, двоевластие «charter vs свод»
устранено; ни один живой указатель статуса не врёт о состоянии работы.

Risks and containment: удаления обратимы через git (все файлы в истории до
коммита удаления). Материалы design-цикла (`design-partner-audit.md`,
`reference/` ~1,1 МБ, скилл `strategy-game-ui`, `tech-generations-1946`)
НЕ тронуты — они привязаны к нерешённой развилке UI-линии; их судьба
решается после решения пользователя о канонической линии. Append-only
история (`audits/`, `runs/`, записи EVOLUTION) не редактировалась.

Validation: public eval после правок агента и до удалений — прогон в
сессии; повторный прогон после исполнения команды удаления обязателен
(charter-проверки сняты, остальных путей eval удаления не задевают).

Fresh-session status: проверяется следующей сессией — чистый eval на
сокращённой системе и отсутствие обращений к удалённым скиллам.

Decision: keep (сокращение), с оговоркой: новые скиллы/документы системы —
только по правилу этого журнала, с evidence ДО создания, не после.


## 2026-08-01 — планы умирают при интеграции; eval обязателен для коммитов в docs/

Problem evidence: продолжение аудита той же даты по прямому решению
пользователя («отработавшие планы надо убирать»; «надо сделать так, чтобы
такого не повторялось»). Два повторяющихся класса: (1) 27 завершённых
планов-сирот — lifecycle в PLANS.md формулировал удаление как опцию
(«остаётся … либо удаляется»), и опция не выбиралась ни разу; (2) штампы
Last updated росли неделями, потому что проверка существовала, но
запускалась только при правках agent-конфигурации и в CI — локальные
коммиты в docs/ шли мимо неё.

Layer changed: три точечные правки. PLANS.md §Расположение — удаление плана
при интеграции стало правилом с одним исключением (живая входящая ссылка);
`integrate-branch` шаг 8 (канон + зеркало побайтно) — удаление ExecPlan в
интеграционном коммите; AGENTS.md §Проверка — public eval обязателен также
для коммитов, трогающих `docs/` (+58 байт, итог в пределах порога 16 384).

Expected benefit: планы перестают накапливаться по построению — их убирает
тот же коммит, который делает их ненужными; разрастание живых доков
ловится в момент коммита, а не при следующем аудите.

Risks and containment: прозаическое правило может игнорироваться так же,
как прежнее — сдерживание в том, что оно теперь встроено в исполняемый
workflow интеграции (скилл), а не живёт отдельной памяткой. Если через
месяц появятся новые планы-сироты или разросшийся док в main — следующий
шаг по этому журналу: git pre-commit hook с public eval (сейчас не ставится,
чтобы не менять поведение чужих живых сессий без решения пользователя).

Validation: public eval прогнан после правок — parity зеркала
integrate-branch и лимит AGENTS.md в числе проверок.

Fresh-session status: проверяется следующей интеграцией ветки — план влитой
задачи должен исчезнуть в её интеграционном коммите.

Decision: keep.


## 2026-08-01 — гигиена доков механик: область mechanics-docs в реестре аудитов

Problem evidence: решение пользователя («чтобы все файлы механик были свежие
и расхождения с кодом были минимальны») поверх повторяющегося класса:
формульный аудит 2026-07-30 — половина находок были doc-rot (док обещает
несуществующее, называет мёртвым кодом никогда не существовавшее, снапшот не
пересматривался). Существующие защиты держат только края: правило «обнови
профильный док в тот же turn» — проза без проверки; rot-check в eval ловит
битые пути и снапшоты старше 90 дней, но не семантический drift; область
living-docs реестра покрывает TODO/DECISIONS, а не доки механик. Регулярной
сверки ECONOMY/POLITICS/WAR/TRADE/DIPLOMACY и остальных канонических доков
с кодом не требовал ни один красный тест.

Layer changed: самый узкий — одна область `mechanics-docs` в
`.agent/audits/registry.json` (механизм уже существует: eval краснеет по
просрочке и называет область; лечится прогоном `project-health` и записью).
maxAgeDays 45 — как у formulas: доки механик описывают те же системы и
гниют с той же скоростью. lastAudited 2026-07-30 — формульный аудит,
последняя реальная сверка этого шва; первый полноценный проход области —
не позже 2026-09-13.

Expected benefit: сверка доков механик с кодом перестаёт зависеть от памяти
и происходит не реже раза в 45 дней по красному тесту; между аудитами drift
держит правило same-turn — теперь как дополнение к гейту, а не единственная
защита.

Risks and containment: семантический drift между аудитами по-прежнему
возможен — это принятый остаток, полная машинная проверка «док против
смысла кода» невозможна. Риск формального прогона («пробежал глазами,
обновил дату») сдержан форматом реестра: запись требует report с находками,
и project-health формулирует гипотезы, которые нужно опровергнуть.

Validation: public eval прогнан — registry parseable, области свежи, отчёт
области существует.

Fresh-session status: проверяется первым прогоном области — не позже
2026-09-13 либо красным eval после этой даты.

Decision: keep.

## 2026-08-03 — rot-check видит имя файла без пути; множество кода строит git

Problem evidence: интеграция ветки `claude/actions-to-primitives` (2026-08-03)
удалила `LLMResponseValidator.ts`, `actionSchemas.ts` и `llmActionCaps.ts`.
Независимое ревью diff'а нашло ШЕСТЬ упоминаний удалённого валидатора в ЖИВЫХ
нормативных документах (`LLM_RULES.md`, `AI_RULES.md`, `WAR.md`, `TECH_TREE.md`,
`PRIMITIVES.md`, `plans/13`) плюс три в комментариях кода — ни одно не поймал
rot-check, который для того и заведён. Причина в одной строке: `if "/" not in
ref: continue` — ссылка без пути не проверялась вовсе. Класс повторяющийся, а
не единичный: `actions` — четвёртое удаление канала за месяц, и предыдущие
оставляли такой же след (`plans/02` пометил часть строк вручную и три
пропустил). Второй дефект найден при замере: множество `existing` собиралось
обходом пяти захардкоженных корней, и `server/scripts` в них не было — то есть
`runCampaignWithLLM.ts` для проверки НЕ СУЩЕСТВОВАЛ (400 файлов против 429 у
индекса git; не видны также `client/pages`).

Layer changed: самый узкий — функция `validate_rot` в
`.agent/evals/public/run_public_evals.py` плюс новая `_repo_code_files()`.
Ни правил в `AGENTS.md`, ни skills, ни policy не тронуто. Множество кода
строится по `git ls-files` (+ untracked, не ignored) вместо списка корней:
корень, заведённый позже, теперь попадает сам. Обход дерева не годится —
в linked worktree `node_modules` состоит из junction на главный checkout
(`scripts/worktree-new.ps1`), и `rglob` ушёл бы по ссылкам наружу.

Expected benefit: удаление файла перестаёт оставлять живые ссылки на него —
класс, который до сих пор ловился только независимым ревью и только когда его
заказывали. Деталь отказа теперь несёт счётчик находок, а не только первые
пять: «показано 5» и «найдено 5» были неразличимы.

Risks and containment: (1) проверка стала строже, и первый прогон дал 15
находок — все разобраны в этой же ветке, белого списка не заведено (белый
список и есть способ не проверять); (2) git может быть недоступен — тогда
возвращается прежнее множество по корням, проверка сужается, но не падает и не
молчит; (3) ложное срабатывание на голом имени распространённого файла
теоретически возможно, но матчинг идёт по basename ЛЮБОГО файла репозитория,
то есть срабатывает только если такого имени нет нигде.

Validation: три негативных контроля прогнаны и показаны. (а) временный док со
ссылкой `LLMResponseValidator.ts` без пути — eval краснеет; (б) он же со
ссылкой `runCampaignWithLLM.ts` — зелёный, при том что в старом множестве этого
файла не было (доказано сравнением множеств); (в) `subprocess.run` подменён на
бросающий OSError — запасной обход отдаёт 400 файлов, падения нет. Полный
прогон: 163 passed, 0 failed.

Fresh-session status: держится самим eval — правка встроена в него, отдельного
гейта не требует.

Decision: keep.

---

Дата / change id: 2026-08-07 / runnable-commands

Problem evidence: команды для необратимых операций выдавались в форме, которая
у пользователя не запускается. `D:/Pax Historia LOCAL/scripts/worktree-drop.ps1
roadmap-sync -DeleteBranch` дал `CommandNotFoundException`: PowerShell режет
путь по пробелу и ищет команду `D:/Pax`. Пользователь показал ошибку целиком.
Это не разовая опечатка — в проекте пути с пробелом ВЕЗДЕ (корень репозитория
`D:/Pax Historia LOCAL`), и та же форма выдавалась в сессии несколько раз
подряд. `AGENTS.md` уже требовал «ГОТОВУЮ команду, а не описание», но не
определял, что делает её готовой, поэтому требование выполнялось формально.

Layer changed: тот же пункт корневого `AGENTS.md`, что и раньше — определение
«готовой» заменено рабочим примером с `pwsh -File` и кавычками. Отдельного
правила не заводилось: это уточнение существующего, самый узкий слой.

Граница уточнена по проверке у пользователя: обёртка нужна ТОЛЬКО для `.ps1`.
`git` в его терминале запускается кнопкой как есть (`git -C "D:/Pax Historia
LOCAL" …`), и заворачивать его в `pwsh -Command` — лишний слой кавычек, который
сам становится источником ошибок. Правило это разделяет явно.

Expected benefit: команда запускается кнопкой из интерфейса, без правки руками.
Побочно снимается класс ошибок «скопировал — не работает» для любых будущих
скриптов репозитория, а не только `worktree-drop`.

Risks and containment: (1) машинно не проверяется — eval не видит, в какой
форме команда попала в ответ; признак нарушения простой и виден сразу, потому
что команда просто не выполняется у пользователя; (2) пример привязан к
абсолютному пути этой машины — при переезде репозитория строку придётся
поправить, но она и так иллюстративная.

Validation: `run_public_evals.py` — 163 passed, 0 failed, включая проверку
размера корневого `AGENTS.md` (16 352 из 16 384 нормализованных).

Fresh-session status: держится самим `AGENTS.md`, он грузится в каждую сессию.

Decision: keep.

---

Дата / change id: 2026-08-07 / run-button-block-tag

Problem evidence: команда, выданная по только что заведённому правилу «должна
запускаться одной кнопкой», кнопки не получила. Пользователь прислал скриншот:
у блока `pwsh -File "D:/Pax Historia LOCAL/scripts/worktree-drop.ps1"
pr-only-policy -DeleteBranch` есть только иконка копирования, тогда как у
соседнего блока с `git …` кнопка запуска была. Причина не в команде, а в теге
блока: приложение вешает «Run» на ```bash, а блок был помечен ```powershell.
Это второй промах того же класса за сессию — сначала команда не запускалась
из-за пробела в пути, теперь из-за тега, — и оба раза правило считалось
выполненным, потому что проверялся текст команды, а не то, что её можно нажать.

Layer changed: `.claude/CLAUDE.md` — адаптер Claude Code, а НЕ корневой
`AGENTS.md`. Кнопка «Run» и разметка блоков — свойство этого клиента; в общий
слой, который читает и Antigravity, такое не выносится. Корневой файл к тому же
в 39 байтах от лимита.

Expected benefit: команды на необратимые операции доезжают до пользователя
нажимаемыми. Закрывается разрыв между требованием в `AGENTS.md` («готовая
команда») и его фактическим исполнением.

Risks and containment: (1) машинно не проверяется — eval не видит тег блока в
ответе модели; признак нарушения виден пользователю сразу (кнопки нет), то есть
обратная связь мгновенная; (2) поведение приложения может измениться, и тогда
правило устареет молча — оно поэтому сформулировано как «кнопку вешает только
`bash`», а не как описание внутренностей клиента.

Validation: `run_public_evals.py` — 163 passed, 0 failed. Само правило
проверяется предъявлением: команда в этом же ответе выдана в блоке `bash`.

Fresh-session status: держится `.claude/CLAUDE.md`, он грузится в каждую сессию
Claude Code.

Decision: keep.

## 2026-08-08 — `orchestrator-roles-2026-08-08`

Observed problem: сессия, которой поручено вести работу, к середине теряет роль
ведущего — начинает соглашаться с пользователем и править код руками вместо
того, чтобы изучать, проектировать, выдавать задания и принимать результат.

Evidence:

- пользователь описал разрушение роли как воспроизводимое («модель обычно к
  середине сессии забывает, что она оркестратор, и начинает просто со мной
  соглашаться и делать вслепую»), то есть это не единичный случай;
- в самом журнале уже зафиксирован тот же класс: `session-handoff` в первой
  редакции передавал ЗАДАЧУ, но не РОЛЬ, и пропажу заметил пользователь
  («а свою роль оркестрации передать?»). Роль не восстанавливается ни из
  репозитория, ни из `git worktree list`;
- де-факто роль уже существовала без опоры: дерево `map-orchestrator` и пакет
  «оркестратор геометрии карты» в тогдашнем общем пакете передачи;
- механика причины: роль жила только в тексте промта и конкурировала с растущим
  контекстом, а при сжатии исчезала физически. Инструменты правки при этом
  оставались доступны, поэтому «сделаю сам» всегда было дешевле делегирования.

Root-cause hypothesis: роль, не имеющая ни внешнего состояния, ни ограничения
инструментов, держится только вниманием модели — самым дешёвым и самым
недолговечным ресурсом сессии.

Layer changed: три якоря, ни один не зависит от памяти модели.

- `scripts/hooks/role-guard.mjs` — `PreToolUse` блокирует правки вне
  `.agent/**` и `docs/**`, пока роль активна; `UserPromptSubmit` назначает роль
  командой `!роль <имя>` и подмешивает секцию `## Якорь` устава плюс счётчики
  реестра в контекст КАЖДЫЙ ход (Claude Code добавляет stdout именно этого
  события в контекст, поэтому якорь переживает сжатие);
- `.agent/roles/` — уставы `integrator`, `geometry`, `logic`, `world`, `ui` и
  формат роли; `.agent/orchestration/` — реестры заданий, где критерии приёмки
  записываются ДО старта исполнителя;
- `.claude/agents/report-auditor.md` — независимый аудит отчёта перед приёмкой:
  вердикт по умолчанию «не принято», доказательством считается только
  собственный прогон;
- `.agents/skills/orchestrate/` + побайтное зеркало — цикл роли;
- `.claude/settings.json` — проводка хука; `run_public_evals.py` —
  `validate_orchestrator_roles`.

Корневой `AGENTS.md` НЕ трогался: он в ~60 байтах от лимита, а роль
доставляется хуком в каждую сессию, то есть места в always-loaded слое не
требует. Механизм пока только для Claude Code: у Codex в `hooks.json` нет
`UserPromptSubmit`, а без него роль назначить нечем, и один `PreToolUse` дал бы
блокировку без напоминания.

Expected benefit: приёмка перестаёт опираться на отчёт исполнителя (критерии
записаны раньше отчёта, аудит перезапускает проверки сам), а «оркестратор
незаметно стал исполнителем» становится невозможным, а не нежелательным.

Risks and containment: (1) церемония там, где хватило бы одной правки —
снимается одной командой `!роль -`, роль назначает пользователь, а не модель;
(2) хук молча деградирует, если устав потеряет секцию `## Якорь`: закрыто
проверкой в public eval, негативный контроль показан (удаление секции даёт
`FAIL: Role geometry defines Якорь`, отключение хука от `UserPromptSubmit` —
`FAIL: Role guard is wired into UserPromptSubmit`); (3) fail-open, как у
`guard.mjs`: сломанный хук не парализует сессию — ценой того, что защита
исчезает тихо, поэтому и нужен живой тест.

Validation: `node scripts/hooks/test-role-guard.mjs` — 24 проверки, включая
негативный контроль (без роли те же вызовы проходят, с ролью блокируются);
`python .agent/evals/public/run_public_evals.py` — 225 passed, 0 failed
(baseline до правок: 163 passed, 0 failed).

Fresh-session status: держится хуком из `.claude/settings.json`, состояние роли
session-local в `~/.claude/geopolis-roles/<session_id>.json`.

Future-session gate: если за следующие сессии роль ни разу не назначалась, а
блокировки срабатывали только как помеха — механизм избыточен и подлежит
снятию, а не расширению. Если, наоборот, приёмки идут без строки аудита в
реестре — не хватает не правил, а проверки на сам реестр.

Decision: keep.

## 2026-08-08 — `orchestrator-lead-2026-08-08`

Observed problem: роли закрывали вертикаль (домен → аудит → влитие), но не
горизонталь. Несколько деревьев идут параллельно — UI, геометрия, логика, — и
свести их потом оказывается дорого.

Evidence — замер `node scripts/worktree-report.mjs` на `main @ 54ba9a4`:

- 10 невлитых веток одновременно;
- **164 файла, которые трогают две и более ветки**; у `docs/DECISIONS.md` и
  `docs/TODO.md` — по семь веток, у `client/src/game/adapter.ts` и
  `client/src/components/EventTimelinePanel.tsx` — по три-четыре;
- отставание от `main` до 468 коммитов (`codex/interface-from-scratch`), 136 и
  120 у двух живых веток;
- три дерева с уже влитыми ветками висели неснесёнными.

Пользователь описал ту же картину со своей стороны: «веду несколько деревьев
одновременно, и потом бывает сложно их совместить».

Root-cause hypothesis: «сложно совместить» — не свойство мержа, а следствие
двух решений, принятых слишком поздно. Форма общих данных не фиксируется до
старта, поэтому каждое дерево изобретает свою; и ветка живёт дольше, чем
`main` стоит на месте, поэтому влитие превращается в переписывание. Git
показывает текстовый конфликт, но НЕ показывает два несовместимых решения об
одном и том же — а именно они и дороги.

Layer changed:

- `.agent/roles/lead.md` — роль организатора: режет запрос на домены,
  фиксирует контракт стыка ДО заданий, ставит владельца контракта первым в
  очередь, отчитывается пользователю. Продуктовый приоритет остаётся у
  пользователя: организатор предлагает очерёдность с обоснованием;
- `scripts/worktree-report.mjs` — read-only сводка: отставание веток и файлы,
  общие для нескольких веток. Без неё «управление деревьями» — пересказ;
- `.agent/roles/README.md` (три уровня ролей), `.agent/orchestration/README.md`
  (что держит реестр `lead`), скилл `orchestrate` (шаг 4а) + зеркало;
- public eval: каждая роль обязана быть в таблице README, скрипт отчёта обязан
  существовать (на него ссылается якорь роли).

Expected benefit: несовместимость доменов обнаруживается на раздаче, а не на
влитии; долгая ветка видна числом, а не ощущением.

Risks and containment: (1) лишний слой на однодоменной задаче — в уставе прямо
задано условие включения (2+ домена или несколько живых деревьев), иначе идти
сразу в домен; (2) ложное спокойствие от отчёта: общий файл ≠ конфликт, и
наоборот — расхождение решений git не покажет; сказано в «Типовых ловушках»;
(3) отчёт врёт при устаревшем `main` — цифры снимаются прогоном, а не
цитированием прошлой сводки.

Validation: `python .agent/evals/public/run_public_evals.py` — 240 passed,
0 failed (baseline `main`: 225 passed, 0 failed);
`node scripts/hooks/test-role-guard.mjs` — 24 проверки, все прошли.
Негативный контроль новых проверок: устав, не внесённый в README, даёт
`FAIL: Role zzztest is listed in roles README`; исчезнувший
`scripts/worktree-report.mjs` — `FAIL: Role infrastructure doc exists`.

Fresh-session status: роль назначается `!роль lead`, устав держит хук.

Future-session gate: если за следующие сессии `lead` ни разу не назначался, а
кросс-доменные задачи всё равно шли — роль избыточна и подлежит снятию. Если
назначался, но число общих файлов между ветками не падает — не хватает не
роли, а порядка влития.

Decision: keep.

### Дополнение к `orchestrator-lead-2026-08-08` — раздача

Problem evidence: пользователь указал, что просил именно раздачу заданий, а
роль умела только фиксировать стык и вести очередь. Первая редакция хука
блокировала правки по `session_id` целиком, то есть заодно запретила бы
исполнителя, запущенного из сессии оркестратора: роль без рук превращалась в
роль без исполнителей.

Evidence из документации Claude Code (проверено 2026-08-08): хуки срабатывают и
внутри субагентов, а событие несёт `agent_id`/`agent_type` — то есть вызов
исполнителя отличим от вызова главного потока машинно, а не по догадке.

Layer changed: `scripts/hooks/role-guard.mjs` — блокировка правок применяется
только к главному потоку сессии; вызов с `agent_id` (субагент-исполнитель)
проходит. Мандат раздачи описан в `.agent/roles/lead.md` и в скилле
`orchestrate`: `Agent` с `isolation: "worktree"` на самодостаточную и
параллельную работу, пакет для отдельной сессии — на длинную и диалоговую.

Expected benefit: оркестратор действительно раздаёт, а не пересказывает
пользователю, что надо бы сделать.

Risks and containment: (1) делегирование как обход блокировки — субагент можно
послать «впиши строку»; сдерживается тем, что работа субагента видна в
транскрипте и всё равно проходит критерии приёмки и аудит, а также правилом
устава «между организатором и кодом всегда домен»; (2) субагент не может
спросить пользователя и склонен решать развилку сам — в задание входит явное
правило возвращаться с вопросом.

Validation: `node scripts/hooks/test-role-guard.mjs` — 26 проверок, включая
пару «субагент правит код / главный поток заблокирован» на одном и том же
файле и одной и той же активной роли.

Decision: keep.

## 2026-08-08 — `handoff-per-branch`: пакет передачи переезжает в файл своей ветки

Problem evidence — замеры организатора 2026-08-08 по ОБЩЕМУ передаточному файлу
(один на все сессии; удалён этим же изменением, текст — в git-истории):

- на первом сборе файл правили **7 веток из 10** — самый общий файл
  репозитория, обгоняющий `docs/DECISIONS.md` и `docs/TODO.md`;
- `claude/ui-port-panels` переписала в нём **269 строк**;
- `claude/handoff` разошлась от базы на **142 коммита** и несла собственную
  нумерацию пакетов: обычный мерж восстановил бы устаревшую структуру поверх
  нынешней. Понадобилось написанное вручную правило разрешения — влитие
  стратегией `ours` плюс дословный перенос одного абзаца
  (`.agent/orchestration/integrator.md`, влития 2026-08-08);
- к моменту правки в файле **719 строк и четыре пакета, и все четыре описывают
  уже влитую работу**: живого содержимого ноль;
- скилл предписывал «файл живой, перезаписывается ЦЕЛИКОМ (стартовый пакет, не
  журнал)», а фактическое поведение было обратным — файл рос как журнал.

Root-cause hypothesis: конфликтовало не содержимое, а КОНТЕЙНЕР. Сессия в
параллельном дереве физически не может исполнить «перезаписать целиком», не
стерев пакет соседа, поэтому каждая дописывала свой раздел — и правило скилла
превращалось в свою противоположность при первом же параллельном дереве.
Единственный общий файл на N изолированных веток — это разделяемое изменяемое
состояние без владельца; git показывает его как текстовый конфликт, но чинить
приходится смысл, а не текст.

Layer changed — контейнер и жизненный цикл, содержание пакета не тронуто:

- `.agents/skills/session-handoff/SKILL.md` + побайтное зеркало в
  `.claude/skills/` — пакет пишется в `.agent/handoff/<ветка>.md` (слэш ветки
  заменён дефисом; работа прямо в `main` → `main.md`). Правило
  «перезаписывается ЦЕЛИКОМ» сохранено — теперь оно исполнимо, потому что у
  файла один владелец. Добавлены явный жизненный цикл (файл удаляется
  интеграционным коммитом своей ветки — как ExecPlan `.agent/PLANS.md` и
  задание в реестре оркестратора `.agent/orchestration/README.md`) и два новых
  условия провала: пакет в общем или чужом файле; пакет, переживший влитие
  своей ветки;
- общий передаточный файл удалён. Каталог `.agent/handoff/` не заводится
  пустым: путь создаётся первым обращением;
- `docs/TODO.md` — ссылка «подробности в общем файле, пакет 3» заменена
  ссылкой на коммиты влитой ветки.

Expected benefit: конфликт по передаточному файлу исчезает по построению, а не
разрешается правилом на каждое влитие; «перезаписывается целиком» становится
исполнимым; мёртвый пакет не переживает свою базу, потому что удаляется тем же
коммитом, что и ExecPlan.

Risks and containment: (1) сессии со старым текстом скилла в контексте будут
искать удалённый файл — ломать нечего, файл остаётся в истории git, новый путь
создаётся первым обращением, обратная совместимость намеренно не заводится;
(2) интегратор забудет удалить файл — тот же риск, что у ExecPlan, и та же
защита: правило записано в скилле и в `.agent/orchestration/README.md`, а
мусор виден как каталог с файлами влитых веток; (3) каталог накопит сирот от
брошенных веток — видно одной командой рядом с `git branch --no-merged main`.

Validation: `python .agent/evals/public/run_public_evals.py` — прогон и
негативный контроль parity зеркала (изменение зеркала на один байт обязано
красить проверку И называть пару) показаны в отчёте задачи.

Future-session gate — заменяет гейт записи 2026-08-01, который был поставлен на
общий файл: если за следующие сессии ни один файл в `.agent/handoff/` не
пригодится при старте новой сессии — правило избыточно и подлежит снятию, а
не расширению. Если файлы пишутся, но переживают влитие своей ветки — не
работает жизненный цикл, а не контейнер.

Decision: keep.

## 2026-08-08 — `handoff-lessons-2026-08-08`: урожай с удаляемого общего файла

Problem evidence: перед удалением общего файла прочитаны все четыре
пакета (719 строк). Разделы «Грабли этой сессии» — единственное в них, что не
портится от времени: числа, состояния деревьев и списки открытого сами
объявлены непригодными без перезамера и НЕ переносятся. Уроки ниже сгруппированы
по классам; в скобках — сколько НЕЗАВИСИМЫХ случаев дал каждый класс, потому
что правило этого журнала требует повторяемости, а не впечатления.

**1. Зелёная проверка проходит по причине, не связанной с проверяемым
свойством (4).** Совпадение площадей после `difference` давало идеальные числа
и роняло `coverage_is_valid` — «площади сходятся раньше топологии». Сторож
«страна кризиса попадает в промт» был зелёным и со СНЯТОЙ правкой: в фикстуре
все страны оказались не-major, и нужная попадала в промт другим путём. Дважды
негативный контроль оказался фиктивным: скриптовая подмена не нашла шаблон
(строка в файле была однострочной), тест не падал, и это выглядело успехом.
Проверочный скрипт врал молча: `\b` внутри template literal — это символ
backspace, а не граница слова. Незакрытый остаток: `AGENTS.md` требует
негативный контроль, но не требует доказать, что ПОДМЕНА ПРИМЕНИЛАСЬ. Кандидат
в правило; здесь не вводится — задача меняла контейнер хендоффа, а не
`AGENTS.md`.

**2. Мерж живых доков ломается тише, чем мерж кода (3+).** Когда обе стороны
дописали в голову `DECISIONS`, граница конфликтного блока склеивает тело одной
записи с заголовком следующей — `git grep` маркеров этого не ловит, стык надо
смотреть глазами. Обрезанный вывод `git merge` (`tail -6`) дважды скрыл
конфликт, и маркеры попали в живые файлы. Гейты размера падают ПОСЛЕ мержа,
когда обе стороны дописали по правилу: файл выходит за порог не от роста, а от
сложения двух журналов. Лечение уже задано `AGENTS.md` (перенос в архив
месяца, не поднятие порога); не покрыто ничем — «вывод `git merge` читать
целиком» и «после мержа журнала смотреть стык глазами».

**3. Отчёт — evidence, не authority (3).** Отчёт субагента содержал неверную
ссылку на файл, пойманную выборочной проверкой. Список осиротевших файлов из
ПРОШЛОГО передаточного пакета числил `ScenarioSelector` и `ErrorBoundary`
мёртвыми — их держит `App.tsx`, и удаление по списку снесло бы экран выбора
сценария: границу удаления считать обходом графа импортов, а не по списку в
передаточном документе. Вывод «конфликта К-2 не существует» опирался на
`git branch --merged`, то есть на имя ветки: работа приехала в `main` другим
путём, проверять надо СОДЕРЖИМОЕ. Класс прямо относится к самому хендоффу:
пакет передачи — свидетельство, а не источник истины.

**4. Дефект, снятый на прежней конфигурации, чинится вхолостую (1, но
дорогой).** Три дефекта из пяти в work-order оказались свойствами СНЯТОЙ
модели. Это и есть доказательство, что раздел «Числа, на которые нельзя
ссылаться без перезамера» в шаблоне пакета не ритуальный: подтверждай дефект на
ТЕКУЩЕЙ конфигурации прежде, чем его чинить.

**5. Команда, проверенная не в оболочке пользователя, у пользователя не
работает (3).** Путь с пробелом без `pwsh -File`; `pwsh -Command '… "путь" …'`,
проверенный в Bash-инструменте, где одинарные кавычки литеральны, — кнопка
«Run» отдаёт строку в PowerShell, и вложенные кавычки срезаются. Класс уже
закрыт правилами `runnable-commands` и `run-button-block-tag`. Незакрытый
остаток: `--ff-only` на сдвинувшемся `main` — состояние `main` проверять прямо
перед выдачей команды, а не в начале хода.

**6. Окружение общее с пользователем и с главным checkout (4).** `vite` на
чужом порту оказался живой сессией пользователя, а не забытым процессом; порт
занял другой проект — прежде чем считать порт своим, `netstat -ano` плюс
владелец PID. `preview_start` поднимает vite из ОСНОВНОГО checkout и отдаёт код
`main`, а не дерева: из worktree сервер поднимается вручную, и только потом
`preview_start {url}`. У linked worktree нет своего `server/.env`, и вывод «в
этом окружении LLM недоступна» был ложным — окружение поднимает лежавший в
репозитории `scripts/llm-run.ps1`, а обязательный `find-existing-solutions`
перед выводом «решения не существует» не запускался. Свежее дерево заводится от
`main` по умолчанию (`scripts/worktree-new.ps1`, `$Base = 'main'` — проверено
2026-08-08): без `-Base` первый запуск уходит на базу, где нет ни данных
задачи, ни брифа.

**7. Что не видно ни компилятору, ни тестам (3).** Отсутствующий ключ словаря
ловится только открытием конкретного экрана — или тестом, который теперь есть
(`client/src/i18n/__tests__/localeKeys.test.ts`). Тест вне путей `include`
серверного vitest не запускается нигде: `server/vitest.config.ts` держит
`src/**/*.test.ts` и `../shared/src/**/*.test.ts` (проверено 2026-08-08).
`tsc` и `vitest` расходятся — vitest типы не проверяет, поэтому тест с
частичным объектом состояния бывает зелёным при сломанной компиляции. Правка по
заранее снятым номерам строк ложится не туда после любой вставки: метить по
СОДЕРЖИМОМУ, номера пересчитывать.

**8. Ответ пользователя в разговоре ≠ заказ durable-правила (1, отменённый).**
Выбор из двух вариантов («всё через PR») был внесён в `AGENTS.md` как жёсткий
процесс и потом отменён. Правило изменения этого журнала уже требует
повторяющегося failure, а не единичного предпочтения; случай — его подтверждение
на живом примере.

**9. Число в задании исполнителю проверяется на последствие (1).** Бриф
«вернуть 217 км²» включал 130 км² открытой Атлантики: по букве задания регион
стал бы сухопутным. Исполнитель вынес развилку вместо исполнения — это и есть
правильное поведение, и оно уже записано в требованиях к заданиям
(`.agent/orchestration/README.md`, критерии приёмки до старта).

Layer changed: только этот журнал. Ни один класс не превращён здесь в
durable-правило: задача меняла контейнер хендоффа, и правка `AGENTS.md` или
чужих скиллов в её scope не входила. Записанное — evidence для следующей
такой правки, а не сама правка.

Expected benefit: уроки четырёх сессий переживают файл, который их держал.
Без этого шага удаление было бы потерей знания, а не уборкой.

Risks and containment: журнал растёт, и запись, которую никто не читает, —
издержка. Сдержано тем, что перенесено ТОЛЬКО непортящееся: числа, состояния
деревьев и очереди открытых задач сознательно оставлены в git-истории —
удаливший файл коммит `3693b3a` (ветка `claude/handoff-per-branch`) и его
родитель.

Validation: прямой проверки у знания нет по построению. Косвенная —
`python .agent/evals/public/run_public_evals.py` зелёный после правки.

Fresh-session status: pending — сработают ли эти классы в чужой сессии,
непроверяемо в той, которая их записывает.

Decision: keep.

## 2026-08-09 — `logic-owns-llm-layer`

Observed problem: `server/src/llm/**` — 24 файла — не входил в область НИ ОДНОЙ
роли оркестратора.

Числа строк здесь намеренно нет. Организатор намерил 3286 (`find … -exec cat
{} + | wc -l`, с тестами) и 2137 без тестов, домен `logic` своим способом —
2946 при том же числе файлов. Расхождение 10% на решение не влияет, а число,
снятое разными способами и записанное как факт, живёт в доке дольше, чем повод
его называть. Файлов 24 — совпало у обоих замеров.

Evidence: устав `logic` перечислял
`server/src/{simulation,game,services,primitives,commands}`, `shared/src/types`,
`shared/src/defines` — слоя `llm` в списке нет, при том что в том же уставе
раздел «Кому выдаёт задания» уже называет субагента `director-prompt-engineer`,
а `docs/LLM_RULES.md` числится среди каноничных документов области. То есть
покрытие подразумевалось, а список путей его не выражал.

Дыра уже стоила: сессия датированных событий (`claude/dated-events`,
2026-08-08) правила `shared/src/types/Event.ts` и `SaveFile.ts` — контрактную
область `logic` — работая над промтом хода, и оркестратора над ней не было.
Обошлось потому, что организатор вручную проверил отсутствие параллельной
правки контракта: `git diff --name-only main...<ветка> -- shared/src/types` по
семи живым веткам дал непустой результат ровно у одной. Это была удача, а не
устройство.

Root-cause hypothesis: устав писался от списка каталогов симуляции, а LLM-слой
концептуально числился «не симуляцией» — и выпал из перечисления, хотя всё
остальное в уставе его подразумевает.

Changed files/layers: `.agent/roles/logic.md` — `llm` добавлен в область якоря
и в раздел «Область» (промт хода, схемы ответа, коды отказов); в «Приёмку»
добавлен пункт 7.

Expected benefit: слой перестаёт быть ничьим; правка `shared/src/types` из
промтовой задачи попадает в ту же очередь контрактов, которую `logic` уже
ведёт.

Почему НЕ отдельная роль. По `.agent/roles/README.md` роль заводится при
«устойчиво другой области и других проверках», и промтовый домен проходит оба:
область своя, а приёмка противоположна якорю `logic` («симуляция
детерминирована») — промт доказывается статистикой на недетерминированной
модели, 72 хода × три прогона при T=0.

Не проходит третий критерий — «роль без параллельной работы — церемония».
Открытых пунктов области `llm` в `docs/TODO.md` **шесть**, проверены по
строкам 2026-08-09: `schemaInvalid` не называет поле (:119); ISO-дата в прозе
(:124); `## Instructions` — 61% промта и стоит в конце, префиксный кэш
невозможен (:312); числа последствий в нарративе (:344); хроника идёт в промт
без капа (:351); `spawn_incident` без `sourceCountryId` (:721).

Шесть — не поток: ни один не блокирует милстоун, и **половина из них — правки
движка и диагностики, а не промта**, то есть доказываются юнит-тестом и от
промт-роли не получают ничего. Граница проходит не по каталогу: в
`server/src/llm/**` живут и промт, и код, читающий-пишущий состояние.

Поток появляется на Милстоуне 6 (советник-LLM, per-роль модели) — тогда и
разделять, по обжитой области. Преждевременная роль сразу потребовала бы
контракта с `logic` по `shared/src/types` и по схемам ответа: ещё один стык
ради одного задания.

Risks and containment: противоречие внутри устава — детерминизм в якоре и
статистическая приёмка в пункте 7. Сдержано тем, что пункт 7 назван явно как
исключение и объясняет, почему пункты 1–4 промт не проверяют. Второй риск —
роль расширена, а нагрузка `logic` и так самая большая (милстоуны 1–6). Лечится
очередью внутри домена, не второй ролью: `shared/src/types` нельзя править
параллельно, и вторая роль в том же домене создала бы ровно тот конфликт.

Validation: `python .agent/evals/public/run_public_evals.py` — 240 passed, 0
failed; проверка `validate_orchestrator_roles` меряет якорь, он вырос 651 → 725
символов при пороге 900.

Fresh-session status: сессия `logic` запущена до этой правки и держит в
контексте старый якорь — решение по стыку отправлено ей сообщением в тот же
день, до влития ветки. Домен принял границу, проверив её своим прогоном
(`.agent/orchestration/logic.md`, «Граница домена», `0e24ab1`), и вернул две
фактические поправки к этой записи: число строк и состав LLM-backlog. Обе
приняты и внесены выше — исходная формулировка «backlog это один пункт» не
выдержала бы сверки с `TODO` у первого же читателя.

Decision: keep.

## 2026-08-09 — `two-measurement-fallacies`

Observed problem: за один день три разные сессии независимо пришли к неверным
выводам двумя одинаковыми способами. Оба способа выглядят как замер, но замером
не являются, и оба прошли бы любую проверку «числа названы».

**Ошибка A — разность, у которой снят только один член.**

- организатор и домен `logic` получили разное число строк в
  `server/src/llm/**` (3286 против 2946) при одинаковом числе файлов; причина —
  разный фильтр выборки, а не арифметика;
- домен `logic` записал в вердикт «база 1445/1, плюс восемь новых тестов»,
  тогда как база ветки была `ce74d66` с 1447/1, а новых тестов шесть.
  Измеренное значение 1453 верно, ошибочна разность: точка отсчёта взята по
  умолчанию, а не снята.

Правило: **разность двух чисел верна, только если сняты ОБА, а не одно снято и
одно предположено.** Диагностический признак для случая с двумя счётчиками:
расхождение на одном каталоге почти всегда означает разный фильтр — сверять
надо состав выборки, а не искать ошибку в счёте.

**Ошибка B — отсутствие текста принято за отсутствие свойства.**

Домен `logic` заявил, что схема, уходящая Gemini, несёт `exclusiveMinimum`, и
указал `server/src/llm/responseSchemas.ts`. Организатор проверил: в этом файле
нет ни `exclusiveMinimum`, ни `.positive()`, ни `.int()` — и заключил, что
адрес неверен. Неверен был вывод, а не заявка. Ограничение приезжает
композицией, каждое звено проверено чтением обоими:

```text
server/src/primitives/primitiveSchemas.ts:68   z.number().int().positive()
server/src/llm/responseSchemas.ts:2            импорт primitiveSchema
server/src/llm/responseSchemas.ts:96           primitives: z.array(primitiveSchema)
server/src/llm/providers/GeminiProvider.ts:200 z.toJSONSchema(schema)
```

`rg exclusiveMinimum responseSchemas.ts` пуст и останется пустым при ЛЮБОМ
состоянии дефекта: файл несёт конверт ответа, а ограничение живёт в примитиве,
который он импортирует. Найденные организатором `validation/schemas.ts` и
`scenario1946Schemas.ts` — ложный след: провайдеру они не уходят вовсе.

Правило: **отсутствие текста в файле доказывает отсутствие текста в файле, а не
отсутствие свойства у того, что этот файл собирает.** Свойство собранного
артефакта проверяется на собранном артефакте.

Layer changed: `.agent/EVOLUTION.md` — запись правил. Уставы ролей не трогаются:
обе ошибки не привязаны к домену, их делали и организатор, и исполнитель, и
доменный оркестратор.

Expected benefit: два самых дешёвых способа принять рассуждение за замер
названы и имеют по два независимых случая каждый.

Risks and containment: правила не исполняются автоматически — ни eval, ни хук
их не держат. Сдерживание честное и слабое: они попадают в `EVOLUTION`, который
читают при разборе повторяющихся дефектов, а не каждый ход. Заводить под них
проверку не за что: обе ошибки распознаются только по смыслу заявки.

Validation: цепочка ошибки B перепроверена организатором построчно
(`primitiveSchemas.ts:68`, `responseSchemas.ts:2` и `:96`,
`GeminiProvider.ts:200` — конвертация действительно там, домен назвал :235,
это комментарий). Числа ошибки A перепроверены обеими сторонами.
`python .agent/evals/public/run_public_evals.py` — 240 passed, 0 failed.

Fresh-session status: правила выведены в живой работе трёх параллельных
сессий, не в ретроспективе.

Decision: keep.

## 2026-08-09 — `doc-hygiene-mechanical-not-textual`

Observed problem: гниение документации — самый частый дефект дня. Пользователь:
«уже много раз о неверную документацию спотыкались», просьба — усилить правило
«где только можно».

**Главная находка — усиливать текстом больше негде и незачем.**

- Корневой `AGENTS.md` **упёрся в порог**: 16 345 нормализованных байт из
  16 384, запас **39 байт**. Порог не случайность — всегда загружаемый слой
  ограничен намеренно.
- Класс уже запрещён там прямым текстом («никогда/всегда только вместе с
  тестом») — и нарушен **пять раз за одну сессию домена `ui`**: тест
  `localeKeys.test.ts` считался защитой от русской строки в JSX, а проверяет
  обратное свойство; урок про ключевание оформления записан в док без теста;
  «один идентификатор даёт семь ошибок `tsc`» не воспроизводится; `UI_DESIGN.md`
  §10 перечисляет защиты локализации так, что список читается исчерпывающим, а
  регистрация namespace вне его — аудитор снял одну строку регистрации, и
  `tsc` с 112 тестами остались зелёными, а игрок увидел сырые идентификаторы;
  пятый случай посеял сам оркестратор своим инструктажем.

Вывод: **правило, которое проверяют глазами, этот класс не держит.** Проверяют
написанное, а не пропущенное. Рычаг — механическая проверка, а не ещё один
абзац в своде.

**Ещё два случая семьи «замер против предположения»** (продолжение
`two-measurement-fallacies` выше, правило C):

- домен `ui` переписал пункт про бюджет как ОТКРЫТЫЙ, проверив код на своей
  базе `92c1aa9`, где он и был открыт; `claude/budget-one-base` тем временем
  свела обе точки на `budgetBase.ts`, и запись попала в `main`, утверждая
  неверное;
- карта разделов `docs/TODO.md`, разосланная организатором в номерах строк,
  устарела в момент отправки: влилась чужая ветка и сняла девять строк выше.

Правило C: **проверка на своей базе не есть проверка на `main`.** Ветка живёт
дольше одного влития; факт переснимается против свежего `main` перед сдачей.

Changed files/layers: `.agent/evals/public/run_public_evals.py`, `validate_rot()`
— добавлена проверка «ссылка `файл:строка` не выходит за конец файла».
Проверяется только выход за конец, а не «та ли там строка»: второе без
исполнения не установить, первое — грубая, но честная граница.

Evidence под неё, четыре случая одного дня: карта разделов разошлась на девять
строк; вердикт домена называл `GeminiProvider.ts:235`, где конвертация на 200
(**оба числа верны — в разных деревьях**); `diagnose_seas_iho.py:216-219`
описывал ловушку, и ловушка сработала; `ASI-0001`/`ASI-0002` в вопросе про
Ганьсу не существуют после перенумерации.

Expected benefit: самый частый вид гниения — устаревший адрес — перестаёт
жить месяцами. Устойчивый адрес (заголовок раздела, имя символа) остаётся
предпочтительным; номер строки — расходник, и теперь это красный тест, а не
пожелание.

Risks and containment: проверка не ловит «строка сместилась, но файл длиннее» —
это принято сознательно. Ложных срабатываний на живых доках нет: 241 passed.

Validation: негативный контроль показан — вставленная в `docs/IDEAS.md` ссылка
`responseSchemas.ts:99999` даёт `FAIL: docs line references stay inside their
file … (в файле 99)`, после отката 241 passed, 0 failed.

**Что НЕ сделано и почему — вторая проверка отложена честно.** Написана и
прогнана проверка «план не ссылается на ветку»: ветка живёт до влития, план,
переживший её, гниёт по построению. Первая редакция ловила и `docs/DECISIONS.md`
и дала **32 срабатывания на законном содержимом** (там имя ветки — провенанс
решения, а не навигация) — признак, что проверялось не то свойство. После
сужения до планов и профильных документов осталось **11 настоящих находок в
пяти файлах**: `11_MVP_ROADMAP.md` шлёт за морским графом в удалённую ветку,
`12_UI_REDESIGN.md` объявляет весь UI-трек замороженным (третья линия влита),
`docs/design/interface-from-scratch/README.md` называет рабочей ветку, списанную
пользователем 2026-08-09.

Проверка не внесена, потому что **гейт, который репозиторий не проходит, нельзя
сдавать**, а чинить 11 ссылок значит переписывать утверждения чужих доменов —
«UI-трек заморожен» это заявление домена `ui`, не организатора. Находки
переданы доменам; проверка включается после уборки.

Fresh-session status: правила выведены в живой работе четырёх параллельных
сессий за один день.

Decision: keep.

## 2026-08-09 — `instrument-and-content-checks`

Продолжение `two-measurement-fallacies` и `doc-hygiene-mechanical-not-textual`
того же дня. Два подслучая, каждый пойман в живой работе, каждый — на
организаторе.

**Правило D — исправность прибора есть часть замера, а не предпосылка.**

Домен `logic` установил, что локальный посредник врал про расход токенов: на
`v7.2.50` три запроса давали `promptTokenCount` 10 544 / 7 588 / 11 731, и
расхождения равнялись токенам размышления, не выделенным отдельной статьёй;
после `v7.2.125` — 7 588 во всех трёх. Записи `logs/token-usage.jsonl` до
2026-08-09 завышены на части вызовов.

Отличие от правила A: там одно число снято, второе предположено. Здесь **оба
сняты**, и прибор врал обоим.

**Признак дороже формулировки.** «А вдруг прибор врёт» можно сказать про любой
замер и никогда не проверить — правило без теста мертво (возражение домена
`logic`, принято). Дешёвый тест: **повторяемость входа — три побайтово
одинаковых запроса обязаны дать три одинаковых числа.** Квоты не требует,
занимает минуту, ловит ровно этот класс.

Радиус проверен организатором по живым докам и роадмапу: пострадало **одно**
влитое число — `docs/DECISIONS.md`, замер датированных событий «промт +3,0%
(9 501,5 → 9 787,5 токена)». Критерий приёмки v1 «PROMPT < ~20k токенов» не
задет: он нёс честную пометку «бюджеты на длинной кампании не замерены», то
есть на испорченных числах не стояло ничего. Перемерять единственное
пострадавшее число не будем: это разность двух конфигураций, снятых ОДНИМ
прибором, и систематическая ошибка в разности сокращается — помечаем как снятое
сломанным прибором.

**Правило E — деление ветки проверяется по СОДЕРЖИМОМУ коммитов, а не по их
составу файлов.**

Организатор предложил разделить ветку `claude/prompt-prefix-cache` на
безопасный префикс и рискованный хвост: `git show --stat` показал, что первые
два коммита не трогают `LLMService.ts`, значит перестановки секций в них нет и
замер поведения к ним не применим. Довод верен и принят доменом.

Но влить этот префикс было нельзя: в коде обоих коммитов стоят ссылки на
`docs/LLM_RULES.md` за фактами о префиксном кэше, а раздел «Префиксный кэш»
появляется только в третьем коммите. Влитие воссоздало бы в `main` **ровно тот
дефект, за который ветка была возвращена в первый раз** — код утверждает
существование раздела, которого нет.

Организатор проверил СТРУКТУРУ (какие файлы затронуты) и принял её за проверку
СОДЕРЖАНИЯ (что этот код утверждает). Тот же корень, что у правила B, с другой
стороны: там отсутствие текста в файле принималось за отсутствие свойства,
здесь присутствие файла — за присутствие раздела.

Следствие для процесса, а не только для формулировки: **делит ветку автор, а не
интегратор.** Интегратор не знает, какой абзац документации к какому коммиту
относится, и нарезка по границам коммитов ему не поручается.

Механической проверки под этот случай НЕ заводится, и это названо намеренно:
ссылки в коде называют файл, а не раздел, файл существует — проверка
существования пути не сработала бы. Поймало чтение содержимого. Предлагать под
это eval значило бы завести проверку, которая на исходном дефекте молчит.

Validation: `python .agent/evals/public/run_public_evals.py` — 241 passed,
0 failed.

Decision: keep.

## 2026-08-09 — `premise-is-a-claim` и `prune-guards-data-not-intent`

Два подслучая того же дня, оба — на организаторе, оба названы доменами.

**Правило F — премиса задания есть ЗАЯВКА, и исполнитель обязан проверить её
прежде, чем выполнять.**

Два независимых случая:

- организатор выдал T-8 домену `geometry` с премисой «площади унаследованы из
  источников, пересчёта в пайплайне нет». Домен померил: `area_km2` пишут сами
  билдеры геодезически (`GEOD.geometry_area_perimeter`), свойство есть у 1591
  фичи из 1591, фолбэк `0` не срабатывает ни разу. Задание переписано из
  пересчёта в гейт;
- в домене `logic` исполнитель T-6 проверил ПИСАТЕЛЯ поля, а не только
  читателя: путь поля лежал в причине с `76bf6c0`, тогда как находка смотрела
  на квитанцию.

Оба раза проверка премисы **сэкономила работу, а не сорвала её**. Ошибка
организатора в первом случае названа точно: проследил читателя
(`import_to_game.py:295` берёт свойство) и не проверил писателя — часть цепочки
принята за целое, тот же корень, что у правил B и E.

Следствие для формата задания: премиса пишется как проверяемое утверждение с
названным способом проверки, а не как преамбула. Исполнитель, нашедший её
неверной, не выполняет задание и возвращает — это не срыв, а результат.

**Наблюдение `prune-guards-data-not-intent`.**

Однострочный проход зачистки деревьев (`worktree-drop.ps1` по всем деревьям)
за один день снёс ДВА дерева живых задач: `geometry-orchestrator` (сессия
работала, ветка была влита, дерево чисто) и `todo-verdicts-logic` (задание T-4
выдано, коммитов ещё не было).

Защиты скрипта отрабатывают верно — они охраняют НЕЗАКОММИЧЕННОЕ и НЕВЛИТОЕ.
Ни в одном из двух случаев данные не потерялись. Но дерево живой задачи без
коммитов и дерево отработавшей задачи для скрипта неразличимы: он проверяет
состояние файлов, а не наличие намерения.

Durable-правка НЕ вносится сейчас, названа как требование к будущей обёртке
`scripts/worktree-prune.ps1`: пропускать дерево, чьё имя названо в открытом
задании реестра (`Статус: выдано` в `.agent/orchestration/*.md`), либо принимать
явный список исключений. Организатор своими руками этого не сделает —
`scripts/**` вне области роли.

Validation: `python .agent/evals/public/run_public_evals.py` — 241 passed,
0 failed.

Decision: keep.
## 2026-08-09 — `check-history-before-judging-backlog`

**Дата / change id:** 2026-08-09 / `check-history-before-judging-backlog`

**Problem evidence.** Пункт живого backlog переживает собственную починку, и
никакой замер этого не показывает — потому что замер отвечает на другой
вопрос. Три случая за одну сессию домена `geometry`:

1. «Мина полного прогона `make_1946.py`» числилась открытой в `docs/TODO.md`;
   закрыта коммитом `19cf364`. Взявший бы её в работу чинил бы починенное —
   это было названо прямо в стартовом промте сессии как уже случившееся.
2. «Узкие полосы соседних регионов вдоль зоны Панамского канала»
   (`docs/TODO.md`) закрыты коммитом `6a4bfd5` 2026-07-29 18:26: геометрия
   зоны заменена уточнённой из внешнего эталона, «Los Santos/Panama честно
   переклипаны» — именно те соседи из жалобы, — «рендер зоны канала
   подтверждён визуально». Запись внесена в `TODO` СЛЕДУЮЩИМ днём коммитом
   `498c710`, причём из раздела **«Out of scope»** плана
   `.agent/plans/region-fragments-audit.md`: граница чужой задачи стала
   задачей, потеряв адресата и признак закрытия. Нашёл это пользователь
   («эту проблему уже решали, ищи в коммитах»), а не проверка.
3. Оркестратор домена дважды судил об этом пункте, оба раза мимо: сначала
   снял по собственному морфологическому замеру, затем по поправке роли
   `lead` вернул с условием «ждёт рендера». Условие было выполнено за
   одиннадцать дней до того, как он его выписал. Ни разу не был задан вопрос
   «а не чинили ли это уже».

Общее у всех трёх: замер устанавливает «есть ли дефект СЕЙЧАС», история
устанавливает «не закрыт ли он УЖЕ». Первое не заменяет второго, а второе
дешевле: один `git log`.

**Layer changed.** Метод триажа в `.agent/orchestration/README.md` — самый
узкий слой, где это применимо: судьбу пункта backlog решает держатель
реестра, и правило нужно ровно ему. `AGENTS.md` не трогается: там правило
стало бы шестым «не забудь» в общем слое, который и так читают выборочно.

**Правило.** Прежде чем объявить пункт backlog открытым, закрытым или
переклассифицированным, найди его происхождение и его починку в истории:

```text
git log --all --oneline -S'<характерная фраза пункта>' -- docs/TODO.md
git log --all --oneline -i --grep='<тема>'
```

Первая команда даёт коммит, ВНЁСШИЙ запись, — по нему видно, была ли это
задача или чужая «out of scope» граница. Вторая даёт коммиты по теме, среди
которых и находится починка. Замером это не заменяется.

**Expected benefit.** Снимается класс «чиню починенное». Цена — две команды
на пункт, секунды; для раздела на 30 пунктов — один проход.

**Risks and containment.** Поиск по фразе не найдёт пункт, переформулированный
при переносе, — тогда работает вторая команда по теме. Риск обратный (счесть
закрытым по коммиту, который чинил соседнее) удерживается требованием, уже
записанным ролью `lead`: закрытие механически проверяемого подтверждается
прогоном, а не чтением сообщения коммита. То есть история подсказывает, где
искать, а закрывает — прогон.

**Validation.** Правило выведено из трёх случаев одной сессии, два из которых
подтверждены коммитами (`19cf364`, `6a4bfd5`) и один — правкой реестра
задним числом. Проверка на следующем триаже: держатель раздела обязан
показать в вердикте команду поиска и её вывод по каждому снятому пункту.

**Fresh-session status:** правило записано в `.agent/orchestration/README.md`,
свежей сессией не проверялось.

**Decision:** keep

## 2026-08-09 — `proxy-instead-of-property`

Правило G, и у него три независимых случая за один день — больше, чем у любого
другого правила этого журнала.

**Дефект:** мерится ПРОКСИ, доступный дёшево, а утверждение делается о
СВОЙСТВЕ, которое нужно на самом деле. Прокси и свойство совпадают на типичных
входах и расходятся ровно там, где сидит дефект.

- **Организатор ввёл правило «ветка с отставанием больше сотни коммитов либо
  обновляет базу, либо возвращается заданием».** Домен `ui` перемерил:
  `claude/ui-orchestrator` — 100 позади, 1 впереди, расхождение по ЧЕТЫРЁМ
  файлам, `git merge-tree` даёт ровно ОДИН конфликт, и тот по жизненному циклу
  служебного файла (пакет передачи удалён в `main` интегратором по регламенту,
  изменён в ветке после). Ветка вливается в одно движение. Отставание —
  прокси, сливаемость — свойство.
- **Домен `geometry`, метрика лестницы на линиях раздела морских зон.** Первая
  метрика — доля сегментов, параллельных осям — объявила 163 зоны из 182
  чистыми и была неверна: ступеньки нарезаны в проекции и перепроецированы в
  градусы, поэтому наклонены (`dx=0,047090 / dy=0,017054`, повтор 40 раз, ни
  один не ноль). Рабочая метрика — доля поворотов 90°±20°. Ловушка при этом
  БЫЛА описана в `diagnose_seas_iho.py` и всё равно сработала.
- **Тот же домен, порог живого документа.** `(Get-Content | Measure-Object
  -Line).Lines` дал 1286 при настоящих 1393: счётчик пропускает пустые строки,
  а public eval считает `text.count("\n") + 1`. Три прогона одного неверного
  метода дали одно неверное число трижды.

**Правило G: прокси доказывает утверждение о прокси.** Прежде чем мерить
дешёвым способом — назвать свойство, о котором будет сделано утверждение, и
показать, где прокси с ним расходится. Не удаётся показать — прокси не
проверен, а выбран.

Исправление введённого организатором правила: **мерить `git merge-tree`, а не
счётчик коммитов.** Отставание остаётся сигналом «посмотреть», а не основанием
возвращать ветку.

**Поправка к отложенной проверке «план не ссылается на ветку».** Домен `ui`
показал: `codex/interface-from-scratch` удалена, а `codex/1946-country-borders`
**жива** — есть локально и на `origin`. Написанная проверка ловит ЛЮБУЮ ссылку
на ветку в плане и потому берёт оба случая; но «улучшение» её до проверки
СУЩЕСТВОВАНИЯ ветки сделало бы её слабее — она пропустила бы именно гнилой
случай, где ветка на месте, а сказанное про неё неправда. Записано, чтобы
следующий не починил проверку в эту сторону.

Уборка со стороны `ui` сделана (`cf0f024`): `docs/plans/12_UI_REDESIGN.md`
помечен SUPERSEDED, `docs/design/interface-from-scratch/README.md` — историей.
Осталась геометрическая доля, после неё проверку можно вносить.

**Побочная находка домена `ui`, требует владельца:** `.agent/plans/1946-country-borders.md`
стоит `blocked` со ссылкой на заморозку UI-трека, которой больше нет —
основание блокировки исчезло вместе с событиями, а не решением.

Validation: `python .agent/evals/public/run_public_evals.py` — 241 passed,
0 failed.

Decision: keep.
