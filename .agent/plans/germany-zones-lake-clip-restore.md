# Восстановление немецких оккупационных зон + клип Ладоги/Байкала

Status: complete
Owner: Claude (this session)
Starting commit: `a6f74ea` (America/Panama/Mediterranean/Puerto-Rico fix,
запись 2026-07-19-k) on `codex/1946-country-borders`

## Objective and observable outcome

Пользователь опроверг две мои более ранние диагностики: "По поводу Ладоги
и Байкала не прав. В прошлой итерации они были вырезаны. Также был
поделенный Берлие, и Кильский канал. ИЩИ где косяк". Цель: найти реальный
корень обеих регрессий (не "исторический факт", как я ошибочно заключил
дважды), восстановить оба, верифицировать живыми данными.

Observable outcome: `/game/start` показывает все 7 немецких зон (4 сектора
Берлина + Kiel Canal Zone + 2 южные зоны) с корректным владением/
населением; Buryat/Karelian/Irkutsk/Leningrad Oblast больше не
перекрывают Байкал/Ладогу.

## Scope and constraints

In scope: `scripts/map/build/build_europe_1946.py` (2 новые функции),
`scripts/map/sources/germany_occupation_zones_1946.json` (новый постоянный
источник), каскад `region_id` для `EUR-`, позиционные файлы
(`names_ru.json`, `ownership_1946.json`, `occupation_overlay.json`),
исправление неверных утверждений в `docs/DECISIONS.md` (записи -h, -k),
`.claude/skills/map-geometry-qa/SKILL.md`, `scripts/map/README.md`.

Out of scope: дальнейшее разбиение регионов (не запрошено), другие
континенты (проверены, не затронуты).

## Assumptions and unknowns

- Владение/контроллёр 7 зон восстановлены из `bdb8f74^` (последний коммит
  перед ПЕРВЫМ схлопыванием, не текущей сессии) — предполагается, что это
  корректная историческая точка данных; не подтверждено пользователем
  построчно.
- Русские переводы имён зон — уже существовавшие в `names_ru.json` до
  первого схлопывания (не новый перевод), взяты как есть.

## Alternatives and selected decision

Рассмотрено: пересобрать зоны Германии с нуля вручную (как Австрию).
Отклонено — геометрия уже существовала в git-истории (`64af2bf`), извлечь
её напрямую быстрее и точнее, чем реконструировать. Тот же приём, что уже
использован для North America в записи -k.

## Progress

- [x] 1. Найден реальный корень немецких зон: `git show 64af2bf:client/
      public/world_1946.geojson` — все 7 зон на месте на старте сессии;
      моя же ранняя правка `build_europe_1946.py` (записи -e/-f/-g) их
      схлопнула, а я ошибочно продиагностировал это как "не эта сессия"
      (запись -h), сравнивая с САМЫМ ПЕРВЫМ коммитом (`146933a`) вместо
      последнего перед сессией.
- [x] 2. Найден реальный корень Ладоги/Байкала: та же правка уничтожила
      клип озёр из `out/europe_1946.geojson`; численно подтверждено
      наложение 20013.8/8572.6/11536.4/9093.0 км² (Buryat/Karelian/
      Irkutsk/Leningrad).
- [x] 3. Восстановлена геометрия 7 зон → новый постоянный источник
      `scripts/map/sources/germany_occupation_zones_1946.json`.
- [x] 4. `build_europe_1946.py::restore_german_occupation_zones()` — новая
      функция, клипает наложившихся соседей.
- [x] 5. `build_europe_1946.py::clip_land_against_lakes()` — новая функция,
      `CLIP_LAKE_NAMES_EUROPE = {"Ладога", "Байкал"}`.
- [x] 6. Владение/контроллёр восстановлены из `bdb8f74^`, включая прямой
      `occupation_overlay.json` код для Kiel Canal Zone (без записи в
      ownership, как остальные "зоны без правительства").
- [x] 7. Каскад `region_id` (`--prefix EUR-`, снимок `a6f74ea`) + вручную
      добавлены 9 записей `names_ru.json` (7 зон + 2 попутных пробела:
      Brandenburg, Midtjylland) + 7 записей ownership/overlay.
- [x] 8. Процессная ошибка поймана и исправлена: `generate_country_
      registry.py`/`fill_region_economy_1946.py` запущены ДО повторного
      `import_to_game.py` — 6 ложных dangling-neighbor; исправлено
      правильным порядком пересборки.
- [x] 9. Верификация: numeric scan (0 наложений с озёрами), живой
      `/game/start` (все 7 зон, владение резолвится в QGS/QGA/QGB/QGF),
      12/12 + 9/9 юнит-тестов, server+client `tsc --noEmit`, server vitest
      680+1skip.
- [x] 10. Исправлены неверные утверждения в `docs/DECISIONS.md` (записи
      -h, -k), `map-geometry-qa/SKILL.md`, `scripts/map/README.md` — обе
      были ошибочно списаны на "исторический факт"/"фоновый шум".
- [x] 11. Коммит.

## Discoveries

См. `docs/DECISIONS.md` запись 2026-07-19-l — полная запись обеих
неверных диагностик и их исправления, не дублирую здесь.

## Decision log

- Kiel Canal Zone получает владение напрямую через `occupation_overlay.json`
  (без записи в `ownership_1946.json`) — та же схема, что у Гуантанамо/
  Панамы/Ливии ("зона без собственного правительства").
- Снимок для `--prefix EUR-` remap — `a6f74ea` (коммит непосредственно
  перед этой правкой), НЕ `146933a` — урок записи -h применён здесь же.

## Validation

Численный скан 0 наложений (Buryat/Karelian/Irkutsk/Leningrad Oblast vs
Ладога/Байкал, было 20013.8/8572.6/11536.4/9093.0 км²), живой
`/game/start` (7 зон присутствуют, `regions.state.json` id 368-374,
владение QGS/QGA/QGB/QGF, все страны есть в `countries.json`,
population/en/ru заполнены), `test_country_entities_1946.py` 12/12,
`test_validate_region_economy_1946.py` 9/9, `validate_region_economy_
1946.py` — только известная отложенная capitalRegionId-категория, server+
client `tsc --noEmit` чисты, server vitest 680+1skip.

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита.

## Final outcome

Все 11 пунктов Progress выполнены. Изменено: `build_europe_1946.py` (2
новые функции), новый постоянный источник `germany_occupation_zones_
1946.json`, ~16 позиционных записей (names_ru/ownership/occupation_
overlay), исправления в `docs/DECISIONS.md`/`map-geometry-qa/SKILL.md`/
`scripts/map/README.md`.

Baseline failures: `validate_region_economy_1946.py` — известная
отложенная категория `capitalRegionId` (не новая проблема).

Introduced failures: 0 (после верификации всех 4 континентов Европа/Азия/
Северная Америка не тронуты вне scope, живой `/game/start` подтверждён).

Unresolved risks: русские переводы 7 зон/2 попутных пробелов не вычитаны
профессиональным переводчиком (взяты из уже существовавшего до первого
схлопывания `names_ru.json`).

Fresh-session requirements: нет.
