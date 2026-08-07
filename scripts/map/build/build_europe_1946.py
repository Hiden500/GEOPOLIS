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
from paths import game_map, out, source
import json
import sys
import time
from shapely.geometry import shape, mapping, LineString
from shapely.ops import unary_union, nearest_points

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
    "DE": "Германия — 16 современных земель как основа; Берлин (4 сектора),"
          " Кильский канал и Вюртемберг-Баден/Баден+Гогенцоллерн (южные зоны)"
          " ЗАМЕНЯЮТ единые Berlin/Baden-Württemberg функцией"
          " restore_german_occupation_zones (2026-07-19-k — см. её докстринг,"
          " это не воспроизводимо ни одним скриптом из game_map.json, только"
          " из committed scripts/map/sources/germany_occupation_zones_1946.json)",
    "DK": "Дания (метрополия) — уже 5 единиц",
    "CY": "Кипр — 5 округов источника + Northern Cyprus/Dhekelia добавляются"
          " функцией add_cyprus_extra_territories (2026-07-19-i, см. её"
          " докстринг — извлекаются из тех же 'потеряшек' iso_a2='-1', что и"
          " Кашмир/Спратли в Азии, не из внешнего источника)",
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
    # Фарерские острова (автономия Дании) — отсутствовали вовсе, найдено
    # пользователем на живом рендере (2026-07-19-o): game_map.json содержит
    # 1 MultiPolygon-фичу 'Eysturoyar'/iso_a2='FO', покрывающую весь
    # архипелаг — не входила ни в один список стран Европы.
    "FO": "Фарерские острова",
    # Мальта — по указанию пользователя (2026-07-19-p) объединить в один
    # регион вместо деления на Malta Xlokk/Malta Majjistral/Gozo по полю
    # region (68 муниципалитетов game_map.json) — та же категория, что
    # Андорра/Лихтенштейн/Сан-Марино/Монако (маленькая страна, не нужна
    # внутренняя детализация).
    "MT": "Мальта",
    # Британские острова метрополии — отсутствовали вовсе (2026-07-22,
    # класс MISSING_LAND в audit_map_geometry.py). iso_a2='GG' в game_map.json содержит 1 фичу
    # с name='Sark', но bounds (-2.67..-2.17, 49.43..49.73) охватывают весь
    # бейливик Гернси (Гернси+Сарк+Херм и т.п., area=66 km2 ~ реальный
    # бейливик ~78 km2), не только остров Сарк — используем название
    # бейливика, не сырое (ошибочно узкое) имя фичи.
    "IM": "Остров Мэн",
    "JE": "Джерси",
    "GG": "Гернси",
}

