# 03 — Команды, модификаторы, defines

Приоритет: P1 — платформа, на которую ложатся планы 04, 06, 08 и волны бэклога 09.
Статус: реализовано в суженном объёме (см. «Отклонения при реализации» ниже и `README.md`).
Зависимости: 01 (гигиена состояния).

## Проблемы (текущее состояние)

1. **Три независимых пути записи в одни поля.** Мир мутируют: LLM-действия
   (`LLMService.applyLlmActions`), игрок (роуты `budget.ts`, `research.ts`),
   ИИ-тик (`AiBehaviorTick.ts`) — каждый со своей валидацией или без неё.

2. **Нет временных эффектов.** Любое влияние — прямое `country.economy.X *= Y`
   внутри тика. Невозможно выразить «−10 стабильности на 6 месяцев из-за
   события Z» без нового бесспойного кода. Комментарии в `SimulationEngine.ts`
   уже документируют хрупкие лаги и зависимость от порядка тиков.

3. **Баланс зашит в код.** Десятки констант рассыпаны по тикам:
   `EconomyTick.ts:17-27`, `AiBehaviorTick.ts:20-29`, `TradeTick.ts:17-37`,
   `WarTick.ts:15-21` и др. Тюнинг = перекомпиляция; моддинг невозможен;
   промт LLM не может процитировать правила мира.

## Целевая модель

### Шаг 1. Слой команд

`shared/src/sim/commands/` — единственный способ мутировать состояние.
Команда = чистая функция `(game, params) => CommandResult` с валидацией внутри.

Стартовый набор (покрывает существующие мутации):
- `transferRegion(regionId, newOwnerId)` — см. планы 01/08;
- `declareWar`, `makePeace` (расширяется в 08);
- `setRelation`, `setInfluence`, `applySanction`, `setGuarantee`, `setPuppet`;
- `setBudgetShares`, `setResearchAllocation`;
- `applyModifier`, `removeModifier` (шаг 2);
- `createFeature`, `removeFeature` (план 06).

Потребители: LLM-действия мапятся 1:1 на команды; HTTP-роуты игрока вызывают
команды; AiBehaviorTick вызывает команды. Одна валидация на всех.
Каждая команда пишет запись в eventHistory или локальный журнал хода
(источник: `llm | player | engine`).

### Шаг 2. Система модификаторов

```ts
interface Modifier {
  id: string;                    // счётчик, не random (см. план 01)
  source: string;                // "event:...", "feature:mf-123", "war:w-5", "llm"
  target: { kind: "country" | "region"; id: string | number };
  attribute: string;             // из белого списка: "stability", "industryOutput", ...
  op: "add" | "mul";
  value: number;
  expiresAt?: string;            // игровая дата; отсутствие = постоянный
}
```

- Хранение: `GameState.modifiers: Modifier[]` (plain JSON).
- Применение: тики читают не сырое поле, а `effectiveValue(base, attribute, target)`
  — суммирование add + произведение mul по активным модификаторам.
  Вводить постепенно: сначала 3–4 атрибута (stability, добыча ресурсов,
  exportIncome, сила армии), остальные по мере надобности.
- Очистка истёкших — в фазе Cleanup тика (там же, где `removeExpiredFeatures`).
- Белый список атрибутов + капы значений — в defines (шаг 3); это же — безопасный
  универсальный рычаг для LLM: действие `apply_modifier` с ограниченным словарём
  вместо бесконечного роста числа типов действий.

### Шаг 3. Defines

- `shared/src/defines/defines.json` (или по файлу на подсистему:
  `economy.json`, `war.json`, `ai.json`, `trade.json`).
- Загрузка через типизированный модуль `shared/src/defines/index.ts` — создать
  (as const + типы), чтобы автокомплит и проверки остались.
- Перенести константы из: EconomyTick, AiBehaviorTick, TradeTick, WarTick,
  ResourceTick, LLMService (LLM_SPOTLIGHT_COUNT, окна заголовков),
  TierTick (пороги тиров), DiplomacyTick.
- Комментарии-обоснования констант перенести в соседний `defines.notes.md`
  (JSON комментариев не имеет).

### Шаг 4. Фиксация порядка фаз

Задокументировать (в `docs/ARCHITECTURE.md`) и закрепить тестом порядок фаз
`simulateMonth`: WorldFacts-снимки → по-страновые тики → агрегация →
дипломатия → война → ИИ → Cleanup (фичи+модификаторы) → дата → годовые тики.
Правило на будущее: фаза читает состояние на начало фазы, пишет результат;
межфазные зависимости — только вперёд. (Полный read/commit-снапшот не нужен
на текущем масштабе — достаточно дисциплины и теста порядка.)

## Критерии приёмки

- [x] AiBehaviorTick, LLM-действия и роуты игрока не пишут в state напрямую — только команды.
- [x] Модификатор с expiresAt влияет на расчёт и исчезает после срока (тест).
- [x] В `server/src/simulation/**` нет числовых констант баланса (грубая проверка grep’ом в CI — допустимы только структурные литералы).
- [x] Промт LLM может включать значения defines (хотя бы капы действий) из того же источника, что использует движок. — уже было выполнено планом 02 (`shared/src/defines/llmActionCaps.ts`, секция "Hard limits" в `LLMService.generatePrompt()`), этим планом не тронуто.

## Отклонения при реализации

