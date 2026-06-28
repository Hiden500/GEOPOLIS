"""
build_namerica_1946.py
Этап 2-3 (Северная Америка): маппинг + объединение ADM1-регионов
game_map.json для сценария 1946 года.

Принципы (по фидбеку из Европы/Азии):
  - План - ориентир, не точные цифры. Где не уверен - использую разумные
    дефолты, отмечаю явно.
  - Если современная граница не изменилась с 1946 - оставляем как есть.
  - Острова - отдельно от материка, не считаются в target.
  - Слияние - компактность (Polsby-Popper), не просто "ближайший по площади".
  - Явные исторические расхождения 1946 vs современность:
      * Ньюфаундленд - был отдельным доминионом до 1949, не частью Канады
      * Нунавут - не существовал до 1999, был частью Northwest Territories
      * Куба - современные 16 провинций это реформа 1976; в 1946 было 6
        историч. провинций (Pinar del Río/Habana/Matanzas/Las Villas/
        Camagüey/Oriente) + Isla de la Juventud отдельно как остров
"""
from paths import game_map, out
import json
import time
import math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
SRC = game_map()
OUT = out("namerica_1946.geojson")

KEEP_AS_IS = {
    "MX": "Мексика — 32 штата + CDMX, не менялось с 1917",
    "US": "США — границы штатов не менялись (Аляска/Гавайи геометрически "
          "те же, но в 1946 это территории, не штаты — помечено в properties)",
    "CR": "Костра-Рика — уже компактно (7)",
    "BZ": "Белиз — уже компактно (6)",
}

# Гаити: до 1962 было 5 департаментов, не 10 (источник: statoids.com,
# перепись 1950 года - почти точно наш 1946). Centre (создан 1932 из
# Artibonite+Ouest+Nord трёх частей) геометрически неразделим в текущих
# данных - целиком отнесён к Artibonite (допущение).
HAITI_HISTORICAL = {
    "Artibonite": ["L'Artibonite", "Centre"],
    "Nord": ["Nord", "Nord-Est"],
    "Nord-Ouest": ["Nord-Ouest"],
    "Ouest": ["Ouest", "Sud-Est"],
    "Sud": ["Sud", "Grand'Anse", "Nippes"],
}

SINGLE_REGION = {
    "AW": "Аруба",
    "AG": "Антигуа и Барбуда",
    "DM": "Доминика",
    "GD": "Гренада",
    "VC": "Сент-Винсент и Гренадины",
    "LC": "Сент-Люсия",
    "BB": "Барбадос",
    "PR": "Пуэрто-Рико",
    "VI": "Виргинские о-ва (США)",
    "GL": "Гренландия",
    "PM": "Сен-Пьер и Микелон",
    "BM": "Бермуды",
    "KY": "Каймановы о-ва",
    "TC": "Тёркс и Кайкос",
    "VG": "Виргинские о-ва (Брит.)",
    "AI": "Ангилья",
    "MS": "Монтсеррат",
    "CW": "Кюрасао",
    "SX": "Синт-Мартен",
    "JM": "Ямайка",
    "BS": "Багамы",
}

REGION_FIELD = {
    "KN": {},  # Nevis / Saint Kitts
}

GEOMETRIC = {
    "GT": 8, "HN": 7, "NI": 7, "SV": 6, "PA": 6, "TT": 2,
}

# Куба: современные 16 провинций (реформа 1976) -> историч. 6 провинций
# 1946 года + Isla de la Juventud отдельно (остров)
CUBA_HISTORICAL = {
    "Pinar del Río": ["Pinar del Río"],
    "Habana": ["Ciudad de la Habana", "Artemisa", "Mayabeque"],
    "Matanzas": ["Matanzas"],
    "Las Villas": ["Villa Clara", "Cienfuegos", "Sancti Spíritus"],
    "Camagüey": ["Camagüey", "Ciego de Ávila"],
    "Oriente": ["Las Tunas", "Granma", "Holguín", "Santiago de Cuba", "Guantánamo"],
}
CUBA_ISLAND = "Isla de la Juventud"

