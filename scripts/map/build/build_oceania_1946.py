"""
build_oceania_1946.py
Океания 1946: 14 стран + 12 потеряшек (огромное число мелких
тихоокеанских территорий с отдельными iso_a2).

Учёт будущих конфликтов/деколонизации (по аналогии с Африкой):
  - North Solomons (Бугенвиль) в PNG - сохранён отдельно (война 1988-1998,
    автономия с 2019)
  - Guadalcanal и Malaita в Solomon Islands - сохранены отдельно
    ("The Tensions" 1998-2003, этнический конфликт)
  - Новая Каледония - отдельный орфан (движение FLNKS, "Les Événements" 1980-х)
  - Gilbert and Ellice Islands (Kiribati+Tuvalu), Trust Territory of Pacific
    Islands (Marshall+Micronesia+Palau), New Hebrides condominium (Vanuatu) -
    были едиными колониальными образованиями в 1946, но границы СТРАН не
    менялись при разделении - это вопрос владения (Stage 4), не геометрии.
"""
from paths import game_map, out
import json
import math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
SRC = game_map()
OUT = out("oceania_1946.geojson")

REGION_FIELD = {"NZ": {}}  # North/South Island, Chatham, Outlying

# Австралия: материковые штаты/территории оставляем, мелкие отдалённые
# острова явно переносим к административно ответственному штату (не
# архипелаг в одном месте, а разбросанные по разным океанам владения -
# проще и честнее присоединить к тому, кто их реально администрирует)
AU_ISLAND_TO_STATE = {
    "Macquarie Island": "Tasmania",
    "Lord Howe Island": "New South Wales",
    "Ashmore and Cartier Islands": "Northern Territory",
    "Jervis Bay Territory": "New South Wales",
}

SINGLE_COUNTRY = {"NR": "Науру", "TV": "Тувалу", "KI": "Кирибати", "MH": "Маршалловы Острова",
                   "TO": "Тонга"}

# целевое число при геометрическом укрупнении - КРОМЕ явно защищённых имён.
# Детализация снижена по запросу - острова одной страны объединяются по
# архипелагу большим буфером (см. ARCHIPELAGO_BUFFER_DEG), но НИКОГДА не
# смешиваются между разными странами/владельцами.
#
# PG/SB здесь НЕ перечислены (были 5/3 до 2026-07-29) - каждая сырая
# adm1-фича этих двух стран уже отдельная настоящая провинция (PG: 20 шт,
# SB: 10 шт, ни одного повтора имени - подтверждено прямым подсчётом), не
# избыточная детализация уровня округа/графства, как у США/России в этом
# датасете. Принудительное сжатие до 5/3 заставляло reduce_clusters сливать
# ГЕОГРАФИЧЕСКИ НЕСВЯЗАННЫЕ провинции только чтобы уложиться в целевое число
# (ARCHIPELAGO_BUFFER_DEG=3.0 буфер "соседства" считал соседями всё в
# ~330 км) - "Isabel" поглотил почти всю остальную цепь Соломоновых
# островов (42 куска, разброс 9.6°), "Southern Highlands" (материковая, без
# выхода к морю) вобрал часть архипелага Бисмарка (разброс 8.1°) и т.д.
# (см. docs/DECISIONS.md 2026-07-29, класс SCATTERED в audit_map_geometry.py). См.
# RAW_PASSTHROUGH ниже - обе страны идут как есть, без укрупнения.
GEOMETRIC_TARGETS = {
    "VU": 1, "WS": 1, "PW": 1, "FJ": 1, "FM": 1,
}
# эти имена никогда не сливаем с другими при геометрическом укрупнении
PROTECTED_NAMES = {"North Solomons", "Guadalcanal", "Malaita"}

# Страны, где каждая сырая adm1-фича уже настоящая, самодостаточная
# провинция - выводятся 1:1 без геометрического укрупнения (см. комментарий
# у GEOMETRIC_TARGETS выше). НЕ архипелаг-буфер (там нет разбросанных
# островов одной провинции, которые надо было бы сшить) - именно raw
# passthrough.
RAW_PASSTHROUGH = {"PG", "SB"}

SINGLE_ORPHANS = {
    "NC": "Новая Каледония", "PF": "Французская Полинезия", "AS": "Американское Самоа",
    "GU": "Гуам", "MP": "Северные Марианские о-ва", "CK": "О-ва Кука", "NU": "Ниуэ",
    "NF": "О. Норфолк", "PN": "О-ва Питкерн", "UM": "Малые отдалённые о-ва США (Уэйк/Мидуэй/Джонстон)",
    "WF": "Уоллис и Футуна", "TK": "Токелау",
    # Субантарктика — отсутствовали вовсе (2026-07-22, diagnose_missing_
    # land.py). Реальный iso_a2 (не "-1"), тот же простой orphan-путь.
    # "Архипелаг" по игровому определению пользователя — 4 разбросанные
    # фичи TF (Кергелен/Крозе/Амстердам/Эпарсе) сливаются в 1 регион.
    "HM": "О. Херд и о-ва Макдональд",
    "TF": "Французские Южные территории",
}

