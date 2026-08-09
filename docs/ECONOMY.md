# Экономика

Last updated: 2026-08-02 (аустерити ИИ двустороннее)

> ⚠️ Заготовка. Часть решений не принята — см. разделы "Открытые вопросы" ниже.
> Непомеченные числа — не источник истины, пока раздел не финализирован.
> Общие принципы ("лёгкая экономика", запрет на Victoria-сложность) — в
> `AGENTS.md`, не дублируются здесь.

## Назначение

Этот файл — дом для дизайна экономической петли: откуда берётся ВВП, как
считается бюджет, что такое единицы измерения в игре, и что делать с
ресурсами после добычи. Консолидирует то, что сейчас размазано по
`AGENTS.md` / `docs/AI_RULES.md` / `docs/DECISIONS.md`.

Смежные доки: [`TRADE.md`](TRADE.md) (мировой рынок, экспорт, логистика),
[`MAP_FEATURES.md`](MAP_FEATURES.md) (заводы/шахты как unit экономики),
[`POLITICS.md`](POLITICS.md) (как экономика двигает стабильность).
Масштаб мира (число регионов/стран/ресурсов) — только в `docs/WORLD.md`.

---

## Текущее состояние в коде

### Поля `EconomyState` (`shared/src/types/EconomyState.ts`)

- `gdp`, `treasury`
- Доход: `taxRevenue`, `exportIncome`, `stateEnterpriseIncome`, `otherIncome`
- Расход: `militarySpending`, `researchSpending`, `educationSpending`,
  `infrastructureSpending`, `welfareSpending`, `debtInterest`, `otherExpenses`
- `inflation`, `unemployment`, `tradeBalance`, `budgetBalance`
- `taxRate?` — рантайм-поле, выводится в `createGame` (см. ниже)
- `spendingFloor?` — снимок 50% стартовой ДОЛИ по 5 дискреционным статьям;
  пол урезания и (×2) потолок восстановления ИИ-правил бюджета
  (`AiBehaviorTick.ts`)

### Откуда берётся ВВП

ВВП считается на уровне региона и агрегируется к стране
(`shared/src/utils/aggregateCountryData.ts`). Формула роста региона —
`EconomyTick.ts::computeGrowthRate`:

```
baseGrowthRate = 0.001 + avgDevelopment×0.002 + avgInfrastructure×0.001
infrastructureBonus = infrastructureSpending / gdp × 0.15
deficitPenalty = budgetBalance < 0 ? |budgetBalance| / gdp × 0.3 : 0
debtPenalty = debt/gdp > 0.6 ? (debt/gdp − 0.6) × 0.02 : 0
growthRate = min(MAX_MONTHLY_GROWTH_RATE, max(0, base + infraBonus − deficitPenalty − debtPenalty))
// MAX_MONTHLY_GROWTH_RATE = 0.05 — защитный потолок, не даёт архетипу разогнаться неограниченно
// Пол — НОЛЬ: рецессия пробовалась 2026-07-31 и снята, она запускает долговую
// спираль (числа и условие включения — docs/TODO.md, docs/DECISIONS.md)
region.gdp *= (1 + growthRate + sectorBonus)   // sectorBonus от industry/services региона
```

### Накопление инфраструктуры (`EconomyTick.ts::updateInfrastructure`)

Вложение не только даёт разовый `infrastructureBonus` к росту, но и **строит
актив**: `region.infrastructure` растёт от вложений и изнашивается со временем
(модель капитала с амортизацией, введена 2026-07-31).

```
intensity = infrastructureSpending / gdp
factor    = 1 + BUILD_RATE × intensity / avgInfrastructure − DECAY_RATE
region.infrastructure = clamp(region.infrastructure × factor, MIN, MAX)
```

Множитель считается ОДИН на страну и применяется к каждому её региону:
вложения задаёт страна, а инфраструктура размечена порегионно, и тянуть регионы
к общему числу значило бы стереть авторскую разметку. Относительные различия
сохраняются точно, меняется только уровень.

