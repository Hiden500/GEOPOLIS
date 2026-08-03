# Перевод остатка канала `actions` на алфавит примитивов

Status: complete
Owner: claude (сессия «actions → primitives»)
Starting commit: eb03e03 (main, `Merge branch 'claude/rule-a-recovery'`)
Worktree: `D:\Pax Historia LOCAL\.claude\worktrees\actions-to-primitives`, ветка
`claude/actions-to-primitives`
Dirty state на старте: чисто (в главном checkout висит неотслеживаемый
`.playwright-mcp/` — чужой, не трогается).

## Objective and observable outcome

Перевести ВЕСЬ остаток старого канала `actions` на `PrimitiveEngine`, после чего
канал перестаёт существовать как путь мутации состояния.

Наблюдаемые результаты:

1. Годовой прогон `runCampaignWithLLM` не содержит ни одного отказа-английской
   строки для переносимых воздействий: каждый отказ приходит кодом
   `PrimitiveRejection` и рендерится игроку по-русски.
2. Ни одна мутация состояния из ответа модели не идёт мимо
   `applyPrimitiveBatch`: `applyLlmActions` и `LLMResponseValidator` удалены
   вместе со своими типами.
3. `CommandResult` больше нигде не игнорируется на пути ответа модели: команда,
   вернувшая `success: false`, откатывает свой примитив, а не попадает в
   применённое.
4. Мёртвая scaffolding-механика `pendingLlmActions` / `savePendingActions` /
   `getPendingActions` / `clearPendingActions` удалена.
5. Три пункта `docs/TODO.md` закрыты и удалены; в `docs/DECISIONS.md` —
   датированная запись.

## Scope and constraints

### Что меняю

- `server/src/primitives/` — четыре новых глагола: схемы, предпосылки, коридоры,
  палитра, сверка, капы целей, отклик, показ распознанного, коды отказа.
- `server/src/llm/` — контракт примитивов в промте; удаление `actionSchemas.ts`
  (union действий) и `LLMResponseValidator.ts`; конверт ответа и схема
  провайдера переезжают в отдельный модуль.
- `server/src/services/LLMService.ts` — удаление `applyLlmActions` и четырёх
  `apply*Action`, ветки старого канала в `processResponse`, секции промта про
  `actions`, квартета `pendingLlmActions`.
- `shared/src/types/GameState.ts` — удаление `LLMAction` и `pendingLlmActions`;
  `shared/src/defines/llmActionCaps.ts` — капы переезжают в коридоры движка.
- `client/src/components/LLMPanel.tsx` + `client/src/i18n/locales/*` — секция
  отказов старого канала уходит; словари `primitiveRejection`/`primitiveOutcome`/
  `primitiveOrders` пополняются новыми кодами и глаголами.
- `server/src/game/SaveService.ts` и тесты, ссылающиеся на удаляемое.
- `docs/TODO.md`, `docs/DECISIONS.md`, профильные `docs/PRIMITIVES.md`,
  `docs/ARCHITECTURE.md` (раздел команд), `docs/LLM_RULES.md` — по факту правки.

### Чего НЕ трогаю (зафиксировано до реализации)

- `server/src/simulation/ai/AiBehaviorTick.ts` — прямых вызовов переносимых
  действий в нём нет (проверено `rg`), поведение ИИ не меняется.
- `scripts/map/` и данные сценария 1946.
- Промт режиссёра как художественный текст (`director-prompt-engineer` —
  чужая ветка `claude/director-prompt`); правлю только машинную часть контракта
  примитивов.
- Продуктовые развилки, названные в `TODO`/`IDEAS` и всплывающие по пути:
  гейт сырья, потолок `MAX_EXTRACTION_LEVEL` на живых данных, casus belli,
  три репутационные санкции, «влияние без денег».
- Механика гарантии как таковая: переносится ровно с теми правилами и
  величинами, что были (прецедент сессии дипломатии — «перевод не должен
  оказаться ещё и тихой рекалибровкой»).

### Пересечение с параллельными задачами

Живые деревья на момент старта: `director-prompt`, `interface-rebuild`,
`map-coastline-fixes`, `sea-shelf-zones`, `codex/interface-from-scratch`.

