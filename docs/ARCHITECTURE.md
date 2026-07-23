# Архитектура проекта

Last updated: 2026-07-11

## Структура

client/
server/
shared/
docs/

---

## Shared

Этот раздел описывает реальные поля типов из `shared/src/types/`. При изменении типов в коде обновляйте и этот раздел в том же PR — иначе документация снова разойдётся с кодом.

### Country (`shared/src/types/Country.ts`)

Содержит:

* id, name, shortName, color, capitalRegionId
* population
* economy: EconomyState
* economyType: EconomyType
* technology: TechnologyState
* researchedTechnologyIds: string[]
* military: MilitaryState
* diplomacy: DiplomacyState
* politics: PoliticsState
* stockpile: ResourceStockpile
* goals: StrategicGoal[]
* aiTraits: AiTraits — детерминированно сеются при `createGame()`
* currencyZoneAnchor?: string — опциональная ссылка на страну-якорь валютной зоны
* tier: CountryTier — "major"/"regional"/"minor", определяет участие в LLM-промте (постоянно/по ротации/только пороговые правила)
* economyProfile: EconomyProfile — масштаб-свободные доли экономики страны, источник истины для дизайна страны (детали — `docs/ECONOMY.md`)

### Region (`shared/src/types/map/Region.ts`)

Основная территориальная единица.

Поля:

* id, geoJsonId, names: LocalizedText
* ownerCountryId, occupiedBy? — юридический владелец и опциональный военный контролёр
* population, area
* urbanization, stability, infrastructure, development
* gdp
* deposits, extraction — геологический потенциал и уровень добывающих мощностей; выпуск за тик вычисляется, а не хранится
* neighboringRegionIds
* sourceAdm1Codes? (опционально)
* economy? — { agriculture, industry, mining, services } (опционально, инициализируется тиками при первом обращении)

### EconomyState (`shared/src/types/EconomyState.ts`)

Поля:

* gdp, treasury
* taxRevenue, taxRate?, exportIncome, importSpending, stateEnterpriseIncome, otherIncome
* militarySpending, researchSpending, educationSpending, infrastructureSpending, welfareSpending, debt, debtInterest, otherExpenses
* inflation, unemployment
* tradeBalance, budgetBalance
* spendingFloor?, spendingShares? — рантайм-пол и пользовательские доли дискреционных расходов

### TechnologyState (`shared/src/types/TechnologyState.ts`)

Поля:

* domains: Record<string, number> — прогресс (накопленные вложения) по доменам
* researchAllocation?: Partial<Record<string, number>> — текущее распределение фокуса исследований по доменам

### MilitaryState (`shared/src/types/MilitaryState.ts`)

Поля:

* manpower, activePersonnel, reservePersonnel, militaryBudget
* armyStrength, navyStrength, airStrength, nuclearWarheads
* units: Unit[]
* equipment: Record<EquipmentType, number>

### DiplomacyState (`shared/src/types/DiplomacyState.ts`)

Поля:

* allies, rivals, puppets, sphereOfInfluence
* relations: Record<string, number>
* influence: Record<string, number>
* guarantees: string[]
* sanctions: Record<string, SanctionType[]>

### PoliticsState (`shared/src/types/PoliticsState.ts`)

Поля:

* ideology, governmentType
* stability, legitimacy, corruption, governmentSupport

---

## Server

Сервер выполняет симуляцию мира.

Тики выполняются последовательно.

### Сохранения (`server/src/game/SaveService.ts`)

Реализовано по `docs/plans/01_PERSISTENCE_STATE.md` (2026-07-10). `GameStore.ts`
остаётся синглтоном одной активной игры в памяти процесса — слоты сейвов
относятся к персистентности на диске, не к параллельным живым играм.

* Формат файла — `shared/src/types/SaveFile.ts`:
  `{ version: number, savedAt: string, game: GameState }`, `SAVE_VERSION`.
  Несовпадение версии при загрузке — явный отказ (`SaveVersionError`, 409),
  без миграций.
* Каталог — `server/data/saves/<slot>.json` (гитигнорен). Имя слота
  ограничено алфавитом `[a-zA-Z0-9_-]{1,64}` (`SAVE_SLOT_PATTERN`) — защита
  от path traversal, слот идёт прямиком в имя файла.
