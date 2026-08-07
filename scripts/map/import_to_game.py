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
  country_entities_1946.json — по-континентальные historical
                            regionOwnerOverrides для современных/ошибочных
                            owner-кодов, которые нельзя исправить всей страной.

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
MASTER_DIR = REPO_ROOT / "scripts" / "map" / "master"

# Геометрия читается из МАСТЕРА, если он есть (2026-07-30). Мастер —
# единственный стартовый источник: геометрия в нём согласована один раз
# (build/weld_map_gaps.py + build/rebuild_shared_edges.py) и зафиксирована в
# git, поэтому обычная сборка больше не прогоняет 31 шаг согласования
# несовпадающих источников. Fallback на out/world_1946.geojson оставлен
# осознанно: он нужен ровно в тот момент, когда мастер пересобирают
# (MASTER_REBUILD_STEPS) и он ещё не заморожен.
MASTER_GEOJSON = MASTER_DIR / "world_1946.master.geojson"


def world_geojson_path() -> Path:
    """Путь к исходной геометрии: мастер, иначе — свежесобранный out/."""
    if MASTER_GEOJSON.exists():
        return MASTER_GEOJSON
    return OUT_DIR / "world_1946.geojson"

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

# Скобочные хвосты в конце имени бывают двух разных видов, и снимать надо
# только один.
#
# ШУМ: технические индексы ("Burgas (5)") и протёкшие заметки составителя MAP
# ("Nepal (план: 'каждый в отдельный регион')", "Gibraltar (отдельный
# iso_a2='GI', не входил в список стран)"). Снимаем.
#
# СМЫСЛ: уточнение, которым пайплайн РАЗЛИЧАЕТ регионы. Раньше снималось тоже,
# и это молча ломало данные (замер 2026-08-02 на 1577 фичах):
#   - "Dalian (Port Arthur / Kwantung Leased Territory)" -> "Dalian",
#     то есть курируемое историческое имя откатывалось при каждом экспорте;
#   - "Distrito Federal (Rio de Janeiro)" и "Rio de Janeiro (estado)"
#     превращались в неразличимую пару;
#   - "Territoires du Sud (Deep Sahara)" и "(Saharan fringe)" — в одно имя;
#   - "Australian Sector (West)" и "(East)" — в одно имя.
# Всего 33 региона теряли уточнение, из них три пары давали дубликаты.
#
# Заметок составителя в данных на 2026-08-02 не осталось ни одной — их
# вычистили у источника. Правило для них сохранено как страховка на будущее:
# признак заметки — кириллица, знак "=" или апостроф внутри скобок.
TRAILING_INDEX_RE = re.compile(r"(?:\s*\(\d+\))+\s*$")
AUTHORING_NOTE_RE = re.compile(r"(?:\s*\([^()]*(?:[А-Яа-яЁё]|=|')[^()]*\))+\s*$")


def strip_trailing_index(name: str) -> str:
    """Снимает шумовые хвосты, сохраняя различающие уточнения."""
    prev = None
    while prev != name:
        prev = name
        name = TRAILING_INDEX_RE.sub("", name)
        name = AUTHORING_NOTE_RE.sub("", name)
    return name.strip()


# Скобок в игровых именах быть не должно (решение пользователя 2026-08-02).
# Уточнение, которое РАЗЛИЧАЕТ два региона, нельзя ни срезать (получится пара
# одинаковых имён), ни оставить в скобках — поэтому каждому такому региону
# задано своё плоское имя в конфигурации.
_NAME_OVERRIDES: dict[str, dict[str, str]] | None = None


def name_overrides() -> dict[str, dict[str, str]]:
    global _NAME_OVERRIDES
    if _NAME_OVERRIDES is None:
        path = CONFIG_DIR / "region_name_overrides.json"
        _NAME_OVERRIDES = load_json(path).get("overrides", {}) if path.is_file() else {}
    return _NAME_OVERRIDES