- `director-prompt` — общий файл `server/src/llm/primitiveContract.ts` и
  `LLMService.generatePrompt`. Риск реальный. Моя правка контракта —
  СТРУКТУРНАЯ (добавление четырёх глаголов, удаление секции `actions`), их —
  риторическая. Конфликт разрешается вручную при интеграции; в ExecPlan
  фиксирую, что я не переписываю формулировки существующих глаголов.
- `interface-rebuild` / `interface-from-scratch` — `client/src/components/
  LLMPanel.tsx`. Я удаляю оттуда ровно один блок (отказы старого канала) и
  добавляю ключи словарей. Если панель переписана целиком в их ветке, мой
  блок исчезнет вместе с ней — потери нет.
- Карта — не пересекаюсь.
- `shared/src/types/GameState.ts` правлю (удаление `LLMAction`) — по правилу
  «не редактировать параллельно в нескольких ветках» проверить перед merge, что
  никто другой его не тронул.

## Assumptions and unknowns

- **UNKNOWN-1 — `influence`.** Задача называет пять действий, но `influence`
  УДАЛЁН из канала 2026-07-29 (`actionSchemas.ts` строки 58-69,
  `llmActionCaps.ts` строки 13-20, `docs/TODO.md` «Хвосты сессии „Мягкие
  глаголы алфавита“»). Переносить нечего. Строка `TODO.md:335`, перечисляющая
  пять действий, устарела. Развилка ждёт решения пользователя — см. «Decision
  log», D0.
- **UNKNOWN-2 — формат сейва.** `receipt.actions` живёт в `eventHistory`, то
  есть в сохранённой партии. Удаление поля может потребовать `SAVE_VERSION`.
  Разрешается чтением `SaveService`/runtime-проверки сейва на шаге 6.
- **Допущение.** Корректность коридоров research/production проверяется
  фикстурами и прогоном; калибровка баланса в scope не входит — доли и потолки
  переносятся из `llmActionCaps.ts` без изменения значений.

## Alternatives and selected decision

### A. Что делать со старым каналом после переноса

1. **Удалить целиком** (выбрано). После переноса в союзе не остаётся ни одного
   типа: `LLMActionSchema` становится пустым union'ом, который не компилируется,
   а `LLMResponseValidator` — классом без единой ветки. Оба TODO-пункта
   (английские причины, игнор `CommandResult`) закрываются исчезновением
   носителя, а не его починкой.
2. Оставить пустую оболочку канала — отвергнуто: мёртвый слой, который следующая
   сессия примет за место для нового действия в обход алфавита.

Поле `actions` в конверте ответа остаётся принимаемым, но НЕ применяемым:
непустой массив даёт диагностический факт с новым кодом `legacyActionsChannel`.
Причина: схема провайдера канал больше не предлагает, но локальные модели
импровизируют, и молча съеденный массив — это ровно тот класс «модель считает
применённым то, чего не было», ради которого задача и затевалась.

### B. Величины у research/production

Старый контракт принимал от модели `share: number` — прямое нарушение правила
«модель решает что, движок решает насколько». Сохранить его в примитиве нельзя.
Прецедент — `diplomacy`, у которого сессия дипломатии сняла `relationChange`.

Выбрано: модель называет ДОМЕН/КАТЕГОРИЮ и НАПРАВЛЕНИЕ, движок считает шаг
коридором от состояния: `step = (cap − current) × позиция интенсивности`, где
`cap` — тот же `MAX_RESEARCH_SHARE` за вычетом штрафа за активные войны
(`WAR_RESEARCH_SHARE_PENALTY`, пол `MIN_RESEARCH_SHARE_CAP`) и
`MAX_PRODUCTION_SHARE` соответственно. Цена названа: резкий разворот фокуса
одним ходом остаётся возможен (`intensity: "severe"` доходит почти до потолка),
но точное число модель больше не задаёт.

Отвергнуто: оставить `share` качественным перечислением («low/medium/high» с
фиксированными долями). Это то же число, только записанное словом, — величина
всё равно приходила бы от модели, а не из состояния.

### C. Слот капа у `guarantee`

