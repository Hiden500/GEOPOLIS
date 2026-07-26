# Legacy cleanup — удаление мёртвого кода (страны-сироты, сценарии-заглушки 1836/2000, пустой RegionLayer.tsx)

Status: complete
Owner: Claude (worktree `legacy-cleanup`)
Starting commit: 43d05a4 (main)

## Objective and observable outcome

Удалить согласованный пользователем набор мёртвого кода без изменения
поведения сценария 1946: 9 неимпортируемых файлов стран, сценарии-заглушки
`Scenario1836.ts`/`Scenario2000.ts` вместе с их эксклюзивными
зависимостями, мёртвый `regions-v2.json` (если реально удалим — см.
Discoveries), пустой `client/src/map/RegionLayer.tsx`. Наблюдаемый
результат: `tsc --noEmit`/`npm test`/`npm run build` (client) зелёные (или
с тем же предсуществующим failure, что и на main), `/scenarios/list`
отдаёт только `"1946"`, diff не содержит правок в `Scenario1946.ts` и
`scripts/map/**`.

## Scope and constraints

**В скоупе (правки):**
- Удаление 9 файлов `server/src/data/countries/{China,France,Germany,
  GermanyFRA,GermanyUK,GermanyUSA,GermanyUSSR,Italy,Taiwan}.ts`.
- Удаление `server/src/scenarios/{Scenario1836,Scenario2000}.ts` +
  эксклюзивных зависимостей `server/src/data/countries/{USSR,USA,
  UnitedKingdom}.ts` и `server/src/data/testRegion.ts`.
- Правка `server/src/scenarios/ScenarioRegistry.ts` (снять записи
  `"1836"`/`"2000"`).
- Удаление `client/src/map/RegionLayer.tsx` (0 байт) — точечное исключение
  из заморозки `client/src/map/**` для этой задачи, санкционировано
  пользователем в постановке.
- Документация: `docs/DECISIONS.md` (новая запись), `docs/SCENARIOS.md`,
  `docs/TODO.md` (3 точечных правки), `docs/plans/07_SCENARIO_1836.md`
  (статус-строка), `docs/plans/11_MVP_ROADMAP.md` (снять устаревший пункт
  license_page.html).

**Вне скоупа (сознательно не трогаю):**
- `server/data/scenarios/1946/regions-v2.json` — см. Discoveries, не
  удалено, требует действия вне агента.
- `server/src/data/countries/templates/CreateCountry.ts` — живой, использует Scenario1946.
- `server/src/scenarios/Scenario1946.ts` — параллельная сессия может его
  править (по постановке задачи); не редактировал.
- `shared/src/data/eras.ts` (`ERAS`) — справочник эпох остаётся.
- `scripts/map/**`, `server/src/scenarios/generateMapFeatures.ts`,
  `server/data/scenarios/1946/countries.json` — владеет параллельная задача
  `capital-region-invariant` (см. `git worktree list`).
- `docs/decisions/**`, `.agent/plans/design-partner-audit.md`,
  `.agent/plans/1946-country-borders.md`, `docs/plans/05_DATA_LAYOUT.md` —
  архив/завершённые планы, содержат исторические упоминания удаляемых
  файлов; не переписываю историю.
- `docs/HISTORICAL_ACCURACY.md` — упоминания 1836/2000/1914/1936/1991 там
  чисто иллюстративные примеры общего принципа, не заявление о текущей
  реализации; не требуют правки.
- Мёртвые поля/вычисления (`governmentType`, `weightedStability`, no-op
  `annex`/`puppet`) — отдельная задача по постановке.

