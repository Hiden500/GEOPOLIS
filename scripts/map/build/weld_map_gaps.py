"""
weld_map_gaps.py — глобальное закрытие внутренних дыр карты (2026-07-30).

ЗАЧЕМ. Пользователь: «Все полигоны должны прилипать друг к другу», «не
должно быть этой белой линии». Требование давнее (2026-07-19-e: «Пока не
будет идеального прилипания — не отстану»), и до сих пор не выполненное:
gap-first `absorb_slivers` закрыл КРУПНЫЕ пробелы, но тонкие остались.

Замер, с которого начался этот скрипт: `unary_union` всех 1577 фич даёт один
полигон с **718 внутренними дырами суммарно 3312 км²**, медианная ширина
156 м. Распределение: 701 дыра на стыке суша↔море, 12 между морскими
фичами, 5 между регионами суши.

ПОЧЕМУ ИХ НЕ ВИДЕЛИ. Их видели и сознательно игнорировали:
`diagnose_coastline_gaps.py` относит такие полосы к категории `LAND_SEAM`
(MRR aspect >= 8) и не выводит списком — «шум несовпадения независимо
оцифрованных границ», потому что без фильтра первый прогон давал 1017
находок. Плюс порог `MIN_AREA_KM2 = 0.5` там же скрывает всё тоньше
полукилометра. То есть дыра шириной 156 м не попадала ни в один отчёт.

ЧЕМ ЭТОТ МЕТОД ОТЛИЧАЕТСЯ ОТ `absorb_slivers`. Тот ищет ячейки
`polygonize`-мозаики и пропускает их через гейты формы/площади
(`MAX_COMPACT_AREA`, `RIBBON_COMPACTNESS`, `MIN_AREA_KM2`) — по построению
не может закрыть то, что отклоняет по форме. Здесь список дыр берётся из
`interior_rings` глобального union: это ИСЧЕРПЫВАЮЩИЙ перечень мест, не
покрытых ничем и окружённых картой, без каких-либо порогов формы. Никакого
buffer (запрещён правилом №11 `scripts/map/README.md`, отвергнут
2026-07-19-e) — дыра отдаётся существующей фиче целиком.

КОМУ ОТДАЁТСЯ ДЫРА:
  - касается и суши, и воды (701 шт.) → ВОДЕ;
  - касается только воды (12) → воде с самой длинной общей границей;
  - касается только суши (5) → суше с самой длинной общей границей.

Направление «берег → воде» выбрано по двум причинам. Во-первых, контур суши
в этом проекте уже принят авторитетным: `fix_sea_coastline_gaps.py` растит
МОРЕ к сырой суше `game_map.json`, а не наоборот. Во-вторых — и это решающее
— при таком направлении площадь суши не меняется вовсе, значит не
затрагиваются ни `fill_region_economy_1946.py`, ни квантильные пороги
`economy_1946/density_tiers.py::generic_tier`, где перескок тира даёт
скачок населения ×5, который не поймает ни один тест. Море получает
+3312 км² при 18+ млн км² — 0.02%.

ЧЕГО СКРИПТ НЕ ДЕЛАЕТ (осознанно):
  - не меняет число, порядок и состав фич — мутирует `ft["geometry"]` по
    индексу, иначе каскад позиционных id (`out/ownership_1946.json`,
    `out/names_ru.json`, `economy_1946/capital_overrides.py`);
  - не применяет `geometry_cleanup.to_polygonal()` к суше: его
    `DEGENERATE_AREA_DEG2 = 1e-4` (~1.24 км²) молча выбрасывает мелкие
    острова как части MultiPolygon;
  - не трогает `game_map.json` и не двигает узлы — только присоединяет
    пустоты. Приведение узлов к общим рёбрам — отдельная задача
    (`build_master_map.py`).

Читает/пишет континентальные `out/<continent>_1946.geojson` +
`out/seas_1946.geojson` + `out/lakes_1946.geojson`. НЕ пишет
`out/world_1946.geojson` — он производный (`merge_world_1946.py`).

Идемпотентен: после прогона внутренних дыр не остаётся, повторный находит 0.
"""
import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import shape, mapping, Polygon  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

# Слои, которые скрипт вправе менять. Порядок совпадает с SOURCES в
# merge_world_1946.py — важно только для читаемости отчёта.
LAYERS = [
    ("europe_1946.geojson", "land"),
    ("asia_1946.geojson", "land"),
    ("namerica_1946.geojson", "land"),
    ("southamerica_1946.geojson", "land"),
    ("africa_1946.geojson", "land"),
    ("oceania_1946.geojson", "land"),
    ("antarctica_1946.geojson", "land"),
    ("seas_1946.geojson", "sea"),
    ("lakes_1946.geojson", "lake"),
]