`setGuarantee` не только пишет в список гарантий, но и двигает отношения на +15
(`DiplomacyService.addGuarantee:204`). Значит глагол пишет в ТУ ЖЕ ячейку
`relations`, что `diplomacy` и `sanction`, и обязан войти в
`SOFT_BILATERAL_VERBS` — иначе коридор дипломатии обходится сменой глагола, тем
самым способом, ради которого общий слот пары и заведён.

## Progress

- [x] 1. **Коды отказа.** Новые ветки `PrimitiveRejection` + английский рендер +
      запись игрока + ru/en `primitiveRejection.json`:
      `guaranteeAlreadyGiven`, `focusNotDomestic`, `unknownResearchDomain`,
      `unknownEquipmentType`, `noDepositInRegion`, `extractionAtMaximum`,
      `noExtractionToDismantle`, `extractionUnaffordable`,
      `legacyActionsChannel`. Observable: `tsc` требует ветку у каждого нового
      кода в обоих рендерах.
- [x] 2. **Алфавит и схемы.** `PRIMITIVE_VERBS` + `SOFT_BILATERAL_VERBS`
      (`guarantee`) + четыре ветки `PRIMITIVE_SCHEMAS`. Observable: тест «реестр
      схем покрывает весь алфавит» зелёный, схема провайдера содержит новые
      глаголы.
- [x] 3. **Типы результата.** `AppliedGuarantee`, `AppliedResearchShift`,
      `AppliedProductionShift`, `AppliedBuildExtraction` + `AllocationEffect` /
      `ExtractionEffect` + ветки `impactEffectsOf`. Observable: `tsc`.
- [x] 4. **Движок.** `validate` (перенос ВСЕХ правил из
      `LLMResponseValidator` + предпосылки команд), `apply` (обязательная
      проверка `CommandResult`), `targetsOf`, палитра, `reportedCells` +
      новые ячейки `research:`/`production:`/`extraction:` в `enumerateCells`.
      Observable: тест «палитра и сверка описывают одни и те же каналы» зелёный
      без расширения списка исключений.
- [x] 5. **Отклик и промт.** `buildPrimitiveOutcome`, `buildPrimitivePreview`,
      ru/en `primitiveOutcome.json`/`primitiveOrders.json`,
      `PRIMITIVE_CONTRACT`. Observable: панель цикла показывает фактические
      величины по новым глаголам.
- [x] 6. **Снос старого канала.** `actionSchemas.ts`, `LLMResponseValidator.ts`,
      `applyLlmActions` + четыре `apply*Action`, `LLMAction`,
      `llmActionCaps.ts`, `pendingLlmActions`-квартет, секции промта, блок
      панели, `receipt.actions` (после разрешения UNKNOWN-2). Observable:
      `rg "applyLlmActions|LLMAction|pendingLlmActions"` даёт ноль в `server/`,
      `client/`, `shared/`.
- [x] 7. **Тесты.** По негативному контролю на КАЖДЫЙ перенесённый
      предохранитель (список в «Validation»); переписать тесты
      `milestone1Contracts`, чей носитель «старого канала» исчез.
- [x] 8. **Приёмка.** `runCampaignWithLLM` на год; server tsc + npm test;
      client tsc + test + lint; public eval.
- [x] 9. **Документация.** `TODO` (удалить закрытое), `DECISIONS` (запись),
      `PRIMITIVES.md`, `ARCHITECTURE.md`, `IDEAS.md` (что вынесено за scope).

## Discoveries

- `influence` уже не существует в канале — см. UNKNOWN-1.
- `AiBehaviorTick` переносимых действий не вызывает: старый канал используется
  ТОЛЬКО `LLMService`. Значит перенос не задевает поведение ИИ вовсе.
- `addGuarantee` двигает отношения (+15) — см. решение C.
- `buildExtraction` на данных 1946 отклоняется ВСЕГДА: все 2055 пар (регион,
  ресурс) с депозитом стоят на `MAX_EXTRACTION_LEVEL` (`docs/TODO.md`,
  `probeResourceGates.ts`). После переноса это станет видно кодом
  `extractionAtMaximum` вместо английской строки — но живым действие не станет,
  и приёмочный прогон это покажет. Развилка данных остаётся вне scope.
