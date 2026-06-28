"""
build_europe_1946.py
Этап 2-3 (Европа): маппинг + объединение ADM1-регионов game_map.json
в исторически осмысленные макро-регионы для сценария 1946 года.

Подход для каждой страны:
  - keep        : оставить как есть (уже корректная гранулярность, напр. немецкие земли)
  - region      : сгруппировать по полю properties.region (реальные NUTS/исторические области)
  - geometric   : геометрическое объединение по смежности до целевого числа регионов

Запуск: python3 build_europe_1946.py
"""
from paths import game_map, out
import json
import time
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
SRC = game_map()
OUT = out("europe_1946.geojson")

# --------------------------------------------------------------------------
# Конфигурация по странам (iso_a2 -> метод)
# --------------------------------------------------------------------------

KEEP_AS_IS = {
    "AT": "Австрия — уже 9 земель",
    "SK": "Словакия — уже 8 краёв",
    "DE": "Германия — уже 16 земель (зонирование отдельным шагом)",
    "DK": "Дания (метрополия) — уже 5 единиц",
    "CY": "Кипр — 5 округов, не избыточно",
    "VA": "Ватикан — 1 регион",
    "BY": "Белорусская ССР — уже 6 областей + Минск",
    "GR": "Греция — оставлена без изменений по плану",
    "UA": "Украина — не трогаем по явному указанию",
}

# Страны, которые сворачиваем в ОДИН регион целиком
SINGLE_REGION = {
    "MK": "Северная Македония",
    "AL": "Албания",
    "ME": "Черногория",
    "SI": "Словения",
    "IS": "Исландия",
    "AD": "Андорра",
    "XK": "Косово (отдельный iso_a2='XK' в данных, не входил в список стран)",
    "AX": "Аландские острова (отдельный iso_a2='AX', автономия Финляндии)",
    "GI": "Гибралтар (отдельный iso_a2='GI', не входил в список стран)",
    "LI": "Лихтенштейн (отдельный iso_a2='LI', не входил в список стран)",
    "SM": "Сан-Марино (отдельный iso_a2='SM', не входил в список стран)",
    "MC": "Монако (отдельный iso_a2='MC', не входил в список стран)",
    "MD": "Молдавская ССР",
}

REGION_FIELD = {
    "IT": {},
    "GB": {},
    "LV": {},
    "MT": {},
    "IE": {},
    "HU": {},
    "BE": {},
    "BA": {},
    "FR": {"exclude_region": {"Guyane française", "Martinique", "Guadeloupe", "Réunion", "Mayotte"}},
    "ES": {},
    "PT": {},
}

GEOMETRIC = {
    "BG": 6, "CH": 8, "CZ": 5, "EE": 3, "FI": 6,
    "HR": 4, "LT": 3, "LU": 1, "NO": 6,
    "PL": 9, "RO": 6, "SE": 7, "RS": 7,
    "NL": 5,  # с исключением карибских территорий
}

