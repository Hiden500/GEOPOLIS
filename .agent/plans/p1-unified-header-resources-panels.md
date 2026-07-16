# P1 — единый Header, стратегические ресурсы и auto-height панелей

Status: complete
Date: 2026-07-16
Owner: Codex

## Goal

Убрать визуальную фрагментацию верхнего HUD и дублирование запасов, удалить
нижний полноширинный «мостик» и сделать постоянные информационные панели
компактными при коротком содержимом без потери scroll-контракта на 1366×768.

## Scope and constraints

- `Header` остаётся двухуровневым плотным HUD, но получает одну поверхность,
  единый border/shadow и непрерывную иерархию вместо отдельных островов.
- В Header всегда показываются четыре стабильных стратегических запаса:
  `oil`, `coal`, `iron`, `food`, включая нулевое значение; полный список
  остаётся доступен в профильных экономических интерфейсах.
- Нижний `ResourceTicker` удаляется из композиции и кода; его локализованные
  имена переиспользуются в tooltip верхних ресурсов.
- `SidePanel` и `ContextPanel` получают auto-height до viewport max-height;
  длинное содержимое скроллится внутри. `OrdersBox` уже content-sized.
- Auto-width не вводится. Плавающие `Window` сохраняют пользовательский размер
  и persistence; автоматический resize разрушил бы предсказуемый workspace.
- Целевой минимум остаётся 1366×768, mobile не является acceptance gate.

## Progress

- [x] Проверить чистый post-P0 baseline и актуальные UI-правила.
- [x] Реализовать единую поверхность Header и четыре ресурса.
- [x] Удалить нижний ticker/мостик и мёртвые стили.
- [x] Реализовать auto-height постоянных панелей.
- [x] Добавить targeted tests и синхронизировать UI docs/решения.
- [x] Выполнить client matrix, public eval, browser QA и review diff.

## Validation

- Targeted Header/component tests.
- `client`: typecheck, full tests, lint с сопоставлением baseline 20, build.
- Docs/plan: public agent eval.
- Browser QA: RU 1366×768, EN 1920×1080; overflow, Header continuity,
  четыре ресурса, отсутствие нижнего ticker, short/long panel height.

## Decision log

- 2026-07-16: фиксированный набор стратегических ресурсов выбран вместо
  динамического top-4, чтобы позиции и видимость дефицитов не менялись по ходу.
- 2026-07-16: дополнительные ненулевые запасы остаются доступны через `+N`;
  сокращение постоянного ряда не должно превращаться в потерю информации.
- 2026-07-16: auto-height ограничен постоянными панелями; auto-width и
  content-driven resize пользовательских окон отклонены из-за layout jitter.

## Outcome

P1 реализован. Header объединён в полосу высотой 95 px; постоянный ряд содержит
ровно четыре стратегических ресурса, остальные ненулевые доступны через `+N`,
нижний ticker удалён. Короткий SidePanel занимает 190/674 px карты, контекст
страны 405/674 px. Browser QA: RU 1366×768 и EN 1920×1080, overflow 0/0,
ErrorBoundary отсутствует. Client typecheck, targeted lint, 103 tests, build и
public eval 121/121 прошли. Full lint сохранил ровно baseline 20 ошибок в
PlayerIntentPanel и трёх map-файлах, новых diagnostics нет.