# Доминиканская Республика: современные 31 провинция+DN собирались
# десятилетиями (1932-2002). На 1946 год реально существовало только 19
# (источник: en.wikipedia.org/wiki/List_of_Dominican_Provinces_by_date_of_provincehood,
# отфильтровано по дате создания <= 1946). Сánchez Ramírez/Hermanas/
# Pedernales/Valverde/María Trinidad Sánchez и др. появились в 1950-2002.
DR_HISTORICAL = {
    "Azua": ["Azua"],
    "Bahoruco": ["Bahoruco", "Independencia"],
    "Barahona": ["Barahona", "Pedernales"],
    "Dajabón": ["Dajabón"],
    "Distrito Nacional": ["Distrito Nacional", "Santo Domingo"],
    "Duarte": ["Duarte", "Sánchez Ramírez"],
    "La Estrelleta": ["La Estrelleta"],
    "El Seybo": ["El Seybo", "Hato Mayor"],
    "Espaillat": ["Espaillat", "Hermanas"],
    "La Altagracia": ["La Altagracia", "La Romana"],
    "La Vega": ["La Vega", "Monseñor Nouel"],
    "Monte Cristi": ["Monte Cristi", "Santiago Rodríguez"],
    "Peravia": ["Peravia", "San José de Ocoa"],
    "Puerto Plata": ["Puerto Plata"],
    "Samaná": ["Samaná", "María Trinidad Sánchez"],
    "San Cristóbal": ["San Cristóbal", "Monte Plata"],
    "San Juan": ["San Juan"],
    "San Pedro de Macorís": ["San Pedro de Macorís"],
    "Santiago": ["Santiago", "Valverde"],
}

# Канада: Ньюфаундленд отдельно (был own dominion до 1949), Нунавут -> NWT
# (не существовал до 1999)
CANADA_EXTRACT_NEWFOUNDLAND = "Newfoundland and Labrador"
CANADA_MERGE_NUNAVUT_INTO = "Northwest Territories"

# Французские заморские территории, исключённые из FR в Европе (не входят
# в Европу географически)
FR_EXTRACT_NAMES = {"Martinique", "Guadeloupe"}
# Голландские карибские территории, исключённые из NL в Европе
NL_EXTRACT_NAMES = {"Bonaire", "St. Eustatius", "Saba"}

EXTRA_SINGLE_FEATURES = [
    ("Guantanamo Bay USNB", "Гуантанамо (военная база США)"),
    ("Clipperton Island", "Клипертон (Франция)"),
]

ALL_COUNTRIES = (set(KEEP_AS_IS) | set(SINGLE_REGION) | set(REGION_FIELD)
                  | set(GEOMETRIC) | {"CU", "CA", "HT", "DO"})


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def compactness(geom):
    perim = geom.length
    if perim == 0:
        return 0.0
    return 4 * math.pi * geom.area / (perim ** 2)


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


def group_by_region(items):
    buckets = {}
    singles = []
    for it in items:
        rf = it["region_field"]
        if not rf:
            singles.append(it)
            continue
        buckets.setdefault(rf, []).append(it)
    clusters = []
    for key, grp in buckets.items():
        geom = unary_union([g["geom"] for g in grp]) if len(grp) > 1 else grp[0]["geom"]
        clusters.append({"codes": [g["adm1_code"] for g in grp], "names": [key],
                          "geom": geom, "area": sum(g["area"] for g in grp)})
    for it in singles:
        clusters.append({"codes": [it["adm1_code"]], "names": [it["name"]],
                          "geom": it["geom"], "area": it["area"]})
    return clusters


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
    return [{"codes": [it["adm1_code"]], "names": [it["name"]],
              "geom": it["geom"], "area": it["area"]} for it in items]


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
        all_parts = [(nm, ar) for nm, ar in zip(
            clusters[i]["names"] + clusters[j]["names"],
            [clusters[i]["area"]] * len(clusters[i]["names"]) + [clusters[j]["area"]] * len(clusters[j]["names"])
        )]
        merged = {"codes": clusters[i]["codes"] + clusters[j]["codes"],
                   "names": [max(all_parts, key=lambda x: x[1])[0]] + [n for n, _ in all_parts],
                   "geom": merged_geom,
                   "area": clusters[i]["area"] + clusters[j]["area"]}
        keep = [clusters[k] for k in range(len(clusters)) if k not in (i, j)]
        clusters = keep + [merged]
    return clusters


def geometric_merge(items, target):
    return reduce_clusters(clusters_from_items(items), target)


