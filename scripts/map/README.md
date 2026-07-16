# `scripts/map` — pipeline сценария 1946

Pipeline формирует геометрию, ownership, соседство, имена, страновой registry
и региональную экономику для сценария 1946. Фактические шаги определяет
`make_1946.py`; пути — `build/paths.py`.

## Обычный путь

Из корня репозитория:

```powershell
python scripts/map/make_1946.py
```

Команда использует готовые inputs из `scripts/map/out/`, экспортирует каталог
ресурсов из server и последовательно запускает import, country registry,
economy fill и validators. Она изменяет generated scenario files — сначала
проверь `git status` и ожидаемый scope.

Минимальные non-generating checks:

```powershell
python scripts/map/validate_region_economy_1946.py
python scripts/map/test_validate_region_economy_1946.py
```

## Входы и выходы

Вход `scripts/map/out/`:

- `world_1946.geojson`;
- `ownership_1946.json`;
- `neighbor_graph.json`;
- `names_ru.json`;
- `countries_1946.json`.

Основной output:

- `client/public/world_1946.geojson`;
- `server/data/scenarios/1946/regions.core.json`;
- `server/data/scenarios/1946/regions.state.json`;
- `server/data/scenarios/1946/names.en.json`;
- `server/data/scenarios/1946/names.ru.json`;
- `server/data/scenarios/1946/countries.json`.

`import_to_game.py` создаёт структурный skeleton; экономические поля затем
заполняет `fill_region_economy_1946.py`. Устаревший монолитный `regions.json`
не используется.

## Исторические страновые сущности

`config/country_entities_1946.json` — исполняемый курированный слой снимка
`1946-01-01`. По континентам он фиксирует:

- `preserve` — колония/зависимая территория остаётся отдельной Country и
  связывается с управляющей державой через существующий `subject_of`;
- `ownerOverrides` — современный код территории переводится реальному
  историческому владельцу/администрации 1946;
- официальные или архивные sources и confidence для каждого решения.

Ещё не обработанные континенты временно сохраняют прежнее объединение в
`QCG/QCF/QCP/QCN/QCU/QCZ/QCS`. `country_merge.json` — generated-результат
этой конфигурации плюс временного legacy grouping, не ручной источник истины.
Targeted-инварианты проверяет `test_country_entities_1946.py`, который входит
в стандартный pipeline.

## Полная пересборка геометрии

Интерфейс существует:

```powershell
python scripts/map/make_1946.py --full-rebuild
```

Но на 2026-07-15 full rebuild **не воспроизводим из чистого clone** и не был
выполнен в global audit:

- `scripts/map/sources/` не хранится в repository;
- точная provenance/URL-таблица inputs отсутствует;
- нет Python dependency manifest/версий;
- требуются Shapely, pyproj и PyShp (`shapefile`), а PyShp отсутствовал в
  проверенной локальной среде.

Не заявляй full rebuild успешным по одному validator pass. Перед следующим
геометрическим проходом нужно добавить provenance и dependency manifest, затем
выполнить pipeline end-to-end и проверить geometry/output diff.

Ожидаемые external inputs (имена, не достаточная provenance):

- `geoBoundaries-BRA-ADM2.geojson`;
- `geoBoundaries-USA-ADM2.geojson`;
- `geoBoundaries-CHN-ADM2.geojson`;
- `china_hist/1947-49/1947_1949`;
- Antarctica/seas/lakes overlays.

Environment overrides `PAXMAP_GAME_MAP`, `PAXMAP_SOURCES` и `PAXMAP_OUT`
описаны в `build/paths.py`.