Равновесие — `avg = BUILD_RATE × intensity / DECAY_RATE`. Константы подобраны
так, чтобы при медианной интенсивности сценария 1946 (0,040 ВВП) равновесие
совпало с медианной инфраструктурой (0,321): механика сохраняет стартовое
состояние мира, а расходятся дальше те, кто менял бюджет.

Соседние поля `development` и `urbanization` по-прежнему не пишет никто — это
отдельные петли, требующие продуктового решения (`docs/TODO.md`).

`country.economy.gdp` перезаписывается агрегацией (Σ `region.gdp`), не
накапливается отдельно.

### Петля бюджета (`EconomyTick.ts`, база — `simulation/economy/budgetBase.ts`)

```
if (taxRate !== undefined) taxRevenue = gdp × taxRate      // см. "Решено" ниже
debtInterest = debt > 0 ? debt × monthlyRate : 0           // см. "Госдолг" ниже
income     = taxRevenue + exportIncome + stateEnterpriseIncome + otherIncome
budgetBase = max(0, income - importSpending)                // база росписи, см. ниже
expenses = militarySpending + researchSpending + educationSpending
         + infrastructureSpending + welfareSpending + debtInterest + otherExpenses + importSpending
budgetBalance = income - expenses
treasury += budgetBalance
if (treasury < 0) { debt += -treasury; treasury = 0 }      // дефицит → долг
else if (debt > 0) { repay = min(debt, treasury); debt -= repay; treasury -= repay }  // профицит гасит долг
// Инфляция и безработица — ПРОЦЕНТЫ, в тех же единицах, что их пороги
// (STABILITY_*_THRESHOLD = 5/15/20), стартовые данные архетипов и текст
// мирового факта для LLM. Модель — возврат к цели, а не интегратор.
pressure = clamp((expenses - income) / gdp, ±FISCAL_PRESSURE_CAP) × 100   // в п.п.
inflationTarget    = INFLATION_BASELINE    + (pressure > 0 ? 1.8 : 0.1) × pressure
unemploymentTarget = UNEMPLOYMENT_BASELINE + (pressure > 0 ? 0.8 : 0.1) × pressure
inflation    += 0.05 × (inflationTarget - inflation)       // клип [-2, 60]
unemployment += 0.03 × (unemploymentTarget - unemployment) // клип [0, 60]
```

Асимметрия сторон — downward rigidity: профицит охлаждает инфляцию к базовой
линии, но не производит дефляцию так же охотно, как дефицит производит инфляцию.
Насыщение входа защищает механику от масштаба бюджетного блока (сальдо сейчас
±6…17% ВВП за месяц — величина нереалистичная и подлежащая перекалибровке
отдельно). Дефицитная сторона откалибрована по порогу, который обязана делать
достижимым: устойчивый дефицит 10% ВВП в месяц выводит цель инфляции ровно на
кризисный порог 20.

До 2026-07-31 приращение считалось в ДОЛЯХ ВВП (`0.1 × дефицит/ВВП`) при
величине и порогах в процентах — отклик был примерно в сто раз слабее
собственной шкалы. Замер за 120 месяцев сценария 1946: кризисный порог не
перешла ни одна страна из 157. Обоснование и калибровка —
`shared/src/defines/economy.ts`, замер — `server/scripts/probeScales.ts`.

**База росписи — одна на все пути записи `*Spending`, и это требование, а не
совпадение.** Пять дискреционных статей считаются от РАСПОЛАГАЕМОГО дохода
`budgetBase = max(0, income − importSpending)` (решение пользователя 2026-08-03,
`docs/decisions/2026-08.md` §«2026-08-04 — Импорт вошёл в роспись»): импорт —
обязательная закупка, а не строка росписи, и доли расписывают то, что осталось.
Кламп по нулю обязателен: страна, чей импорт превысил доход, иначе получила бы
отрицательные расходы, то есть доход из ниоткуда. Формула живёт в ОДНОМ месте —
`server/src/simulation/economy/budgetBase.ts` (`grossIncome`,
`disposableIncome`), и её вызывают все три пути, пишущие суммы: `EconomyTick.
updateBudget` (каждый тик), `CountryService.updateBudget` (`PUT /budget` игрока)
и команды бюджета ИИ в `server/src/commands/economy.ts` (`applyDeficitAusterity
Cut`, `applyAusterityRecoveryRaise`, `setMilitaryShare`, сдвиги military↔
welfare). `importSpending` входит в `expenses` во всех трёх — поэтому
`budgetBalance`, показанный игроку сразу после сохранения росписи, равен тому,
который при неизменном состоянии посчитает следующий ход. До 2026-08-09 базы
расходились: тик считал от располагаемого дохода, два других пути — от полного,
и показанный баланс отличался от ходового на `(1 − Σдолей) × importSpending`.

