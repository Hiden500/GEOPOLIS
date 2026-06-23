---
trigger: always_on
---
# Архитектура проекта

Last updated: 2026-06-21

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

### Region (`shared/src/types/map/Region.ts`)

Основная территориальная единица.

Поля:

* id, geoJsonId, name
* ownerCountryId
* population, area
* urbanization, stability, infrastructure, development
* gdp
* resourceProduction
* neighboringRegionIds
* sourceAdm1Codes? (опционально)
* economy? — { agriculture, industry, mining, services } (опционально, инициализируется тиками при первом обращении)

### EconomyState (`shared/src/types/EconomyState.ts`)

Поля:

* gdp, treasury
* taxRevenue, exportIncome, stateEnterpriseIncome, otherIncome
* militarySpending, researchSpending, educationSpending, infrastructureSpending, welfareSpending, debtInterest, otherExpenses
* inflation, unemployment
* tradeBalance, budgetBalance

### TechnologyState (`shared/src/types/TechnologyState.ts`)

Поля:

* domains: Record<string, number>
* projects: ResearchProject[]

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

---

## Client

Отвечает за интерфейс, карту и отображение состояния мира.

Все информационные панели (бюджет, исследования, действия, мировой рейтинг, территории, инспектор страны/региона) рендерятся как независимые перетаскиваемые окна (`client/src/components/Window.tsx` + `client/src/hooks/useWindows.ts`), а не как постоянные колонки макета — карта всегда занимает весь `game-content`, окна открываются по клику и закрываются явно. Размер окна по умолчанию подстраивается под содержимое; ручной ресайз через угловую ручку. См. `docs/DECISIONS.md` ("Редизайн интерфейса") за обоснованием.

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

**Текущий статус реализации**: шаги 2 (`buildSimulationPrompt` в `server/src/llm/BuildSimulationPrompt.ts`, `LLMService` в `server/src/services/LLMService.ts`) и 9 (`LLMResponseValidator` в `server/src/llm/LLMResponseValidator.ts`) написаны в коде, но **не подключены** ни к одному route и ни к одному элементу UI — шаги 4, 5, 6, 7, 8, 10 физически нечем выполнить прямо сейчас. Это не баг и не повод переделывать сами модули — ручной цикл задуман архитектурно (см. "Работа без API" ниже), просто отсутствует связующий route/кнопка "скопировать промт" + поле "вставить ответ". Подробности и причины — `docs/DECISIONS.md`.

---

## Ограничения LLM

LLM не является источником истины.

Источник истины:

* savegame;
* countries.json;
* regions.json;
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
