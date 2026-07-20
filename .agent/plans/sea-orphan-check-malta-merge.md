# Проверка "неприсоединённых" фрагментов морей (с учётом островов) + Мальта в 1 регион

Status: complete
Owner: Claude (this session)
Starting commit: `a99b963` (морская приклейка, раунд 2) on
`codex/1946-country-borders`

## Objective and observable outcome

Пользователь: "Не всё исправил. Можно проверить, с учётом островов, что у
полигона есть неприсоединенных участков? Также... Мальту надо объединить
в один полигон."

Observable outcome: подтверждено численно, что после фикса записи -o в
морях не осталось оторванных ("сиротских") фрагментов, если учитывать
настоящие острова как легитимную причину разрозненности; Мальта — один
регион вместо трёх.

## Scope and constraints

In scope: разовый diagnostic-скрипт (не в пайплайне) для проверки морей;
`build_europe_1946.py` (MT в SINGLE_REGION); `translate_world.py`
(переводы для FO/MT).

Out of scope: Комино (не найден как отдельная фича даже в сыром
game_map.json — пред-существующий пробел источника, не поднимался
пользователем).

## Progress

- [x] 1. Diagnostic по всем 113 морям: кластеризация частей по близости +
      "якорный" критерий (>= 1.0 deg2 ИЛИ рядом с реальной сушей < 0.15°)
      — 0 сиротских кластеров найдено.
- [x] 2. Побочная проверка суши (тот же кластерный подход) — все найденные
      мелкие MultiPolygon-хвостики оказались настоящими островами, не
      артефактами.
- [x] 3. Мальта перенесена из `REGION_FIELD` в `SINGLE_REGION`
      (68 муниципалитетов → 1 регион).
- [x] 4. `translate_world.py::TRANSLATE` — добавлены записи для
      "Фарерские острова"/"Мальта" (обе отсутствовали, найдено по "Не
      переведено" count).
- [x] 5. Каскад region_id для `EUR-` (372/375 однозначных, 3 нерезолвлено
      — старые Malta Xlokk/Majjistral/Gozo). Процессная ошибка поймана и
      исправлена: сначала сравнил со СТАРЫМ client/public (урок #27,
      наступил на свои же грабли) — исправлено правильным порядком
      (import_to_game.py перед remap).
- [x] 6. Верификация: рендер Мальты (hole-aware) — чистый единый полигон;
      тесты, tsc, vitest, живой `/game/start`.
- [x] 7. Документация: `docs/DECISIONS.md` (2026-07-19-p), skill, этот
      ExecPlan.
- [x] 8. Коммит.

## Validation

Diagnostic по морям — 0 сиротских кластеров; рендер Мальты — один чистый
полигон; `test_country_entities_1946.py` 12/12, `test_validate_region_
economy_1946.py` 9/9, `validate_region_economy_1946.py` — мировое
население/Китай в допуске, 43 известных отложенных capitalRegionId;
server+client `tsc --noEmit` чисты; server vitest 680+1skip; живой
`/game/start` — Мальта owner=GBR, population=103544, area=314.3 km2.

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита.

## Final outcome

Все 8 пунктов Progress выполнены. Изменено: `build_europe_1946.py` (MT в
SINGLE_REGION), `translate_world.py` (2 новых перевода), позиционные
записи для EUR-0195, документация.

Baseline failures: `validate_region_economy_1946.py` — известная
отложенная capitalRegionId-категория (43, не новая).

Introduced failures: 0.

Unresolved risks: Комино не проверен отдельно (не найден в сыром
источнике, не поднимался пользователем).

Fresh-session requirements: нет.
