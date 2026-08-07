"""
build_brazil_1946.py
Бразилия 1946 года - современная основа + точечные исторические правки
(аналог build_china_1946_v2.py для Маньчжурии/Сикана).

Подтверждённые источниками расхождения с современностью:
  - Acre, Amapá: уже территории (не штаты) в 1946 - геометрия не меняется,
    только статус
  - Roraima (тогда "Rio Branco"), Rondônia (тогда "Guaporé"): территории,
    переименование без изменения геометрии
  - Fernando de Noronha: отдельная территория-остров, вырезана из
    Pernambuco (муниципия в ADM2)
  - Ponta Porã: федеральная территория 1943-1946 (расформирована 18 сент.
    1946 - на начало года ещё существовала), собрана из 7 муниципий юга
    Mato Grosso (Bela Vista, Dourados, Maracaju, Miranda, Nioaque,
    Ponta Porã, Porto Murtinho) - площадь 46,655 km2
  - Iguaçu: федеральная территория 1943-1946, известная площадь ~65,000
    km2 (Oeste/Sudoeste Paraná + Oeste Santa Catarina) - калибровано
    отсечением по долготе lon<-52.7 (даёт 65,528 km2, точное совпадение)
  - Mato Grosso do Sul: не существовал до 1977 - объединён с Mato Grosso
  - Tocantins: не существовал до 1988 - объединён с Goiás
  - Distrito Federal (Brasília): построена/перенесена столица только в
    1960 - в 1946 это была территория Goiás
  - Рио-де-Жанейро: в 1946 федеральный округ (город) был ОТДЕЛЬНОЙ
    единицей от штата Rio de Janeiro (столица штата - Niterói); объединены
    в одно состояние только в 1975. Город извлечён из ADM2.
"""
from paths import game_map, out, source
import json
from shapely.geometry import shape, mapping, box
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
GAME_MAP = game_map()
MUNI_SRC = source("geoBoundaries-BRA-ADM2.geojson")
OUT = out("brazil_1946.geojson")

PONTA_PORA_MUNIS = ["Bela Vista", "Dourados", "Maracaju", "Miranda", "Nioaque",
                    "Ponta Porã", "Porto Murtinho"]