REGION_FIELD = {
    "IT": {},
    "GB": {},
    "LV": {},
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


def fix_cyprus_larnaca_exclave(features):
    """game_map.json/Natural Earth относит небольшой отдельный кусок земли
    рядом с Фамагустой к округу Larnaca (MultiPolygon, вторая часть
    физически не касается основного тела Larnaca — 0.13 deg до него,
    но touches() с Famagusta) — похоже на ошибку атрибуции в исходнике,
    не реальный ларнакский эксклав. Найдено 2026-07-19-g по прямому
    скриншоту пользователя (отдельный "остров" рядом с Кипром при
    добавлении Кирении — extract_kyrenia.py). Переносим маленькую часть
    в Famagusta, с которой она физически граничит."""
    larnaca = next((ft for ft in features if ft["properties"].get("iso_a2") == "CY"
                     and ft["properties"]["name"] == "Larnaca"), None)
    famagusta = next((ft for ft in features if ft["properties"].get("iso_a2") == "CY"
                        and ft["properties"]["name"] == "Famagusta"), None)
    if larnaca is None or famagusta is None:
        return
    lg = shape(larnaca["geometry"])
    if lg.geom_type != "MultiPolygon" or len(lg.geoms) < 2:
        return
    parts = list(lg.geoms)
    main_part = max(parts, key=lambda p: p.area)
    strays = [p for p in parts if p is not main_part]
    fg = shape(famagusta["geometry"])
    kept_strays = []
    moved_area = 0.0
    for p in strays:
        if p.distance(fg) < 1e-6:
            fg = unary_union([fg, p])
            moved_area += area_km2(p)
        else:
            kept_strays.append(p)
    if moved_area == 0.0:
        return
    new_larnaca = main_part if not kept_strays else unary_union([main_part] + kept_strays)
    larnaca["geometry"] = mapping(new_larnaca)
    larnaca["properties"]["area_km2"] = round(area_km2(new_larnaca), 1)
    famagusta["geometry"] = mapping(fg)
    famagusta["properties"]["area_km2"] = round(area_km2(fg), 1)
    print(f"  [CY] перенесено {round(moved_area,1)} km2 из Larnaca-эксклава в Famagusta")


def fix_cyprus_famagusta_gap(features, max_bridge_deg=0.15):
    """SUPERSEDED (2026-07-19-i) — БОЛЬШЕ НЕ ВЫЗЫВАЕТСЯ. Диагноз "Famagusta
    оторвана от Larnaca разрывом ~0.098°" (2026-07-19-g) был неверным: тот
    "разрыв" — это территория Northern Cyprus (iso_a2="-1" в game_map.json,
    см. add_cyprus_extra_territories), которую я тогда не проверил.
    Численно: main-body Larnaca касается Northern Cyprus на distance=0.0,
    Famagusta тоже касается Northern Cyprus на distance=0.0 — Larnaca и
    Famagusta НЕ должны быть смежны напрямую, между ними законно лежит
    Northern Cyprus. Мост, который эта функция строила, на 100.27 из
    101.5 km2 накладывался на настоящую территорию Northern Cyprus (нашлось
    численно при добавлении последней). Оставлено в коде как пройденный
    урок (см. find-existing-solutions), не удалено."""
    famagusta = next((ft for ft in features if ft["properties"].get("iso_a2") == "CY"
                        and ft["properties"]["name"] == "Famagusta"), None)
    larnaca = next((ft for ft in features if ft["properties"].get("iso_a2") == "CY"
                      and ft["properties"]["name"] == "Larnaca"), None)
    if famagusta is None or larnaca is None:
        return
    fg = shape(famagusta["geometry"])
    lg = shape(larnaca["geometry"])
    gap = fg.distance(lg)
    if gap == 0 or gap > max_bridge_deg:
        return
    p1, p2 = nearest_points(fg, lg)
    bridge = LineString([p1, p2]).buffer(gap / 2 + 0.002, cap_style=2, join_style=2)
    bridged = unary_union([fg, bridge])
    if not bridged.is_valid:
        bridged = bridged.buffer(0)
    added_km2 = area_km2(bridged) - area_km2(fg)
    famagusta["geometry"] = mapping(bridged)
    famagusta["properties"]["area_km2"] = round(area_km2(bridged), 1)
    print(f"  [CY] Famagusta соединена с Larnaca мостом (+{round(added_km2,1)} km2)")


def add_cyprus_extra_territories(feats, out_features):
    """Northern Cyprus, Dhekelia и Akrotiri — не отдельные страны в
    game_map.json, а фичи с iso_a2="-1" (тот же тег, что у Кашмира/Спратли в
    Азии — спорные/де-факто территории без официального ISO). Раньше
    (extract_kyrenia.py, 2026-07-19-g) я проверил наличие Кирении только по
    iso_a2=="CY", заключил, что её нет в game_map.json вовсе, и притащил
    внешний geoBoundaries-граф с буферным мостом — получился уродливый шов,
    пользователь отклонил и указал искать по смежным полигонам под другим
    тегом (2026-07-19-i). Northern Cyprus (3309.8 km2, sov_a3="CYN") лежит
    в том же файле и стыкуется с существующими 5 округами БЕЗ разрыва
    (distance=0.0, overlap=0.0 — проверено численно) — покрывает больше
    площади, чем одна историческая Кирения, и корректно смыкает суммарную
    площадь острова (~9045 km2 против реальных ~9251 km2). Dhekelia
    (134.1 km2, adm0_a3="ESB") и Akrotiri (adm0_a3="WSB", найдено 2026-07-20 —
    пользователь: "Потерял WSB-5133 у Кипра"; изначально пропущена при
    написании этой функции, не регрессия — `git log -S"Akrotiri"` пуст, её
    вообще никогда не было в списке) — британские военные базы со статусом
    только с 1960 года (в 1946 просто территория Ларнаки/Лимасола), но по
    решению пользователя современные анахронизмы источника оставляются
    буквально, не сворачиваются (тот же принцип, что для UNDOF/An Nabatiyah в
    Азии). Отсутствие Akrotiri оставляло непокрытую дыру фона на юге Кипра
    (у Лимасола) — море не клипалось по ней (см. `extra_union` ниже), т.к. её
    не было в исходном списке. Выходной iso_a2="CY" для всех трёх — в 1946
    весь остров был единой британской колонией, Northern Cyprus/TRNC как
    отдельный статус не существовал. extract_kyrenia.py остаётся на диске,
    помечен как superseded в собственном докстринге, не вызывается
    пайплайном."""
    EXTRA = ["Northern Cyprus", "Dhekelia", "Akrotiri"]
    extra_geoms = []
    for name in EXTRA:
        ft = next((f for f in feats if f["properties"].get("iso_a2") == "-1"
                    and f["properties"].get("name") == name), None)
        if ft is None:
            print(f"  [CY] ВНИМАНИЕ: '{name}' не найден в game_map.json")
            continue
        g = shape(ft["geometry"])
        extra_geoms.append(g)
        out_features.append({
            "type": "Feature",
            "properties": {
                "iso_a2": "CY",
                "name": name,
                "source_adm1": [ft["properties"].get("adm1_code")],
                "source_count": 1,
                "area_km2": round(area_km2(g), 1),
                "merge_method": "keep_raw_extra",
            },
            "geometry": mapping(g),
        })
        print(f"  [CY] добавлена {name} ({round(area_km2(g), 1)} km2)")

    if not extra_geoms:
        return
    extra_union = unary_union(extra_geoms)
    # fix_cyprus_famagusta_gap раздула Famagusta буферным мостом ДО того, как
    # Northern Cyprus/Dhekelia появились в геометрии — мост слегка заходит на
    # обе (0.0037/0.0062 deg2, проверено численно). Northern Cyprus/Dhekelia
    # авторитетны (тот же провенанс, что остальные округа), поэтому клипаем
    # существующие CY-фичи по ним, не наоборот.
    for ft in out_features:
        if ft["properties"].get("iso_a2") != "CY" or ft["properties"].get("name") in EXTRA:
            continue
        g = shape(ft["geometry"])
        if g.intersects(extra_union):
            clipped = g.difference(extra_union)
            if not clipped.is_valid:
                clipped = clipped.buffer(0)
            if clipped.area > 1e-9:
                overlap_km2 = area_km2(g) - area_km2(clipped)
                ft["geometry"] = mapping(clipped)
                ft["properties"]["area_km2"] = round(area_km2(clipped), 1)
                print(f"  [CY] {ft['properties']['name']} обрезана по "
                      f"Northern Cyprus/Dhekelia (-{round(overlap_km2, 2)} km2)")

    clip_seas_against_land(extra_union, ["Mediterranean Sea - Eastern Basin"])


def clip_seas_against_land(new_land_union, sea_names):
    """`out/seas_1946.geojson` — внешний, вручную поддерживаемый вход (как
    `lakes_1946.geojson`/`ownership_1946.json`), НЕ пересчитывается никаким
    шагом пайплайна и не знает о суше, добавленной build-скриптами. Когда
    Northern Cyprus/Dhekelia появились в игре (2026-07-19-j), их площадь
    (3305.1 + 134.1 km2 — практически целиком) осталась морем в этом файле,
    рендерясь ПОВЕРХ новой суши (найдено пользователем: "Из Средиземного
    моря надо вырезать новые территории Кипра"). Обрезаем перечисленные
    морские фичи по новой суше и перезаписываем файл — тот же класс правки,
    что уже применялся к суше против воды (clip_against_dead_sea), только
    в обратную сторону."""
    seas_path = out("seas_1946.geojson")
    with open(seas_path, encoding="utf-8") as f:
        seas_fc = json.load(f)
    n_clipped = 0
    for ft in seas_fc["features"]:
        if ft["properties"].get("name") not in sea_names:
            continue
        g = shape(ft["geometry"])
        if not g.intersects(new_land_union):
            continue
        clipped = g.difference(new_land_union)
        if not clipped.is_valid:
            clipped = clipped.buffer(0)
        removed_km2 = area_km2(g) - area_km2(clipped)
        ft["geometry"] = mapping(clipped)
        n_clipped += 1
        print(f"  [SEA] '{ft['properties']['name']}' обрезано по новой суше "
              f"(-{round(removed_km2, 1)} km2)")
    if n_clipped:
        with open(seas_path, "w", encoding="utf-8") as f:
            json.dump(seas_fc, f, ensure_ascii=False)


CLIP_LAKE_NAMES_EUROPE = {"Ладога", "Байкал"}


def clip_land_against_lakes(out_features, lake_names):
    """`out/lakes_1946.geojson` уже содержит Ладогу/Байкал как настоящие
    водоёмы (добавлены в какой-то более ранней сессии) — но НИ ОДИН шаг
    build_europe_1946.py никогда не вычитал их из земли Бурятской АССР/
    Карельской АССР/Иркутской и Ленинградской областей (тот же класс
    пробела, что MediterrAnean/Cyprus — не gitignored-регрессия конкретно
    этого прогона, а изначально отсутствующий шаг, см. docs/DECISIONS.md
    "2026-07-19-k"). Симметрично `clip_seas_against_land` (вода режется по
    новой суше), здесь СУША режется по уже существующим озёрам —
    тот же общий принцип, что `clip_against_dead_sea` в build_asia_1946.py."""
    lakes_path = out("lakes_1946.geojson")
    with open(lakes_path, encoding="utf-8") as f:
        lakes_fc = json.load(f)
    lake_geoms = [shape(ft["geometry"]) for ft in lakes_fc["features"]
                   if ft["properties"].get("name") in lake_names]
    if not lake_geoms:
        print(f"  [LAKE] ВНИМАНИЕ: не найдено ни одного из {lake_names} в lakes_1946.geojson")
        return
    lakes_union = unary_union(lake_geoms)
    n_clipped = 0
    for ft in out_features:
        g = shape(ft["geometry"])
        if not g.intersects(lakes_union):
            continue
        clipped = g.difference(lakes_union)
        if not clipped.is_valid:
            clipped = clipped.buffer(0)
        if clipped.area <= 1e-9:
            continue
        removed_km2 = area_km2(g) - area_km2(clipped)
        if removed_km2 < 1e-6:
            continue
        ft["geometry"] = mapping(clipped)
        ft["properties"]["area_km2"] = round(area_km2(clipped), 1)
        n_clipped += 1
        print(f"  [LAKE] {ft['properties']['name']} обрезана по озёрам "
              f"(-{round(removed_km2, 1)} km2)")
    print(f"  [LAKE] обрезано регионов: {n_clipped}")


GERMANY_ZONES_SRC = source("germany_occupation_zones_1946.json")


def restore_german_occupation_zones(out_features):
    """SUPERSEDED-РАЗВОРОТ 2026-07-19-k. Комментарий KEEP_AS_IS["DE"] раньше
    гласил "зонирование отдельным шагом" — но такого шага НЕ БЫЛО НИ В ОДНОМ
    СКРИПТЕ этого репозитория, только в исходном импорте d/MAP (`146933a`).
    Берлин (4 сектора), Kiel Canal Zone и южно-германские зоны Вюртемберг-
    Баден/Баден+Гогенцоллерн жили ТОЛЬКО в gitignored `out/europe_1946.
    geojson`, годами накапливаясь как несброшенное состояние — build_europe_
    1946.py всегда строил Германию заново из СОВРЕМЕННЫХ 16 земель
    game_map.json, никогда не зная об этих зонах. Первый сегодняшний прогон
    этого скрипта (в рамках работы над Кипром/Киренией, до находки
    пользователя) тихо уничтожил их, заменив на единые Berlin/Baden-
    Württemberg — тот же класс потери, что Зона Панамского канала в
    Северной Америке (см. docs/DECISIONS.md "2026-07-19-k").

    Восстановлено из последнего коммита ДО этой сессии (`64af2bf`,
    `git show 64af2bf:client/public/world_1946.geojson`), где все 7 фич ещё
    были целы — геометрия сохранена постоянно (не gitignored) в
    `scripts/map/sources/germany_occupation_zones_1946.json` (.json, не
    .geojson — тот паттерн gitignore здесь исключил бы файл снова).
    Заменяет уже построенные единые Berlin/Baden-Württemberg этими 7."""
    with open(GERMANY_ZONES_SRC, encoding="utf-8") as f:
        zones_fc = json.load(f)

    before = len(out_features)
    kept = [ft for ft in out_features
            if not (ft["properties"].get("iso_a2") == "DE"
                     and ft["properties"].get("name") in ("Berlin", "Baden-Württemberg"))]
    removed = before - len(kept)
    out_features[:] = kept

    added = 0
    new_geoms = []
    for ft in zones_fc["features"]:
        name = ft["properties"]["name"]
        iso2 = ft["properties"]["iso_a2"]
        g = shape(ft["geometry"])
        new_geoms.append(g)
        out_features.append({
            "type": "Feature",
            "properties": {
                "iso_a2": iso2,
                "name": name,
                "source_adm1": ["ORIGINAL_DMAP_IMPORT"],
                "source_count": 1,
                "area_km2": round(area_km2(g), 1),
                "merge_method": "restored_from_commit_64af2bf",
            },
            "geometry": mapping(g),
        })
        added += 1
    print(f"  [DE] заменено {removed} объединённых фичи (Berlin/Baden-"
          f"Württemberg) на {added} восстановленных зон оккупации")

    # Kiel Canal Zone — анклав ВНУТРИ Schleswig-Holstein (и краем задевает
    # Niedersachsen), которые построены заново из game_map.json и ничего не
    # знают об этом анклаве — реальное наложение (0.067 + 0.0001 deg2,
    # 2026-07-19-k), не защита от которой gap-first: тут не разрыв, а
    # наложение специально восстановленной исторической зоны поверх
    # современной земли. Зона авторитетна (специально построена, как Голан/
    # Northern Cyprus), обрезаем современные земли по ней.
    new_union = unary_union(new_geoms)
    for ft in out_features:
        if ft["properties"].get("iso_a2") != "DE" or ft is None:
            continue
        if ft["properties"].get("name") in [z["properties"]["name"] for z in zones_fc["features"]]:
            continue
        g = shape(ft["geometry"])
        if not g.intersects(new_union):
            continue
        clipped = g.difference(new_union)
        if not clipped.is_valid:
            clipped = clipped.buffer(0)
        if clipped.area <= 1e-9:
            continue
        removed_km2 = area_km2(g) - area_km2(clipped)
        if removed_km2 < 1e-6:
            continue
        ft["geometry"] = mapping(clipped)
        ft["properties"]["area_km2"] = round(area_km2(clipped), 1)
        print(f"  [DE] {ft['properties']['name']} обрезана по восстановленным "
              f"зонам (-{round(removed_km2, 2)} km2)")


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

    fix_cyprus_larnaca_exclave(out_features)
    # fix_cyprus_famagusta_gap(out_features) — SUPERSEDED, см. её докстринг:
    # "разрыв" Larnaca/Famagusta оказался территорией Northern Cyprus,
    # добавляемой ниже, не настоящей дырой источника.
    add_cyprus_extra_territories(feats, out_features)
    restore_german_occupation_zones(out_features)
    clip_land_against_lakes(out_features, CLIP_LAKE_NAMES_EUROPE)

    # Фарерские острова — новая суша (2026-07-19-o), моря её не знают:
    # "Сев. Атлантика — Европейский сектор" уже накрывал эту точку открытым
    # океаном (0.116 deg2 наложения, найдено merge_world_1946.py
    # diagnostic) — тот же класс правки, что add_cyprus_extra_territories
    # делает для Northern Cyprus/Dhekelia (вода режется по новой суше).
    faroe_geoms = [shape(ft["geometry"]) for ft in out_features if ft["properties"]["iso_a2"] == "FO"]
    if faroe_geoms:
        clip_seas_against_land(unary_union(faroe_geoms),
                                ["Сев. Атлантика — Европейский сектор", "Norwegian Sea"])

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