# Допуск «дыра касается фичи». 1e-7° ~ 1 см: дыра по построению вырезана
# ровно по границам соседей, поэтому касание точное, и порог нужен лишь
# как защита от float-погрешности.
TOUCH_DEG = 1e-7
# Дыры мельче этого не трогаем: это машинный шум noding'а, а union такой
# площади лишь сдвигает координаты, порождая новый фантом на следующем
# проходе (тот же механизм, что описан у MIN_CELL_AREA_DEG2 в
# geometry_cleanup.py).
MIN_HOLE_AREA_DEG2 = 1e-12


def load_layer(name):
    with open(out(name), encoding="utf-8") as f:
        return json.load(f)


def valid(g):
    return g if g.is_valid else g.buffer(0)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="только посчитать дыры, ничего не записывать")
    args = ap.parse_args()

    # --- загрузка всех слоёв в один плоский список с обратными ссылками ---
    layers = {}
    entries = []          # (layer_name, index_in_layer, region_type)
    geoms = []
    for name, rt in LAYERS:
        data = load_layer(name)
        layers[name] = data
        for i, ft in enumerate(data["features"]):
            entries.append((name, i, rt))
            geoms.append(valid(shape(ft["geometry"])))
    print(f"  загружено фич: {len(geoms)} из {len(LAYERS)} слоёв", flush=True)

    print("  строю глобальный union…", flush=True)
    u = unary_union(geoms)
    parts = list(u.geoms) if u.geom_type == "MultiPolygon" else [u]

    holes = []
    for p in parts:
        for ring in p.interiors:
            h = Polygon(ring)
            if not h.is_valid:
                h = h.buffer(0)
            if h.is_empty or h.area < MIN_HOLE_AREA_DEG2:
                continue
            holes.append(h)
    total_area = sum(area_km2(h) for h in holes)
    print(f"  внутренних дыр: {len(holes)}, суммарно {total_area:.2f} км²", flush=True)
    if not holes:
        print("  дыр нет — карта уже сплошная")
        return 0

    tree = STRtree(geoms)

    # --- раздача дыр ---
    assigned = {}          # global_idx -> [hole, ...]
    stats = {"land+sea": 0, "sea": 0, "land": 0, "unresolved": 0}
    for h in holes:
        cand = [int(i) for i in tree.query(h.buffer(TOUCH_DEG * 10))]
        touch = []
        for i in cand:
            if geoms[i].distance(h) <= TOUCH_DEG:
                touch.append(i)
        if not touch:
            stats["unresolved"] += 1
            continue

        water = [i for i in touch if entries[i][2] in ("sea", "lake")]
        land = [i for i in touch if entries[i][2] == "land"]

        # Берег: отдаём ВОДЕ — площадь суши остаётся неизменной, экономика
        # и квантильные тиры не затрагиваются (см. докстринг модуля).
        pool = water if water else land
        if water and land:
            stats["land+sea"] += 1
        elif water:
            stats["sea"] += 1
        else:
            stats["land"] += 1

        # Из пула — тот, с кем у дыры самая длинная общая граница
        best, best_len = None, -1.0
        hb = h.boundary
        for i in pool:
            shared = hb.intersection(geoms[i].boundary).length
            if shared > best_len:
                best_len, best = shared, i
        if best is None:
            stats["unresolved"] += 1
            continue
        assigned.setdefault(best, []).append(h)

    print(f"  роздано: берег→воде {stats['land+sea']}, "
          f"вода→воде {stats['sea']}, суша→суше {stats['land']}"
          + (f", НЕ РАЗОБРАНО {stats['unresolved']}" if stats["unresolved"] else ""))

    if args.dry_run:
        print("  --dry-run: ничего не записано")
        return 0

    # --- применение ---
    changed_layers = set()
    grown = []
    for gi, hs in assigned.items():
        name, idx, _rt = entries[gi]
        ft = layers[name]["features"][idx]
        before = geoms[gi]
        after = unary_union([before] + hs)
        # to_polygonal НЕ применяем: он выбрасывает части < 1.24 км² и на
        # суше это тихая потеря островов (см. докстринг модуля).
        if after.geom_type not in ("Polygon", "MultiPolygon"):
            print(f"    ВНИМАНИЕ: {ft['properties'].get('name')} дал "
                  f"{after.geom_type} — пропускаю")
            continue
        ft["geometry"] = mapping(after)
        d = area_km2(after) - area_km2(before)
        ft["properties"]["area_km2"] = round(area_km2(after), 1)
        changed_layers.add(name)
        grown.append((d, ft["properties"].get("name"), name))

    grown.sort(reverse=True)
    print(f"  изменено фич: {len(grown)} в {len(changed_layers)} слоях")
    for d, nm, layer in grown[:12]:
        print(f"    +{d:9.2f} км²  {nm}  [{layer}]")
    if len(grown) > 12:
        print(f"    … и ещё {len(grown) - 12}")

    for name in sorted(changed_layers):
        with open(out(name), "w", encoding="utf-8") as f:
            json.dump(layers[name], f, ensure_ascii=False)
        print(f"  Записано: {out(name)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