IGUACU_LON_CUT = -52.7  # калибровано под известную площадь ~65,000 km2


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def main():
    with open(GAME_MAP, encoding="utf-8") as f:
        gm = json.load(f)
    modern = {f["properties"]["name"]: shape(f["geometry"])
              for f in gm["features"] if f["properties"].get("iso_a2") == "BR"}

    with open(MUNI_SRC, encoding="utf-8") as f:
        muni_fc = json.load(f)
    muni_by_name = {}
    for f in muni_fc["features"]:
        muni_by_name.setdefault(f["properties"]["shapeName"], []).append(shape(f["geometry"]))

    out_features = []

    def add(name, geom, note=""):
        if not geom.is_valid:
            geom = geom.buffer(0)
        out_features.append({
            "type": "Feature",
            "properties": {"iso_a2": "BR", "name": name, "area_km2": round(area_km2(geom), 1),
                            "merge_method": "historical_1946" if note else "modern_unchanged",
                            **({"note": note} if note else {})},
            "geometry": mapping(geom),
        })

    # --- простые переименования территорий (без изменения геометрии) ---
    add("Acre", modern["Acre"], "Федеральная территория в 1946 (статус, не штат)")
    add("Amapá", modern["Amapá"], "Федеральная территория в 1946 (статус, не штат)")
    add("Rio Branco", modern["Roraima"], "1946 название Roraima (переим. 1962), федеральная территория")
    add("Guaporé", modern["Rondônia"], "1946 название Rondônia (переим. 1956), федеральная территория")

    # --- Fernando de Noronha: остров-территория, вырезан из Pernambuco ---
    fn_geom = unary_union(muni_by_name["Fernando de Noronha"])
    pernambuco_rump = modern["Pernambuco"].difference(fn_geom.buffer(0.01))
    add("Fernando de Noronha", fn_geom, "Федеральная территория-остров в 1946 (вернулась в Pernambuco в 1988)")
    add("Pernambuco", pernambuco_rump)

    # --- Ponta Porã: 7 муниципий юга объединённого Mato Grosso ---
    pp_parts = []
    for n in PONTA_PORA_MUNIS:
        pp_parts.extend(muni_by_name.get(n, []))
    pp_geom = unary_union(pp_parts)
    mt_combined = unary_union([modern["Mato Grosso"], modern["Mato Grosso do Sul"]])
    mt_rump = mt_combined.difference(pp_geom.buffer(0.01))
    add("Ponta Porã", pp_geom, "Федеральная территория 1943-46 (расформирована 18.09.1946, "
                                "на начало 1946 года существовала). MS не существовал до 1977.")
    add("Mato Grosso", mt_rump, "MS (Mato Grosso do Sul) не существовал до 1977 - объединён")

    # --- Iguaçu: калиброванная зона запада Paraná + запада Santa Catarina ---
    clip_box = box(-60, -30, IGUACU_LON_CUT, -20)
    iguacu_pr = modern["Paraná"].intersection(clip_box)
    iguacu_sc = modern["Santa Catarina"].intersection(clip_box)
    iguacu_geom = unary_union([iguacu_pr, iguacu_sc])
    pr_rump = modern["Paraná"].difference(clip_box)
    sc_rump = modern["Santa Catarina"].difference(clip_box)
    add("Iguaçu", iguacu_geom, "Федеральная территория 1943-46 (расформирована 18.09.1946). "
                                "Граница калибрована по долготе под известную площадь ~65,000 km2 "
                                "(точных архивных координат не найдено)")
    add("Paraná", pr_rump)
    add("Santa Catarina", sc_rump)

    # --- Goiás: + Tocantins (не существовал до 1988) + Distrito Federal (Brasília с 1960) ---
    goias_combined = unary_union([modern["Goiás"], modern["Tocantins"], modern["Distrito Federal"]])
    add("Goiás", goias_combined, "Tocantins (с 1988) и Distrito Federal/Brasília (столица "
                                   "перенесена в 1960) объединены обратно - в 1946 всё это Goiás")

    # --- Рио-де-Жанейро: федеральный округ (город) отдельно от штата ---
    # Вычитание БЕЗ буфера. Было `.buffer(0.01)`, и это оставляло между городом
    # и штатом ров шириной 0.00997° ≈ 1,11 км: у столицы Бразилии выходило ноль
    # сухопутных соседей, а 71 км² суши доставались морю SEA-0096. Ров вычищен
    # из мастера хирургически (build/fix_dalian_rio_master.py, 2026-08-07).
    #
    # НЕ ПРОВЕРЕНО ПРОГОНОМ: `sources/geoBoundaries-BRA-ADM2.geojson`
    # отсутствует с 2026-08-02 (каталог в .gitignore), скрипт падает с
    # FileNotFoundError на чтении муниципий. Правка нужна, чтобы следующая
    # пересборка не воссоздала ров, но её результат не измерен.
    rj_city_geom = unary_union(muni_by_name["Rio de Janeiro"])
    rj_state_rump = modern["Rio de Janeiro"].difference(rj_city_geom)
    add("Distrito Federal (Rio de Janeiro)", rj_city_geom,
        "В 1946 столица Бразилии - федеральный округ = город Рио-де-Жанейро, "
        "отдельно от штата (столица штата - Niterói). Объединены в 1975.")
    add("Rio de Janeiro (estado)", rj_state_rump)

    # --- всё остальное без изменений ---
    HANDLED = {"Acre", "Amapá", "Roraima", "Rondônia", "Pernambuco", "Mato Grosso",
               "Mato Grosso do Sul", "Paraná", "Santa Catarina", "Goiás", "Tocantins",
               "Distrito Federal", "Rio de Janeiro"}
    for name, geom in modern.items():
        if name in HANDLED:
            continue
        add(name, geom)

    fc = {"type": "FeatureCollection", "features": out_features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)

    print(f"Регионов: {len(out_features)}")
    total = sum(ft["properties"]["area_km2"] for ft in out_features)
    print(f"Суммарная площадь: {total:,.0f} km2")
    for ft in out_features:
        print(" ", ft["properties"]["name"], ft["properties"]["area_km2"])


if __name__ == "__main__":
    main()