- `milestone1Contracts.test.ts` использует `guarantee` как ЕДИНСТВЕННЫЙ
  наблюдаемый след старого канала (`legacyTraceOf`, `legacyAction`). Пять
  тестов транзакции и idempotency держатся на нём. После сноса канала они
  обязаны быть переписаны на примитив-носитель, а не удалены: проверяемые
  свойства (общая транзакция, ключ идемпотентности на весь ответ) остаются.

## Decision log

- **D0 — `influence`: РЕШЕНО пользователем 2026-08-02, вариант (а).** Пункт
  признан закрытым сессией мягких глаголов (2026-07-29); устаревшая строка
  `TODO.md:335`, перечисляющая пять действий, приводится к факту. «Влияние без
  денег» остаётся названной ценой в `TODO` и вернётся отдельным глаголом, когда
  найдётся предпосылка, отличная от «есть казна». Вариант (б) — новый глагол
  здесь же — отклонён как новая механика поверх миграции.
- **D1** — старый канал сносится целиком (альтернатива A).
- **D2** — величины research/production считает коридор движка (альтернатива B).
- **D3** — `guarantee` входит в `SOFT_BILATERAL_VERBS` (альтернатива C).
- **D4** — имена глаголов сохраняются (`guarantee`, `research_shift`,
  `production_shift`, `build_extraction`): переименование ради стиля стоило бы
  правок промта и документов без выигрыша.

## Validation

Негативный контроль обязателен на каждый перенесённый предохранитель: тест
обязан ПАДАТЬ на восстановленном старом поведении, и это показывается в отчёте.

| Предохранитель | Откуда перенесён | Негативный контроль |
|---|---|---|
| гарантия уже выдана | `LLMResponseValidator:125` | снять проверку → примитив применяется дважды |
| цель ≠ источник | `actionSchemas.ts::noSelfTarget` | самогарантия проходит |
| домен принадлежит стране | `LLMResponseValidator:62` | чужой домен создаёт запись в `researchAllocation` |
| потолок доли с поправкой на войну | `LLMResponseValidator:66` | воюющая страна получает мирный потолок |
| категория техники существует | `LLMResponseValidator:76` | выдуманная категория создаёт запись |
| контроль над регионом | `LLMResponseValidator:91` | добыча растёт на чужой земле |
| депозит существует | `LLMResponseValidator:94` | добыча из пустого региона |
| потолок мощностей | `LLMResponseValidator:101` | ложный успех на максимуме |
| казны хватает | `commands/resources.ts:66` | казна уходит в минус |
| `CommandResult` проверяется | новое | команда с `success:false` попадает в применённое |

Команды (cwd — дерево задачи):

```text
server: npx tsc --noEmit -p tsconfig.json
server: npm test
client: npx tsc --noEmit -p tsconfig.app.json
client: npm test
client: npm run lint
root:   python .agent/evals/public/run_public_evals.py
server: npx tsx scripts/runCampaignWithLLM.ts   (годовой прогон, приёмка)
```

Baseline снимается ДО первой правки: без него регрессия неотличима от
предсуществующего failure.

## Rollback / containment

Работа изолирована в дереве `.claude/worktrees/actions-to-primitives` на ветке
`claude/actions-to-primitives`. Обратимые единицы:

- любой шаг — `git -C <дерево> restore <файл>` до коммита шага;
- шаг целиком — `git -C <дерево> revert <sha>` (коммиты пошаговые, по разделам
  «Progress»);
- задача целиком — дерево снимается `./scripts/worktree-drop.ps1
  actions-to-primitives` (он откажет на невлитом и незакоммиченном).

Главный checkout не редактируется; чужие ветки не мержатся и не ребейзятся.
Точка невозврата одна — шаг 6 (снос канала): до него мир работает обоими
каналами, после него откат означает revert коммита шага, а не ручную
реконструкцию.

## Final outcome