# --------------------------------------------------------------------------
# РСФСР — точная историческая карта из документа пользователя.
# Формат: "название" -> [adm1_code, ...] (несколько кодов = объединить).
#
# Все 86 современных ADM1-юнитов России учтены без остатка и без задвоений.
# Особые случаи:
#   - Чечено-Ингушская АССР: собрана обратно из 2 современных республик
#     (Chechnya + Ingushetia), которые разделились только в 1992-93 гг.
#   - 6 автономных округов (Таймырский, Эвенкийский, Корякский,
#     Коми-Пермяцкий, Усть-Ордынский Бурятский, Агинский Бурятский) НЕ
#     восстановлены отдельно: в современных границах их территория уже
#     слита с краем/областью (слияния 2005-2008 гг.), отдельного контура
#     для них в этом датасете физически не существует. Их площадь
#     остаётся внутри родительского региона.
#   - Крым и Севастополь оставлены отдельно от любой исторической группы
#     (не объединяются ни с чем) — по явному указанию.
#   - Крошечный безымянный остров-артефакт "RUS+99?" (38 км², Natural
#     Earth дефект данных) присоединён к Ненецкому АО как географически
#     ближайшему.
# --------------------------------------------------------------------------
RSFSR_MAPPING = [
    # АССР
    ("Башкирская АССР", ["RUS-2378"]),
    ("Бурятская АССР", ["RUS-2606"]),
    ("Дагестанская АССР", ["RUS-2417"]),
    ("Кабардино-Балкарская АССР", ["RUS-2304"]),
    ("Калмыцкая АССР", ["RUS-2390"]),
    ("Карельская АССР", ["RUS-2353"]),
    ("Коми АССР", ["RUS-2383"]),
    ("Марийская АССР", ["RUS-2385"]),
    ("Мордовская АССР", ["RUS-2372"]),
    ("Северо-Осетинская АССР", ["RUS-2305"]),
    ("Татарская АССР", ["RUS-2394"]),
    ("Тувинская АССР", ["RUS-2605"]),
    ("Удмуртская АССР", ["RUS-2387"]),
    ("Чечено-Ингушская АССР", ["RUS-2416", "RUS-2303"]),
    ("Чувашская АССР", ["RUS-2389"]),
    ("Якутская АССР", ["RUS-2612"]),
    # Края
    ("Алтайский край", ["RUS-2399"]),
    ("Краснодарский край", ["RUS-2371"]),
    ("Красноярский край", ["RUS-2603"]),
    ("Приморский край", ["RUS-2611"]),
    ("Ставропольский край", ["RUS-2306"]),
    ("Хабаровский край", ["RUS-2614"]),
    # Области
    ("Амурская область", ["RUS-2609"]),
    ("Архангельская область", ["RUS-2354"]),
    ("Астраханская область", ["RUS-2388"]),
    ("Белгородская область", ["RUS-2370"]),
    ("Брянская область", ["RUS-2342"]),
    ("Владимирская область", ["RUS-2376"]),
    ("Волгоградская область", ["RUS-2369"]),
    ("Вологодская область", ["RUS-2359"]),
    ("Воронежская область", ["RUS-2377"]),
    ("Горьковская область", ["RUS-2357"]),
    ("Ивановская область", ["RUS-2355"]),
    ("Иркутская область", ["RUS-2602"]),
    ("Калининградская область", ["RUS-2324"]),
    ("Калининская область", ["RUS-2358"]),
    ("Калужская область", ["RUS-2361"]),
    ("Камчатская область", ["RUS-3468"]),
    ("Кемеровская область", ["RUS-2401"]),
    ("Кировская область", ["RUS-2384"]),
    ("Костромская область", ["RUS-2356"]),
    ("Куйбышевская область", ["RUS-2392"]),
    ("Курганская область", ["RUS-2380"]),
    ("Курская область", ["RUS-2362"]),
    ("Ленинградская область", ["RUS-2336"]),
    ("Липецкая область", ["RUS-2363"]),
    ("Магаданская область", ["RUS-2615"]),
    ("Московская область", ["RUS-2364"]),
    ("Мурманская область", ["RUS-2333"]),
    ("Новгородская область", ["RUS-2334"]),
    ("Новосибирская область", ["RUS-2403"]),
    ("Омская область", ["RUS-2397"]),
    ("Оренбургская область", ["RUS-2391"]),
    ("Орловская область", ["RUS-2366"]),
    ("Пензенская область", ["RUS-2373"]),
    ("Пермская область", ["RUS-3200"]),
    ("Псковская область", ["RUS-2335"]),
    ("Ростовская область", ["RUS-2367"]),
    ("Рязанская область", ["RUS-2374"]),
    ("Саратовская область", ["RUS-2393"]),
    ("Сахалинская область", ["RUS-2616"]),
    ("Свердловская область", ["RUS-2386"]),
    ("Смоленская область", ["RUS-2343"]),
    ("Тамбовская область", ["RUS-2375"]),
    ("Томская область", ["RUS-2167"]),
    ("Тульская область", ["RUS-2368"]),
    ("Тюменская область", ["RUS-2398"]),
    ("Ульяновская область", ["RUS-2395"]),
    ("Челябинская область", ["RUS-2379"]),
    ("Читинская область", ["RUS-2610"]),
    ("Ярославская область", ["RUS-2360"]),
    # Автономные области
    ("Адыгейская АО", ["RUS-2279"]),
    ("Горно-Алтайская АО", ["RUS-2400"]),
    ("Еврейская АО", ["RUS-2613"]),
    ("Карачаево-Черкесская АО", ["RUS-2280"]),
    ("Хакасская АО", ["RUS-2402"]),
    # Автономные округа (только те, что физически сохранились отдельно)
    ("Ненецкий АО", ["RUS-2381", "RUS+99?"]),
    ("Ханты-Мансийский АО", ["RUS-2396"]),
    ("Чукотский АО", ["RUS-2321"]),
    ("Ямало-Ненецкий АО", ["RUS-2382"]),
    # Города республиканского подчинения
    ("Москва", ["RUS-2365"]),
    ("Ленинград", ["RUS-2337"]),
    # Отдельно, не объединяя ни с чем (см. указание про Крым)
    ("Крым", ["RUS-283"]),
    ("Севастополь", ["RUS-5482"]),
]
GEOMETRIC_EXCLUDE_NAME = {
    "NL": {"Bonaire", "St. Eustatius", "Saba"},
}