**Известные параллельные задачи (`git worktree list` на старте):**
`capital-region-fix`, `capital-region-invariant`, `design-partner-audit`,
`milestone-0-core`, `strategy-game-ui-design-*`, plus Codex worktrees
(`design-review`, interface-from-scratch visualizations). Пересечение
области: ни одна не касается `server/src/data/countries/*`,
`server/src/scenarios/{Scenario1836,Scenario2000,ScenarioRegistry}.ts`,
`server/src/data/testRegion.ts` или `client/src/map/RegionLayer.tsx` (по
именам веток/задач в постановке). `capital-region-invariant` владеет
`countries.json`/`generateMapFeatures.ts`/`scripts/map/**` — не пересекается
с этим списком.

## Assumptions and unknowns

- Предположение задачи «старые сейвы со scenarioId 1836/2000 перестанут
  открываться» — проверено и НЕ подтвердилось: `GameState`/`SaveFile` не
  хранят `scenarioId` вообще (см. Discoveries). Не считаю это расхождением
  постановки — просто уточняю факт в отчёте.
- UNKNOWN: физическое существование/судьба `server/data/scenarios/1946/
  regions-v2.json` в основном checkout остаётся на усмотрение
  пользователя — агент не может и не должен трогать основной checkout.

## Alternatives and selected decision

Рассматривал: (а) удалить `regions-v2.json` прямо в основном checkout,
раз он там физически лежит — отклонено: прямое нарушение
worktree-протокола AGENTS.md («основной checkout не редактировать»),
независимо от того, что hook технически не блокирует безфлаговый `rm` по
абсолютному пути вне worktree; (б) промолчать про находку — отклонено,
скрывает реальный незакрытый пункт задачи; (в) зафиксировать находку в
DECISIONS + ExecPlan + финальном отчёте, ничего не удалять — выбрано.

## Progress
- [x] Прочитаны `AGENTS.md`, `server/AGENTS.md`, `scripts/hooks/guard.mjs`.
- [x] `git worktree list`/`git branch -a` — параллельные задачи учтены выше.
- [x] Grep-доказательство отсутствия ссылок для всех 16 файлов (включая
      false-positive `testRegion`/`createTestRegion` разобран отдельно).
- [x] Удалены 9 файлов стран-сирот (`git rm`).
- [x] Удалены `Scenario1836.ts`/`Scenario2000.ts` + эксклюзивные
      зависимости (`USSR.ts`/`USA.ts`/`UnitedKingdom.ts`/`testRegion.ts`).
- [x] `ScenarioRegistry.ts` — только `"1946"`.
- [x] Удалён `client/src/map/RegionLayer.tsx`.
- [x] `regions-v2.json` — НЕ найден в worktree, установлена причина
      (untracked/gitignored артефакт только в основном checkout).
- [x] Побочные эффекты проверены: роут `/scenarios/list`, клиентский
      `ScenarioSelector.tsx`, `routes.integration.test.ts` — все строят
      список динамически/не завязаны на count==3, правок не потребовалось.
- [x] Документация: DECISIONS/SCENARIOS/TODO/07_SCENARIO_1836/11_MVP_ROADMAP.
- [x] Доп. правка по сообщению координатора (параллельная задача doc-гигиены
      нашла устаревшие числа в уже закреплённом за мной `docs/SCENARIOS.md`):
      проверено прямым подсчётом по `countries.json`/`regions.core.json`/
      `regions.state.json`/`names.{en,ru}.json` — факт 157 стран (не 199),
      1399 регионов (не 1367), локализация `ru` полная 157/157 (не 105/199).
      Исправлено в `docs/SCENARIOS.md` (таблица статуса 1946) и попутно
      `docs/TODO.md:64` (128→157, та же природа расхождения).
- [x] `npm ci` (server, client) — node_modules отсутствовали в свежем
      worktree.
- [x] Проверки запущены (см. Validation).
- [x] Локальный коммит.

## Discoveries

1. **`testRegion` grep false-positive.** `server/src/test-utils/fixtures.ts`
   экспортирует несвязанный `createTestRegion()` (factory для unit-тестов,
   строит `Region` с нуля из `@shared/types`, не импортирует
   `data/testRegion.ts`). 20+ тестовых файлов используют именно его.
   Единственные реальные импортёры `testRegions` (plural, из
   `server/src/data/testRegion.ts`) — `Scenario1836.ts`/`Scenario2000.ts`.
   Подтверждено чтением `fixtures.ts` (импорты только из `@shared/types/*`)
   и построчным сравнением всех 24 файлов из grep-выдачи.