**Изменено.** Четыре воздействия — `guarantee`, `research_shift`,
`production_shift`, `build_extraction` — стали глаголами алфавита; старый канал
`actions` удалён целиком (`actionSchemas.ts`, `LLMResponseValidator.ts`,
`applyLlmActions` + четыре `apply*Action`, тип `LLMAction`, `llmActionCaps.ts`,
`receipt.actions`, мёртвый квартет `pendingLlmActions`). Конверт ответа и схема
провайдера переехали в `server/src/llm/responseSchemas.ts`, `SAVE_VERSION` 12→13.
50 файлов, +2158/−1997.

**Доказательства.**
- server: `tsc` чист, `npm test` — 90 файлов / 1382 теста (baseline был 91/1410;
  разница — два удалённых тест-файла мёртвого канала и переписанные блоки);
- client: `tsc` чист, 143 теста; `lint` — 20 ошибок, ВСЕ предсуществующие
  (`TopologyBuilder.ts`, `GeometryEngine.ts`, `MapView.tsx`,
  `PlayerIntentPanel.tsx`), снято в baseline до первой правки;
- public eval: 163 passed, 0 failed;
- **негативный контроль: 12/12** — каждый перенесённый предохранитель снимался
  по одному, и тест обязан был упасть. Первый прогон дал 11/12: «результат
  команды проверяется» тестами покрыт НЕ был (предпосылки движка дублируют
  проверки команды, поэтому в живой партии она не отказывает). Пробел закрыт
  тестом с подставленным отказом команды, повторный прогон — 12/12;
- замер на живом сценарии 1946
  (`.agent/runs/actions-to-primitives-2026-08-02/probe-migrated-verbs.txt`):
  `guarantee` 40/40 применено, `research_shift` 40/40 применено и 40/40
  отклонено кодом `unknownResearchDomain` на выдуманном домене,
  `production_shift` 40/40, стройка 0/40 (`extractionAtMaximum` у всех — все
  2055 пар с депозитом стоят на потолке), снос 40/40.

**Baseline failures (не мои).** 20 ошибок client lint в четырёх файлах карты и
панели намерения — были до задачи, не трогались.

**Прогон с живой моделью выполнен** (после того как пользователь дал
`scripts/llm-run.ps1`, поднимающий env и прокси из любого дерева): 2 года,
24 хода, `gemini-3.6-flash-high`, 3.3 мин. 63 примитива применены, 19
отклонены, **ни одной квитанции с полем `actions`**. Приёмочное свидетельство —
`.agent/runs/actions-to-primitives-2026-08-02/campaign-2y-*.txt`.

**Что прогон вскрыл (НЕ регрессия миграции).** 18 из 19 отказов — код
`schemaInvalid`, и все они ОДНА ошибка модели: `target` прислан строкой вместо
объекта. Бьёт по глаголам, которых перенос не касался (`diplomacy` 12,
`enact_reform` 4), то есть это дефект per-verb контракта цели от 2026-07-27.
Установлено прямым замером сырых ответов (`scripts/probeSchemaFailures.ts`,
24 хода в двух прогонах, 8 пойманных отказов — все одной формы), а не
рассуждением. Вынесено в `TODO.md` с числами; чинить здесь не стал — это
область промта/контракта, а не миграции.

**Ограничение свидетельства.** Из четырёх переехавших глаголов модель за 24
хода предложила только `production_shift` (дважды); `guarantee`,
`research_shift`, `build_extraction` не предлагались ни разу. То, что МИР их
пускает и правильно отклоняет, измерено отдельно (пробник на сценарии 1946 +
26 тестов); то, что МОДЕЛЬ их выбирает, этим прогоном не подтверждено.

**Названные последствия.**
- Режиссёр больше не применяет эти четыре глагола ЗА СТРАНУ ИГРОКА (все
  классифицированы `playerDecision`). Через старый канал это проходило без
  проверки агентности. Игроку способности доступны его каналом приказов.
- Сдвиг фокуса стал коридором: модель называет домен и направление, число
  считает движок. Предельная доля по-прежнему достижима одним ходом
  (`severe` по пустому направлению).
- `build_extraction` на поставляемых данных по-прежнему мёртв — теперь это
  видно кодом отказа, а не английской строкой. Развилка данных остаётся
  открытой (`docs/IDEAS.md` §12).
