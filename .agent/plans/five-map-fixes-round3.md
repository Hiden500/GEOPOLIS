# Пять точечных дефектов карты + скрытый баг кодировки (раунд после архитектурной правки)

Status: complete
Owner: Claude (this session)
Starting commit: `91e0166` (order-independent multi-sea claiming) on
`codex/1946-country-borders`

## Objective and observable outcome

Пользователь прислал 2 скриншота и список из 5 пунктов после предыдущего
раунда: (1) шов на стыке Andaman or Burma Sea/Bay of Bengal; (2) у Ionian
Sea снова "сирота"; (3) Великие озёра обрезаны по границам территорий —
взять из ne_10m_lakes; (4) добавить Lake Malawi; (5) "Потерял WSB-5133 у
Кипра" (Akrotiri, Western Sovereign Base).

Observable outcome: все 5 пунктов исправлены и подтверждены рендерами;
полный пайплайн/тесты/tsc/vitest/живой `/game/start` без регрессий
относительно базовой линии.

## Scope and constraints

In scope: `fix_sea_coastline_gaps.py` (новая `transfer_misassigned_parts`),
новый `refresh_lakes_from_ne10m.py`, `build_namerica_1946.py` (клип озёр),
`build_africa_1946.py` (Малави в клип), `build_europe_1946.py` (Akrotiri),
`translate_world.py` (запись для Малави), `density_tiers.py` (`cyp_tier`),
позиционные файлы (`ownership_1946.json`/`names_ru.json` для EUR-0367,
LAK-0012/0013).

Out of scope: capitalRegionId-нарушения (уже известная, отдельная
категория); расхождения кураторской суши с сырым побережьем за пределами
пяти заявленных пунктов.

## Progress

- [x] 1. Разведка тремя параллельными Explore-агентами (WSB-5133/Akrotiri,
      геометрия стыка Andaman/Bengal + Ionian-сирота, пайплайн озёр) —
      план составлен и одобрен пользователем.
- [x] 2. `transfer_misassigned_parts()` — перенос части, касающейся ЧУЖОГО
      моря (не своего же тела), тому морю, с кем самая длинная граница.
      Прогон на всех 113 морях нашёл ~100 случаев, не только 2 заявленных;
      выборочно проверено рендерами (Baltic/Kattegat, SE Alaska/BC vs
      "Гавайский сектор", Black Sea/Azov) — все чистые; сходится за 1 проход.
- [x] 3. `refresh_lakes_from_ne10m.py` — Великие озёра заменены на месте
      полными контурами из `ne_10m_lakes`, Lake Malawi добавлено в конец.
- [x] 4. `clip_land_against_lakes` добавлен в `build_namerica_1946.py`
      (никогда не было, в отличие от Европы/Африки) — клип 7 US-штатов.
- [x] 5. "Малави (Ньяса)" добавлено в `CLIP_LAKE_NAMES_AFRICA` — клип 6
      регионов (Malawi/Tanzania/Mozambique).
- [x] 6. `translate_world.py` — запись для "Малави (Ньяса)".
- [x] 7. Akrotiri добавлена в `EXTRA` список `add_cyprus_extra_territories`
      (`build_europe_1946.py`) — не регрессия, никогда не была в карте
      (`git log -S"Akrotiri"` пуст).
- [x] 8. `cyp_tier` добавлен в `density_tiers.py` (по образцу `dnk_tier`) —
      превентивно, тот же класс риска "маленький регион = столица".
- [x] 9. Найден и исправлен скрытый баг: `build_us_states_split_1946.py`
      читал источники без `encoding="utf-8"` — молча портил кириллицу и
      латиницу с диакритикой на этой машине (не-UTF-8 системная кодировка
      по умолчанию). Не регрессия этой сессии — баг сидел давно, просто
      впервые дошёл до выполнения (раньше падал на отсутствующем внешнем
      источнике). Потребовалась пересборка `build_namerica_1946.py` с нуля
      ПЕРЕД повторным прогоном исправленного скрипта — починка чтения одна
      недостаточна, если файл на диске уже испорчен предыдущим прогоном.
- [x] 10. Скачан отсутствующий `geoBoundaries-USA-ADM2.geojson` (с
      разрешения пользователя, коммит `9469f09`, тот же что ISR/PSE/CYP).
      `build_china_1946_v2.py`/`build_brazil_1946.py` упали на ДРУГИХ
      отсутствующих источниках — безопасно пропущены (упали до записи,
      старые выходы не тронуты, не в scope этой задачи).