* API: `POST /game/save {slot}`, `POST /game/load {slot}`, `GET /game/saves`
  (метаданные слотов), `DELETE /game/saves/:slot`.
* Автосейв — слот `autosave`, перезаписывается в конце каждого успешного
  `GameService.advanceMonth()`.
* Транзиентные поля `llmContext`/`pendingLlmActions` не сохраняются;
  `llmResponse` (кэш последнего ответа LLM) сохраняется как есть.
* `GameState.rngState: number` (`shared/src/utils/rng.ts`, mulberry32) —
  сериализуемое состояние seeded RNG, инфраструктура на будущее (текущей
  игровой логике не нужна). `GameState.nextFeatureId: number` — счётчик для
  детерминированных id Map Features (`mf-000123`, `MapFeatureService.generateId()`),
  заменил `Math.random()`/`Date.now()`.

### Команды (`server/src/commands/`)

Реализовано по `docs/plans/03_MODIFIERS_COMMANDS.md` (2026-07-11, суженный
объём — детали и отклонения в файле плана). Единственный способ мутировать
state для трёх «внешних инициаторов»: LLM-действия (`LLMService.ts`),
роут `budget.ts`, детерминированный ИИ (`AiBehaviorTick.ts`). Внутренние
детерминированные тики (`DiplomacyTick`/`WarTick`/`TierTick` и т.п.) вне
периметра — продолжают вызывать `WarService`/`DiplomacyService` напрямую.

* Команда — функция `(game, ...params) => CommandResult`,
  `CommandResult = { success: boolean; error?: string }`. Один файл на
  подсистему, без barrel/index.ts.
* `commands/diplomacy.ts` — `setRelation`/`setInfluence`/`applySanction`/
  `setGuarantee` (тонкие обёртки `DiplomacyService`) + `nudgeRelationOneSided`/
  `nudgeInfluenceTowardTarget` (точные обёртки формул `AiBehaviorTick`
  Правило B — не переиспользуют `DiplomacyService.changeRelation`, у того
  есть побочный реципрокный сдвиг, которого нет в AI-формуле).
* `commands/war.ts` — `declareWar`/`makePeaceBetween` (обёртки `WarService`) и
  `transferRegion` (атомарная смена `ownerCountryId`; оккупация во время войны
  остаётся отдельным слоем в `simulation/war/occupation.ts`).
* `commands/economy.ts` — `setResearchAllocation`/`setProductionAllocation`/
  `setBudgetShares` (обёртки `ResearchService`/`MilitaryService`/
  `CountryService`) + `applyDeficitAusterityCut`/`shiftMilitaryToWelfare`/
  `setMilitarySpending` (точные обёртки формул `AiBehaviorTick` Правил A/B/C).
* `commands/modifiers.ts` — `applyModifier`/`removeModifier`/
  `removeExpiredModifiers` (см. «Модификаторы» ниже).
* `commands/resources.ts` — `buildExtraction`/`damageExtraction`
  (docs/plans/04_RESOURCES.md, 2026-07-11): уровень добывающих мощностей
  региона (`Region.extraction`), не сама добыча (та — производная,
  `ResourceTick.ts`). `buildExtraction` проверяет `effectiveController`
  и наличие deposit, списывает `EXTRACTION_BUILD_COST` при `delta>0`;
  `damageExtraction` — безусловное снижение, для будущей интеграции с
  войной/событиями (не подключена автоматически ни к чему в этом заходе).
* Не реализовано (нет обоснования критерием приёмки, см. план): `setPuppet`
  (нет сервисного метода), `createFeature`/`removeFeature` (план 06), запись
  команд в `eventHistory`/журнал хода.

### Модификаторы (`shared/src/utils/modifiers.ts`, `server/src/commands/modifiers.ts`)

Реализовано по `docs/plans/03_MODIFIERS_COMMANDS.md` — минимальный сквозной
срез на одном атрибуте (`stability`), остальные добавляются по потребности.
План 04 добавил второй атрибут: `resourceOutput` (`ResourceTick.ts`,
`target.kind: "region"` — финальный множитель добычи, тот же паттерн, что
`stability` для `"country"`).

* `Modifier` (`shared/src/types/Modifier.ts`): `{ id, source, target: {kind,
  id}, attribute, op: "add"|"mul", value, expiresAt? }`. `id` — тот же
  счётчик, что Map Features (`game.nextFeatureId`), префикс `"mod-"`.
  `expiresAt` — игровая дата (`game.currentDate`), НЕ wall-clock.
