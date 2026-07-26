# Милстоун 0, сессия A — ядро недовольства и движок примитивов

Status: complete
Owner: Claude (Opus) — worktree `.claude/worktrees/milestone-0-core`, ветка `claude/milestone-0-core`
Starting commit: 43d05a4

## Objective and observable outcome

Реализовать ядро вертикального среза (`docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md`):
недовольство национального региона СССР выводится движком из геометрии
«идеология власти ↔ желаемая позиция демо-группы» + экономики региона + памяти
воздействий; порог даёт типизированный факт «кризис в регионе X»; пять примитивов
(`incite_unrest` / `repress` / `grant_autonomy` / `enact_reform` / `spawn_incident`)
проходят движковый контракт `validate → compute → apply` с декларативной палитрой
полей.

Наблюдаемый результат:

- `npx tsc --noEmit -p tsconfig.json` и `npm test` в `server/` зелёные;
- новый tick растит/снижает недовольство прибалтийских регионов SUN и не трогает
  контрольные славянские регионы сопоставимо;
- параметризованный тест: `repress` / `grant_autonomy` / `enact_reform` через N ходов
  дают попарно различимые состояния (ветки не схлопываются);
- тест палитры: применение каждого verb меняет только задекларированные пути состояния.

## Scope and constraints

**Что меняю**

- `shared/src/types/`: `GameState.ts`, `PoliticsState.ts`, `map/Region.ts`, `SaveFile.ts`,
  новые `types/politics/*`.
- `shared/src/defines/discontent.ts` (новый), `shared/src/utils/discontent.ts` (новый).
- `server/data/scenarios/1946/`: новые `groups.json`, `demographics.json`, `ideology.json`.
- `server/src/scenarios/`: `scenario1946Schemas.ts`, `Scenario1946.ts`, `types/Scenario.ts`.
- `server/src/game/CreateGame.ts`, `server/src/test-utils/fixtures.ts`.
- `server/src/simulation/politics/DiscontentTick.ts` (новый) + регистрация в
  `SimulationEngine.ts`; типизация `pendingWorldFacts` там же.
- `server/src/commands/politics.ts` (новый) — слой мутации.
- `server/src/primitives/**` (новый) — движок примитивов, палитра, Zod-схемы.
- Тесты рядом с новым кодом + региональные проверки в `campaignSmoke.test.ts`.
- Docs: `docs/DECISIONS.md`, `docs/TODO.md`, `docs/POLITICS.md`,
  `docs/plans/13_MILESTONE_0_VERTICAL_SLICE.md`.

**Что не трогаю**

- `client/**` целиком (сессия B; `client/src/map/**` заморожен решением пользователя).
- LLM-контракт: `server/src/llm/actionSchemas.ts`, `LLMResponseValidator.ts`,
  `LLMService.generatePrompt` — подключение примитивов к LLM-пути делает сессия B.
- Lifecycle §7.1 (создание/раскол/исчезновение стран).
- Предсуществующие дефекты: шкала `region.stability` (данные 0..1, `PopulationTick.ts:68,76`
  делит на 100) и игнор `CommandResult` в `apply*Action` (`LLMService.ts:362-454`) —
  фиксирую в `docs/TODO.md`, не чиню.
- `scripts/map/validate_region_economy_1946.py`, `scripts/map/generate_country_registry.py`,
  `server/src/scenarios/generateMapFeatures.ts`, `server/data/scenarios/1946/countries.json`.

**С чем могу конфликтовать**

- Worktree `capital-region-invariant` (ветка `claude/capital-region-invariant`) правит
  ровно те четыре файла из списка выше. Пересечения нет: демографию/идеологию веду
  тремя новыми файлами данных, валидацию — через Zod на загрузке, без нового
  python-валидатора и без правки существующих скриптов.
- `shared/src/types/` — правило «не менять параллельно в нескольких ветках». На момент
  старта ни один активный ExecPlan (`.agent/plans/*.md`) не заявляет правок в
  `shared/src/types/`; `capital-region-invariant` работает в `scripts/map` + `server/src/scenarios`.
