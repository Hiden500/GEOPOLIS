# 05 — Данные: расслоение JSON, валидация, пайплайн

Приоритет: P1. Предпосылка для сценария 1836 (план 07).
Статус: не начато.
Зависимости: нет жёстких; согласован с 04 (deposits в regions).

## Проблемы (текущее состояние)

1. **regions.json смешивает 4 слоя** (`server/data/scenarios/1946/regions.json`,
   771 КБ, 1366 регионов): географию (id, geoJsonId, area, neighbors,
   sourceAdm1Codes), локализацию (names), стартовое состояние сценария
   (owner, population, экономика) — и всё это потом ещё и мутирует в GameState.
   Для 1836 география/имена общие, состояние другое → дублирование = дрейф.

2. **countries.json — сериализованный рантайм, а не авторские данные**
   (377 КБ, 128 стран): каждая страна тащит полностью нулевые `economy`
   (17 полей), `technology.domains` (14), `military.equipment` (8), пустую
   дипломатию. Добавление поля в EconomyState требует регенерации файла или
   обработки undefined.

3. **Нет валидации на загрузке.** regions/countries читаются сервером «на веру».

4. **Валидатор данных не в CI.** `scripts/map/validate_region_economy_1946.py`
   запускается руками; инварианты целостности не проверяются нигде.

5. **Два источника истины по ресурсам:** TS `RESOURCE_CATALOG` и Python
   `resource_geography.py::RESOURCE_HOTSPOTS` — разъедутся.

6. **Нет оркестратора пайплайна:** цепочка build_* → merge → translate →
   import → fill → validate восстанавливается только по README.

7. **Мёртвые/тяжёлые артефакты клиента:** `client/src/assets/game_map.json`
   (37 МБ) не имеет ни одного импорта — удалить; `client/public/world_1946.geojson`
   (34 МБ) грузится сырым — нужен TopoJSON/упрощение + сжатие.

8. Мелочи: `scripts/map/out/names_ru.json` — список вместо словаря по
   region_id; `neighbor_graph.json` обёрнут в лишний `{"neighbors": ...}`;
   артефакты out/ не имеют штампа генератора.

## Целевая раскладка

```
data/map/<era>/regions.core.json      — id, geoJsonId, area, neighbors (на эпоху карты; см. план 07)
data/map/<era>/names.en.json          — { "EUR-0001": "Andorra", ... }
data/map/<era>/names.ru.json
data/scenarios/1946/regions.state.json — owner, population, urbanization, stability,
                                          infrastructure, development, deposits, extraction
data/scenarios/1946/countries.json     — ТОЛЬКО авторское: id, name, color,
                                          capitalRegionId, tier, economyProfile,
                                          ненулевые старты (армия, дипломатия), subject_of
data/scenarios/1946/cities.json        — города с реальными координатами (план 06)
```

- Рантайм-объект Country со всеми нулями собирает `createCountry`
  (`server/src/data/countries/templates/CreateCountry.ts` уже есть) —
  Python-генератор нули не пишет.
- `LocalizedText` в рантайме остаётся; собирается при загрузке сценария из
  файлов имён. Новая локаль = новый файл имён, игровые данные не трогаются.
- 12 рукописных TS-стран (`server/src/data/countries/*.ts`) мигрируют в
  countries.json (авторский формат) — один источник истины.

### Валидация

1. **Zod на загрузке сценария** (сервер): схемы Region/Country-авторских данных,
   `parse` при `createGame`. Рукописная правка JSON не должна молча ронять
   симуляцию через 40 тиков.
2. **Инварианты в CI** (новый job, расширяющий validate_region_economy):
   - симметрия neighbor-графа;
   - каждый `ownerCountryId` существует в countries.json;
   - каждая `capitalRegionId` принадлежит своей стране;
   - каждый ресурс deposits ∈ RESOURCE_CATALOG;
   - полнота локализации по локалям (все region_id есть в обоих names.*);
   - суммы населения по странам в допуске якорей anchors.py.
3. **Один источник ресурсов:** npm-скрипт экспортирует RESOURCE_CATALOG в
   JSON (`scripts/map/out/resource_catalog.json`); Python-скрипты читают его
   и сверяют id.

### Пайплайн

- `scripts/map/make_1946.py` — оркестратор: гонит всю цепочку
  (build_* континенты → merge → translate → build_neighbor_graph → import →
  fill → validate), падает на первом расхождении.
- Каждый `out/*.json` — штамп в шапке: `_meta: { generator, version, date }`.
- `names_ru.json` → словарь по region_id; развернуть обёртку neighbor_graph.

### Клиент

- Удалить `client/src/assets/game_map.json` (37 МБ, мёртвый).
- `world_1946.geojson` → TopoJSON с квантованием (ожидаемо ~3–5 МБ) либо
  упрощение геометрии + брendered gzip/brotli на отдаче. Конвертация — шаг
  оркестратора; `GeoJsonLoader` учится разворачивать TopoJSON (библиотека
  `topojson-client`, ~10 КБ).

## Критерии приёмки

- [ ] В countries.json нет нулевых плейсхолдер-блоков; сервер собирает рантайм-объекты сам.
- [ ] Загрузка сценария падает с внятной ошибкой на битом JSON (тест с испорченной копией).
- [ ] CI-job валидации данных зелёный и ловит подсунутое нарушение (тест: несимметричный сосед).
- [ ] `make_1946.py` от чистого out/ до валидного сценария одним запуском.
- [ ] Начальная загрузка карты клиентом ≤ 5 МБ по сети.
- [ ] Сценарий 1836 сможет добавить только `regions.state.json` + countries.json, не трогая core/names (проверка планом 07).

## Отклонения при реализации

_(заполняется при реализации)_
