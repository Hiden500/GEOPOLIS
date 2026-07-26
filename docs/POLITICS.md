# Политика

Last updated: 2026-07-06

> Реализовано 2026-06-30 (`PoliticsTick.ts`), формулы ниже. Непомеченные
> числа — не источник истины.

## Назначение

Дом для дизайна внутриполитической динамики стран: что двигает
`PoliticsState`, как это стыкуется с ИИ-нудж-правилами (P2) и с кризисом
легитимности после войны (Threat/Rivalry Response, механизм 2).

Смежные доки: [`ECONOMY.md`](ECONOMY.md) (вероятный источник входов —
безработица/дефицит), [`WAR.md`](WAR.md) (война как драйвер и как триггер
кризиса), [`DIPLOMACY.md`](DIPLOMACY.md) (Threat/Rivalry Response).

---

## Текущее состояние в коде

### Поля `PoliticsState` (`shared/src/types/PoliticsState.ts`)

```
ideology: string
governmentType: string
stability: number
legitimacy: number
corruption: number
governmentSupport: number
```

### Кто читает и кто пишет

Так было до 2026-06-30: ни один тик не присваивал значение этим четырём
полям, они были статичны на значениях сценария с момента `createGame` до
конца партии. С 2026-06-30 все четыре поля каждый тик пишет
`PoliticsTick.ts` — см. раздел "Реализация" ниже.

Читают: `MilitaryTick` и `PopulationTick` (как вход для своих расчётов).

`ideology` используется в `DiplomacyTick.areIdeologicallyCompatible()` для
проверки совместимости при формировании союзов (`DiplomacyTick.ts:81-107`) —
в текущем коде `ideology` статична.

> **Superseded ([`CONCEPT.md`](CONCEPT.md) §4.2):** целевой дизайн делает идеологию
> **двигаемой** — спектр-координаты (эконом. + полит. оси) под именованными зонами;
> дрейфует примитивом `сдвинуть_идеологию`, союзы = близость координат, недовольство
> группы = геометрическая дистанция «власть vs группа». Абзац выше описывает текущий
> код, не целевую модель.

---

## Что уже решено

- Часть P2 ("ИИ-страны") изначально реализована без динамики политики —
  `AiBehaviorTick.ts` использует `budgetBalance`/`treasury` (Правило A) и
  дипломатические отношения/влияние (Правило B). Правило C (низкая
  `stability` → сдвиг к welfare) опирается на `PoliticsState` и работает,
  так как поле теперь пишется каждый тик (см. "Реализация" ниже).
- Кризис легитимности после войны (Threat/Rivalry Response, механизм 2,
  `docs/DECISIONS.md` 2026-06-22) задуман как: исход войны →
  детерминированное изменение `legitimacy`/`governmentSupport` → провал
  порога → гарантированный триггер "кризиса лидерства" (импичмент/протесты/
  чистка — конкретный вид решает LLM по `governmentType`). War-система
  Phase 1 реализована — механизм есть: `WarService.makePeace` присваивает
  изменение `legitimacy`/`governmentSupport` по исходу войны (см.
  "Реализация" ниже и `docs/WAR.md`).

---

## Реализация (2026-06-30)

`server/src/simulation/politics/PoliticsTick.ts`, вписан в `SimulationEngine`.

| Поле | Механика |
|---|---|
| `stability` | Дрейф к равновесию × 0.05/мес. Eq = 50 ± unemployment/deficit/inflation-поправки |
| `governmentSupport` | Дрейф × 0.08/мес. Eq = 50 ± unemployment/deficit/welfare-поправки |
| `legitimacy` | Дрейф × 0.005/мес к идеологическому базису (70 демократия, 60 коммунизм, 50 национализм, 55 прочее) |
| `corruption` | Дрейф ×0.003/мес к структурному равновесию (режим + stability + образование). Авторитаризм не падает ниже 55, Democracy — ниже 20 только при стабильных институтах. Утечка казны: `treasury -= gdp × corruption × 0.00005/мес`. Высокая коррупция (> 60) давит на stability. |

Война как драйвер `legitimacy` — реализовано: `WarService.makePeace`, см.
`docs/WAR.md`. Нудж P2 "низкая stability → welfare" (Правило C в
`AiBehaviorTick.ts`) реально работает.