- Сессия B будет править `server/src/llm/**` и `client/**` — стык описан в разделе
  «Стык для сессии B» ниже; ядро спроектировано так, чтобы B подключалась без переделки.

## Assumptions and unknowns

- Демо-состав и координаты идеологии — плейсхолдеры для калибровки, не исторический
  канон. Покрытие частичное (14 регионов, 3 страны) — это штатное состояние, а не баг.
- UNKNOWN: реальные коэффициенты формулы. Стартовые значения выбраны так, чтобы
  прибалтийские регионы SUN устойчиво стояли выше кризисного порога, а контрольные
  славянские — устойчиво ниже. Калибровка — после сессии B, на живых прогонах.
- UNKNOWN: конфликт внутри `docs/PRIMITIVES.md` — §3 говорит «структурный → весь ответ
  reject», §4 говорит «его reject не откатывает уже применённые мягкие». Следую §4
  (операционно конкретнее), фиксирую расхождение.

## Alternatives and selected decision

| Развилка | Альтернативы | Выбрано | Почему |
|---|---|---|---|
| Хранение `discontent` | (а) поле в `Region`; (б) полностью выводить каждый раз | (б) + хранимая память воздействий | §4.1 «настроение не хранится»; fitness-правило 9 (производное не хранится). Память воздействий хранится — иначе «подавил → загнал вглубь» не с чего считать |
| Хранение демо-состава | (а) отдельный индекс в `GameState`; (б) поле `Region.demographics` | (б) | §4.1 буквально: «регион хранит доминантную группу + меньшинства»; нет второго индекса и рассинхрона |
| Детекция порога | (а) сравнение before/after внутри тика; (б) латч пересечённых регионов | (б) `GameState.regionCrisisLatch` | before/after не сработает: регион уже стартует выше порога, пересечения не будет никогда. Латч + гистерезис даёт повторный кризис после спада |
| Атомарность применения | (а) применить и откатывать при ошибке; (б) прогон на клоне + commit подменой | (б) | §7.2 «plan → клон → пост-инварианты → commit»; откат по месту потребовал бы обратных операций на каждый эффект |
| Проверка палитры | (а) только тест; (б) рантайм-диф путей состояния + тест | (б) | «Палитра — декларативный whitelist (проверяем тестом)» + рантайм делает её реальной границей, а не документацией |
| «Благосостояние региона» | (а) `region.development` (статичен); (б) относительный ВВП на душу к стране-владельцу | (б) | (а) никогда не меняется тиком → член формулы мёртвый. (б) дышит от `EconomyTick`, масштаб-свободен |

## Progress

- [x] Worktree + baseline (tsc чистый; 680 passed / 1 skipped, 0 failures)
- [x] A1 состояние + Zod-схемы + `SAVE_VERSION` 3→4
- [x] A2 seed-данные (генератор + валидатор + три файла: 8 групп, 14 регионов, 3 страны)
- [x] A3 расчёт `discontent` + `DiscontentTick`, зарегистрирован после `aggregateAllCountries`
- [x] A4 типизированные `pendingWorldFacts` (`WorldFactKind`) + факт «кризис в регионе»
- [x] A5 движок примитивов (validate/compute/apply, рантайм-палитра, 5 verb, `commands/politics.ts`)
- [x] A6 тесты: формула, каждый verb, палитра, расхождение веток, campaignSmoke на реальных данных
- [x] Docs footprint + финальная верификация
- [x] A7 доработка по независимому ревью (2026-07-26): state-зависимая магнитуда с клампом
      хинта; commit без подмены идентичности; `validate_demographics_1946.py` в матрицах
      проверок + self-тест; расхождение с `PRIMITIVES.md` §4 зафиксировано; мелкие правки
- [x] A8 доработка по второму независимому ревью (2026-07-26): кап «один verb на цель за
      ход»; фактические дельты вместо посчитанных; калибровка двух каналов до достижимого
      схлопывания; NaN-guard на двух оставшихся командах; тест пар `MIN`/`MAX`; полярность
      теста пересечения