- [x] 11. Полная пересборка: все шаги `FULL_REBUILD_STEPS` по порядку (с
      двумя пропущенными по п.10) → `import_to_game.py` →
      `remap_region_ids.py --prefix EUR- --apply` (373 сопоставлено, 7
      сдвинулось) → ручные записи `ownership_1946.json`/`names_ru.json`
      для EUR-0367 (Akrotiri) и LAK-0012/0013 (Кинерет — тоже была без
      записи, восполнено попутно; Малави) → повторный `import_to_game.py`
      → `generate_country_registry.py` → `fill_region_economy_1946.py`.
- [x] 12. Верификация рендерами всех 5 пунктов — чистые.
- [x] 13. `merge_world_1946.py` (86, было 80 — объяснимый рост, тот же
      известный класс), `validate_region_economy_1946.py` (44 известных
      capitalRegionId, было 43 — механический сдвиг), оба теста,
      server+client `tsc --noEmit`, server vitest, живой `/game/start`.
- [x] 14. Документация: `docs/DECISIONS.md` (2026-07-22), skill (3 новых
      пункта), README (пункты 43-45 + provenance USA-ADM2), этот ExecPlan.
- [x] 15. Коммит.

## Discoveries

См. `docs/DECISIONS.md` запись `2026-07-22` — все находки (перенос по
касанию границы вместо расстояния, скрытый encoding-баг, пропуск упавших
до записи build-шагов) описаны там подробно с числами.

## Decision log

- `transfer_misassigned_parts` вызывается ДО `cleanup_scattered_fragments`
  (не после) — иначе дистанционная кластеризация может "простить" неверно
  приписанную часть по близости к нынешнему (неверному) морю.
- Encoding-баг: решение — пересобрать `namerica_1946.geojson` С НУЛЯ через
  `build_namerica_1946.py` (не тронут багом) перед повторным прогоном
  исправленного `build_us_states_split_1946.py`, а не просто починить
  чтение и запустить один раз поверх уже испорченного файла.
- `build_china_1946_v2.py`/`build_brazil_1946.py` НЕ чинились (missing
  external sources, не в scope) — их старые выходы (недели до сессии)
  использованы как есть, downstream шаги не пострадали.
- `geoBoundaries-USA-ADM2.geojson` скачан с явного разрешения пользователя
  (AskUserQuestion) — тот же закреплённый коммит `9469f09`, что уже
  использует repo для ISR/PSE/CYP, через media.githubusercontent.com
  (LFS-ловушка).

## Validation

Рендеры: Andaman/Bengal (чисто), Арголидский залив/Ionian-Aegean (чисто),
4 Великих озера (полные контуры), Lake Malawi (видно, суша обрезана),
Кипр/Akrotiri (дыра закрыта). `merge_world_1946.py` 86 пересечений (было
80, объяснимый рост той же известной категории). `validate_region_
economy_1946.py` — население/Китай в допуске, 44 известных
capitalRegionId (было 43, механический сдвиг). `test_country_entities_
1946.py` 12/12, `test_validate_region_economy_1946.py` 9/9; server+client
`tsc --noEmit` чисты; server vitest 680+1skip; живой `/game/start` — 1388
регионов, 157 стран, Akrotiri подтверждена.

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита.

## Final outcome

Все 15 пунктов Progress выполнены. Изменено: `fix_sea_coastline_gaps.py`
(`transfer_misassigned_parts`), новый `refresh_lakes_from_ne10m.py`,
`build_namerica_1946.py` (клип озёр + encoding-фикс),
`build_africa_1946.py` (Малави), `build_europe_1946.py` (Akrotiri),
`translate_world.py`, `density_tiers.py` (`cyp_tier`), позиционные файлы,
`scripts/map/sources/geoBoundaries-USA-ADM2.geojson` (новый внешний
источник), документация.

Baseline failures: capitalRegionId 44 (было 43, объяснимый сдвиг); overlap-
diagnostic 86 (было 80, объяснимый рост той же известной категории).

Introduced failures: 0.

Unresolved risks: остаточные мелкие наложения округ-озеро на границе
Великих озёр (0.008-0.48 deg2, US county-сплит происходит ПОСЛЕ клипа на
уровне штата, не наследует его) — тот же принятый класс, что уже
существует для Аральского моря, не исправлялось в рамках этого раунда;
316 некритичных разрывов моря (531.9 km2, из предыдущего раунда) остаются
нетронутыми.

Fresh-session requirements: нет.