2. **`regions-v2.json` не существует в git вообще.** `git log --all
   --oneline --diff-filter=A -- '*regions-v2*'` — пусто. `.gitignore`
   (`/server/data/scenarios/1946/*` + white-list 5 файлов) не включает его.
   `git ls-files -- server/data/scenarios/1946/` подтверждает те же 5
   файлов. Физически файл лежит только в основном checkout
   (`D:/Pax Historia LOCAL/server/data/scenarios/1946/regions-v2.json`,
   1 272 753 байт, mtime 18 июня — старее остальных файлов каталога на
   ~5 недель, похоже на артефакт пайплайна до перехода на
   `regions.core.json`/`regions.state.json`). Задача описывала его как
   обычный удаляемый файл — на деле это untracked leftover, недоступный
   агенту без нарушения worktree-протокола.
3. **Сейвы не хранят `scenarioId`.** `shared/src/types/GameState.ts` и
   `SaveFile.ts` — поля нет; `createGame()` резолвит сценарий один раз при
   создании партии и копирует данные (`structuredClone`) в `GameState`,
   дальше `ScenarioRegistry` не участвует. `loadGame()` сверяет только
   `SAVE_VERSION`. Значит удаление записей реестра не ломает загрузку уже
   существующих сейвов — только создание НОВОЙ партии с `scenarioId:
   "1836"/"2000"`, что и раньше (без изменений в этой задаче) отдавало
   честную `400 "Invalid scenario ID"` (`server/src/routes/game.ts:21-23`).
4. Свежесозданный linked worktree не содержит `node_modules` (не
   расшаривается между worktree) — потребовался `npm ci` в `server/` и
   `client/` перед любыми проверками.

## Decision log

- 2026-07-26: удаляю 9 стран-сирот + 2 сценария-заглушки + 3
  эксклюзивные страны + testRegion.ts + пустой RegionLayer.tsx —
  все доказаны grep'ом как неиспользуемые. `regions-v2.json` не удаляю —
  физически недоступен в worktree, трогать основной checkout запрещено.
  Причина и альтернативы — выше.

## Validation

См. финальный отчёт агента (текстовый ответ) — там фактический вывод команд
и разделение pre-existing/regression. Кратко: `server: tsc --noEmit`,
`server: npm test`, `client: tsc --noEmit -p tsconfig.app.json`,
`client: npm test`, `client: npm run build`,
`root: python scripts/map/validate_region_economy_1946.py`.

## Rollback / containment

Все правки — в одном локальном коммите (`eed1ddb`) на ветке
`claude/legacy-cleanup` внутри собственного worktree; `git revert eed1ddb`
в этом worktree восстанавливает все 16 файлов и правки документации.
`regions-v2.json` не затронут (не было изменений, откатывать нечего).
Основной checkout и другие worktree не задеты.

## Final outcome

16 файлов удалено, `ScenarioRegistry.ts` сведён к одной записи `"1946"`,
7 документов обновлено под факт (5 из исходного скоупа задачи +
`docs/SCENARIOS.md`/`docs/TODO.md` также по числам датасета 1946 —
запрос параллельной doc-гигиены задачи, проверено прямым подсчётом).
Локальный коммит `eed1ddb`, ветка `claude/legacy-cleanup`, не влито в
`main`. `regions-v2.json` — не удалён, см. Discoveries #2 и итоговый
отчёт агента (нужно ручное действие пользователя в основном checkout).
Все обязательные проверки (`server`/`client` tsc, `npm test` ×2,
`client` build, python-валидатор 1946) зелёные; проверки и baseline —
в финальном отчёте агента, не дублируются здесь.