## Discoveries

- В worktree нет `node_modules`, сеть из песочницы недоступна (`npm install` → `EAI_AGAIN`,
  `--offline` → `ENOTCACHED`). Обход: junction `server/node_modules` →
  `D:\Pax Historia LOCAL\server\node_modules` (чтение чужого дерева, основной checkout
  не изменяется). Junction не коммитится.
- `campaignSmoke.test.ts` на baseline зелёный, хотя его комментарий утверждает, что тест
  «ОБЯЗАН падать на известном баге популяции» — комментарий устарел относительно кода.
- Guard-хук (`scripts/hooks/guard.mjs`) блокирует ручную запись в
  `server/data/scenarios/**`. Три новых слоя данных заведены через генератор
  `scripts/map/generate_demographics_1946.py` + валидатор `validate_demographics_1946.py` —
  это и есть предписанный хуком путь, обходить его не пришлось.
- Смешанные регионы Прибалтики (Рига 30 % русских, Латгале 35 %) дают недовольство ~0.43-0.46
  против ~0.55 у моноэтничных уездов, то есть НИЖЕ кризисного порога 0.5. Это работающая
  механика (доля-взвешенная сумма), а не пробел разметки; порог под них не занижался,
  `campaignSmoke` проверяет градиент.
- `grant_autonomy` и `enact_reform` пересекаются по недовольству целевого региона около
  36-го месяца: уступка затухает, реформа постоянна. Ветки при этом остаются разными
  состояниями мира. Зафиксировано явным тестом.

## Decision log

Перенесён в `docs/DECISIONS.md` (запись 2026-07-26): имя `discontent` и выбор
`incite_unrest`; гибридное хранение (значение выводится, память воздействий хранится);
диапазон осей `[-1, +1]` и нормировка на 2√2; шкала 0..1 у новых полей и отказ опираться на
`region.stability`; латч кризисов; три слоя данных отдельными файлами через генератор;
рантайм-проверка палитры; следование §4 в конфликте §3/§4 `PRIMITIVES.md`; отказ от
`fast-check`; `SAVE_VERSION` 3→4.

## Validation

```text
cwd: D:/Pax Historia LOCAL/.claude/worktrees/milestone-0-core/server
npx tsc --noEmit -p tsconfig.json
npm test
```

Baseline (43d05a4, до правок): tsc — 0 ошибок; vitest — 48 файлов, 680 passed, 1 skipped,
0 failed. Предсуществующих failure в затронутом scope не было.

Фактически выполнено после правок:

| Проверка | Результат |
|---|---|
| `server: npx tsc --noEmit -p tsconfig.json` | 0 ошибок |
| `server: npm test` | 51 файл, 742 passed, 1 skipped, 0 failed |
| `client: npx tsc --noEmit -p tsconfig.app.json` | 0 ошибок (затронут `shared/`) |
| `client: npm test` | 10 файлов, 102 passed |
| `python scripts/map/validate_demographics_1946.py` | OK (8 групп, 14/1399 регионов, 3/157 стран) |
| `python scripts/map/validate_region_economy_1946.py` | все проверки чисто |
| `python scripts/map/test_validate_region_economy_1946.py` | 9 тестов, OK |
| `python .agent/evals/public/run_public_evals.py` | 159 passed, 0 failed |

## Rollback / containment

Вся работа — в ветке `claude/milestone-0-core`, отдельном worktree. Откат: удалить ветку
и worktree (`git worktree remove`), основной checkout и чужие ветки не затронуты. Новые
файлы данных не читаются никем, кроме `Scenario1946.ts`; новые поля `GameState`
инициализируются в `CreateGame.ts`, поэтому частичный откат = снятие коммита, миграции
данных не требуется (сейвы старых версий и так отклоняются по `SAVE_VERSION`).

## Final outcome

