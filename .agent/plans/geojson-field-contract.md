# Контракт полей geojson (T-5 роли geometry)
Status: complete
Owner: claude/geojson-field-contract
Starting commit: da59420

## Objective and observable outcome

Решить и закрепить, какие свойства несёт мастер (`scripts/map/master/
world_1946.master.geojson`), какие — клиентская копия (`client/public/
world_1946.geojson`), и чем это держится.

Наблюдаемый результат: шаг пайплайна падает на фиче с полем вне контракта и на
отсутствующем обязательном поле; таблица «поле → где живёт → кто читает → чем
держится» лежит в `scripts/map/AGENTS.md`; клиентская копия пересобрана
пайплайном.

## Scope and constraints

Меняю: `scripts/map/import_to_game.py`, `scripts/map/make_1946.py`, мастер
(свойства, НЕ геометрия), `client/src/map/GeoJsonLoader.ts`,
`scripts/map/AGENTS.md`, `docs/TODO.md`, `docs/DECISIONS.md`. Новые файлы:
`scripts/map/build/apply_field_contract_master.py`,
`scripts/map/verify_geojson_field_contract.py`,
`scripts/map/test_verify_geojson_field_contract.py`,
`server/data/scenarios/1946/waters.json`.

Не трогаю: геометрию (ни одной правки полигона), экспорт морской смежности
(`landNeighboringRegionIds`/`seaNeighboringRegionIds` — отдельная задача, ждёт
контракта стыка от роли lead), пересчёт площади (T-8).

**Генераторы мастера не редактирую.** `build/verify_master_freshness.py`
сторожит коммиты `MASTER_REBUILD_STEPS` + `OFF_CHAIN` против записи в
`master.meta.json`; правка любого из них объявит мастер устаревшим, а
перезаморозить его нечем (`freeze_master_map.py` читает
`out/world_1946.geojson`, которого нет). Поэтому нормализация свойств мастера
идёт отдельным хирургическим скриптом, как `fix_dalian_rio_master.py`.

Риск пересечения: параллельно живут ветки `claude/t9-baseline`,
`claude/panama-stale-entry`, `claude/canal-passage-research` — все по карте.
Пересечение по файлам возможно на мастере и `import_to_game.py`.

## Assumptions and unknowns

- `--rebuild-master` сегодня невозможен (8 из 11 входов вне репозитория) —
  правка свойств мастера идёт хирургически, воспроизводимость держит скрипт.
- `merge_kiel_canal_zone.py` при гипотетической пересборке снова напишет
  `iso_a2: "DE_KC"`; правку генератора делать нельзя (см. выше), поэтому
  возврат ловит контрактная проверка, а не молчание.

## Alternatives and selected decision

Критерий, утверждённый с пользователем: в клиентский geojson едет геометрия,
ключ соединения и то, что надо нарисовать до ответа сервера; всё остальное —
в сценарные json.

- `iso_a2`, `continent` в клиенте: потребителя нет ни одного (проверено по
  `client/src`) → удалены. В мастере оба потребителя есть → остаются.
- Числовой игровой id: остаётся ТОЛЬКО на уровне фичи (канонический
  geojson-id, его читает MapLibre `feature-state`), из `properties` уходит как
  дубликат.
- `region_type` → в сценарий: суша уже выражена составом `regions.core.json`,
  вода получает `waters.json` c `waterType` (`sea`/`lake`) и игровым id.
- `naval_terrain`/`ocean` — объявлены отложенными (Милстоун 4), проверка их
  не требует, но печатает покрытие каждый прогон.

## Progress

- [x] замер мастера и клиента, поиск потребителей каждого поля
- [x] `build/apply_field_contract_master.py` — нормализация свойств мастера
      (снято 111 записей полей, `iso_a2` `DE_KC` -> `DE`; геометрия не тронута —
      0 изменившихся хешей на 1591 фиче)
- [x] `verify_geojson_field_contract.py` + 27 тестов + два негативных контроля
      на живых файлах
- [x] `import_to_game.py`: три свойства клиента + `waters.json` (182 моря,
      13 озёр)
- [x] `GeoJsonLoader.ts`: сохранение id фичи, цвет океана — константа
- [x] таблица контракта в `scripts/map/AGENTS.md`, DECISIONS, TODO, IDEAS
- [x] прогон `make_1946.py` целиком код 0; размер клиента 43 700 791 ->
      43 620 396 байт; `git diff --stat` просмотрен, экономика на месте