Если у страны задан `EconomyState.spendingShares?: { military, research,
education, infrastructure, welfare }` (`PUT /budget`), каждый тик до расчёта
`expenses` пересчитываются абсолютные `militarySpending/researchSpending/
educationSpending/infrastructureSpending/welfareSpending = budgetBase × доля` —
тот же паттерн, что `taxRate → taxRevenue` выше. Потолки на каждую статью
независимые (`shared/src/defines/budgetSpendingShareCaps.ts`,
`BUDGET_SPENDING_SHARE_CAPS`), сумма долей может превышать 1 — разрешено
осознанно. С 2026-08-01 `spendingShares` сеются ВСЕМ странам в `CreateGame`
(`docs/DECISIONS.md`): у ИИ доли двигает `AiBehaviorTick`, у игрока —
`PUT /budget`. В интерфейсе — ползунки долей в ТОМЕ «Экономика»
(`client/src/game/panels.tsx`) с явной кнопкой сохранения; смена бюджета
**не** продвигает игровой ход. Четыре готовых пресета жили в старом слое и
удалены вместе с ним 2026-08-07.

### Госдолг (реализовано 2026-07-11, `docs/plans/08_WAR_WAVE1.md` Шаг 4)

`EconomyState.debt` — накопленный госдолг. Раньше `debtInterest` было висящим
статичным полем без самого долга; теперь:

- **Дефицит → долг.** Казна не уходит в бесконечный минус: часть `treasury`
  ниже нуля конвертируется в `debt` (пол казны — 0). Профицит **сначала гасит
  долг**, остаток идёт в казну.
- **Проценты.** `debtInterest = debt × monthlyRate`, пересчитывается каждый тик
  до суммирования расходов. `monthlyRate = DEBT_BASE_MONTHLY_INTEREST_RATE(0.003)
  + DEBT_RISK_PREMIUM_COEFFICIENT(0.013) × (1 − avgHealth/100)`, где `avgHealth =
  (legitimacy + stability)/2`. Слабое государство занимает дороже (~19%/год при
  здоровье 0 против ~3.7%/год при 100).
- **Штраф росту.** Долг/ВВП выше `DEBT_GDP_PENALTY_THRESHOLD(0.6)` вычитает из
  месячного роста ВВП `(долг/ВВП − 0.6) × DEBT_GDP_GROWTH_PENALTY_COEFFICIENT`.
  Считается напрямую как функция состояния (не timed-модификатор — непрерывная
  зависимость, не временный эффект; сигнатуру `economyTick` менять не пришлось).
- **Аустерити ИИ.** Правило A (`AiBehaviorTick`) теперь триггерится дефицитом +
  долг/ВВП выше того же порога 0.6 (прежний триггер `treasury < 0` стал мёртвым
  с конвертацией дефицита в долг). ИИ затягивает пояс ровно тогда, когда долг
  начинает вредить росту. С 2026-08-02 правило двустороннее: при профиците с
  запасом (≥ 3% дохода) и долге, погашенном ниже четверти порога, доли
  восстанавливаются на +5%/тик до стартовых (`docs/DECISIONS.md`, 2026-08-02).
- **Мировой факт.** Долг/ВВП, пересекающий `DEBT_CRISIS_GDP_THRESHOLD(1.0)`,
  кладёт в промт LLM факт «X на грани дефолта» (`SimulationEngine`, тот же
  паттерн, что инфляционный/политический кризис). Сам дефолт — нарратив/действие
  LLM (план 02, шаг 4); команда `default(countryId)` и LLM-действие ещё не
  сделаны (кандидат на следующий заход).

