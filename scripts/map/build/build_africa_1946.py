"""
build_africa_1946.py
Африка 1946: 47 стран + потеряшки (Кабо-Верде, Сейшелы, Коморы, Зап.Сахара,
Св.Елена, Брит.территория в Индийском океане, Реюньон+Майотта из FR).

Почти вся Африка в 1946 - колонии; современные границы СТРАН в основном
совпадают с колониальными адм.границами (не менялись при независимости),
поэтому глубокая историческая реконструкция (как для Кубы/Гаити/Бразилии)
здесь не нужна - вопрос владения (Stage 4), не геометрии. Где есть поле
region - использую (реальные исторические провинции, в т.ч. Уганда -
ровно 4 британские провинции 1946 года). Остальное - геометрическое
укрупнение с компактностью, детализация уменьшена по аналогии с Южной
Америкой.
"""
from paths import game_map, out
import json
import math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
SRC = game_map()
OUT = out("africa_1946.geojson")

REGION_FIELD = {
    "BF": {},  # 13 регионов Буркина-Фасо
    "GN": {},  # 8 регионов Гвинеи
    "GW": {},  # 4 (Leste/Sul/Norte/Bissau)
    "MW": {},  # 3 (Northern/Central/Southern)
    "SD": {},  # 6 историч. провинций Судана
    "SS": {},  # 3 историч. провинции Юж.Судана (Equatoria/Bahr al Ghazal/Upper Nile)
}

# Уганда -> 1 регион целиком (по явному указанию)
SINGLE_COUNTRY = {"UG": "Уганда", "GM": "Гамбия"}

# Руанда: уже 4 провинции + Kigali - оставляем как есть (значимость геноцида
# 1994 года - региональная динамика важна), не сливаем
KEEP_AS_IS = {"RW"}

# целевое число регионов для стран без поля region (площадь+значимость,
# мягкая детализация, по аналогии с Южной Америкой)
GEOMETRIC_TARGETS = {
    "NG": 3, "ZA": 4, "ET": 5, "MG": 5, "TZ": 5, "MA": 4,
    "AO": 5, "MZ": 5, "CD": 6, "SO": 4, "KE": 4, "TN": 4, "GH": 3,
    "CM": 4, "CI": 4, "ML": 4, "NE": 3, "TD": 4, "ZM": 4, "ZW": 3,
    "SN": 3, "NA": 3, "CV": 2, "SC": 2,
    "DJ": 1, "ER": 2, "GA": 2, "GQ": 1, "LR": 2, "LS": 1, "MR": 2,
    "MU": 1, "SL": 1, "ST": 1, "SZ": 1, "TG": 1, "BJ": 2,
    "BW": 2, "CF": 2, "CG": 2,
    "BI": 3,  # значимость гражданской войны/этнического конфликта (как Руанда)
}

SINGLE_ORPHANS = {
    "KM": "Коморы",
    "EH": "Западная Сахара (Испанская Сахара)",
    "SH": "Св. Елена, Вознесения и Тристан-да-Кунья",
    "IO": "Брит. территория в Индийском океане (Чагос)",
}
FR_EXTRACT_REGIONS = {"Réunion": "GF_RE", "Mayotte": "GF_YT"}

# Сомалиленд - отдельный iso_a2='-1', admin='Somaliland' (бывший Британский
# Сомалиленд, с 1991 де-факто независим, не входил в список стран)
EXTRA_BY_ADMIN = {"Somaliland": "Сомалиленд"}

# --------------------------------------------------------------------------
# Египет: явное разделение с акцентом на Нил (3 нильских региона: Каир/
# Дельта/Долина) отдельно от пустынных (Синай, Западная пустыня/Красное
# море) - актуально для Суэцкого кризиса 1956, Шестидневной войны 1967
# (Синай!), войны Йом-Кипур 1973 (тоже Синай/Суэц)
# --------------------------------------------------------------------------
EGYPT_GROUPS = {
    # Каир + три губернаторства долины Нила, тесно связанные со столичной
    # агломерацией (Фаюм/Бени-Суэйф/Минья - северная часть Верхнего Египта)
    "Каир (Большой Каир)": ["Al Qahirah", "Al Jizah", "Al Qalyubiyah",
        "Al Fayyum", "Bani Suwayf", "Al Minya"],
    # Александрия отдельно - вторая столица, средиземноморский порт
    "Александрия": ["Al Iskandariyah"],
    # Дельта без Александрии и без зоны канала
    "Дельта Нила (Нижний Египет)": ["Ad Daqahliyah", "Al Buhayrah", "Al Gharbiyah",
        "Al Minufiyah", "Ash Sharqiyah", "Dumyat", "Kafr ash Shaykh"],
    # Зона Суэцкого канала - Порт-Саид/Исмаилия/Суэц - отдельно по стратегической
    # значимости (кризис 1956, закрытие канала 1967-75)
    "Зона Суэцкого канала": ["Bur Sa`id", "Al Isma`iliyah", "As Suways"],
    # Долина Нила без северной части (та теперь в группе Каира)
    "Долина Нила (Верхний Египет)": ["Aswan", "Asyut", "Luxor", "Qina", "Suhaj"],
    "Синай": ["Janub Sina'", "Shamal Sina'"],
    # Матрух - средиземноморское побережье Зап. пустыни (Эль-Аламейн) - отдельно
    "Матрух": ["Matruh"],
    # Красное море и Новая Долина разделены ВСЕЙ долиной Нила - не граничат
    # физически, поэтому раздельно (а не "Западная пустыня/Красное море" вместе)
    "Красное море": ["Al Bahr al Ahmar"],
    "Новая Долина (Зап. пустыня)": ["Al Wadi at Jadid"],
}