* Белый список атрибутов — `shared/src/defines/modifierAttributes.ts`
  (сейчас: `stability`, `resourceOutput`).
* `effectiveValue(base, attribute, target, modifiers)` — `(base + Σadd) ×
  Πmul` среди модификаторов, совпадающих по `target`+`attribute`. Тики
  читают через неё, не сырое поле — читатели: `AiBehaviorTick.
  applyStabilityWelfareNudge` (`stability`), `ResourceTick.ts`
  (`resourceOutput`).
* Очистка истёкших — `removeExpiredModifiers(game)`, вызывается в Cleanup-
  фазе `SimulationEngine.ts` рядом с `MapFeatureService.removeExpiredFeatures()`
  (та сравнивает с wall-clock — задокументированный баг, не повторён здесь).

### Данные сценария 1946 (`server/data/scenarios/1946/`, `scripts/map/`)

Реализовано по `docs/plans/05_DATA_LAYOUT.md` (2026-07-11, суженный объём —
только server/shared/Python; клиентская часть плана вне заходa, см. файл
плана). `Scenario1946.ts::buildScenario1946()` собирает `Region[]`/`Country[]`
на загрузке, не хранит их в едином файле.

* **Регионы расслоены на 4 файла**: `regions.core.json` (id/geoJsonId/area/
  neighboringRegionIds/sourceAdm1Codes — география, не меняется рестартом
  сценария), `names.en.json`/`names.ru.json` (`geoJsonId → имя`, локализация),
  `regions.state.json` (ownerCountryId/population/urbanization/stability/
  infrastructure/development/gdp/deposits/extraction — состояние сценария).
  `scenario1946Schemas.ts` — Zod-схема на каждый слой; сборка бросает
  `ScenarioDataError` с внятным сообщением на битом JSON, рассинхроне
  core↔state (регион без записи в state) или отсутствующем имени региона
  сразу в обеих локалях.
* **Страны — только авторские поля**: `countries.json` не содержит нулевых
  рантайм-блоков (economy/technology/military/пустая diplomacy/stockpile/
  goals) — их дефолтит `createCountry()`
  (`server/src/data/countries/templates/CreateCountry.ts`), тот же путь
  сборки, что у 12 рукописных TS-стран сценариев 1836/2000. `technology.domains`
  для домена без явного оверрайда дефолтится в `createGame()` из
  `scenario.technologyEra.technologyDomains` (`shared/src/data/eras.ts`), не
  дублируется в данных сценария.
* **Единый источник каталога ресурсов**: `server/scripts/exportResourceCatalog.ts`
  (`npm run export:resource-catalog` в `server/`) экспортирует
  `RESOURCE_CATALOG`+`MAX_EXTRACTION_LEVEL` в `scripts/map/out/resource_catalog.json`
  — Python-пайплайн читает его (`economy_1946/resource_catalog.py`) вместо
  дублирования списков/констант вручную.
* **Пайплайн**: `scripts/map/make_1946.py` — оркестратор от готовых
  `out/*.geojson`/`*.json` (или, с флагом `--full-rebuild`, от полной
  пересборки геометрии) до валидного сценария: экспорт каталога ресурсов →
  `import_to_game.py` → `generate_country_registry.py` →
  `fill_region_economy_1946.py` → `validate_region_economy_1946.py` → тест
  структурных инвариантов. Падает на первом ненулевом коде возврата.
* **Валидация**: `validate_region_economy_1946.py::validate_structural_invariants()`
  — симметрия графа соседей, `ownerCountryId` существует в `countries.json`,
  `capitalRegionId` страны принадлежит ей самой, `deposits`/`extraction` ⊆
  каталог ресурсов, полнота локализации (имя есть и в `names.en.json`, и в
  `names.ru.json`) — независимы от исторических анкеров 1946, покрыты
  `test_validate_region_economy_1946.py` (synthetic-фикстура, stdlib
  `unittest`). CI-job `data` (`.github/workflows/ci.yml`) гоняет оба на
  каждый PR, затрагивающий `scripts/map/**`.
