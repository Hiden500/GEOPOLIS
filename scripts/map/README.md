# scripts/map — пайплайн карты Pax Historia

Геометрия, владельцы, граф соседей и имена регионов для исторических сценариев.
Перенесено из внешней папки `d:/MAP` и параметризовано под репозиторий.

## Структура

```
scripts/map/
  build/      Python-билдеры геометрии (по континентам + merge + translate + соседи)
  sources/    Внешние входные данные (НЕ в репо — положить вручную, см. ниже)
  out/        Выходные артефакты билдеров (вход для импортера). *.geojson в .gitignore
  config/     Конфиги интеграции (country_codes.json, country_merge.json — Этап 4)
  import_to_game.py   Импортер: out/ → игровые артефакты (Этап 3)
```

## Пути

Все пути берутся из `build/paths.py` (репо-относительные, переопределяемы окружением):

| Переменная | Значение по умолчанию | Назначение |
|---|---|---|
| `PAXMAP_GAME_MAP` | `client/src/assets/game_map.json` | Исходная геометрия — из неё собран весь датасет. **Не удалять.** |
| `PAXMAP_SOURCES` | `scripts/map/sources/` | Внешние входы (geoBoundaries, шейпы Китая) |
| `PAXMAP_OUT` | `scripts/map/out/` | Выходы билдеров |

## Внешние источники (положить в `sources/` перед полной пересборкой)

> TODO: ниже только имена файлов, нет прямых ссылок на загрузку. Добавить URL
> (geoBoundaries: https://www.geoboundaries.org/, источник китайских исторических
> шейпов уточнить) при следующей полной пересборке — сейчас не блокирует, готовые
> выходы лежат в `out/`.

- `geoBoundaries-BRA-ADM2.geojson` — муниципалитеты Бразилии
- `geoBoundaries-USA-ADM2.geojson` — округа США
- `geoBoundaries-CHN-ADM2.geojson` — префектуры Китая
- `china_hist/1947-49/1947_1949` — исторические шейпы Китая 1947–49
- `antarctica_1946.geojson`, `seas_1946.geojson`, `lakes_1946.geojson` — заготовки
  (сейчас уже лежат в `out/` как готовые выходы)

> Готовые выходы уже скопированы в `out/`, поэтому импортер (Этап 3) запускается
> без пересборки. Полная пересборка геометрии нужна только при изменении исходников.

## Порядок запуска (полная пересборка)

```bash
cd scripts/map/build
python build_europe_1946.py
python build_asia_1946.py        # требует china_1946_historical.json (см. build_china_1946_v2)
python build_china_1946_v2.py
python build_namerica_1946.py
python build_us_states_split_1946.py
python fill_us_border_gaps.py
python build_brazil_1946.py
python build_southamerica_1946.py
python build_africa_1946.py
python build_oceania_1946.py
python merge_world_1946.py        # объединяет всё в out/world_1946.geojson
python build_neighbor_graph.py    # граф соседей по world_1946.geojson
python translate_world.py         # русские имена (далее уточняются regen_names_ru.py)
```

Зависимости: `shapely`, `pyproj`, `pyshp` (shapefile).

## Артефакты `out/` (вход импортера)

- `world_1946.geojson` — единая геометрия (region_id, continent, region_type, area_km2…)
- `ownership_1946.json` — region_id → owner (ISO3)
- `neighbor_graph.json` — граф соседства по region_id
- `names_ru.json` — region_id → имена (перегенерация экзонимов — Этап 5)
- `countries_1946.json` — страны (ISO3, subject_of/subject_type)

## Дальше

`import_to_game.py` (Этап 3) превращает `out/` в игровые артефакты:
`client/public/world_1946.geojson`, `server/data/scenarios/1946/regions.json`,
реестр стран. См. план интеграции.