# --------------------------------------------------------------------------
# Ливия: 3 настоящих исторических региона (Триполитания/Киренаика/Феццан) -
# актуально и для современности (раскол востока/запада в гражданской войне
# с 2011 года практически по этой же линии). Классификация по координатам
# (lon<18: Триполитания если lat>28, иначе Феццан; lon>=18: Киренаика) -
# даёт точное совпадение 9+6+7=22.
# --------------------------------------------------------------------------
def libya_zone(lon, lat):
    if lon >= 18:
        return "Киренаика"
    return "Триполитания" if lat > 28 else "Феццан"


# --------------------------------------------------------------------------
# Алжир 1946: 3 настоящих департамента (Alger/Oran/Constantine, civil) +
# Territoires du Sud (военная администрация Сахары). Юг дополнительно
# разделён на ближнюю пустынную кайму и глубокую Сахару (туарегские земли -
# актуально для современных конфликтов туарегов, по аналогии с Мали/Нигером).
# Классификация по координатам: lat<33.5 -> юг; в севере по долготе
# Oran(<1.7)/Alger(1.7-4.65)/Constantine(>=4.65).
# --------------------------------------------------------------------------
def algeria_zone(lon, lat):
    if lat < 33.5:
        return "Territoires du Sud (Сахара)" if lat < 29 else "Territoires du Sud (кайма)"
    if lon < 1.7:
        return "Oran"
    if lon < 4.65:
        return "Alger"
    return "Constantine"


CUSTOM_ZONE_COUNTRIES = {"LY": libya_zone, "DZ": algeria_zone}


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