def main():
    t0 = time.time()
    feats = load_features(SRC)
    by_country = {}
    fr_extract, nl_extract, extra_by_name = [], [], {}
    for f in feats:
        p = f["properties"]
        iso2 = p.get("iso_a2")
        name = p.get("name")
        if iso2 == "FR" and name in FR_EXTRACT_NAMES:
            fr_extract.append(f)
            continue
        if iso2 == "NL" and name in NL_EXTRACT_NAMES:
            nl_extract.append(f)
            continue
        if iso2 == "-1" and name in dict(EXTRA_SINGLE_FEATURES):
            extra_by_name[name] = f
            continue
        if iso2 in ALL_COUNTRIES:
            by_country.setdefault(iso2, []).append(to_item(f))

    out_features = []
    report = []

    # --- Французские/голландские заморские территории, не вошедшие в Европу ---
    for f in fr_extract:
        it = to_item(f)
        cl = {"codes": [it["adm1_code"]], "names": [it["name"]], "geom": it["geom"], "area": it["area"]}
        out_features.append(make_output_feature(cl, "FR", "extracted_from_europe"))
    for f in nl_extract:
        it = to_item(f)
        cl = {"codes": [it["adm1_code"]], "names": [it["name"]], "geom": it["geom"], "area": it["area"]}
        out_features.append(make_output_feature(cl, "NL", "extracted_from_europe"))

    # --- Анклавы с iso_a2='-1' ---
    for name, label in EXTRA_SINGLE_FEATURES:
        f = extra_by_name.get(name)
        if f is None:
            print(f"  [EXTRA] ВНИМАНИЕ: '{name}' не найден")
            continue
        it = to_item(f)
        cl = {"codes": [it["adm1_code"]], "names": [label], "geom": it["geom"], "area": it["area"]}
        out_features.append(make_output_feature(cl, "-1", "extra"))

    # --- Канада: Ньюфаундленд отдельно, Нунавут -> NWT ---
    ca_items = by_country.pop("CA", [])
    nl_item = next((it for it in ca_items if it["name"] == CANADA_EXTRACT_NEWFOUNDLAND), None)
    nu_item = next((it for it in ca_items if it["name"] == "Nunavut"), None)
    nwt_item = next((it for it in ca_items if it["name"] == CANADA_MERGE_NUNAVUT_INTO), None)
    rest = [it for it in ca_items if it["name"] not in (CANADA_EXTRACT_NEWFOUNDLAND, "Nunavut", CANADA_MERGE_NUNAVUT_INTO)]

    if nl_item:
        cl = {"codes": [nl_item["adm1_code"]], "names": ["Newfoundland"], "geom": nl_item["geom"], "area": nl_item["area"]}
        out_features.append(make_output_feature(cl, "NF", "historical_separate_dominion"))
    if nu_item and nwt_item:
        merged_geom = unary_union([nu_item["geom"], nwt_item["geom"]])
        cl = {"codes": [nu_item["adm1_code"], nwt_item["adm1_code"]], "names": ["Northwest Territories"],
              "geom": merged_geom, "area": nu_item["area"] + nwt_item["area"]}
        out_features.append(make_output_feature(cl, "CA", "historical_1946_pre_nunavut"))
    for it in rest:
        cl = {"codes": [it["adm1_code"]], "names": [it["name"]], "geom": it["geom"], "area": it["area"]}
        out_features.append(make_output_feature(cl, "CA", "keep"))
    report.append({"iso2": "CA", "method": "historical+keep", "source_units": len(ca_items),
                    "output_regions": len(rest) + (1 if nl_item else 0) + (1 if nu_item and nwt_item else 0)})

    # --- Куба: 16 совр. -> 6 истор. + остров отдельно ---
    cu_items = by_country.pop("CU", [])
    by_name = {it["name"]: it for it in cu_items}
    for hist_name, modern_names in CUBA_HISTORICAL.items():
        parts = [by_name[n] for n in modern_names if n in by_name]
        missing = [n for n in modern_names if n not in by_name]
        if missing:
            print(f"  [CU] ВНИМАНИЕ: не найдены {missing} для '{hist_name}'")
        if not parts:
            continue
        geom = unary_union([p["geom"] for p in parts]) if len(parts) > 1 else parts[0]["geom"]
        cl = {"codes": [p["adm1_code"] for p in parts], "names": [hist_name],
              "geom": geom, "area": sum(p["area"] for p in parts)}
        out_features.append(make_output_feature(cl, "CU", "historical_1946"))
    if CUBA_ISLAND in by_name:
        it = by_name[CUBA_ISLAND]
        cl = {"codes": [it["adm1_code"]], "names": [it["name"]], "geom": it["geom"], "area": it["area"]}
        out_features.append(make_output_feature(cl, "CU", "island_separate"))
    report.append({"iso2": "CU", "method": "historical_1946", "source_units": len(cu_items), "output_regions": 7})

    # --- Гаити: 10 совр. -> 5 истор. департаментов (до реформы 1962) ---
    ht_items = by_country.pop("HT", [])
    ht_by_name = {it["name"]: it for it in ht_items}
    for hist_name, modern_names in HAITI_HISTORICAL.items():
        parts = [ht_by_name[n] for n in modern_names if n in ht_by_name]
        missing = [n for n in modern_names if n not in ht_by_name]
        if missing:
            print(f"  [HT] ВНИМАНИЕ: не найдены {missing} для '{hist_name}'")
        if not parts:
            continue
        geom = unary_union([p["geom"] for p in parts]) if len(parts) > 1 else parts[0]["geom"]
        note = "Centre геометрически неразделим (исторически из 3 частей), отнесён целиком" \
            if hist_name == "Artibonite" else None
        props_extra = {"note": note} if note else {}
        cl = {"codes": [p["adm1_code"] for p in parts], "names": [hist_name],
              "geom": geom, "area": sum(p["area"] for p in parts)}
        ft = make_output_feature(cl, "HT", "historical_1946_pre_1962")
        ft["properties"].update(props_extra)
        out_features.append(ft)
    report.append({"iso2": "HT", "method": "historical_1946_pre_1962", "source_units": len(ht_items), "output_regions": 5})

    # --- Доминикана: 31+DN совр. -> 19 истор. провинций 1946 года ---
    do_items = by_country.pop("DO", [])
    do_by_name = {it["name"]: it for it in do_items}
    for hist_name, modern_names in DR_HISTORICAL.items():
        parts = [do_by_name[n] for n in modern_names if n in do_by_name]
        missing = [n for n in modern_names if n not in do_by_name]
        if missing:
            print(f"  [DO] ВНИМАНИЕ: не найдены {missing} для '{hist_name}'")
        if not parts:
            continue
        geom = unary_union([p["geom"] for p in parts]) if len(parts) > 1 else parts[0]["geom"]
        cl = {"codes": [p["adm1_code"] for p in parts], "names": [hist_name],
              "geom": geom, "area": sum(p["area"] for p in parts)}
        out_features.append(make_output_feature(cl, "DO", "historical_1946"))
    report.append({"iso2": "DO", "method": "historical_1946", "source_units": len(do_items), "output_regions": 19})

    # --- Остальные страны по обычным методам ---
    for iso2 in sorted(ALL_COUNTRIES - {"CA", "CU", "HT", "DO"}):
        items = by_country.get(iso2, [])
        n_source = len(items)
        if n_source == 0:
            print(f"  [{iso2}] ВНИМАНИЕ: 0 регионов найдено")
            continue

        if iso2 in KEEP_AS_IS:
            clusters = clusters_from_items(items)
            method = "keep"
        elif iso2 in SINGLE_REGION:
            geom = unary_union([it["geom"] for it in items]) if len(items) > 1 else items[0]["geom"]
            clusters = [{"codes": [it["adm1_code"] for it in items], "names": [SINGLE_REGION[iso2]],
                         "geom": geom, "area": sum(it["area"] for it in items)}]
            method = "single"
        elif iso2 in REGION_FIELD:
            clusters = group_by_region(items)
            method = "region"
        elif iso2 in GEOMETRIC:
            clusters = geometric_merge(items, GEOMETRIC[iso2])
            method = "geometric"
        else:
            continue

        for c in clusters:
            out_features.append(make_output_feature(c, iso2, method))
        report.append({"iso2": iso2, "method": method, "source_units": n_source, "output_regions": len(clusters)})

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    total_area = sum(ft["properties"]["area_km2"] for ft in out_features)
    print(f"\nГотово за {time.time()-t0:.1f} сек")
    print(f"Итоговых регионов: {len(out_features)}")
    print(f"Суммарная площадь: {total_area:,.0f} km2")
    print()
    print(f"{'iso2':5}{'метод':25}{'было':6}{'стало':6}")
    for r in sorted(report, key=lambda r: -r["source_units"]):
        print(f"{r['iso2']:5}{r['method']:25}{r['source_units']:6}{r['output_regions']:6}")


if __name__ == "__main__":
    main()
