# Дыры-острова в морях/озёрах (95 из 115) + разрыв Циндао/Шаньдун

Status: complete (partial scope — 20 дыр без источника и Great Lakes
coastline gap намеренно вынесены за рамки, см. Final outcome)
Owner: Claude (this session)
Starting commit: `0101b28` (пакет B: Китай/Тайвань) on `codex/1946-country-borders`

## Objective and observable outcome

Пользователь попросил QA-рендер (Далянь/Циндао/Филиппины/Океания по
частям/ПНГ) + приложил скриншот белого клина на фоне моря ("похоже,
осталось с оригинального файла морей"). Рендеры нашли: (1) подтверждение
скриншота — острова-дыры в полигонах морей без покрывающей суши, системный
класс по всему миру; (2) новый, не связанный с сегодняшним пакетом B,
разрыв суша↔море у Циндао/Shandong.

Observable outcome: `diagnose_sea_holes.py` — 0 дыр с сырым источником
остаётся непокрытыми (95/95 закрыто); разрыв Циндао/Shandong закрыт;
полный пайплайн/тесты/tsc/vitest/живой `/game/start` без регрессий
относительно baseline пакета B.

## Scope and constraints

In scope: новый `diagnose_sea_holes.py` (перманентный диагностический
инструмент), новый `fill_sea_holes.py` (заливка 95 дыр с сырым источником),
`fix_china_geometry.py` (`MANUAL_GAP_PATCHES` для Циндао/Shandong),
точечная починка наложения Washington San Juan/Adams (побочный эффект
заливки).

Out of scope (осознанно, найдено но НЕ чинилось в этом заходе): 20 дыр БЕЗ
сырого источника (нужен синтез суши + решение пользователя по владельцу —
отдельный список); ~2086 км² разрывов суша↔озеро по периметру всех 4
Великих озёр (найдено при верификации Isle Royale, вероятно побочный
эффект более раннего `refresh_lakes_from_ne10m.py`, объёмная отдельная
задача).

## Progress

- [x] 1. Рендеры по запросу: Далянь/Циндао (чисто из пакета B, но Циндао —
      найден НОВЫЙ разрыв), Филиппины Север/Центр/Юг (архипелаги в целом
      норм, найдены 3 дыры у Батанес/Бабуян — тот же класс, что и общий
      скан), Океания Австралия/Меланезия (чисто) + Микронезия/Полинезия
      (нашлись дыры, включая скриншот пользователя), ПНГ (чисто).
- [x] 2. `diagnose_sea_holes.py` — перманентный скан: 115 реальных дыр,
      95 совпали с сырым источником (>30% площади), 20 — без источника.
- [x] 3. `fill_sea_holes.py` — заливка 95 дыр геометрией самой дыры (не
      сырой фичи) в ближайшую существующую выходную фичу того же iso_a2
      (NAM для US/CA/GL, EUR для RU). Число регионов не изменилось нигде
      — `remap_region_ids.py` не потребовался. Найдена и исправлена
      архитектурная ошибка первой версии: патчила гитигнорённый `client/
      public/world_1946.geojson`/уже собранные continent-файлы напрямую —
      тихо терялось бы при следующей пересборке континента по любой
      причине. Переписано на continent-файлы + добавлено в `FULL_REBUILD_
      STEPS` (после `fix_sea_coastline_gaps.py`, до `merge_world_1946.py`).
- [x] 4. Побочная находка и починка: наложение Washington — San Juan /
      Washington — Adams (0.002°, merge_world 98→99) — `A.difference(B)`
      в пользу San Juan, вернулось к 98.
- [x] 5. Циндао/Shandong: точечный `gap = bbox.difference(вся_суша∪вся_
      вода)`, применено напрямую + встроено в `fix_china_geometry.py` как
      `MANUAL_GAP_PATCHES` (идемпотентно). Проверка всего периметра Китая
      (bbox 68-136°E/15-55°N с полным context) — это единственный такой
      разрыв, не системный паттерн.
- [x] 6. Полная пересборка: `build_asia_1946.py` (подхватить фикс Китая) →
      `merge_world_1946.py` → `build_neighbor_graph.py` → `translate_
      world.py` → `import_to_game.py` → `generate_country_registry.py` →
      `fill_region_economy_1946.py`.
- [x] 7. Верификация: `diagnose_sea_holes.py` (0/95 совпавших остаются),
      `diagnose_missing_land.py` (без новых пропаж), `merge_world_1946.py`
      (98, как до находки), `validate_region_economy_1946.py` (46
      известных, не изменилось), рендеры Isle Royale/Аляска/Циндао
      (визуально подтверждено закрытие — Isle Royale заодно вскрыл Great
      Lakes coastline находку, см. Discoveries), оба теста (12/12, 9/9),
      tsc (server+client), vitest (680+1skip), живой `/game/start` (свежий
      процесс, `netstat` подтверждён) — 1399 регионов, 157 стран.
- [x] 8. Документация: `docs/DECISIONS.md`, skill (5 новых уроков), README
      (пункты 56-59), этот ExecPlan.
- [ ] 9. Коммит (следующий шаг после записи этого файла).

## Discoveries

См. `docs/DECISIONS.md` запись "2026-07-23 — острова-«дыры»..." — полные
числа и разбивка по странам/озёрам. Ключевое: `diagnose_missing_land.py` и
`diagnose_sea_holes.py` — взаимно НЕ перекрывающиеся диагностики (первая
по ADM1-записям, вторая чисто геометрическая) — нужны ОБЕ, ни одна не
покрывает класс другой.

## Decision log

- Заливка дыры её собственной геометрией, не сырой фичи — гарантирует
  бесшовный стык с морем по построению.
- Слияние по "ближайшая фича того же iso_a2" (не по имени/коду страны/
  штата) — практичный компромисс, учитывая что многие штаты (Alaska) сами
  представлены geometric-кластерами без честного county-соответствия.
- 20 дыр без источника и Great Lakes coastline gap — осознанно НЕ чинились
  в этом заходе: первое требует решения пользователя по владельцу
  (синтетическая суша без исторических данных), второе — объёмная
  отдельная задача (весь периметр 4 озёр), обе вне разумного размера
  "точечного продолжения" сессии.

## Validation

`diagnose_sea_holes.py` — 95/95 совпавших с источником закрыты, 20 без
источника остаются (ожидаемо, отложено). `merge_world_1946.py` — 98
пересечений (равно baseline, включая починку побочного наложения San
Juan/Adams). `validate_region_economy_1946.py` — 46 известных
capitalRegionId. `diagnose_missing_land.py` — без новых пропаж. `test_
country_entities_1946.py` 12/12, `test_validate_region_economy_1946.py`
9/9; server+client `tsc --noEmit` чисты; server vitest 680+1skip; живой
`/game/start` (свежий процесс, PID подтверждён `netstat`) — 1399 регионов,
157 стран, выборочно проверены San Juan/Adams (наложение исчезло) и
Minnesota — Cass (не задета).

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита.

## Final outcome

Пункты 1-8 выполнены (9 — коммит, следующим шагом). Изменено: новые
`diagnose_sea_holes.py`, `fill_sea_holes.py`; `fix_china_geometry.py`
(`MANUAL_GAP_PATCHES`); `scripts/map/out/namerica_1946.geojson`,
`scripts/map/out/europe_1946.geojson` (95 дыр залито + починка San
Juan/Adams), `scripts/map/out/china_1946_historical.json` (Циндао/
Shandong-патч); документация.

Baseline failures: 46 known capitalRegionId, 98 merge_world overlaps —
оба не изменились от пакета B.

Introduced failures: 0 (San Juan/Adams — introduced И исправлено в этом
же заходе, не осталось в финальном состоянии).

Unresolved risks: 20 дыр без сырого источника (список с площадями/
координатами в выводе `diagnose_sea_holes.py`, владелец не определён) и
~2086 км² Great Lakes coastline gap — оба осознанно переданы пользователю
как отдельные находки, не блокируют текущее состояние.

Fresh-session requirements: нет.