Реализован **осознанно суженный объём** одного захода — разведка (3
параллельных агента + прямая проверка ключевых файлов) показала, что
буквальный объём всех 4 шагов значительно больше, чем текст плана
предполагает (~15 файлов с десятками безымянных числовых литералов, часть —
`PoliticsTick.ts`/`PopulationTick.ts`/`MilitaryTick.ts`/`ResearchTick.ts` —
план вообще не называл). Полный анализ и решения по сужению — согласованы с
пользователем явно перед реализацией (`docs/DECISIONS.md`, 2026-07-11).

### Расположение слоя команд

**`server/src/commands/`, не `shared/src/sim/commands/`** (буква правила 2
`MASTER_PROMPT.md`). Весь слой тиков физически живёт в `server/src/simulation/`,
не в `shared/src/sim/` (директория не существует) — команды рядом с
`simulation/`/`services/`, где реально живёт игровая логика. Решение
пользователя, зафиксировано в `docs/DECISIONS.md`; текст `MASTER_PROMPT.md`
не редактировался.

### Шаг 1 — периметр команд

Критерий приёмки буквально требует только: `AiBehaviorTick`, LLM-действия и
роуты игрока не пишут в state напрямую. Внутренние детерминированные тики
(`DiplomacyTick`, `WarTick`, `TierTick` и т.п.) остались вызывать
`WarService`/`DiplomacyService` напрямую — это не «внешний инициатор» по
смыслу критерия, не переводились на команды.

Реализованный набор команд — подмножество списка из плана:
`setRelation`/`setInfluence`/`applySanction`/`setGuarantee`/
`nudgeRelationOneSided`/`nudgeInfluenceTowardTarget` (`commands/diplomacy.ts`),
`declareWar`/`makePeaceBetween` (`commands/war.ts`),
`setResearchAllocation`/`setProductionAllocation`/`setBudgetShares`/
`applyDeficitAusterityCut`/`shiftMilitaryToWelfare`/`setMilitarySpending`
(`commands/economy.ts`), `applyModifier`/`removeModifier`/
`removeExpiredModifiers` (`commands/modifiers.ts`). **Не реализованы**
(план называл, но нет обоснования делать в этом заходе):
- `transferRegion` — единственная прод-мутация `ownerCountryId` (`WarTick.ts`)
  уже дважды сознательно оставлена вне атомарной команды (план 01 → план 08)
  с явным комментарием в коде «не должно зависеть от порядка обхода».
- `setPuppet` — нет сервисного метода, который команда могла бы обернуть;
  `annex`/`puppet` остаются no-op, как после плана 02.
- `createFeature`/`removeFeature` — план 06.
- Запись команд в `eventHistory`/журнал хода (`source: llm|player|engine`) —
  ни один критерий приёмки этого не требует; `Event` не имеет поля `source`.

`nudgeRelationOneSided`/`nudgeInfluenceTowardTarget`/`applyDeficitAusterityCut`/
`shiftMilitaryToWelfare`/`setMilitarySpending` — точные обёртки формул
`AiBehaviorTick` Правил A/B/C, **не переиспользуют** похожие методы
`DiplomacyService` (у `changeRelation` есть побочный реципрокный сдвиг 50%,
которого в AI-формуле нет) — переиспользование изменило бы откалиброванный
баланс незаметно.

### Шаг 2 — один атрибут вместо 3-4

Критерий приёмки требует только «модификатор с `expiresAt` влияет на расчёт
и исчезает после срока (тест)» — сквозная демонстрация одного атрибута
(`stability`) полностью его закрывает. Белый список
(`shared/src/defines/modifierAttributes.ts`) содержит один атрибут,
расширяется по потребности следующих планов. Реальная интеграция —
`AiBehaviorTick.applyStabilityWelfareNudge` (единственный переведённый
читатель на `effectiveValue()` в этом заходе); остальные читатели
`politics.stability` и других полей продолжают читать сырое значение.

### Шаг 3 — периметр defines

Критерий приёмки формально требует только `server/src/simulation/**` — вне
периметра остались `server/src/services/**` (`RegionEconomyService.ts`/
`DiplomacyService.ts`/`WarService.ts` сохраняют свои константы) и
`shared/src/utils/**`. `LLMService.ts`'s `LLM_SPOTLIGHT_COUNT`/окна
заголовков — план называл их явно, но файл в `services/`, не `simulation/` —
тоже вне периметра, не тронуты.

Формат — TypeScript-файлы по подсистеме (паттерн `llmActionCaps.ts`), не
`defines.json`+`defines.notes.md` (план предлагает JSON — в кодовой базе нет
такого прецедента, JSON теряет комментарии-обоснования).

Миграция `shared/src/constants/` → `shared/src/defines/` (пользователь ранее
в плане 02 отложил её «до отдельного захода по плану 03» — сделана в этом
заходе): `budgetSpendingShareCaps.ts`/`createEmptyEconomyState.ts` перенесены,
`resourceWeights.ts` (подтверждённый мёртвый код) удалён вместо переноса.

Файлы `PoliticsTick.ts`/`PopulationTick.ts`/`MilitaryTick.ts`/`ResearchTick.ts`
план вообще не упоминал, но они физически в периметре критерия — константы
именованы и вынесены наравне с названными планом файлами.

### Шаг 4 — не в этом заходе

Фиксация порядка фаз `simulateMonth` — без критерия приёмки (тот же паттерн
отсечения, что уже дважды применялся в 01/02); дополнительно конфликтует с
`docs/AI_RULES.md:89-91` («состав/порядок тиков — только `SimulationEngine.ts`,
не дублировать список в доках»).