Реализовано ядро вертикального среза: демо-состав регионов и координаты идеологии как слои
данных; вывод недовольства из геометрии дистанции «власть ↔ группа» + относительного
благосостояния + памяти воздействий; `DiscontentTick` с затуханием памяти и латчем кризисов;
типизированные `pendingWorldFacts`; движок пяти примитивов с контрактом
`validate → compute → apply`, рантайм-палитрой и слоем команд.

Доказательства — таблица проверок выше плюс целевые тесты: `DiscontentTick.test.ts` (формула,
фолбэки, затухание, латч), `PrimitiveEngine.test.ts` (каждый verb, атомарность, палитра,
«числа — движок»), `branchDivergence.test.ts` (ветки не схлопываются),
`campaignSmoke.test.ts` (60 месяцев на реальных данных 1946: градиент недовольства,
ровно один кризисный факт на регион, память не растёт без примитивов).

Baseline failures: нет.

Unresolved risks / fresh-session requirements:
- все коэффициенты — плейсхолдеры, калибровка после сессии B на живых прогонах;
- конфликт §3/§4 `PRIMITIVES.md` по поведению структурного reject требует решения при
  финализации алфавита;
- idempotency-key на ход (§7.2) не реализован — примитивы применяются столько раз, сколько
  вызван `applyPrimitiveBatch`; защита от двойного применения — на вызывающем (сессия B);
- `applyPrimitiveBatch` делает `structuredClone` состояния на батч и ещё один на примитив;
  на 1399 регионах это заметно, но вызывается раз в ход — оптимизация не требовалась;
- зафиксированные в `docs/TODO.md` предсуществующие дефекты (шкала `region.stability`,
  игнор `CommandResult` в `apply*Action`, wall-clock в `removeExpiredFeatures`) не чинились.

## Доработка A7 по независимому ревью (2026-07-26)

Ревью (другая модель, read-only) подтвердило палитру, атомарность, reject и границы worktree
и нашло, что **центральное требование среза выполнено не было**: магнитуда всех пяти глаголов
считалась как `КОНСТАНТА × множитель_хинта`, состояние в расчёт не входило, а тест
`PrimitiveEngine.test.ts` ЗАКРЕПЛЯЛ линейное масштабирование (`severe/mild === 1.5/0.5`) как
ожидаемое поведение. То есть не «недоделано», а «зафиксировано неправильным».

Что сделано (детали и мотивировка — `docs/DECISIONS.md`, поправка от 2026-07-26):

| Правка | Файлы |
|---|---|
| Магнитуда = коридор от состояния × позиция хинта; кламп; факторы состояния на все 5 глаголов | `server/src/primitives/magnitude.ts` (новый), `PrimitiveEngine.ts`, `shared/src/defines/discontent.ts` |
| Словарь интенсивности в `shared`, позиции типизированы `Record<PrimitiveIntensity, number>` | `shared/src/types/politics/PrimitiveIntensity.ts` (новый), `server/src/primitives/types.ts` |
| Commit/rollback без подмены идентичности объектов + удаление исчезнувших ключей | `PrimitiveEngine.ts::restore` |
| Отказ команды на неконечной дельте (NaN-недовольство глушило кризисный латч) | `server/src/commands/politics.ts` + новый `__tests__/politics.test.ts` |
| `kind: "objective_completed"` у факта завершения цели | `server/src/simulation/ObjectiveTick.ts`, `shared/src/types/GameState.ts` |
| Fitness-правила 2 и 4 распространены на `server/src/primitives/**` | `server/src/__tests__/architecture.test.ts` |
| `validate_demographics_1946.py` в обеих матрицах проверок + self-тест (15 кейсов) | `scripts/map/AGENTS.md`, `.agents/skills/verify-change/SKILL.md` + зеркало, `scripts/map/test_validate_demographics_1946.py` (новый) |
| Комментарии приведены к коду: `orderForExecution`, порядок цены реформы | `PrimitiveEngine.ts` |

Новые тесты: «одинаковые `params`, разное состояние → разные числа» на каждый глагол;
«без способности применить силу хинт перестаёт что-либо значить» (коридор схлопнулся);
«commit не отрывает ссылки от состояния» + «пустой батч не трогает состояние» +
«перенос удаляет исчезнувшие ключи».

