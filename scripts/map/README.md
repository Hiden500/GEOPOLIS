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
- `regionOwnerOverrides` — точечная граница исправляется, когда один source
  owner смешивает несколько администраций или вообще отсутствует;
- `subjectOverrides` — историческая зависимость задаётся для каталожной
  страны, ошибочно помеченной суверенной;
- официальные или архивные sources и confidence для каждого решения.

`country_merge.json` — generated-результат этой конфигурации, не ручной
источник истины. Targeted-инварианты проверяет `test_country_entities_1946.py`,
который входит в стандартный pipeline.

На текущем срезе завершены все шесть континентов (Южная Америка, Северная
Америка/Карибы, Европа, Африка, Азия, Океания); легаси колониальные блоки
(`QCG/QCF/QCP/QCN/QCU/QCZ/QCS`) больше нигде не используются.
В Карибах современные островные ISO-коды объединяются по администрациям 1946
(Leeward, Windward, Jamaica dependencies, Curaçao and Dependencies), а не
механически превращаются в отдельные страны. В Европе Cyprus, Gibraltar и
Malta выведены из мирового британского блока как отдельные зависимости.
Для территорий, которые upstream ошибочно пишет прямо на метрополию,
`regionOwnerOverrides` в том же континентальном разделе задаёт точечный owner
(например, Martinique/Guadeloupe и острова Curaçao and Dependencies).
Африка сохраняет AOF/AEF как реальные федерации 1946, объединяет современные
RWA/BDI в Ruanda-Urundi и исправляет анахроничные BIOT и отдельные Comoros на
их администрации Mauritius/Madagascar.
Азия отделяет British Raj, Burma, Ceylon, Hong Kong, Malaya/Singapore и
британские территории Borneo; восстанавливает Tibet, Sikkim, Jammu and
Kashmir, Portuguese/French India и семь Trucial Sheikhdoms. Переходные
послевоенные зоны Republic of Indonesia/Netherlands Indies и северного
DRV/южной French administration выражены только там, где текущие ADM1-полигоны
дают воспроизводимую границу; невидимые городские bridgeheads не дорисовываются.
Океания задокументирует Papua and New Guinea (мандат AUS), Solomon Islands
(протекторат GBR), Tonga (собственная монархия под британским протекторатом),
New Hebrides (англо-французский кондоминиум) и Western Samoa (мандат NZL,
отдельно от American Samoa) — все пять уже существовали в исходном каталоге
корректно, просто не были заявлены в курируемой конфигурации.

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
- `palestine_hist/geoBoundaries-ISR-ADM2.geojson` (15 израильских округов,
  CC0 1.0 Public Domain) и `palestine_hist/geoBoundaries-PSE-ADM2.geojson`
  (16 палестинских губернаторств, CC BY 4.0) — точная provenance ЕСТЬ
  (2026-07-19, единственные 2 входа в этом списке с полным URL): скачаны с
  `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/ISR/ADM2/geoBoundaries-ISR-ADM2.geojson`
  и `.../gbOpen/PSE/ADM2/geoBoundaries-PSE-ADM2.geojson` соответственно
  (geoBoundaries, коммит `9469f09`). Используются `build_palestine_1946.py`
  для реконструкции 1946 подрайонов Подмандатной Палестины — см. докстринг
  скрипта и `docs/HISTORICAL_ACCURACY.md`.

Environment overrides `PAXMAP_GAME_MAP`, `PAXMAP_SOURCES` и `PAXMAP_OUT`
описаны в `build/paths.py`.