## Discoveries

- `state` (108 фич США) пишет `build_us_states_split_1946.py` и не читает
  никто во всём репозитории.
- `strategic_points` у `ASI-0043` дублирует уже потребляемую запись
  `economy_1946/capital_overrides.py: "TWN": "Nanjing"`.
- `GeoJsonLoader` теряет числовой id фичи, а `MapView` выставляет
  `setFeatureState({source:'regions', id: r.id})` по числовому id региона —
  hover/выделение/цвет режима сегодня не доезжают ни до одной фичи.
- `props.color` и `props.country` читаются загрузчиком, но в файле их нет
  никогда — оба чтения всегда падают в fallback.

## Decision log

- **Два потребителя клиентского geojson нашлись только прогоном**, не поиском:
  `economy_1946/capital_geography.py` читал `properties.id`, а
  `test_country_entities_1946.py` — `properties.iso_a2` (и притом по КОПИИ
  КЛИЕНТА, то есть по прошлой сборке: шаг идёт раньше импорта). Оба переведены
  на канонические места: id — с уровня фичи, `iso_a2` — из мастера.
- **Проверка нашла три предсуществующих дефекта данных**, не относящихся к
  контракту: полигон Ватикана 0,0107 км² при настоящих ~0,44; два региона без
  имени; четыре не-ISO значения `iso_a2`. Ни один не подавлен: все внесены в
  ЗАКРЫТЫЕ списки (`KNOWN_ZERO_AREA`, `KNOWN_EMPTY_NAMES`,
  `NON_ISO_SOURCE_CODES`) с причиной, закрытость списков закреплена тестами,
  первые два ушли в `docs/TODO.md`.
- **`PA_CZ` оставлен, `DE_KC` снят** — намеренная асимметрия: Зона Панамского
  канала в 1946 была отдельной территорией под юрисдикцией США, а «Kiel Canal
  Zone» — конструкция карты на немецкой земле.
- **`waters.json` внесён в `.gitignore` явным отрицанием** — иначе правило
  `/server/data/scenarios/1946/*` уронило бы его из git молча; поймал это
  `scenarioDataTracked.test.ts` (шёл красным до `git add`).

## Validation

```text
cwd: D:/Pax Historia LOCAL/.claude/worktrees/geojson-field-contract
python scripts/map/test_verify_geojson_field_contract.py
python scripts/map/verify_geojson_field_contract.py
python scripts/map/make_1946.py
npx tsc --noEmit -p tsconfig.app.json   (cwd: client)
npm test                                (cwd: client)
python .agent/evals/public/run_public_evals.py
```

## Rollback / containment

Мастер и клиентская копия под git — `git checkout` возвращает любое состояние.
Хирургический скрипт идемпотентен: повторный прогон не находит что менять.

## Final outcome

Status: complete. Контракт закреплён таблицей в `scripts/map/AGENTS.md` и
исполняемой проверкой в STANDARD_STEPS.

Прогнано и просмотрено (всё в этом дереве, 2026-08-09):

- `python scripts/map/make_1946.py` — код 0;
- `python scripts/map/test_verify_geojson_field_contract.py` — 27 тестов, OK;
- негативные контроли на ЖИВЫХ файлах: снятие `area_km2` у `EUR-0001` в
  мастере и добавление `iso_a2` у `AFR-0001` в клиенте — оба дают код 1 с
  именем фичи и поля;
- `client`: `tsc` 0, `npm test` 112/112, `npm run lint` чисто;
- `server`: `tsc` 0, `npm test` 1457 passed / 1 skipped (падавший
  `scenarioDataTracked` зелёный после внесения `waters.json` в git);
- `python .agent/evals/public/run_public_evals.py` — 240 passed, 0 failed;
- `python scripts/map/build/freeze_master_map.py --verify` — мастер совпадает
  с `master.meta.json` (правка свойств геометрию не тронула).

UNKNOWN: карта в браузере не проверена глазами. Preview-харнесс поднимает dev
server из ОСНОВНОГО checkout, а не из этого дерева (проверено: отданный им
`world_1946.geojson` нёс старые поля), а основной checkout править нельзя.
Изменение `GeoJsonLoader` меняет поведение карты — hover, выделение и цвет
режима впервые начинают адресовать существующие фичи, — и это стоит увидеть
на живой карте после влития ветки.
