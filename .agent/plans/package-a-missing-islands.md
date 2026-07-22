# Пакет A: 11 пропущенных островов + сюрвей разбросанных регионов

Status: complete
Owner: Claude (this session)
Starting commit: `d72736e` (документация находок + diagnose_missing_land.py) on
`codex/1946-country-borders`

## Objective and observable outcome

По итогам `diagnose_missing_land.py` найдено 11 территорий, реально
отсутствующих на карте (суша есть в `game_map.json`, фон на выходе).
Пользователь дал направление: добавить все 11, владелец — по сюзерену 1946
(GBR/FRA/AUS), плюс отдельно проверить (сюрвей, не авто-правка) все острова
на предмет консолидации в "архипелаги".

Observable outcome: `diagnose_missing_land.py` больше не показывает эти 11
как пропажу; полный пайплайн/тесты/tsc/vitest/живой `/game/start` без
регрессий относительно базовой линии.

## Scope and constraints

In scope: `build_asia_1946.py` (Мальдивы), `build_europe_1946.py` (Мэн/
Джерси/Гернси), `build_namerica_1946.py` (Сен-Бартелеми/Сен-Мартен),
`build_oceania_1946.py` (новый `EXTRA_SINGLE_FEATURES` путь + `SINGLE_
ORPHANS` для Кокосовых/Рождества/Кораллового моря/Херд/Французских Южных
территорий), `translate_world.py`, `density_tiers.py`/`fill_region_
economy_1946.py` (тир-баг для новых островов), позиционные файлы
(`ownership_1946.json`/`names_ru.json` для 11 регионов, remap по 4
префиксам).

Out of scope: реформа СУЩЕСТВУЮЩИХ разбросанных регионов (Филиппины и
т.п.) — только сюрвей, решение по каждому за пользователем; Китай/Тайвань
(пакет B).

## Progress

- [x] 1. Добавлены 6 простых островов через `SINGLE_REGION`: MV (asia),
      IM/JE/GG (europe), BL/MF (namerica). Владелец по сюзерену (GBR/FRA).
- [x] 2. Новый `EXTRA_SINGLE_FEATURES` путь в `build_oceania_1946.py`
      (по образцу asia/namerica) для iso="-1" территорий: Кокосовые/
      Рождества/Кораллового моря → AU. `SINGLE_ORPHANS` (уже существовал,
      не требовал новой инфраструктуры) для HM/TF (реальный iso).
- [x] 3. TRANSLATE-пары в `translate_world.py` для всех 11 новых имён.
- [x] 4. `diagnose_scattered_regions.py` — новый сюрвей-скрипт (read-only,
      НЕ шаг пайплайна). 150 регионов с разбросом >0.5° + 7 антимеридиан-
      артефактов (отделены). Отчёт для пользователя, авто-правок нет.
- [x] 5. Снапшот `client/public/world_1946.geojson` → пересборка 4
      континентов (europe/asia/namerica/oceania) → `merge_world` →
      `neighbor_graph` → `translate_world` (0 непереведённых) →
      `test_country_entities` (12/12) → `import_to_game` (1-й раз).
      Обнаружено и исправлено: тестовый прогон `build_namerica_1946.py`
      откатил US county-сплит на 51 штат — восстановлено повторным
      `build_us_states_split_1946.py`+`fill_us_border_gaps.py` (кодировка
      подтверждена чистой).
- [x] 6. `remap_region_ids.py --apply` по 4 префиксам (EUR/ASI/NAM/OCE) —
      0 неоднозначных везде, сдвиги ожидаемы (249/143/213/43).
- [x] 7. Ручные записи `ownership_1946.json`+`names_ru.json` для 11 новых
      region_id (владелец по сюзерену) → повторный `import_to_game` (1399
      регионов) → `generate_country_registry` → `fill_region_economy`.
- [x] 8. Найден и исправлен экономический баг: все 11 островов получили
      абсурдное население (Christmas Island 43,791, French Southern
      Territories 361,180, Heard Island 21,973 — необитаем). Причина:
      GBR/FRA явные классификаторы не знали новых имён → default тир 3;
      AUS классификатора не имела вовсе → `generic_tier`'s "нижние 20%
      площади" поймала все 4 новые крошечные территории. Исправлено:
      явные ветки в `gbr_tier`/`fra_tier`; новый `au_tier` с поддержкой
      `None`-fallback на `generic_tier` (расширение `compute_region_tier`)
      — материковые штаты Австралии не затронуты.