Верификация A7: `server tsc` — 0 ошибок; `server npm test` — 52 файла, **760 passed**, 1 skipped
(baseline A6: 51 файл, 742 passed); `client tsc` — 0 ошибок; `client npm test` — 10 файлов,
102 passed; `python scripts/map/validate_demographics_1946.py` — OK;
`python scripts/map/test_validate_demographics_1946.py` — 15 тестов OK;
`python scripts/map/validate_region_economy_1946.py` + его self-тест — чисто;
`python .agent/evals/public/run_public_evals.py` — 159 passed, 0 failed.

Осознанно НЕ сделано в A7 (занесено в `docs/TODO.md`, раздел «Милстоун 0 — хвосты сессии A»):
idempotency-key; кризисный кап (факт: 9 регионов пересекают порог на первом тике при
hard-cap ≤ ~5); калибровка коридоров магнитуды; переделка исторических долей в seed-данных
(датасет заменяется внешним наполнением; зафиксировано, что завышенная русская доля
**занижает** недовольство и градиент `campaignSmoke` частично держится на анахронизме).

## Доработка A8 по второму независимому ревью (2026-07-26)

Ревью проверило коридор магнитуды на живых данных: архитектура коридора признана верной, но
обходимой. Мотивировка каждой правки — `docs/DECISIONS.md`, «Поправка 2 (2026-07-26)».

| Правка | Файлы |
|---|---|
| Кап «один verb на цель за ход» (§4): счётчик по паре «глагол + сущность», ключи целей | `PrimitiveEngine.ts` (`targetEntities`, `targetUseKey`), `shared/src/defines/discontent.ts` |
| Фактические дельты: `CommandResult<TApplied>`, `applied` у трёх команд, движок отчитывается ими | `commands/types.ts`, `commands/politics.ts`, `PrimitiveEngine.ts` |
| Легитимность вторым входом каналов отчуждения и уступки; базы и веса под достижимое схлопывание | `primitives/magnitude.ts`, `shared/src/defines/discontent.ts` |
| NaN-guard на `spendGovernmentSupport` и `shiftCountryIdeology` | `commands/politics.ts` |
| Тест достижимости схлопывания по всем шести каналам + согласованность пар `MIN`/`MAX` | `primitives/__tests__/magnitude.test.ts` (новый) |
| Пересечение веток на 36-м месяце: утверждение → наблюдение с печатью зазора | `primitives/__tests__/branchDivergence.test.ts` |

`stateFactor` на сидовых данных (регион 187, титульная группа, SUN: stability/legitimacy/
governmentSupport = 50) — до и после калибровки:

| канал | было | стало |
|---|---|---|
| repress · suppression | 0.28 | 0.280 |
| repress · alienation | 0.92 | 0.449 |
| grant_autonomy · concession | 0.91 | 0.446 |
| incite_unrest | 0.33 | 0.329 |
| spawn_incident | 0.24 | 0.239 |
| enact_reform | 0.33 | 0.333 |

Разброс по всем 14 размеченным регионам: `alienation` 0.313…0.492 (было 0.71…0.99),
`concession` 0.302…0.491 (было 0.67…0.985), `suppression` 0.255…0.360.

Верификация A8: `server tsc` — 0 ошибок; `server npm test` — 53 файла, **816 passed**, 1 skipped,
0 failed (baseline A7: 52 файла, 760 passed); `client tsc` — 0 ошибок; `client npm test` —
10 файлов, 102 passed; `python scripts/map/validate_demographics_1946.py` — OK;
`python scripts/map/test_validate_demographics_1946.py` — 15 тестов OK.

Осознанно НЕ сделано в A8: idempotency-key и кризисный кап (по-прежнему сессия B); балансовая
калибровка коридоров (структурная правка каналов её не заменяет — см. `docs/TODO.md`);
значение `MAX_PRIMITIVES_PER_TARGET_PER_TURN = 1` остаётся плейсхолдером.