Все числа — тюнингуемые плейсхолдеры (`shared/src/defines/economy.ts`).

`RegionEconomyService.calculateRegionalProduction`/`aggregateRegionEconomy`
существуют и протестированы, но **не подключены** к общему циклу — зарезервированы
под будущую MapFeature-экономику (см. `MAP_FEATURES.md`). Не включать их в
`EconomyTick` без явного решения, кто считает что — иначе задвоение
(прецедент: удалённый `ProductionTick`, см. `DECISIONS.md` 2026-06-22).
`RegionEconomyService.initializeRegionEconomy` — отдельно от этих двух,
**подключён и используется**: строит нулевой economy-снимок региона при
`createGame` (`CreateGame.ts`) и лениво в `ResourceTick.ts` для регионов без
`economy`.

### Добыча ресурсов

`deposits`/`extraction`/output — три слоя (`docs/plans/04_RESOURCES.md`,
2026-07-11), заменившие прежнее одно число `resourceProduction`:

- **`Region.deposits[resource]`** — richness, геологический потенциал.
  Меняется только истощением (тиком), не командами.
- **`Region.extraction[resource]`** — уровень добывающих мощностей
  `0..MAX_EXTRACTION_LEVEL` (`shared/src/defines/resources.ts`). Меняется
  только командой `buildExtraction`/`damageExtraction`
  (`server/src/commands/resources.ts`) — стройка списывает
  `EXTRACTION_BUILD_COST` из казны, кламп до `MAX_EXTRACTION_LEVEL`;
  разрушение (`damageExtraction`) безусловное, для будущей интеграции с
  войной/событиями (пока не подключено ни к чему автоматически).
- **Output** — не хранится, считает **только** `ResourceTick`
  (`server/src/simulation/resources/ResourceTick.ts`):
  `actualProduction = richness × (level/MAX_EXTRACTION_LEVEL) ×
  infrastructureBonus × techBonus × miningBonus × occupationPenalty ×
  resourceOutput-модификатор`, пишет в `country.stockpile`
  (`Record<ResourceType, number>`). `extractionFactor <= 0` — добычи и
  истощения нет. Истощение richness — 0.01%/мес, пропорционально
  фактической добыче (`extractionFactor`), до минимума 10% от исходного.
  Оккупированные регионы (`docs/plans/08_WAR_WAVE1.md`) добывают на
  оккупанта (`effectiveController`, не `ownerCountryId`) со штрафом
  `OCCUPATION_EXTRACTION_PENALTY`.

Списания со `stockpile` два (с 2026-08-02): `TradeTick` продаёт излишек
сверх резерва, а производство техники (`MilitaryTick.ts`, гейт сырья —
вариант А) физически потребляет ВОЕННОЕ сырьё
(`WAR_MATERIAL_RESOURCE_IDS`: coal/oil/iron/copper/nitrates) в объёме
спроса `militarySpending / EQUIPMENT_RESOURCE_DEMAND_SCALE`; непокрытая
доля спроса пропорционально режет выпуск техники. Остальные ресурсы
(аграрные, gold, uranium…) по-прежнему только копятся и торгуются.

LLM управляет уровнем мощностей действием `build_extraction`
(`docs/LLM_RULES.md`) — плоское действие с жёстким капом `delta: ±1` за ход,
как `research_shift`/`production_shift`; произвольное число добычи LLM
писать не может.

---

## Бегство капитала — примитив по РЕГИОНУ (Милстоун 1, 2026-07-29)

`capital_flight` — мягкий глагол алфавита (`docs/PRIMITIVES.md` §2). Он бьёт по
двум полям: `region.gdp` и казне фактического контролёра региона.

**Цель — регион, а не страна, и это следствие модели единиц.**
`country.economy.gdp` — АГРЕГАТ: `aggregateAllCountries` пересчитывает его из
регионов каждый тик, поэтому удар, записанный туда, испарился бы к следующему
месяцу. `region.gdp` живёт: `EconomyTick` растит его мультипликативно от
текущего значения, значит отток уменьшает базу будущего роста, а не
отыгрывается за месяц. Примитив, чей эффект испаряется, — это ложь с задержкой,
и выбор цели закрывает именно её.