# Отдельные фичи по adm1_code, минуя страновой фильтр — для территорий с
# iso_a2='-1' (не страна в датасете), у которых реально ЕСТЬ собственный
# полигон. Тот же паттерн, что EXTRA_SINGLE_FEATURES в build_asia_1946.py/
# build_namerica_1946.py. Cocos/Christmas/Coral Sea Islands (2026-07-22,
# класс MISSING_LAND в audit_map_geometry.py) — sov_a3='AU1', австралийские внешние
# территории, выходной iso_a2='AU' (владелец по сюзерену).
EXTRA_SINGLE_FEATURES = [
    ("IOA-1928", "Кокосовые (Килинг) острова", "AU"),
    ("IOA-2652", "Остров Рождества", "AU"),
    ("CSI+00?", "О-ва Кораллового моря", "AU"),
]


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def compactness(geom):
    perim = geom.length
    if perim == 0:
        return 0.0
    return 4 * math.pi * geom.area / (perim ** 2)


def adjacency(clusters, buffer_deg=0.0005):
    n = len(clusters)
    adj = {i: set() for i in range(n)}
    buffered = [c["geom"].buffer(buffer_deg) for c in clusters]
    for i in range(n):
        for j in range(i + 1, n):
            if buffered[i].intersects(buffered[j]):
                adj[i].add(j)
                adj[j].add(i)
    return adj


# Архипелаги - острова одной страны разделены водой, но принадлежат одному
# владельцу, поэтому крупный буфер тут безопасен: unary_union при слиянии
# НЕ заливает воду новой территорией, просто объединяет существующие
# острова в один MultiPolygon (в отличие от заливки зазоров между разными
# странами, где буфер мог случайно "нарисовать" лишнюю землю в океане).
ARCHIPELAGO_BUFFER_DEG = 3.0


def reduce_clusters(clusters, target, protected_idx=frozenset(), buffer_deg=0.0005):
    clusters = list(clusters)
    if len(clusters) <= target:
        return clusters
    while len(clusters) > target:
        adj = adjacency(clusters, buffer_deg)
        candidates = [i for i in range(len(clusters)) if adj[i] and i not in protected_idx]
        if not candidates:
            break
        i = min(candidates, key=lambda idx: clusters[idx]["area"])
        # защищённые кластеры не предлагаем как партнёра для слияния
        opts = [j for j in adj[i] if j not in protected_idx]
        if not opts:
            break
        best_j, best_score = None, -1.0
        for j in opts:
            trial = unary_union([clusters[i]["geom"], clusters[j]["geom"]])
            score = compactness(trial)
            if score > best_score:
                best_j, best_score = j, score
        j = best_j
        merged_geom = unary_union([clusters[i]["geom"], clusters[j]["geom"]])
        names = clusters[i]["names"] + clusters[j]["names"]
        areas = [clusters[i]["area"]] * len(clusters[i]["names"]) + [clusters[j]["area"]] * len(clusters[j]["names"])
        main_name = max(zip(names, areas), key=lambda x: x[1])[0]
        merged = {"codes": clusters[i]["codes"] + clusters[j]["codes"],
                   "names": [main_name] + names, "geom": merged_geom,
                   "area": clusters[i]["area"] + clusters[j]["area"]}
        new_idx = len(clusters) - 2  # после удаления i,j и добавления merged в конец
        keep_order = [k for k in range(len(clusters)) if k not in (i, j)]
        clusters = [clusters[k] for k in keep_order] + [merged]
        # пересчитываем protected_idx под новую нумерацию
        remap = {old: new for new, old in enumerate(keep_order)}
        protected_idx = frozenset(remap[k] for k in protected_idx if k in remap)
    return clusters


def make_feature(iso2, name, geom, method, codes=None):
    return {
        "type": "Feature",
        "properties": {"iso_a2": iso2, "name": name, "area_km2": round(area_km2(geom), 1),
                        "merge_method": method, "source_adm1": codes or []},
        "geometry": mapping(geom),
    }