def reduce_clusters(clusters, target):
    clusters = list(clusters)
    if len(clusters) <= target:
        return clusters
    while len(clusters) > target:
        adj = adjacency(clusters)
        candidates = [i for i in range(len(clusters)) if adj[i]]
        if not candidates:
            break
        i = min(candidates, key=lambda idx: clusters[idx]["area"])
        best_j, best_score = None, -1.0
        for j in adj[i]:
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
        keep = [clusters[k] for k in range(len(clusters)) if k not in (i, j)]
        clusters = keep + [merged]
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
    ALL_KEEP = set(KEEP_AS_IS)
    ALL_ZONE = set(CUSTOM_ZONE_COUNTRIES)
    EGYPT_ALL_NAMES = {n for names in EGYPT_GROUPS.values() for n in names}
    ALL_COUNTRIES = ALL_GEOM | ALL_REGION | ALL_SINGLE | ALL_KEEP | ALL_ZONE | {"EG"}

    by_country = {}
    fr_extract = {}
    extra_admin = {}
    for f in feats:
        p = f["properties"]
        iso2 = p.get("iso_a2")
        if iso2 == "FR" and p.get("region") in FR_EXTRACT_REGIONS:
            fr_extract.setdefault(p["region"], []).append(shape(f["geometry"]))
            continue
        if iso2 == "-1" and p.get("admin") in EXTRA_BY_ADMIN:
            extra_admin.setdefault(p["admin"], []).append(shape(f["geometry"]))
            continue
        if iso2 in ALL_COUNTRIES:
            g = shape(f["geometry"])
            by_country.setdefault(iso2, []).append({
                "codes": [p.get("adm1_code")], "names": [p.get("name")],
                "geom": g, "area": area_km2(g), "region_field": (p.get("region") or "").strip(),
            })

    out_features = []

    # Реюньон / Майотта - потеряшки из FR
    for region_name, label in FR_EXTRACT_REGIONS.items():
        if region_name in fr_extract:
            g = unary_union(fr_extract[region_name])
            out_features.append(make_feature("FR", region_name, g, "extracted_from_europe"))

    # Сомалиленд - потеряшка с iso_a2='-1'
    for admin_name, label in EXTRA_BY_ADMIN.items():
        if admin_name in extra_admin:
            g = unary_union(extra_admin[admin_name])
            out_features.append(make_feature("-1", label, g, "extracted_orphan"))
        else:
            print(f"  [EXTRA] {admin_name} не найден")

    # Орфанные микро-территории, не входившие в список 47 стран
    for iso2, label in SINGLE_ORPHANS.items():
        items = [f for f in feats if f["properties"].get("iso_a2") == iso2]
        if not items:
            print(f"  [ORPHAN] {iso2} не найден")
            continue
        g = unary_union([shape(f["geometry"]) for f in items])
        out_features.append(make_feature(iso2, label, g, "single_orphan"))

    # Уганда -> 1 регион целиком (по явному указанию)
    for iso2, label in SINGLE_COUNTRY.items():
        items = by_country.get(iso2, [])
        if not items:
            print(f"  [{iso2}] ВНИМАНИЕ: 0 регионов")
            continue
        g = unary_union([it["geom"] for it in items])
        out_features.append(make_feature(iso2, label, g, "single_country",
                                          [it["codes"][0] for it in items]))
        print(f"{iso2}: {len(items)} -> 1 (явное объединение)")

    # Руанда - оставляем как есть (значимость геноцида 1994)
    for iso2 in sorted(ALL_KEEP):
        items = by_country.get(iso2, [])
        for it in items:
            out_features.append(make_feature(iso2, it["names"][0], it["geom"], "keep", it["codes"]))
        print(f"{iso2}: {len(items)} -> {len(items)} (keep as-is)")

    # Египет - явное разделение с акцентом на Нил
    eg_items = by_country.get("EG", [])
    eg_by_name = {it["names"][0]: it for it in eg_items}
    for label, names in EGYPT_GROUPS.items():
        parts = [eg_by_name[n] for n in names if n in eg_by_name]
        missing = [n for n in names if n not in eg_by_name]
        if missing:
            print(f"  [EG] ВНИМАНИЕ: не найдены {missing} для '{label}'")
        if not parts:
            continue
        g = unary_union([p["geom"] for p in parts]) if len(parts) > 1 else parts[0]["geom"]
        out_features.append(make_feature("EG", label, g, "historical_nile_split",
                                          [p["codes"][0] for p in parts]))
    print(f"EG: {len(eg_items)} -> {len(EGYPT_GROUPS)} (явное разделение, акцент на Нил)")

    # Ливия / Алжир - зональное геометрическое укрупнение (историч. регионы)
    for iso2, zone_func in CUSTOM_ZONE_COUNTRIES.items():
        items = by_country.get(iso2, [])
        buckets = {}
        for it in items:
            lon, lat = it["geom"].centroid.x, it["geom"].centroid.y
            zone = zone_func(lon, lat)
            buckets.setdefault(zone, []).append(it)
        clusters_out = []
        for zone, grp in buckets.items():
            g = unary_union([x["geom"] for x in grp]) if len(grp) > 1 else grp[0]["geom"]
            out_features.append(make_feature(iso2, zone, g, "historical_region",
                                              [x["codes"][0] for x in grp]))
            clusters_out.append(zone)
        print(f"{iso2}: {len(items)} -> {len(clusters_out)} ({', '.join(clusters_out)})")

    # Страны с полем region - группировка (ВНИМАНИЕ: пустой region у разных
    # объектов НЕ объединяем вместе просто по совпадению пустого ключа - это
    # склеило 2 разных полигона "Chitipa" в Малави в одну фигуру 17,000 км2
    # при реальной площади ~1,151 км2. Каждый "пустой" остаётся отдельно.)
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
            clusters.append({"codes": [x["codes"][0] for x in grp], "name": key,
                              "geom": g, "area": sum(x["area"] for x in grp)})
        for it in singles:
            clusters.append({"codes": [it["codes"][0]], "name": it["names"][0],
                              "geom": it["geom"], "area": it["area"]})
        for cl in clusters:
            out_features.append(make_feature(iso2, cl["name"], cl["geom"], "region_field", cl["codes"]))
        if singles:
            print(f"  [{iso2}] {len(singles)} элементов без region остались отдельными синглтонами: "
                  f"{[s['names'][0] for s in singles]}")
        print(f"{iso2}: {len(items)} -> {len(clusters)} (region field)")

    # Страны без поля region - геометрическое укрупнение
    for iso2, target in GEOMETRIC_TARGETS.items():
        items = by_country.get(iso2, [])
        if not items:
            print(f"  [{iso2}] ВНИМАНИЕ: 0 регионов")
            continue
        clusters = reduce_clusters(items, target)
        for cl in clusters:
            out_features.append(make_feature(iso2, cl["names"][0], cl["geom"], "geometric", cl["codes"]))
        print(f"{iso2}: {len(items)} -> {len(clusters)}")

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    print(f"\nРегионов: {len(out_features)}")
    total = sum(ft["properties"]["area_km2"] for ft in out_features)
    print(f"Суммарная площадь: {total:,.0f} km2")


if __name__ == "__main__":
    main()