**У глагола ЕСТЬ предпосылка, хотя спецификация её не требует**:
`region.stability` ниже `CAPITAL_FLIGHT_MAX_STABILITY`. Без неё это бесплатное
оружие по любому региону мира — тот же класс дефекта, что общий порог
`spawn_incident` до разделения по видам инцидента. Капитал бежит оттуда, где
доверие уже сломано.

**Коридор задают развитость и стабильность региона** — оба входа живые на
поставляемых данных 1946 (`development` 0.082…0.95, `stability` 0.184…0.809).
Схлопывается он дважды: при нулевой развитости («бежать нечему») и ровно на
пороге стабильности. Удар по казне взвешен ВЕСОМ региона в экономике страны —
иначе паника в окраинной провинции стоила бы державе столько же, сколько
паника в её промышленном ядре.

**Кап хода ключуется РЕГИОНОМ, без источника**: ячейка принадлежит региону и
стоит источнику ноль, поэтому ключ с источником позволил бы десяти
государствам сложить десять коридоров в одном регионе бесплатно
(`docs/PRIMITIVES.md` §4).

---

## Что уже решено

- **`taxRevenue = gdp × taxRate`** (`docs/DECISIONS.md`, 2026-06-23): ставка
  выводится в `createGame` как `taxRevenue / gdp` на старте партии, далее
  пересчитывается каждый тик. `export/stateEnterprise/other` остаются
  статичными в первом проходе — оживут с торговлей (`TRADE.md`).
- **Добыча ресурсов — только `ResourceTick`** (`docs/DECISIONS.md`, 2026-06-23,
  бывш. "вопрос 4"). `RegionEconomyService.calculateRegionalProduction`
  не включается в общий цикл, чтобы не задвоить добычу.
- Снимок `spendingFloor` (50% старта) и ИИ-аустерити по дефициту — реализованы,
  детали в `docs/DECISIONS.md` (2026-06-23) и [`POLITICS.md`](POLITICS.md)
  (там же — связь с дальнейшими нудж-правилами).
- **Бюджет игрока переведён на доли income + пресеты** (`docs/decisions/2026-07.md`,
  2026-07-04): `*Spending` пересчитываются тиком из `EconomyState.spendingShares`,
  детали см. в "Петля бюджета" выше.

---

## Модель единиц (Q9 — решено и реализовано, 2026-06-26)

Раньше `gdp` (~10¹¹, из формулы региона) и budget-поля (`treasury`/`*Spending`,
~10³, согласованные между собой в данных стран) жили на разных масштабах —
все формулы вида `spending/gdp` (инфляция, безработица, military-бонус,
рождаемость, исследования — 8 мест) схлопывались в `≈0`. Найденный при этом
второй, не связанный с масштабом баг: `region.gdp` пересчитывался с нуля
**каждый ход** в `updateAllRegionsAndAggregate`, что стирало накопленный рост
из `EconomyTick` — экономический рост был мёртв независимо от масштаба
(исправлено отдельно, см. ниже).

**Принятая модель — "ВВП-якорь + доли":** `gdp` остаётся единственной
абсолютной величиной (из регионов, формула не тронута). Всё финансовое —
**масштаб-свободные доли** в новом типе `EconomyProfile`
(`shared/src/types/EconomyProfile.ts`): `taxRate`, доли бюджета по статьям
(`spending.military/research/education/infrastructure/welfare/other`),
`treasuryShare`/`exportShare`/`stateEnterpriseShare`/`otherIncomeShare`.

**Поток данных:**
- Страна авторит `economyType` (`planned`/`mixed`/`market`) + опциональные
  оверрайды профиля. `createCountry` (`server/src/data/countries/templates/CreateCountry.ts`)
  мержит их с архетип-дефолтом (`templates/economyArchetypes.ts`) и строит
  `economy` как нулевой placeholder.