def main():
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    feats = data["features"]

    ALL_GEOM = set(GEOMETRIC_TARGETS)
    ALL_REGION = set(REGION_FIELD)
    ALL_SINGLE = set(SINGLE_COUNTRY)
    ALL_COUNTRIES = ALL_GEOM | ALL_REGION | ALL_SINGLE | RAW_PASSTHROUGH | {"AU"}

    by_country = {}
    for f in feats:
        p = f["properties"]
        iso2 = p.get("iso_a2")
        if iso2 in ALL_COUNTRIES:
            g = shape(f["geometry"])
            by_country.setdefault(iso2, []).append({
                "codes": [p.get("adm1_code")], "names": [p.get("name")],
                "geom": g, "area": area_km2(g), "region_field": (p.get("region") or "").strip(),
            })

    out_features = []

    # Отдельные фичи по adm1_code (iso_a2='-1', минуя страновой фильтр)
    by_code = {f["properties"].get("adm1_code"): f for f in feats}
    for code, label, out_iso2 in EXTRA_SINGLE_FEATURES:
        f = by_code.get(code)
        if not f:
            print(f"  [EXTRA] ВНИМАНИЕ: '{label}' ({code}) не найден в game_map.json")
            continue
        g = shape(f["geometry"])
        out_features.append(make_feature(out_iso2, label, g, "extra", [code]))

    # Орфанные территории
    for iso2, label in SINGLE_ORPHANS.items():
        items = [f for f in feats if f["properties"].get("iso_a2") == iso2]
        if not items:
            print(f"  [ORPHAN] {iso2} не найден")
            continue
        g = unary_union([shape(f["geometry"]) for f in items])
        out_features.append(make_feature(iso2, label, g, "single_orphan"))

    # Науру/Тувалу/Кирибати/Маршалловы/Тонга -> по 1
    for iso2, label in SINGLE_COUNTRY.items():
        items = by_country.get(iso2, [])
        g = unary_union([it["geom"] for it in items])
        out_features.append(make_feature(iso2, label, g, "single_country", [it["codes"][0] for it in items]))
        print(f"{iso2}: {len(items)} -> 1")

    # Австралия: материковые штаты/территории как есть + мелкие отдалённые
    # острова явно присоединены к администрирующему штату (разбросаны по
    # разным океанам - не один архипелаг, поэтому не общий буфер, а явное
    # присвоение владельцу)
    au_items = by_country.get("AU", [])
    au_by_name = {it["names"][0]: it for it in au_items}
    au_mainland = {}
    for it in au_items:
        name = it["names"][0]
        if name in AU_ISLAND_TO_STATE:
            continue
        au_mainland[name] = it
    for island_name, state_name in AU_ISLAND_TO_STATE.items():
        if island_name in au_by_name and state_name in au_mainland:
            isl = au_by_name[island_name]
            au_mainland[state_name] = {
                "codes": au_mainland[state_name]["codes"] + isl["codes"],
                "names": [state_name],
                "geom": unary_union([au_mainland[state_name]["geom"], isl["geom"]]),
                "area": au_mainland[state_name]["area"] + isl["area"],
            }
    for name, it in au_mainland.items():
        out_features.append(make_feature("AU", name, it["geom"], "merged_to_administering_state",
                                          it["codes"] if isinstance(it["codes"], list) else [it["codes"]]))
    print(f"AU: {len(au_items)} -> {len(au_mainland)} (мелкие острова присоединены к штату-администратору)")

    # NZ - по region field
    for iso2 in sorted(ALL_REGION):
        items = by_country.get(iso2, [])
        buckets = {}
        singles = []
        for it in items:
            if not it["region_field"]:
                singles.append(it)
                continue
            buckets.setdefault(it["region_field"], []).append(it)
        clusters = []
        for key, grp in buckets.items():
            g = unary_union([x["geom"] for x in grp]) if len(grp) > 1 else grp[0]["geom"]
            clusters.append((key, g, [x["codes"][0] for x in grp]))
        for it in singles:
            clusters.append((it["names"][0], it["geom"], [it["codes"][0]]))
        for name, g, codes in clusters:
            out_features.append(make_feature(iso2, name, g, "region_field", codes))
        print(f"{iso2}: {len(items)} -> {len(clusters)} (region field)")

    # Raw passthrough (PG/SB) - каждая сырая adm1-фича уже настоящая
    # провинция, выводится как есть, без укрупнения (см. комментарий у
    # GEOMETRIC_TARGETS/RAW_PASSTHROUGH выше).
    for iso2 in sorted(RAW_PASSTHROUGH):
        items = by_country.get(iso2, [])
        for it in items:
            out_features.append(make_feature(iso2, it["names"][0], it["geom"], "raw_passthrough", it["codes"]))
        print(f"{iso2}: {len(items)} -> {len(items)} (raw passthrough, без укрупнения)")

    # Геометрическое укрупнение с защитой значимых провинций - большой
    # буфер для объединения островов одной страны по архипелагу (безопасно,
    # т.к. слияние не заливает воду новой территорией)
    for iso2, target in GEOMETRIC_TARGETS.items():
        items = by_country.get(iso2, [])
        if not items:
            continue
        clusters0 = [{"codes": it["codes"], "names": it["names"], "geom": it["geom"], "area": it["area"]}
                     for it in items]
        protected_idx = frozenset(i for i, c in enumerate(clusters0) if c["names"][0] in PROTECTED_NAMES)
        clusters = reduce_clusters(clusters0, target, protected_idx, buffer_deg=ARCHIPELAGO_BUFFER_DEG)
        for cl in clusters:
            out_features.append(make_feature(iso2, cl["names"][0], cl["geom"], "geometric", cl["codes"]))
        protected_kept = [c["names"][0] for c in clusters if c["names"][0] in PROTECTED_NAMES]
        print(f"{iso2}: {len(items)} -> {len(clusters)} (защищены: {protected_kept})")

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    print(f"\nРегионов: {len(out_features)}")
    total = sum(ft["properties"]["area_km2"] for ft in out_features)
    print(f"Суммарная площадь: {total:,.0f} km2")


if __name__ == "__main__":
    main()
