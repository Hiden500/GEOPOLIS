# Чистка машинно-шумовых микрочастиц морей (найдено пользователем после записи -p)

Status: complete
Owner: Claude (this session)
Starting commit: `9120e61` (проверка сирот + Мальта) on
`codex/1946-country-borders`

## Objective and observable outcome

Пользователь опроверг мою предыдущую диагностику ("0 сиротских
кластеров"): "Не правда, остались некоторые 'сироты'. Ionian Sea, Inner
Seas off the West Coast of Scotland, Norwegian Sea, например. Это из того
что я нашел, скорее всего еще есть."

Observable outcome: у указанных (и всех остальных) морей не остаётся
частей площадью меньше настоящей маленькой прибрежной фичи.

## Scope and constraints

In scope: `fix_sea_coastline_gaps.py` (`to_polygonal()`/
`cleanup_scattered_fragments()`).

Out of scope: суша (не трогалась).

## Progress

- [x] 1. Прямая проверка Ionian Sea/Inner Seas off the West Coast of
      Scotland/Norwegian Sea — найдены десятки частей площадью
      1e-18..1e-6 deg2 (машинный шум от повторных union/intersection/
      buffer(0), не гео-фичи).
- [x] 2. Найдена причина, почему предыдущий diagnostic это пропустил:
      проверка легитимности применялась к КЛАСТЕРУ целиком — шумовая
      частица рядом с настоящим маленьким островом наследовала
      легитимность кластера через соседа.
- [x] 3. Добавлен `DEGENERATE_AREA_DEG2 = 1e-4` — применяется в
      `to_polygonal()` (на каждом union/intersection во всём файле, не
      только в разовой чистке).
- [x] 4. Прогон на всех 113 морях — убрано 942 шумовых частицы.
- [x] 5. Проверка распределения площадей всех оставшихся частей — чистый
      разрыв ровно на пороге, ничего легитимного не отрезано.
- [x] 6. Верификация: 3 указанных моря + рендеры + полный пайплайн + тесты.
- [x] 7. Документация: `docs/DECISIONS.md` (2026-07-19-q), skill, README
      (пункт 39), этот ExecPlan.
- [x] 8. Коммит.

## Validation

Ionian Sea/Inner Seas off the West Coast of Scotland/Norwegian Sea — все
части >= 0.32 км² (реальные острова/проливы); рендеры всех трёх — чистые;
`merge_world_1946.py` — 89 пересечений (тот же известный/отложенный
набор); `test_country_entities_1946.py` 12/12, `test_validate_region_
economy_1946.py` 9/9, `validate_region_economy_1946.py` — мировое
население/Китай в допуске, 43 известных отложенных capitalRegionId;
server+client `tsc --noEmit` чисты; server vitest 680+1skip; живой
`/game/start` — 1388 регионов (не изменилось).

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита.

## Final outcome

Все 8 пунктов Progress выполнены. Изменено: `fix_sea_coastline_gaps.py`
(`DEGENERATE_AREA_DEG2` + фильтр в `to_polygonal()`), документация.

Baseline failures: без изменений (43 capitalRegionId, известное).

Introduced failures: 0.

Unresolved risks: порог 1e-4 deg2 — эмпирический, основан на наблюдаемом
разрыве в распределении площадей ЭТОГО датасета; если в будущем появится
легитимная фича меньше ~0.32 км², порог может её случайно отбросить —
стоит перепроверить гистограммой при следующей правке морей.

Fresh-session requirements: нет.
