"""
build_palestine_1946.py

Историческая реконструкция Подмандатной Палестины на 1946-01-01: 6 округов /
16 подрайонов (Administrative Divisions (Amendment) Proclamation, 1942,
действовала без изменений структуры округов до конца мандата — см.
en.wikipedia.org/wiki/Districts_of_Mandatory_Palestine).

Источник game_map.json даёт для этой территории только 6 СОВРЕМЕННЫХ
израильских округов (ISR, post-1948, несколько post-1990s) + 2 нерасчленённых
пятна (Газа/Зап.берег) — историческая структура мандата там не сохранилась
вообще (в отличие от Германии/Кореи, где раздел уже нативно есть в
ownership_1946.json). Готового векторного шейпфайла границ 1946 года не
нашлось (проверены palopenmaps.org — растровые карточные листы, не полигоны;
HDX/iGISMap — только современные границы State of Palestine). Поэтому, по
образцу build_china_1946_v2.py (который взял реальный архивный шейпфайл
1947-49 и наложил его поверх современной основы), здесь СТРОИТЕЛЬНЫЙ МАТЕРИАЛ
— современные ADM2-юниты (geoBoundaries), сгруппированные по историческому
подрайону мандата, а не архивный шейпфайл — техника упрощается до простого
объединения (unary_union) юнитов одной группы, без gap-fill/nearest-distance
логики Китая (там она нужна, т.к. историч. и совр. границы не совпадают
точно; здесь совр. ADM2-юниты берутся ЦЕЛИКОМ, не режутся).

Источники (см. также docs/HISTORICAL_ACCURACY.md, scripts/map/README.md):
  - geoBoundaries ISR ADM2 (15 округов/нафот), CC0 1.0 Public Domain,
    https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/ISR/ADM2/geoBoundaries-ISR-ADM2.geojson
  - geoBoundaries PSE ADM2 (16 губернаторств), CC BY 4.0 (атрибуция),
    https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/PSE/ADM2/geoBoundaries-PSE-ADM2.geojson

КРИТИЧНО: современный израильский округ "Golan" (Голанские высоты, захвачены
у Сирии в 1967) ИСКЛЮЧЁН из группировки подрайонов Палестины целиком — в 1946
это была территория французского мандата Сирии, не Палестины. Геометрия НЕ
выбрасывается: game_map.json/Natural Earth не содержит эту территорию ни в
сирийском, ни в израильском наборе (реальная дыра в исходных данных, не
специфичная для этого скрипта — найдено 2026-07-19 по прямой жалобе
пользователя на пропавшую на рендере территорию). Единственный источник её
геометрии в этом пайплайне — уже загруженный здесь geoBoundaries ISR-набор,
поэтому полигон экспортируется отдельной фичей с iso_a2="SY" в конце этого
же выходного файла; build_asia_1946.py забирает её оттуда и вливает как
дополнительный исходный юнит Сирии ДО геометрического слияния (GEOMETRIC["SY"]),
чтобы алгоритм сам подхватил её к соседнему кластеру (Quneitra/Dar'a).

Группировка современных ADM2 -> исторический подрайон 1946 года — каждая
запись сверена с источником (не угадана):
  - Acre/Safad/Tiberias/Haifa: прямое совпадение имени с современным округом.
  - Назарет + Бейсан: Wikipedia (Beisan Subdistrict) — "has been merged with
    the neighboring Nazareth Subdistrict to form the modern-day Jezre'el
    County" — оба подрайона слились в один современный округ Yizre'el,
    разделить географически невозможно (нет данных) — на выходе ОДИН
    объединённый регион, а не 16, а 15 (см. итоговый список ниже).
  - Хайфа + Хадера: подтверждено (WebSearch) — Hadera была частью Haifa
    Subdistrict вплоть до конца мандата, отдельным округом стала только
    после 1948.
  - Наблус + Тубас + Сальфит + Калькилия: WebSearch — все три современных
    губернаторства-новодела (post-1995) исторически принадлежали "Jabal
    Nablus" (округу Наблуса).
  - Иерусалим + Вифлеем + Иерихон: Wikipedia (Districts of Mandatory
    Palestine) — поправка 1942 года прямо слила подрайоны Вифлеема и
    Иерихона в Иерусалимский; действовало на 1946 год без изменений.
  - Яффа = Tel Aviv + Petah Tiqwa + HaSharon: Wikipedia (Jaffa Subdistrict) —
    поимённый список населённых пунктов подрайона включает Petah Tikva,
    Ramat Gan, Bnei Brak (совр. округ Petah Tiqwa) и Herzliya, Kfar Saba,
    Ra'anana (совр. округ HaSharon), не только Tel-Aviv/Jaffa.
  - Рамле = Ramla + Rehovot: WebSearch — "the area that had made up Ramla
    Subdistrict became... mostly subdivided between a newly created Ramla
    Subdistrict and Rehovot Subdistrict" (после 1948).
  - Газа = Gaza+North Gaza+Deir Al Balah+Khan Yunis+Rafah (все PSE) + Ashqelon
    (ISR): Wikipedia (Gaza Subdistrict) — поимённый список населённых
    пунктов явно включает "Khan Yūnis (Urban)" и "Rafah", а также
    "El Majdal" (совр. город Ашкелон) — вопреки первоначальному
    предположению, что Хан-Юнис/Рафах были в Беэр-Шеве.
  - Беэр-Шева = Be'er Sheva (ISR) один, без прибрежной полосы (см. выше).

Принцип границ (см. docs/HISTORICAL_ACCURACY.md, "Постоянный принцип
границ"): важнее совместимость с будущими конфликтами игры (1948 война,
линия перемирия/Зелёная линия, граница сектора Газа/Западного берега), чем
хирургическая точность архивной линии 1946 года. Строительный материал тут —
уже современные ADM2 (выросшие из линии перемирия 1949), поэтому группировка
по историческим именам естественно остаётся близкой к будущим линиям
конфликта без специальной подгонки.
"""
from paths import out, source
import json
from shapely.geometry import shape as shp_shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
ISR_SRC = source("palestine_hist/geoBoundaries-ISR-ADM2.geojson")
PSE_SRC = source("palestine_hist/geoBoundaries-PSE-ADM2.geojson")
OUT = out("palestine_1946_historical.json")