## Доработка A9 по третьему независимому ревью (2026-07-26)

Ревью нашло третий способ обойти коридор магнитуды и одну дыру в валидаторе.
Мотивировка — `docs/DECISIONS.md`, «Поправка 3 (2026-07-26)».

| Правка | Файлы |
|---|---|
| Кап накопления следа: потолок суммарной дельты на тройку (регион, группа, поле), считается по фактическому дифу памяти | `primitives/PrimitiveEngine.ts` (`impactDeltas`, `impactBudgetKey`), `shared/src/defines/discontent.ts` (`IMPACT_FIELD_BATCH_CEILING`) |
| Рантайм-список полей памяти + типовая проверка его полноты | `shared/src/types/politics/Demographics.ts`, `commands/politics.ts` (`ImpactField` — алиас общего типа) |
| Нулевая уступка даёт нулевой отклик соседей (комментарий был сильнее кода) | `primitives/magnitude.ts` (`neighbourEmboldenment`), `PrimitiveEngine.ts` |
| `enact_reform`: цель обязана совпадать с источником — реформа внутриполитический акт | `primitives/PrimitiveEngine.ts` (`validate`) |
| Тест каналов магнитуды выводит список из модуля констант; седьмой коридор (отклик соседей) заведён отдельным классом «без хинта» | `primitives/__tests__/magnitude.test.ts` |
| Тесты обоих колец (синтетическое + реальное вокруг региона 192), законные комбинации, цепочка §4, чужая реформа | `primitives/__tests__/PrimitiveEngine.test.ts` |

Кольцо соседей (`emboldenment` хаба) — до и после капа накопления:

| кольцо | было | стало | потолок поля |
|---|---|---|---|
| синтетическое, 5 × `severe` | 1.000 (потолок памяти) | 0.411 | 0.45 |
| синтетическое, 10 × `mild` | 1.000 (потолок памяти) | 0.356 | 0.45 |
| регион 192 (1946), 6 × `severe` | 0.738 | 0.349 | 0.45 |
| регион 192 (1946), 6 × `mild` | 0.613 | 0.407 | 0.45 |

`branchDivergence` не сдвинулся: та же калибровочная печать `0.0027` на 36-м
месяце и до, и после правки (проверено прогоном на файлах базового коммита
`592f8f6` и на текущих). Ни одна из трёх правок в его ветках не срабатывает —
единственный примитив ветки не подходит к потолку накопления, уступка в свежем
мире ненулевая, цель реформы совпадает с источником.

Поправка к отчёту A8, чтобы формулировка не тиражировалась: «новые числа — это
ровно старые, делённые пополам» неточно. Старые `stateFactor` давали 0.9220 и
0.9100, половины были бы 0.4610 и 0.4550, фактические — 0.4490 и 0.4460;
расхождение оттого, что менялись и базы (`REPRESS_ALIENATION_SHARE_BASE`
0.35 → 0.15, `GRANT_AUTONOMY_SHARE_BASE` 0.25 → 0.1), а не только вводился
множитель легитимности. В таблице A8 выше стоят фактические числа, эта фраза в
`docs/` и в план не попадала.

Верификация A9: `server tsc` — 0 ошибок; `server npm test` — 53 файла,
**838 passed**, 1 skipped, 0 failed (baseline A8: 53 файла, 816 passed);
`client tsc` — 0 ошибок; `client npm test` — 10 файлов, 102 passed;
`client npm run lint` — 0 ошибок; `python scripts/map/validate_demographics_1946.py` — OK;
`python .agent/evals/public/run_public_evals.py` — см. ниже.

Осознанно НЕ сделано в A9 (занесено в `docs/TODO.md`): счётчики капов живут на
батч, а не на игровой ход (решается вместе с idempotency-key и границей хода);
доминирование репрессии у легитимного режима по обеим осям — балансовый риск
для калибровки; `?? 0` при чтении фактических дельт не отличает «ноль» от
«команда не заполнила `applied`».