- [x] 9. Верификация: `diagnose_missing_land.py` (0 из 11 в списке пропаж),
      рендеры (Channel Islands/Isle of Man/Maldives — чистые), `merge_
      world` overlap (98, было 86 — объяснимый рост той же категории),
      `validate_region_economy` (46 известных capitalRegionId, было 44),
      оба теста, tsc, vitest.
- [x] 10. Живой `/game/start` — поймал зомби-процесс на порту 3000 (первый
      ответ показал 1388 регионов и перепутанных владельцев); `netstat` +
      `taskkill` по реальному PID + повторный запуск дали верный результат
      (1399 регионов, все 11 островов с верными owner/population).
- [x] 11. Документация: `docs/DECISIONS.md` (пакет A), skill (4 новых
      урока), README (пункты 49-51), этот ExecPlan.
- [x] 12. Коммит.

## Discoveries

См. `docs/DECISIONS.md` запись "2026-07-22 (пакет A)" — экономический баг,
зомби-сервер, EXTRA_SINGLE_FEATURES-паттерн для oceania — все с числами.

## Decision log

- Владелец 11 новых островов — по сюзерену 1946 (прямое решение
  пользователя), не по гипотетической независимости (Мальдивы → GBR, не
  MDV, хотя формально самоуправляемый султанат под брит. протекторатом).
- A2 (сюрвей разбросанных регионов) — сознательно НЕ авто-правка. Реформа
  существующих регионов меняет идентичность/число сотен регионов, высокий
  риск; пользователь явно просил Филиппины не углублять.
- `au_tier` возвращает `None` вместо форсирования тира для всех AU-
  регионов — минимальное расширение архитектуры (`compute_region_tier`),
  не переписывание уже верно работавшей `generic_tier`-логики для
  материковых штатов.

## Validation

`diagnose_missing_land.py` — все 11 из списка "ПРОПАЖА" исчезли (слой 2:
100% покрыто по всем; только приозёрные [LAKE]-ложные срабатывания,
несвязанные, остаются). Рендеры Channel Islands/Isle of Man/Maldives —
чистые. `merge_world_1946.py` — 98 пересечений (было 86, +12 — новые
острова vs приклеенное к сырому берегу море, известная категория).
`validate_region_economy_1946.py` — население/Китай в допуске, 46
известных capitalRegionId (было 44, механический сдвиг). `test_country_
entities_1946.py` 12/12, `test_validate_region_economy_1946.py` 9/9;
server+client `tsc --noEmit` чисты; server vitest 680+1skip; живой
`/game/start` (после устранения зомби-процесса) — 1399 регионов, 157
стран, все 11 островов подтверждены с верными owner/population.

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита.

## Final outcome

Все 12 пунктов Progress выполнены. Изменено: `build_asia_1946.py`,
`build_europe_1946.py`, `build_namerica_1946.py`, `build_oceania_1946.py`
(EXTRA_SINGLE_FEATURES + SINGLE_ORPHANS), `translate_world.py`,
`density_tiers.py` (`au_tier`, расширения `gbr_tier`/`fra_tier`),
`fill_region_economy_1946.py` (`None`-fallback), новые `diagnose_
scattered_regions.py`, позиционные файлы, документация.

Baseline failures: capitalRegionId 46 (было 44, объяснимый сдвиг); overlap-
diagnostic 98 (было 86, объяснимый рост той же известной категории).

Introduced failures: 0.

Unresolved risks: French Southern Territories (7244 км², практически
необитаемы) всё ещё показывает 43,658 населения даже на минимальном тире —
известное ограничение формулы `area^0.55`, не блокирует, задокументировано.
Сюрвей A2 (150 разбросанных регионов) передан пользователю без авто-правок
— решения по каждому не приняты. 5 пре-существующих регионов без владельца
(Kiel Canal Zone/Haifa/Jerusalem/Beirut/Spratly Islands) подтверждены как
баг ДО этой сессии (не регрессия) — не исправлялись, вне scope.

Fresh-session requirements: нет.