* **Не в этом заходе** (см. `docs/plans/05_DATA_LAYOUT.md` «Отклонения при
  реализации»): удаление мёртвого `client/src/assets/game_map.json`,
  TopoJSON-конвертация `world_1946.geojson`, миграция 12 рукописных TS-стран
  1836/2000 в авторский JSON-формат, штампы `_meta` в промежуточных
  `scripts/map/out/*.json`.

---

## Client

Отвечает за интерфейс, карту и отображение состояния мира.

Карта остаётся полноэкранной основой HUD. Постоянная оболочка строится из
`Header`, левой `SidePanel`, правой `ContextPanel`, нижней `OrdersBox` и
`MapControls` (`client/src/hud/`, сборка в `GameView.tsx`). Перетаскиваемый
`Window` используется только для отдельных поверхностей сравнения и LLM, а
не как универсальный контейнер всех панелей. Актуальная композиция и правила
адаптивности описаны в `docs/UI_DESIGN.md`.

После успешного `GameService.advanceMonth()` движок сохраняет опциональный
`GameState.lastTurnReport`: фиксированный diff восьми уже вычисляемых показателей
страны игрока и id новых завершённых целей. Поле содержит только последний ход,
не меняет порядок тиков, не зависит от LLM-текста и совместимо со старыми saves.

# LLM Simulation Architecture

## Общий принцип

Симуляция мира выполняется при помощи внешней Large Language Model (LLM).

LLM является основным компонентом, отвечающим за:

* обработку действий игроков;
* генерацию мировых событий;
* реакцию государств на изменения мира;
* принятие стратегических решений ИИ-государств;
* развитие альтернативной истории;
* создание текстовых описаний событий.

Игровой движок отвечает за:

* хранение состояния мира;
* хранение карты и регионов;
* выполнение игровых расчётов;
* применение изменений к игровому состоянию;
* отображение результатов симуляции.

---

## Цикл симуляции

Каждый игровой ход выполняется следующий процесс:

1. Игровой движок собирает текущее состояние мира.
2. Игровой движок формирует промт.
3. В промт включаются:

   * текущая дата;
   * состояние государств;
   * состояние регионов;
   * дипломатическая ситуация;
   * военная ситуация;
   * экономическая ситуация;
   * действия игроков;
   * предыдущие события;
   * дополнительные данные сценария.
4. Сформированный промт копируется в буфер обмена.
5. Пользователь вручную вставляет промт в выбранную LLM.
6. LLM выполняет симуляцию игрового хода.
7. LLM возвращает результат в структурированном формате.
8. Ответ копируется обратно в игру.
9. Игровой движок валидирует ответ.
10. Игровой движок применяет изменения к миру.

**Текущий статус реализации**: ручной LLM-цикл работает целиком — `GET /llm/prompt` отдаёт промт, `client/src/components/LLMPanel.tsx` копирует его в буфер обмена и предоставляет поле вставки ответа, `POST /llm/response` принимает и применяет ответ. Дополнительно есть автоматизированный путь через `GeminiProvider` (`POST /llm/auto`), не требующий ручного копирования. Ход защищён гейтом: `GameState.llmRespondedThisTurn` — `GameService.advanceMonth` бросает `LLMGateError`/409, если LLM не ответила за цикл. Длина хода переменная (1–12 месяцев): `advanceTurnSchema`, параметр `months` в `POST /game/next-turn`. Подробности и история решений — `docs/DECISIONS.md`.

---

## Ограничения LLM

LLM не является источником истины.

Источник истины:

* savegame;
* countries.json / regions.core.json+names.*.json+regions.state.json (см. «Данные сценария 1946» выше);
* map features;
* игровые данные движка.

LLM может предлагать изменения, но не изменяет данные напрямую.

Все изменения должны проходить проверку игровым движком.

---

## Работа без API

Проект должен поддерживать режим работы без API.

Основной сценарий:

* генерация промта;
* копирование промта в буфер обмена;
* ручная вставка промта в LLM;
* ручное копирование ответа;
* импорт ответа обратно в игру.

Архитектура должна работать полностью локально без обязательного подключения к внешним сервисам.

---

## Масштабирование

Система должна поддерживать:

* полный мир;
* несколько исторических эпох;
* тысячи регионов;
* сотни государств;
* десятки тысяч объектов карты.

Для уменьшения размера контекста в промт должны передаваться только данные, необходимые для текущего игрового хода.

LLM не обязана получать полное состояние мира целиком.