- `createGame` (после агрегации регионов, когда `gdp` известен) выводит
  денежные поля: `taxRevenue = gdp×taxRate`, `*Income = gdp×доля`,
  `*Spending = income×доля`, `treasury = gdp×treasuryShare`.
- Следствие: `spending/gdp ≈ taxRate×доля` — **одинаковое отношение для
  страны любого размера**, все 8 мест оживают без правки самих формул.
  Подтверждено симуляцией: страны одного архетипа дают идентичный `mil/gdp`
  независимо от абсолютного ВВП (разница в десятки раз).

**Сопутствующий фикс (тот самый "рост мёртв"):** `aggregateCountryData.ts`
разделён на `initializeRegionGdp` (формула региона, только при `createGame`)
и `aggregateAllCountries` (просто суммирует текущий `region.gdp`, без
пересчёта — вызывается каждый ход в `SimulationEngine`). До фикса рост ВВП
не работал **независимо от Q9** — это был отдельный баг, найденный при
верификации.

**Тюнинг:** коэффициенты роста (константы в `shared/src/defines/economy.ts` —
`INFRASTRUCTURE_SPENDING_GROWTH_COEFFICIENT` и т.д.) **откалиброваны по
20-летнему прогону 2026-08-03**: до калибровки мировой ВВП рос ×13,3 за 240
месяцев (~13%/год), после — ×3,16 (исторический коридор 1946–66 ×2,5–4);
население мира выходит на 3,35 млрд к 1966-му (реально ≈3,4). Все слагаемые
ставки роста уменьшены одним множителем ≈0,43 — относительная структура
сохранена. Страж — `server/src/simulation/__tests__/growthCorridor.test.ts`
(коридор кратности на 120 месяцах + форма кривой); при осознанной
перекалибровке пересчитывать его коридоры с обоснованием, не подгонять.

**⚠️ Страны 1946 (датасет d/MAP, см. `docs/SCENARIOS.md`)** конвертированы
на доли механически (через архетип по `economyType`), без исторической
калибровки. На их числа не ориентироваться при оценке баланса.

### ~~Q8 — Петля ресурсов~~ — реализовано частично (2026-07-06)

`stockpile` больше не копится бесконечно без выхода: `TradeTick.ts`
(`docs/TRADE.md`) продаёт излишек сверх внутреннего резерва
(`population × DOMESTIC_RESERVE_PER_CAPITA`) по мировой цене категории,
физически списывает проданное со stockpile, доход идёт в `exportIncome`.
Внутреннее потребление отвечено 2026-08-02 для военного сырья: производство
техники потребляет `WAR_MATERIAL_RESOURCE_IDS` (гейт сырья, вариант А, см.
блок Output выше). MapFeature input/output и потребление вне военного
производства — не спроектированы; для них в v1 остаётся упрощение
«фиксированный резерв на душу населения».

### Прочее (не блокер, просто незавершённое)

- `exportIncome` пересчитывается каждый тик (`TradeTick.ts`, `docs/TRADE.md`)
  как СУММА двух частей: базовая внешняя торговля (`ВВП × economyProfile.
  exportShare`, авторская доля 3–6%) плюс выручка от продажи излишков сырья;
  обе под множителями эмбарго и валютной зоны. **Исправлено 2026-07-31:** до
  этого тик ЗАТИРАЛ поле сырьевой частью, и фактическое отношение падало до
  0,0001 ВВП на первом же ходу — мир ежемесячно терял доход, на который была
  расписана его бюджетная роспись. Расходы при этом по-прежнему калибруются от
  ВНУТРЕННЕГО дохода, без экспорта (`CreateGame.deriveCountryEconomy`): экспорт
  — волатильная часть, которую блокада может обнулить, и строить на ней
  постоянные обязательства значит делать страну заложником санкции. Замер
  обоих вариантов — в `docs/DECISIONS.md` (2026-07-31).
  `stateEnterpriseIncome`/`otherIncome` остаются статичными (госпредприятия
  — не спроектировано вообще). `*Spending` пересчитывается тиком, если у
  страны задан `spendingShares` (см. "Петля бюджета" выше) — не смешивать
  эти категории.
