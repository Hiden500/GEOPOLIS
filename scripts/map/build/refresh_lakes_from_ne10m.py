"""
refresh_lakes_from_ne10m.py

Заменяет геометрию Великих озёр (Верхнее/Мичиган-Гурон/Эри/Онтарио) в
scripts/map/out/lakes_1946.geojson НА МЕСТЕ полными контурами из Natural
Earth ne_10m_lakes, и добавляет озеро Малави (Ньяса) новой фичей в конец.

Контекст (2026-07-20, пользователь): "Великие озёра обрезаны по границам
территорий. Возьми из ne_10m_lakes. Также добавь Lake Malawi." Текущие
контуры Великих озёр в lakes_1946.geojson урезаны по линии границы США-
Канада (Verified: Superior maxY=48.21 vs NE 49.03 — канадская часть
отсутствует; Huron maxX=-82.15 vs NE -79.66 — часть в Онтарио
отсутствует) — их провенанс не ne_10m_lakes напрямую, а какой-то более
ранний, обрезанный по стране/провинции проход. Малави сейчас вообще
отсутствует как озеро — вода целиком закрыта сушей 6 регионов Malawi/
Tanzania/Mozambique.

lakes_1946.geojson — внешний, hand-maintained input (как ownership_1946.json),
ни один build-скрипт его не перегенерирует целиком. Этот скрипт ИДЕМПОТЕНТЕН
(повторный запуск не дублирует Малави, обновляет геометрию озёр на месте)
и НЕ входит в FULL_REBUILD_STEPS — тот же паттерн, что extract_kinneret.py
(шаблон для этого скрипта).

Позиционная безопасность: Великие озёра заменяются НА МЕСТЕ (позиции 1-4
файла, те же LAK-id) — downstream (ownership_1946.json/names_ru.json) не
сдвигается. Малави добавляется В КОНЕЦ файла (новый LAK-id, следующий по
порядку) — тоже не сдвигает уже существующие записи, но ownership_1946.json/
names_ru.json нужно вручную пополнить новой записью (как Кинерет).

Запуск: python scripts/map/build/refresh_lakes_from_ne10m.py
"""
from paths import out, source
import json
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
NE_LAKES = source("naturalearth/ne_10m_lakes.geojson")
LAKES_OUT = out("lakes_1946.geojson")

# (имя в lakes_1946.geojson -> список имён в ne_10m_lakes, объединяемых в один полигон)
GREAT_LAKES = {
    "Озеро Верхнее": ["Lake Superior"],
    "Озеро Мичиган-Гурон": ["Lake Michigan", "Lake Huron"],
    "Озеро Эри": ["Lake Erie"],
    "Озеро Онтарио": ["Lake Ontario"],
}
MALAWI_NAME_RU = "Малави (Ньяса)"


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def load_ne_lake(ne_features, name):
    for ft in ne_features:
        if ft["properties"].get("name") == name:
            return shape(ft["geometry"])
    return None


def main():
    with open(NE_LAKES, encoding="utf-8") as f:
        ne = json.load(f)
    ne_features = ne["features"]

    with open(LAKES_OUT, encoding="utf-8") as f:
        lakes = json.load(f)

    updated = 0
    for ft in lakes["features"]:
        name_ru = ft["properties"].get("name")
        if name_ru not in GREAT_LAKES:
            continue
        pieces = []
        for ne_name in GREAT_LAKES[name_ru]:
            g = load_ne_lake(ne_features, ne_name)
            if g is None:
                print(f"  ВНИМАНИЕ: '{ne_name}' не найдено в ne_10m_lakes.geojson — {name_ru} не обновлено")
                pieces = None
                break
            pieces.append(g)
        if not pieces:
            continue
        new_g = unary_union(pieces) if len(pieces) > 1 else pieces[0]
        before_km2 = ft["properties"].get("area_km2")
        ft["geometry"] = mapping(new_g)
        ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
        ft["properties"]["note"] = "Natural Earth ne_10m_lakes, полный контур (2026-07-20: заменена урезанная по границе США-Канада версия)."
        updated += 1
        print(f"  {name_ru}: {before_km2} -> {ft['properties']['area_km2']} km2")

    malawi_g = load_ne_lake(ne_features, "Lake Malawi")
    if malawi_g is None:
        print("  ВНИМАНИЕ: 'Lake Malawi' не найдено в ne_10m_lakes.geojson — не добавлено")
    else:
        existing = next((ft for ft in lakes["features"] if ft["properties"].get("name") == MALAWI_NAME_RU), None)
        if existing is not None:
            existing["geometry"] = mapping(malawi_g)
            existing["properties"]["area_km2"] = round(area_km2(malawi_g), 1)
            print(f"  {MALAWI_NAME_RU} обновлено ({existing['properties']['area_km2']} km2)")
        else:
            lakes["features"].append({
                "type": "Feature",
                "properties": {
                    "name": MALAWI_NAME_RU,
                    "region_type": "lake",
                    "area_km2": round(area_km2(malawi_g), 1),
                    "note": "Natural Earth ne_10m_lakes 'Lake Malawi' (name_alt 'Lake Nyasa'). "
                             "Добавлено 2026-07-20 — раньше отсутствовало как озеро, вода была "
                             "целиком закрыта сушей регионов Malawi/Tanzania/Mozambique.",
                },
                "geometry": mapping(malawi_g),
            })
            print(f"  {MALAWI_NAME_RU} добавлено ({round(area_km2(malawi_g), 1)} km2)")

    with open(LAKES_OUT, "w", encoding="utf-8") as f:
        json.dump(lakes, f, ensure_ascii=False)
    print(f"Записано: {LAKES_OUT} (озёр обновлено: {updated}, всего фич: {len(lakes['features'])})")


if __name__ == "__main__":
    main()
