# Структурные глаголы — подчинение и состав держав
Status: complete
Owner: Claude (Opus), worktree `.claude/worktrees/structural-verbs`, ветка `claude/structural-verbs`
Starting commit: c6cbf90

## Objective and observable outcome

Алфавит примитивов получает глаголы, меняющие ПОДЧИНЕНИЕ и СОСТАВ государств:
`puppet`, `annex` (обязательный минимум), затем `merge_countries`,
`create_country`. Тем же действием закрывается долг: юридический статус
(`politics.sovereigntyStatus`/`overlordIds`) и рантайм-отношение
(`diplomacy.puppets`) перестают расходиться.

Достигнуто полностью:

- четыре глагола в `PRIMITIVE_VERBS`, `PRIMITIVE_SCHEMAS`, палитре, сверке,
  капах хода, контракте промта, обеих локалях; алфавит доведён до 18;
- `findStateViolations` держит «марионетка не суверенна, её сюзерен —
  в `overlordIds`»; инвариант исполняется и пост-фазой транзакции, и загрузкой
  сейва;
- аннексия последнего региона страны игрока ведёт в `defeated / absorbed`, а
  страна остаётся в мире и игрок остаётся собой;
- суммы сходятся в обе стороны: замкнутый цикл «раскол → объединение» даёт
  исходные суммы мира.

## Scope and constraints

**Изменено:** `server/src/primitives/*` (новый `subordination.ts`),
`server/src/commands/lifecycle.ts`, `server/src/llm/primitiveContract.ts`,
`server/src/services/LLMService.ts`, `server/src/test-utils/discontentFixtures.ts`,
`shared/src/defines/diplomacy.ts`, `shared/src/types/politics/Government.ts`,
словари i18n двух локалей, `docs/{PRIMITIVES,DIPLOMACY,CONCEPT,DECISIONS,TODO}.md`.

**Не тронуто:** `client/src/map/**`, клиентские компоненты (только словари),
`simulation/diplomacy/affinity.ts`, коридоры мягких глаголов, калибровка
существующих коэффициентов, семейство блоков, формат сейва (`SAVE_VERSION`
не менялся), данные сценария 1946.

**Пересечения.** Активны `claude/interface-rebuild` (клиент),
`claude/1946-map-coastline-fixes`, `codex/design-review`,
`codex/milestone-0-audit`. Конфликта областей не возникло: клиентские файлы
затронуты только словарями i18n, `scripts/map/**` не тронут.

## Assumptions and unknowns

- Предположение о том, что в `diplomacy.puppets` в рантайме не пишет никто,
  подтверждено поиском и осталось верным до конца сессии.
- UNKNOWN о палитре `split_country` разрешён: гипотеза подтвердилась
  (предсуществующий дефект), закрыт и покрыт тестом.
- `stage_coup`/`hold_election` в сессию не вошли — см. Final outcome.

## Alternatives and selected decision

- **Инвариант подчинения: слой данных или рантайм.** Выбран рантайм
  (`findStateViolations`) — иначе первый же писатель в `puppets` делал бы
  расхождение достижимым игровым путём. Цена: перенос ссылок обязан достраивать
  разорванную половину пары, что и делает `reconcileSubordination`.
- **`undefined` статуса: законен или нарушение.** Выбрано «читается как
  суверенность» — так же, как его читает запись. Первая версия допускала
  `undefined`, и собственный негативный контроль на ней не падал; это и был
  сигнал, что проверка не проверяет.
- **`annex`: цель регион или страна.** Выбрана страна: поглощение державы
  одним актом, а не 42 хода подряд при одном структурном слоте в месяц.
- **`annex` над последним регионом: удалять страну или нет.** Не удалять
  (§7.1). Конец партии вычисляет машина состояний кампании.
- **`merge_countries` над страной игрока: запретить или вести в поражение.**
  Запретить: перенос ссылок увёл бы `playerCountryId` на поглотителя.
- **`create_country`: копия раскола или общее ядро.** Общее ядро
  (`secedeGroups`), вынесенное из `splitCountry`.
- **Исключение сторожа каналов: список или свойство класса.** Свойство класса,
  как и предсказывал `docs/TODO.md`.

## Progress

- [x] Baseline: server 1161 passed | 1 skipped, client 143 passed.
- [x] Гипотеза о палитре `split_country` проверена — дефект подтверждён.
- [x] Сведение подчинения: `subordination.ts`, инвариант, палитра раскола.
- [x] `puppet`.
- [x] `annex` + переход кампании.
- [x] `merge_countries` (сложение сумм, замкнутый цикл).
- [x] `create_country`.
- [x] Проверка на боевых данных 1946 (все четыре глагола).
- [x] Docs footprint.

## Discoveries

- **Предсуществующий дефект палитры `split_country`:** путь
  `countries[*].politics.overlordIds[*]` не был объявлен, и раскол государства в
  отношениях подчинения, не пережившего распад, откатывался собственной
  палитрой. Достижимо на данных 1946.
- **Поглощение снимает влияние поглотителя на поглощённого** как самоссылку;
  сверка результата откатывала примитив за молчание об этой дельте. Найдено
  только на боевых данных (`influence:AUS->NRU`, 85 → 0).
- **Оккупированных регионов в сценарии 1946 — ноль из 1399**, поэтому путь
  подчинения силой на старте недоступен никому, а `annex` отклоняется всегда.
  Это свойство семантики, а не дефект.
- **Распределение влияния 1946:** 300 связей, медиана 30, верх 95–98; выше 70 —
  95 связей, из них не-вассальных 24.

## Decision log

Совпадает с разделом «Alternatives and selected decision»; подробности с
причинами — `docs/DECISIONS.md`, запись 2026-07-29 «Структурные глаголы».

## Validation

```text
server: npx tsc --noEmit -p tsconfig.json            → чисто
server: npm test                                     → 1207 passed | 1 skipped (72 файла)
client: npx tsc --noEmit -p tsconfig.app.json        → чисто
client: npm test                                     → 143 passed (16 файлов)
client: npm run build                                → built
root:   python scripts/map/validate_demographics_1946.py → OK
root:   python .agent/evals/public/run_public_evals.py   → 159 passed, 0 failed
```

Baseline был server 1161 passed | 1 skipped, client 143 passed. Прирост
серверных тестов — 46 новых (структурные глаголы, сценарии палитры, негативные
контроли). Предсуществующие: клиентский `npm run lint` — 20 ошибок и 1 warning
(P4 в `docs/TODO.md`), не трогался.

## Rollback / containment

Работа изолирована в ветке `claude/structural-verbs`, три коммита. Откат —
отказ от ветки либо `git revert` конкретного коммита. Формат сейва не менялся,
данные сценария не правились.

## Final outcome

**Сделано:** `puppet`, `annex`, `merge_countries`, `create_country`; инвариант
согласованности подчинения стал рантайм-проверяемым; закрыт предсуществующий
дефект палитры раскола; ядро отделения вынесено из `splitCountry` и
переиспользовано; правило исключения сторожа выражено свойством класса.

**Не сделано и куда занесено:**

- `stage_coup`/`hold_election` — не начаты; остаются в спецификации §2 как
  нереализованные;
- семейство `form_bloc`/`join_bloc`/`leave_bloc` — НЕ начато намеренно по
  заданию: сущности «блок» в состоянии не существует;
- след «здесь сменился флаг» в истории места, отсутствие смежности у
  `create_country`, отсутствие обратного глагола к `puppet`, эмпирическая
  проверка порога `VASSALAGE_MIN_HELD_SHARE` — все четыре в `docs/TODO.md`.