EXCLUDE_MODERN_UNITS = {("ISR", "Golan")}  # Голанские высоты — Сирия 1946, не Палестина

# исторический_подрайон -> (округ_мандата, [(источник, совр._имя), ...])
SUBDISTRICT_GROUPS: dict[str, tuple[str, list[tuple[str, str]]]] = {
    "Acre": ("Galilee", [("ISR", "Akko")]),
    "Safad": ("Galilee", [("ISR", "Zefat")]),
    "Tiberias": ("Galilee", [("ISR", "Kinneret")]),
    "Nazareth-Beisan": ("Galilee", [("ISR", "Yizre'el")]),
    "Haifa": ("Haifa", [("ISR", "Haifa"), ("ISR", "Hadera")]),
    "Jenin": ("Samaria", [("PSE", "Jenin")]),
    "Nablus": ("Samaria", [("PSE", "Nablus"), ("PSE", "Tubas"), ("PSE", "Salfit"), ("PSE", "Qalqiliya")]),
    "Tulkarm": ("Samaria", [("PSE", "Tulkarm")]),
    "Jerusalem": ("Jerusalem", [("ISR", "Jerusalem"), ("PSE", "Jerusalem"),
                                  ("PSE", "Bethlehem"), ("PSE", "Jericho & Al Aghwar")]),
    "Hebron": ("Jerusalem", [("PSE", "Hebron")]),
    "Ramallah": ("Jerusalem", [("PSE", "Ramallah & Al Bireh")]),
    "Jaffa": ("Lydda", [("ISR", "Tel Aviv"), ("ISR", "Petah Tiqwa"), ("ISR", "HaSharon")]),
    "Ramle": ("Lydda", [("ISR", "Ramla"), ("ISR", "Rehovot")]),
    "Gaza": ("Gaza", [("PSE", "Gaza"), ("PSE", "North Gaza"), ("PSE", "Deir Al Balah"),
                       ("PSE", "Khan Yunis"), ("PSE", "Rafah"), ("ISR", "Ashqelon")]),
    "Beersheba": ("Gaza", [("ISR", "Be'er Sheva")]),
}


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def load_units(path: str, tag: str) -> tuple[dict[str, object], dict[str, object]]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    units = {}
    excluded = {}
    for feat in data["features"]:
        name = feat["properties"]["shapeName"]
        g = shp_shape(feat["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if (tag, name) in EXCLUDE_MODERN_UNITS:
            excluded[name] = g
            continue
        units[name] = g
    return units, excluded


def trim_internal_overlaps(features: list[dict], order: list[str]) -> None:
    """15 подрайонов строятся из ДВУХ независимо оцифрованных источников
    (geoBoundaries ISR + PSE) — их общие границы не совпадают идеально,
    отсюда мелкие взаимные наложения между соседними подрайонами (до
    ~0.002 deg2, найдено 2026-07-19 по жалобе пользователя на "разрывы
    между полигонами" на рендере). Убираем детерминированно: каждый
    следующий по `order` подрайон обрезается по уже обработанным ранее
    (тот же принцип приоритета "уже построенный сосед", что и
    clip_palestine_to_neighbors в build_asia_1946.py) — гарантирует ноль
    взаимных наложений, ничего не подвигает и не создаёт новых зазоров."""
    by_name = {ft["properties"]["name"]: ft for ft in features}
    processed_union = None
    for name in order:
        ft = by_name.get(name)
        if ft is None:
            continue
        g = shp_shape(ft["geometry"])
        if processed_union is not None and g.intersects(processed_union):
            trimmed = g.difference(processed_union)
            if not trimmed.is_valid:
                trimmed = trimmed.buffer(0)
            if trimmed.area > 1e-9:
                ft["geometry"] = mapping(trimmed)
                ft["properties"]["area_km2"] = round(area_km2(trimmed), 1)
                g = trimmed
        processed_union = g if processed_union is None else unary_union([processed_union, g])


def main():
    units = {}
    excluded = {}
    units["ISR"], excluded["ISR"] = load_units(ISR_SRC, "ISR")
    units["PSE"], excluded["PSE"] = load_units(PSE_SRC, "PSE")

    used = {"ISR": set(), "PSE": set()}
    out_features = []
    for subdistrict, (district, sources) in SUBDISTRICT_GROUPS.items():
        pieces = []
        missing = []
        for tag, name in sources:
            g = units[tag].get(name)
            if g is None:
                missing.append(f"{tag}:{name}")
                continue
            pieces.append(g)
            used[tag].add(name)
        if missing:
            print(f"  ВНИМАНИЕ: не найдены {missing} для подрайона {subdistrict}")
        if not pieces:
            continue
        geom = unary_union(pieces) if len(pieces) > 1 else pieces[0]
        out_features.append({
            "type": "Feature",
            "properties": {
                "iso_a2": "PS",
                "name": subdistrict,
                "district_1946": district,
                "merge_method": "historical_adm2_group",
                "note": "Границы = объединение современных ADM2-юнитов (geoBoundaries), "
                         "сгруппированных по историческому подрайону мандата 1946 года "
                         "(см. докстринг скрипта за источниками по каждой группе). Не "
                         "архивный шейпфайл — реальных векторных границ 1946 года не нашлось.",
                "area_km2": round(area_km2(geom), 1),
            },
            "geometry": mapping(geom),
        })

    # Проверка полноты покрытия: каждый совр. юнит должен быть использован
    # ровно один раз (кроме явно исключённого Golan) — иначе какой-то кусок
    # исторической Палестины 1946 молча выпал из результата.
    for tag in ("ISR", "PSE"):
        all_names = set(units[tag].keys())
        unused = all_names - used[tag]
        if unused:
            print(f"  ВНИМАНИЕ: неиспользованные {tag} юниты: {sorted(unused)}")

    # Наложения между соседними подрайонами (два независимых источника ISR/
    # PSE не совпадают идеально на общей границе) - см. докстринг
    # trim_internal_overlaps.
    trim_internal_overlaps(out_features, list(SUBDISTRICT_GROUPS.keys()))

    # Голанские высоты - см. докстринг файла: не подрайон Палестины, но
    # единственный источник их геометрии в пайплайне - уже загруженный
    # здесь geoBoundaries ISR-набор. Экспортируем отдельной фичей с
    # iso_a2="SY"; build_asia_1946.py вливает её в Сирию до геометрического
    # слияния.
    golan_geom = excluded.get("ISR", {}).get("Golan")
    if golan_geom is not None:
        out_features.append({
            "type": "Feature",
            "properties": {
                "iso_a2": "SY",
                "name": "Golan Heights",
                "district_1946": "Syria (Quneitra)",
                "merge_method": "historical_exclave_to_syria",
                "note": "Голанские высоты (совр. израильский округ 'Golan' в "
                         "geoBoundaries ISR ADM2) - на 1946 год часть французского "
                         "мандата Сирии (захвачены Израилем в 1967), не Палестины. "
                         "game_map.json/Natural Earth не содержит эту территорию ни "
                         "в сирийском, ни в израильском наборе (реальная дыра в "
                         "исходных данных, не только в этой реконструкции) - "
                         "вливается в Сирию build_asia_1946.py до GEOMETRIC-слияния.",
                "area_km2": round(area_km2(golan_geom), 1),
            },
            "geometry": mapping(golan_geom),
        })
    else:
        print("  ВНИМАНИЕ: геометрия Golan не найдена в исключённых юнитах ISR")

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    ps_features = [ft for ft in out_features if ft["properties"]["iso_a2"] == "PS"]
    total = sum(ft["properties"]["area_km2"] for ft in ps_features)
    print(f"\nПодрайонов: {len(ps_features)}")
    print(f"Суммарная площадь: {total:,.0f} km2")
    for ft in ps_features:
        p = ft["properties"]
        print(f"  {p['name']:20s} ({p['district_1946']:10s}) {p['area_km2']:>8.1f} km2")
    if golan_geom is not None:
        print(f"  + Golan Heights -> SY (build_asia_1946.py): "
              f"{round(area_km2(golan_geom), 1):,.1f} km2")


if __name__ == "__main__":
    main()