ALL_COUNTRIES = (set(KEEP_AS_IS) | set(REGION_FIELD) | set(GEOMETRIC)
                  | set(SINGLE_REGION) | {"RU"})


# --------------------------------------------------------------------------

def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def load_features(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data["features"]


def to_item(feat):
    p = feat["properties"]
    geom = shape(feat["geometry"])
    return {
        "adm1_code": p.get("adm1_code"),
        "name": p.get("name"),
        "region_field": (p.get("region") or "").strip(),
        "geom": geom,
        "area": area_km2(geom),
    }


def make_output_feature(cluster, iso2, source="?"):
    geom = cluster["geom"]
    names = cluster["names"]
    # имя по самой крупной составляющей + (при нескольких) количество
    main_name = names[0]
    label = main_name if len(names) == 1 else f"{main_name} ({len(names)})"
    return {
        "type": "Feature",
        "properties": {
            "iso_a2": iso2,
            "name": label,
            "source_adm1": cluster["codes"],
            "source_count": len(cluster["codes"]),
            "area_km2": round(cluster["area"], 1),
            "merge_method": source,
        },
        "geometry": mapping(geom),
    }


def group_by_region(items, exclude_region=None):
    """Группировка по properties.region. Пустые/уникальные значения не схлопываются вместе."""
    exclude_region = exclude_region or set()
    buckets = {}
    singles = []
    excluded = []
    for it in items:
        rf = it["region_field"]
        if rf in exclude_region:
            excluded.append(it)
            continue
        if not rf:
            singles.append(it)
            continue
        buckets.setdefault(rf, []).append(it)

    clusters = []
    for key, grp in buckets.items():
        geom = unary_union([g["geom"] for g in grp]) if len(grp) > 1 else grp[0]["geom"]
        sorted_grp = sorted(grp, key=lambda g: -g["area"])
        clusters.append({
            "codes": [g["adm1_code"] for g in grp],
            "names": [key] + [g["name"] for g in sorted_grp],  # имя группы первично
            "geom": geom,
            "area": sum(g["area"] for g in grp),
        })
        # переопределим имя кластера на сам региональный лейбл
        clusters[-1]["names"] = [key]

    for it in singles:
        clusters.append({
            "codes": [it["adm1_code"]],
            "names": [it["name"]],
            "geom": it["geom"],
            "area": it["area"],
        })

    return clusters, excluded


def adjacency(clusters, buffer_deg=0.0005):
    n = len(clusters)
    adj = {i: set() for i in range(n)}
    buffered = [c["geom"].buffer(buffer_deg) for c in clusters]
    for i in range(n):
        for j in range(i + 1, n):
            try:
                if buffered[i].intersects(buffered[j]):
                    adj[i].add(j)
                    adj[j].add(i)
            except Exception:
                pass
    return adj


def clusters_from_items(items):
    return [{
        "codes": [it["adm1_code"]],
        "names": [it["name"]],
        "geom": it["geom"],
        "area": it["area"],
    } for it in items]


def reduce_clusters(clusters, target):
    clusters = list(clusters)
    if len(clusters) <= target:
        return clusters

    while len(clusters) > target:
        adj = adjacency(clusters)
        candidates = [i for i in range(len(clusters)) if adj[i]]
        if not candidates:
            break  # больше нет смежных пар (изолированные острова) — не можем продолжить
        i = min(candidates, key=lambda idx: clusters[idx]["area"])
        j = min(adj[i], key=lambda idx: clusters[idx]["area"])
        merged_geom = unary_union([clusters[i]["geom"], clusters[j]["geom"]])
        merged = {
            "codes": clusters[i]["codes"] + clusters[j]["codes"],
            "names": sorted(clusters[i]["names"] + clusters[j]["names"],
                             key=lambda nm: -1),  # порядок не критичен
            "geom": merged_geom,
            "area": clusters[i]["area"] + clusters[j]["area"],
        }
        # имя кластера = имя самой большой исходной части
        all_parts = [(nm, ar) for nm, ar in zip(
            clusters[i]["names"] + clusters[j]["names"],
            [clusters[i]["area"]] * len(clusters[i]["names"]) + [clusters[j]["area"]] * len(clusters[j]["names"])
        )]
        merged["names"] = [max(all_parts, key=lambda x: x[1])[0]] + [n for n, _ in all_parts]
        keep = [clusters[k] for k in range(len(clusters)) if k not in (i, j)]
        clusters = keep + [merged]

    return clusters


def geometric_merge(items, target):
    return reduce_clusters(clusters_from_items(items), target)


def geometric_merge_by_zone(items, sub_targets):
    buckets = {}
    for it in items:
        key = it["region_field"] or "_none"
        buckets.setdefault(key, []).append(it)
    all_clusters = []
    for zone, grp in buckets.items():
        target = sub_targets.get(zone, len(grp))
        all_clusters.extend(geometric_merge(grp, target))
    return all_clusters


def main():
    t0 = time.time()
    feats = load_features(SRC)
    by_country = {}
    for f in feats:
        iso2 = f["properties"].get("iso_a2")
        if iso2 in ALL_COUNTRIES:
            by_country.setdefault(iso2, []).append(to_item(f))

    out_features = []
    report = []
    skipped_overseas = []

    for iso2 in sorted(ALL_COUNTRIES):
        items = by_country.get(iso2, [])
        n_source = len(items)

        if iso2 in KEEP_AS_IS:
            clusters = [{
                "codes": [it["adm1_code"]],
                "names": [it["name"]],
                "geom": it["geom"],
                "area": it["area"],
            } for it in items]
            method = "keep"

        elif iso2 in REGION_FIELD:
            cfg = REGION_FIELD[iso2]
            clusters, excluded = group_by_region(items, cfg.get("exclude_region"))
            for ex in excluded:
                skipped_overseas.append((iso2, ex["name"], ex["region_field"]))
            post_target = cfg.get("post_target")
            if post_target and len(clusters) > post_target:
                clusters = reduce_clusters(clusters, post_target)
            method = "region"

        elif iso2 in GEOMETRIC:
            excl_names = GEOMETRIC_EXCLUDE_NAME.get(iso2, set())
            kept_items = [it for it in items if it["name"] not in excl_names]
            for it in items:
                if it["name"] in excl_names:
                    skipped_overseas.append((iso2, it["name"], "geometric-excluded"))
            target = GEOMETRIC[iso2]
            clusters = geometric_merge(kept_items, target)
            method = "geometric"

        elif iso2 in SINGLE_REGION:
            if items:
                geom = unary_union([it["geom"] for it in items]) if len(items) > 1 else items[0]["geom"]
                clusters = [{
                    "codes": [it["adm1_code"] for it in items],
                    "names": [SINGLE_REGION[iso2]],
                    "geom": geom,
                    "area": sum(it["area"] for it in items),
                }]
            else:
                clusters = []
            method = "single"

        elif iso2 == "RU":
            by_code = {it["adm1_code"]: it for it in items}
            used = set()
            clusters = []
            for label, codes in RSFSR_MAPPING:
                parts = [by_code[c] for c in codes if c in by_code]
                missing = [c for c in codes if c not in by_code]
                if missing:
                    print(f"  [RU] ВНИМАНИЕ: не найдены коды {missing} для '{label}'")
                if not parts:
                    continue
                used.update(codes)
                geom = unary_union([p["geom"] for p in parts]) if len(parts) > 1 else parts[0]["geom"]
                clusters.append({
                    "codes": codes,
                    "names": [label],
                    "geom": geom,
                    "area": sum(p["area"] for p in parts),
                })
            leftover = [it for it in items if it["adm1_code"] not in used]
            if leftover:
                print(f"  [RU] НЕ ОХВАЧЕНО КАРТОЙ ({len(leftover)}):",
                      [it["name"] for it in leftover])
                clusters.extend(clusters_from_items(leftover))
            method = "historical"

        else:
            continue

        for c in clusters:
            out_features.append(make_output_feature(c, iso2, method))

        report.append({
            "iso2": iso2,
            "method": method,
            "source_units": n_source,
            "output_regions": len(clusters),
        })

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    total_area_out = sum(ft["properties"]["area_km2"] for ft in out_features)

    print(f"Готово за {time.time()-t0:.1f} сек")
    print(f"Итоговых регионов: {len(out_features)} (исходных ADM1: {sum(r['source_units'] for r in report)})")
    print(f"Суммарная площадь результата: {total_area_out:,.0f} km2")
    print()
    print(f"{'iso2':5}{'метод':10}{'было':6}{'стало':6}")
    for r in sorted(report, key=lambda r: -r["source_units"]):
        print(f"{r['iso2']:5}{r['method']:10}{r['source_units']:6}{r['output_regions']:6}")

    if skipped_overseas:
        print()
        print("Исключено как не-европейские (требуют отдельной обработки в других континентах):")
        for iso2, name, why in skipped_overseas:
            print(f"  {iso2}: {name}  ({why})")

    return report, skipped_overseas, total_area_out, len(out_features)


if __name__ == "__main__":
    main()
