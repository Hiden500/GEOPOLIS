"""
clip_us_counties_to_raw_land.py — обрезка county-кластеров США по сырой
суше (2026-07-29).

КОРЕНЬ ПРОБЛЕМЫ. `build_us_states_split_1946.py` собирает суб-регионы
штатов из geoBoundaries USA ADM2 (округа) и обрезает их только
`difference(neighbors_union)` — по соседям, но НЕ по суше. А юридические
границы округов США идут ПО ВОДЕ: San Juan County владеет акваторией
пролива Хуан-де-Фука, Accomack — водами Чесапикского залива, Newport —
Наррагансеттского. В карту это попало как СУША.

Последствия оказались куда шире косметики (найдено 2026-07-29 по жалобе
пользователя на "сирот" у моря):
  - `Washington — San Juan` жил с 9706 км² при 412 км² настоящей суши —
    96% площади была акваторией и канадской землёй;
  - `clip_land_by_water.py` отказывался это резать (его порог
    MAX_SAFE_FRACTION=10% защищает от уничтожения реальных островов
    грубым океанским сектором), а `clip_sea_by_land.py`, работая по
    принципу "суша точна, море грубое", покорно вырезал МОРЕ по этой
    ложной суше;
  - `North Pacific — American Sector` из-за этого распался с 1 куска до
    17 (1 в `628a3bd` → 15 в `main` → 17 к 2026-07-29): дефект молча РОС
    с каждой серией фиксов берега, потому что ни одна проверка не
    сверяла площадь региона с сырым источником.

ПОЧЕМУ ПОРОГ, А НЕ "ОБРЕЗАТЬ ВСЁ". Прямой замер по всем 112
county-кластерам: у 5 регионов доля площади вне сырой суши 11–96%
(настоящая акватория), у остальных 8 — доли процента (Alaska
-434 км² при 1.49 млн, Yakima -7 км² при 70 тыс.). Вторая группа — обычное
расхождение оцифровки: сырьё game_map.json грубее геоBoundaries, и
обрезка по нему УХУДШИЛА бы берег, наплодив разрывов там, где округа
точнее. Поэтому режется только то, где доля превышает
MIN_WATER_FRACTION — на порядок выше шума оцифровки и чуть агрессивнее
порога аудита (INFLATED_FRACTION=0.15), чтобы после обрезки аудит был
чист.

Освободившуюся акваторию НЕ заполняем здесь: это работа
`fix_sea_coastline_gaps.py` (море растёт к сырой суше), который идёт
дальше по FULL_REBUILD_STEPS.

Читает/пишет out/namerica_1946.geojson. Число фич НЕ меняется — значит
позиционные `ownership_1946.json`/`names_ru.json`/`CAPITAL_REGION_
OVERRIDES` не сдвигаются (см. docs/DECISIONS.md 2026-07-29 о каскаде
позиционных сдвигов).

Идемпотентен: после обрезки доля площади вне сырой суши падает ниже
порога, повторный прогон ничего не находит.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import game_map, out  # noqa: E402
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402
from shapely.geometry import shape, mapping  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

NAM_PATH = out("namerica_1946.geojson")
# Доля площади вне сырой суши, выше которой обрезаем. Замер 2026-07-29:
# настоящая акватория даёт 11-96%, расхождение оцифровки — <1%.
MIN_WATER_FRACTION = 0.10
TARGET_MERGE_METHOD = "county_cluster"
TARGET_ISO = "US"


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    raw = load_features(game_map())
    us_raw = [shape(ft["geometry"]).buffer(0) for ft in raw
              if ft["properties"].get("iso_a2") == TARGET_ISO]
    if not us_raw:
        print(f"  ВНИМАНИЕ: в сыром источнике нет фич iso_a2={TARGET_ISO} — прерываю")
        return
    tree = STRtree(us_raw)
    print(f"  сырых фич {TARGET_ISO}: {len(us_raw)}")

    feats = load_features(NAM_PATH)
    n_clipped = 0
    total_removed = 0.0
    for ft in feats:
        p = ft["properties"]
        if p.get("iso_a2") != TARGET_ISO or p.get("merge_method") != TARGET_MERGE_METHOD:
            continue
        g = shape(ft["geometry"]).buffer(0)
        a = area_km2(g)
        if a <= 0:
            continue
        idx = tree.query(g)
        if len(idx) == 0:
            continue
        cov = unary_union([us_raw[int(i)] for i in idx])
        clipped = to_polygonal(g.intersection(cov))
        if clipped.is_empty:
            print(f"  ВНИМАНИЕ: {p.get('name')} обрезался бы в ПУСТО — пропускаю")
            continue
        na = area_km2(clipped)
        frac = (a - na) / a
        if frac < MIN_WATER_FRACTION:
            continue
        ft["geometry"] = mapping(clipped)
        p["area_km2"] = round(na, 1)
        n_clipped += 1
        total_removed += a - na
        print(f"    {p.get('name')}: {a:.1f} -> {na:.1f} км² "
              f"(снято {a - na:.1f}, {frac*100:.1f}% — акватория)")

    if not n_clipped:
        print("  обрезать нечего (все county-кластеры в пределах сырой суши)")
        return

    print(f"  Обрезано регионов: {n_clipped}, снято суши: {total_removed:.1f} км²")
    with open(NAM_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)
    print(f"  Записано: {NAM_PATH}")


if __name__ == "__main__":
    main()
