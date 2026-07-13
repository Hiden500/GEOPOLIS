"""
import_to_game.py — превращает выходы пайплайна MAP (scripts/map/out/) в игровые
артефакты сценария 1946: геометрию для клиента и скелеты регионов для сервера.

Вход (scripts/map/out/):
  world_1946.geojson    — геометрия, properties.region_id/continent/region_type/...
  ownership_1946.json   — region_id -> {"owner": ISO3}
  neighbor_graph.json   — {"neighbors": {region_id: [region_id, ...]}}
  names_ru.json         — region_id -> {name_en, name_ru, ...}

Конфиг (scripts/map/config/):
  occupation_overlay.json — region_id -> игровой код владельца, для случаев,
                            которые НЕ выражены в ownership_1946.json.controller
                            (советская оккупация Маньчжурии отдельно от
                            остального Китая, раздел Китая КПК/Гоминьдан).

Зоны оккупации Германии и Кореи читаются из НАТИВНОГО поля
ownership_1946.json[region_id].controller (MAP уже знает про 4 зоны в
Германии и раздел по 38-й параллели в Корее, с исторической пометкой
note) — см. resolve_owner().

Выход (docs/plans/05_DATA_LAYOUT.md, Срез 1 — расслоение вместо единого regions.json):
  client/public/world_1946.geojson              — геометрия с числовым id + region_id,
                                                    type нормализован (land->region, sea/lake->ocean)
  server/data/scenarios/1946/regions.core.json   — география: id, geoJsonId, area,
                                                    neighboringRegionIds, sourceAdm1Codes
  server/data/scenarios/1946/names.en.json       — geoJsonId -> имя (английское)
  server/data/scenarios/1946/names.ru.json       — geoJsonId -> имя (русское)
  server/data/scenarios/1946/regions.state.json  — владение/экономика: id, ownerCountryId,
                                                    population, urbanization, stability,
                                                    infrastructure, development, gdp,
                                                    deposits, extraction — скелет
                                                    (экономику заполняет отдельная модель,
                                                    см. docs/tasks/REGION_ECONOMY_FILL.md)

Экономические поля (population, urbanization, stability, infrastructure,
development, gdp, deposits, extraction) заполняются нулевыми плейсхолдерами —
это намеренно, не баг: их назначение out of scope для этого импортера.
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "scripts" / "map" / "out"
CONFIG_DIR = REPO_ROOT / "scripts" / "map" / "config"

CLIENT_GEOJSON_OUT = REPO_ROOT / "client" / "public" / "world_1946.geojson"
SCENARIO_DIR = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
REGIONS_CORE_OUT = SCENARIO_DIR / "regions.core.json"
REGIONS_STATE_OUT = SCENARIO_DIR / "regions.state.json"
NAMES_EN_OUT = SCENARIO_DIR / "names.en.json"
NAMES_RU_OUT = SCENARIO_DIR / "names.ru.json"

# MAP's region_type -> формат, который потребляет GeoJsonLoader/MapView
TYPE_MAP = {"land": "region", "sea": "ocean", "lake": "ocean"}

# controller (зона оккупации) -> игровой код, для owner-значений MAP, где
# население региона достаточно велико, чтобы прямое присвоение controller'у
# искажало бы его агрегаты (Германия/Корея). Для мелких случаев (Гуантанамо,
# зона Панамского канала, Ливия, Сомали, Эритрея) ownership.controller
# используется как owner напрямую — см. resolve_owner().
ZONE_CODES_BY_OWNER = {
    "DEU": {"SUN": "QGS", "USA": "QGA", "GBR": "QGB", "FRA": "QGF"},
    "KOR": {"SUN": "QKS", "USA": "QKA"},
}

# MAP использует составной (не 3-буквенный) код для Британского Сомалиленда —
# единственное нарушение конвенции "все коды стран — 3 буквы" во всём
# датасете. Нормализуем на private-use код, как остальные кастомные сущности.
OWNER_CODE_ALIASES = {
    "SOM_GBR": "QSO",
}

# Скобочные хвосты в конце имени — от технических индексов ("Burgas (5)")
# до прямых заметок составителя MAP, протёкших в данные ("Nepal (план:
# 'каждый в отдельный регион')", "Gibraltar (отдельный iso_a2='GI', не
# входил в список стран)"). Ни один не несёт смысла для игрового названия —
# снимаем все хвостовые группы (может быть несколько подряд).
TRAILING_PAREN_RE = re.compile(r"(?:\s*\([^()]*\))+\s*$")


def strip_trailing_index(name: str) -> str:
    return TRAILING_PAREN_RE.sub("", name).strip()


def resolve_owner(region_id: str, ownership: dict, overlay: dict) -> str | None:
    entry = ownership.get(region_id) or {}
    owner = entry.get("owner")
    controller = entry.get("controller")

    zone_codes = ZONE_CODES_BY_OWNER.get(owner)
    if zone_codes and controller in zone_codes:
        return zone_codes[controller]
    if controller:
        # Территория без собственного правительства на 1946 (военная
        # администрация/лизинг) — присваиваем оккупанту напрямую.
        return OWNER_CODE_ALIASES.get(controller, controller)

    resolved = overlay.get(region_id) or owner
    return OWNER_CODE_ALIASES.get(resolved, resolved)


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    world = load_json(OUT_DIR / "world_1946.geojson")
    ownership = load_json(OUT_DIR / "ownership_1946.json")
    neighbors = load_json(OUT_DIR / "neighbor_graph.json")["neighbors"]
    names = {n["region_id"]: n for n in load_json(OUT_DIR / "names_ru.json")}
    overlay = load_json(CONFIG_DIR / "occupation_overlay.json")
    overlay = {k: v for k, v in overlay.items() if not k.startswith("_")}

    features = world["features"]

    # Числовой id — стабильный, в порядке region_id (уже continent-префиксован
    # и последовательный в world_1946.geojson).
    region_id_to_numeric: dict[str, int] = {}
    for i, ft in enumerate(features, start=1):
        region_id_to_numeric[ft["properties"]["region_id"]] = i

    # --- 1. Геометрия для клиента ---
    out_features = []
    for ft in features:
        props = ft["properties"]
        region_id = props["region_id"]
        region_type = props.get("region_type", "land")
        numeric_id = region_id_to_numeric[region_id]

        out_features.append({
            "type": "Feature",
            "id": numeric_id,
            "properties": {
                "id": numeric_id,
                "region_id": region_id,
                "type": TYPE_MAP.get(region_type, "region"),
                "name": strip_trailing_index(props.get("name", "")),
                "iso_a2": props.get("iso_a2", ""),
                "continent": props.get("continent"),
            },
            "geometry": ft["geometry"],
        })

    CLIENT_GEOJSON_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(CLIENT_GEOJSON_OUT, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": out_features}, f, ensure_ascii=False)

    # --- 2. Регионы для сервера (только land — sea/lake не становятся Region) ---
    # Расслоено на core (география) / names.* (локализация) / state (владение +
    # нулевой экономический скелет) — docs/plans/05_DATA_LAYOUT.md, Срез 1.
    regions_core = []
    regions_state = []
    names_en_out: dict[str, str] = {}
    names_ru_out: dict[str, str] = {}
    skipped_no_owner = []
    for ft in features:
        props = ft["properties"]
        region_id = props["region_id"]
        if props.get("region_type", "land") != "land":
            continue

        owner = resolve_owner(region_id, ownership, overlay)
        if not owner:
            skipped_no_owner.append(region_id)
            continue

        name_entry = names.get(region_id, {})
        neighbor_ids = [
            region_id_to_numeric[n]
            for n in neighbors.get(region_id, [])
            # сосед должен сам быть land-регионом (только такие становятся Region)
            if n in region_id_to_numeric and names.get(n, {}).get("region_type", "land") == "land"
        ]
        numeric_id = region_id_to_numeric[region_id]

        names_en_out[region_id] = strip_trailing_index(name_entry.get("name_en", props.get("name", region_id)))
        names_ru_out[region_id] = strip_trailing_index(name_entry.get("name_ru", name_entry.get("name_en", region_id)))

        regions_core.append({
            "id": numeric_id,
            "geoJsonId": region_id,
            "area": props.get("area_km2", 0),
            "neighboringRegionIds": neighbor_ids,
            "sourceAdm1Codes": [region_id],
        })
        regions_state.append({
            "id": numeric_id,
            "ownerCountryId": owner,
            "population": 0,
            "urbanization": 0,
            "stability": 0,
            "infrastructure": 0,
            "development": 0,
            "gdp": 0,
            "deposits": {},
            "extraction": {},
        })

    SCENARIO_DIR.mkdir(parents=True, exist_ok=True)
    with open(REGIONS_CORE_OUT, "w", encoding="utf-8") as f:
        json.dump(regions_core, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(REGIONS_STATE_OUT, "w", encoding="utf-8") as f:
        json.dump(regions_state, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(NAMES_EN_OUT, "w", encoding="utf-8") as f:
        json.dump(names_en_out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with open(NAMES_RU_OUT, "w", encoding="utf-8") as f:
        json.dump(names_ru_out, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Геометрия: {len(out_features)} фич -> {CLIENT_GEOJSON_OUT}")
    print(f"Регионы: {len(regions_core)} -> {REGIONS_CORE_OUT} / {REGIONS_STATE_OUT} / {NAMES_EN_OUT} / {NAMES_RU_OUT}")
    if skipped_no_owner:
        print(f"ВНИМАНИЕ: {len(skipped_no_owner)} land-регионов без владельца пропущены: {skipped_no_owner[:10]}")


if __name__ == "__main__":
    main()
