"""
diagnose_missing_land.py — разовый диагностический скрипт (НЕ шаг пайплайна):
находит сушу, которая ЕСТЬ в сыром источнике game_map.json, но ОТСУТСТВУЕТ на
итоговой карте (рендерится фоном — ни суша, ни море её не покрывают).

Зачем (2026-07-22, пользователь: "не могу физически каждый клочок проверять"):
мелкие острова/территории тихо теряются при укрупнении/фильтрации по странам
(Akrotiri под adm0_a3=WSB — вообще никогда не была в карте; Мальдивы —
21 фича выпала целиком). Ручной визуальный обход всего мира нереален — этот
скрипт формализует проверку.

Три независимых слоя (каждый ловит свой класс пропажи):
  1. Целые страны: iso_a2 присутствует в сыром источнике, но отсутствует в
     выходе. Затем пространственная проверка покрытия — отличает РЕАЛЬНУЮ
     пропажу суши от территории, просто перетегированной/влитой в соседа под
     другим iso (Израиль → влит, 98% покрыт — не пропажа).
  2. Спорные территории iso_a2="-1" (Natural Earth так тегирует Кашмир/
     Northern Cyprus/базы и т.п.): проверка покрытия по имени — здесь пряталась
     Akrotiri (WSB-5133).
  3. Пофичевая проверка: representative_point каждой сырой фичи не покрыта
     выходной сушей → пропущена (ловит отдельные острова, выпавшие ВНУТРИ
     присутствующих стран). Части, чей центр попал в вырезанное ОЗЕРО, — не
     пропажа суши (приозёрный район, суша на месте), помечаются отдельно.

СЦЕНАРИО-НЕЗАВИСИМ: пути можно переопределить аргументами (по умолчанию —
1946). Тот же скрипт применим к любому будущему сценарию с той же схемой.

Запуск: python scripts/map/build/diagnose_missing_land.py
        python scripts/map/build/diagnose_missing_land.py <raw.json> <world.geojson> <lakes.geojson>
"""
import json
import sys
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from pyproj import Geod

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from paths import game_map, out

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GEOD = Geod(ellps="WGS84")
COVERAGE_FOLDED = 0.8   # >= этого доля покрытия => перетегировано/влито, не пропажа
COVERAGE_MISSING = 0.1  # < этого => реально пропало


def area_km2(g):
    a, _ = GEOD.geometry_area_perimeter(g)
    return abs(a) / 1e6


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def build_land_tree(out_features):
    lands = []
    for ft in out_features:
        p = ft["properties"]
        if p.get("type") == "ocean":
            continue
        rid = p.get("region_id", "")
        if rid.startswith("SEA-") or rid.startswith("LAK-"):
            continue
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        lands.append(g)
    return lands, STRtree(lands)


def coverage(g, lands, tree):
    idxs = tree.query(g)
    if len(idxs) == 0:
        return 0.0
    cov = unary_union([lands[int(i)] for i in idxs])
    return g.intersection(cov).area / g.area if g.area > 0 else 0.0


def main(argv):
    repo_root = __import__("pathlib").Path(__file__).resolve().parents[3]
    raw_path = argv[0] if len(argv) > 0 else game_map()
    out_path = argv[1] if len(argv) > 1 else str(repo_root / "client" / "public" / "world_1946.geojson")
    lakes_path = argv[2] if len(argv) > 2 else out("lakes_1946.geojson")

    raw = load(raw_path)
    out_features = load(out_path)
    lands, tree = build_land_tree(out_features)

    lake_geoms = [shape(ft["geometry"]) for ft in load(lakes_path)]
    lake_tree = STRtree(lake_geoms) if lake_geoms else None

    raw_iso = {}
    for ft in raw:
        iso = ft["properties"].get("iso_a2")
        raw_iso.setdefault(iso, []).append(ft)
    out_iso = {ft["properties"].get("iso_a2") for ft in out_features}

    print("=" * 70)
    print("СЛОЙ 1: целые страны (iso_a2 в источнике, но не в выходе)")
    print("=" * 70)
    for iso in sorted(k for k in raw_iso if k not in out_iso and k not in ("-1", None, "")):
        u = unary_union([shape(ft["geometry"]) for ft in raw_iso[iso]])
        cov = coverage(u, lands, tree)
        if cov >= COVERAGE_FOLDED:
            verdict = f"влито/перетегировано ({cov:.0%} покрыто) — НЕ пропажа"
        elif cov < COVERAGE_MISSING:
            verdict = f"*** ПРОПАЖА суши ({cov:.0%} покрыто) ***"
        else:
            verdict = f"частично {cov:.0%}"
        names = [ft["properties"].get("name") for ft in raw_iso[iso][:3]]
        print(f"  {iso}: {len(raw_iso[iso])} фич, {area_km2(u):,.0f} km2 | {verdict} | {names}")

    print()
    print("=" * 70)
    print("СЛОЙ 2: спорные территории iso_a2='-1' (по имени)")
    print("=" * 70)
    for ft in raw:
        if ft["properties"].get("iso_a2") != "-1":
            continue
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        cov = coverage(g, lands, tree)
        flag = " *** ПРОПАЖА ***" if cov < COVERAGE_MISSING else ""
        print(f"  {ft['properties'].get('name')!r}: {cov:.0%} покрыто{flag}")

    print()
    print("=" * 70)
    print("СЛОЙ 3: пофичевые пропажи (rep-point не на выходной суше), по iso")
    print("(озёрные ложные срабатывания помечены [LAKE])")
    print("=" * 70)
    uncovered = {}
    for ft in raw:
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if g.is_empty:
            continue
        rp = g.representative_point()
        if any(lands[int(i)].contains(rp) for i in tree.query(rp)):
            continue
        in_lake = lake_tree is not None and any(
            lake_geoms[int(i)].contains(rp) for i in lake_tree.query(rp))
        iso = ft["properties"].get("iso_a2")
        uncovered.setdefault(iso, []).append((ft["properties"].get("name"), area_km2(g), in_lake))
    rows = []
    for iso, feats in uncovered.items():
        total = sum(a for _, a, _ in feats)
        rows.append((total, iso, feats))
    rows.sort(reverse=True)
    for total, iso, feats in rows:
        lake_n = sum(1 for _, _, lk in feats if lk)
        tag = f" [{lake_n} LAKE]" if lake_n else ""
        top = [nm for nm, _, _ in sorted(feats, key=lambda x: -x[1])][:4]
        print(f"  {iso}: {len(feats)} фич, {total:,.0f} km2{tag} | top: {top}")


if __name__ == "__main__":
    main(sys.argv[1:])
