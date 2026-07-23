# P0: игровой цикл, runtime карты и desktop-компоновка
Status: complete
Owner: Codex /root
Starting commit: a7c3142

## Objective and observable outcome

На 1366x768 игрок видит положение страны, цели и результат последнего хода,
понимает состояние LLM-гейта, не теряет окна за экраном; карта показывает
подписи стран и переживает массовую смену владельцев без ErrorBoundary reset.

## Scope and constraints

- Client: briefing/turn feedback, Header gate, MapView/GeometryEngine, Window/useWindows,
  desktop layout, RU/EN localization and focused tests.
- Shared/server: только минимальный сериализуемый `lastTurnReport`, формируемый
  детерминированно вокруг существующего месячного тика; порядок тиков не менять.
- Обновить канонические UI/architecture/objectives/map решения и живой TODO.
- Не менять полигоны, topology builder, save version, resource duplication/P1,
  визуальную философию HUD или незавершённый onboarding slice.
- Dirty state на старте принадлежит пользователю: изменены GameView/Header/
  OrdersBox/icons/i18n/docs и добавлен Onboarding. Патчи P0 сохраняют эти изменения.

## Assumptions and unknowns

- Целевой минимум — desktop 1366x768; мобильный layout не является acceptance gate.
- `lastTurnReport` хранит только последний bounded report, поэтому не создаёт
  неограниченную историю и не заменяет `eventHistory`.
- Browser QA выполнен на реальном headless Edge; отдельный mobile layout и
  миграция игровых названий в `LocalizedText` остаются вне P0.

## Alternatives and selected decision

- Выбрано: детерминированный diff ключевых показателей до/после хода в GameService.
  Отклонено: LLM-summary и event sourcing — недетерминированы/избыточны.
- Выбрано: исправить spread-overflow и lifecycle слоя подписей. Отклонено:
  геометрический rewrite — не нужен для подтверждённых runtime-дефектов.
- Выбрано: clamp окон при открытии/resize viewport и единые CSS width tokens.
  Отклонено: динамическая auto-width — вызывает layout jitter.

## Progress

- [x] Установить starting commit, dirty state и применимые инструкции.
- [x] Записать baseline targeted/full checks.
- [x] Добавить bounded lastTurnReport, briefing и честный LLM-gate UI.
- [x] Исправить country labels, bulk ownership regression и resize MapLibre.
- [x] Исправить window clamp/reset и контракт 1366x768.
- [x] Обновить локализации и канонические документы.
- [x] Прогнать targeted, client/server/shared matrix; просмотреть diff/status.

## Discoveries

- `playerStanding` и типизированные `Country.goals` уже есть в GameState, но UI
  их не показывает.
- `computeCountryAxis` использует spread в `Math.max/min` на полном массиве
  координат; это объясняет RangeError при массовом ownership update.
- country-label effect не зависит от готовности style (`loaded`) и задаёт
  `text-font: EB Garamond` при CARTO glyph endpoint.
- Window CSS min-width 260px расходится с resize minimum 220px; сохранённые
  позиции не нормализуются при повторном открытии и изменении viewport.
- Browser QA нашёл два дополнительных runtime-факта: MapLibre отвергал nested
  `zoom` expression в `text-size`, а hook clamp считал y от viewport, хотя
  окно позиционируется от `map-container`. Оба исправлены и перепроверены.

## Decision log

- 2026-07-16: пользователь подтвердил выполнять весь P0 одной итерацией.
- 2026-07-16: P1 (единый HUD, четыре ресурса, удаление мостика, auto-height)
  намеренно не включён, кроме необходимого отображения состояния гейта.

## Validation

- Baseline и итог: client GeometryEngine/useWindows/новые component tests,
  server GameService tests, затем client `tsc`, `test`, `lint`, `build` и
  server `tsc`, `test`.
- Browser QA: 1366x768 и 1920x1080, RU/EN; labels, bulk ownership, короткий/
  длинный briefing, ready/waiting/loading gate, окна после viewport shrink.
- Map data validators не требуются: scenario geometry не меняется.

## Rollback / containment

- Откат возможен отдельными собственными патчами: shared/report + server,
  briefing/Header, GeometryEngine/MapView, Window/useWindows/layout, docs.
- Не применять reset/checkout; onboarding и иные стартовые изменения сохранить.

## Final outcome

P0 реализован. `lastTurnReport`/briefing/gate дают обратную связь хода; country
labels создаются после style load, работают без CDN и не падают на 150 000
точек; окна нормализуются по реальному родителю и имеют reset. Browser QA:
1366×768 RU и 1920×1080 EN, overflow 0/0, 945/1271 rendered label glyphs,
ErrorBoundary/MapLibre errors отсутствуют. Client 102 tests, server 680 passed
(1 skipped), оба typecheck, build и 121 public eval прошли. Full lint сохранил
ровно baseline 20 ошибок без новых diagnostics. Вне P0: `html lang` в RU,
локализация игровых названий и P1 Header/resources/auto-height.