def region_name(region_id: str, raw: str, lang: str) -> str:
    """Плоское имя региона: переопределение из конфигурации, иначе очищенное сырое."""
    ov = name_overrides().get(region_id)
    if ov and ov.get(lang):
        return ov[lang]
    return strip_trailing_index(raw)


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


def load_historical_region_overrides() -> dict[str, str]:
    config = load_json(CONFIG_DIR / "country_entities_1946.json")
    overrides: dict[str, str] = {}
    for continent, section in config.get("continents", {}).items():
        for entry in section.get("regionOwnerOverrides", []):
            region_id = entry["regionId"]
            target = entry["to"]
            confidence = entry.get("confidence")
            reason = entry.get("reason")
            if not isinstance(target, str) or len(target) != 3:
                raise ValueError(f"Некорректный target historical region owner override: {entry}")
            if confidence not in {"high", "medium", "low"}:
                raise ValueError(f"Некорректный confidence historical region owner override: {entry}")
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError(f"Пустой reason historical region owner override: {entry}")
            if region_id in overrides:
                raise ValueError(f"Дубликат historical region owner override: {region_id} ({continent})")
            overrides[region_id] = target
    return overrides


def main():
    world_src = world_geojson_path()
    print(f"Геометрия из: {world_src.relative_to(REPO_ROOT)}")
    world = load_json(world_src)
    ownership = load_json(OUT_DIR / "ownership_1946.json")
    neighbors = load_json(OUT_DIR / "neighbor_graph.json")["neighbors"]
    names = {n["region_id"]: n for n in load_json(OUT_DIR / "names_ru.json")}
    overlay = load_json(CONFIG_DIR / "occupation_overlay.json")
    overlay = {k: v for k, v in overlay.items() if not k.startswith("_")}

    features = world["features"]
    feature_ids = {ft["properties"]["region_id"] for ft in features}
    historical_overrides = load_historical_region_overrides()
    unknown_overrides = sorted(set(historical_overrides) - feature_ids)
    if unknown_overrides:
        raise ValueError(
            "Historical region owner overrides ссылаются на неизвестные регионы: "
            + ", ".join(unknown_overrides)
        )
    overlay.update(historical_overrides)

    # Числовой id — стабильный, в порядке region_id (уже continent-префиксован
    # и последовательный в world_1946.geojson).
    region_id_to_numeric: dict[str, int] = {}
    for i, ft in enumerate(features, start=1):
        region_id_to_numeric[ft["properties"]["region_id"]] = i

    # Множество land-регионов из САМОГО world-файла (не из names_ru.json) —
    # только они становятся Region, поэтому только на них может ссылаться
    # neighboringRegionIds. Раньше фильтр соседей смотрел region_type в
    # names_ru.json; любой водоём, отсутствующий там (напр. заново добавленный
    # Кинерет LAK-0012, 2026-07-19-f), проходил фильтр как "land" по дефолту и
    # утекал висячей ссылкой в граф соседей. Источник истины о типе — world.
    land_region_ids = {
        ft["properties"]["region_id"] for ft in features
        if ft["properties"].get("region_type", "land") == "land"
    }

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
                "name": region_name(region_id, props.get("name", ""), "en"),
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
            if n in region_id_to_numeric and n in land_region_ids
        ]
        numeric_id = region_id_to_numeric[region_id]

        names_en_out[region_id] = region_name(
            region_id, name_entry.get("name_en", props.get("name", region_id)), "en")
        names_ru_out[region_id] = region_name(
            region_id, name_entry.get("name_ru", name_entry.get("name_en", region_id)), "ru")

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

    # Инвариант решения 2026-08-02: скобок в игровых именах нет. Проверяем ВСЕ
    # три выхода — клиентскую геометрию и оба словаря имён.
    with_paren = sorted(
        {f["properties"]["region_id"] for f in out_features if "(" in f["properties"]["name"]}
        | {rid for rid, n in names_en_out.items() if "(" in n}
        | {rid for rid, n in names_ru_out.items() if "(" in n}
    )
    if with_paren:
        raise SystemExit(
            "имена со скобками остались — добавь их в config/region_name_overrides.json: "
            + ", ".join(with_paren[:20]))

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
