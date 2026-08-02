"""
build_islands_preview.py — ПРЕДПРОСМОТР островных правок, применённых к геометрии.

Зачем. `out/region_edits_islands.json` описывает 24 операции словами и числами;
увидеть их можно только на карте. Этот скрипт применяет операции к копии
геометрии и пишет отдельный geojson для рендера. Живую карту он НЕ ТРОГАЕТ:
`world_1946.geojson`, `SEA-`, сценарий и позиционные файлы остаются как были.
Настоящее применение — отдельная задача с ExecPlan из-за каскада `region_id`.

Что применяется:
  merge   — геометрии участников объединяются, население складывается,
            выживший идентификатор берётся у крупнейшего участника;
  rename  — меняются только имена;
  split   — геометрия делится по правилу ниже, оба куска помечены
            provisional: границу подтверждает пользователь;
  resplit — НЕ применяется (Филиппины ждут указаний пользователя),
            регионы остаются как есть и помечены `pending`.

Правила раздела выведены из замера геометрии, а не назначены:
  Сахалин/Курилы — тело Сахалина занимает долготы 141,64…144,76, ближайший
    курильский полигон начинается с 145,41: между группами чистый зазор 0,65°.
    Делим по принадлежности к bbox крупнейшего полигона, расширенному на 0,5°.
  Западный Тимор — единственные полигоны Nusa Tenggara Timur, касающиеся
    Portuguese Timor (ASI-0354). Соседние Алор и Атауро зазор не перекрывают.

Проверка, которую скрипт делает сам: суммарная площадь островных регионов до и
после обязана совпасть. Слияние и раздел не создают и не теряют сушу; расхождение
печатается как ошибка.

Запуск:
    python scripts/map/build/build_islands_preview.py

Выход: `out/islands_preview.geojson`.
"""
import json
import sys
from pathlib import Path

from paths import REPO_ROOT, out

try:
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from pyproj import Geod
except ImportError:  # pragma: no cover - зависимость пайплайна
    print("Нужны shapely и pyproj: pip install shapely pyproj", file=sys.stderr)
    raise

# Доли при разделе считаем по НАСТОЯЩЕЙ площади, а не по плоской в градусах:
# градусный квадрат растёт с широтой, и Сахалин на 50° забирал бы у Курил ~5%.
GEOD = Geod(ellps="WGS84")

EDITS = "region_edits_islands.json"
INDEX = "islands_index.geojson"
OUT_NAME = "islands_preview.geojson"

# Зазор между телом Сахалина и Курилами — 0.65°; берём половину с запасом.
SAKHALIN_BBOX_PAD_DEG = 0.5
# Тот же буфер смежности, что во всём пайплайне.
BUFFER_DEG = 0.01
AREA_TOL_KM2 = 1.0


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def parts_of(geom):
    return list(getattr(geom, "geoms", [geom]))


def true_area_km2(geom):
    """Геодезическая площадь. Знак у Geod зависит от обхода кольца — берём модуль."""
    return sum(abs(GEOD.geometry_area_perimeter(p)[0]) for p in parts_of(geom)) / 1e6


def split_sakhalin(geom):
    """Тело Сахалина с прибрежными островками — отдельно, курильская цепь — отдельно."""
    parts = sorted(parts_of(geom), key=lambda p: -p.area)
    body = parts[0]
    minx, miny, maxx, maxy = body.bounds
    box = (minx - SAKHALIN_BBOX_PAD_DEG, miny - SAKHALIN_BBOX_PAD_DEG,
           maxx + SAKHALIN_BBOX_PAD_DEG, maxy + SAKHALIN_BBOX_PAD_DEG)
    near, far = [], []
    for p in parts:
        c = p.centroid
        (near if box[0] <= c.x <= box[2] and box[1] <= c.y <= box[3] else far).append(p)
    return unary_union(near), unary_union(far)


def split_west_timor(geom, neighbour):
    """Полигоны, касающиеся португальской части, — Западный Тимор; остальное — NTT."""
    nb = neighbour.buffer(BUFFER_DEG)
    on_timor, rest = [], []
    for p in parts_of(geom):
        (on_timor if p.buffer(BUFFER_DEG).intersects(nb) else rest).append(p)
    return unary_union(on_timor), unary_union(rest)


def main():
    edits_path = Path(out(EDITS))
    index_path = Path(out(INDEX))
    for p in (edits_path, index_path):
        if not p.is_file():
            raise SystemExit(f"нет {p}: сначала запусти build_islands_index.py "
                             f"и build_region_edits_islands.py")
    edits = load_json(edits_path)
    index = load_json(index_path)

    feats = {f["properties"]["region_id"]: f for f in index["features"]}
    geoms = {rid: shape(f["geometry"]) for rid, f in feats.items()}
    area_before = round(sum(f["properties"]["area_km2"] for f in index["features"]), 1)
    pop_before = sum(f["properties"]["population"] for f in index["features"])

    # мир нужен целиком только ради соседа Португальского Тимора: он материковым
    # не является, но в островной набор своей страны попадает отдельным регионом
    world = load_json(Path(out("world_1946.geojson")))["features"]
    world_geom = {f["properties"]["region_id"]: f["geometry"] for f in world}

    consumed = set()
    produced = []
    problems = []

    def base_props(rid):
        p = dict(feats[rid]["properties"])
        for k in ("cluster_id", "cluster_name", "cluster_regions", "group_id", "group_regions",
                  "island_area_km2", "island_owners", "island_population", "island_regions",
                  "island_id", "sea_neighbors", "crosses_dateline", "centroid"):
            p.pop(k, None)
        return p

    for op in edits["operations"]:
        kind = op["op"]
        if kind == "merge":
            members = [m["region_id"] for m in op["members"]]
            missing = [m for m in members if m not in geoms]
            if missing:
                problems.append(f"{op['id']}: нет геометрии у {missing}")
                continue
            survivor = op["members"][0]["region_id"]  # члены отсортированы по площади
            merged = unary_union([geoms[m] for m in members])
            props = base_props(survivor)
            props.update({
                "region_id": survivor,
                "name_en": op["target"]["name_en"],
                "name_ru": op["target"]["name_ru"],
                "area_km2": op["area_km2"],
                "population": op["population"],
                "op": "merge",
                "op_id": op["id"],
                "rule": op["rule"],
                "merged_from": members,
                "merged_count": len(members),
                "polygons": len(parts_of(merged)),
            })
            produced.append((props, merged))
            consumed.update(members)

        elif kind == "rename":
            rid = op["source"]["region_id"]
            if rid not in geoms:
                problems.append(f"{op['id']}: нет геометрии у {rid}")
                continue
            props = base_props(rid)
            props.update({
                "name_en": op["target"]["name_en"],
                "name_ru": op["target"]["name_ru"],
                "op": "rename",
                "op_id": op["id"],
                "rule": op["rule"],
                "renamed_from": op["source"]["name_en"],
            })
            produced.append((props, geoms[rid]))
            consumed.add(rid)

        elif kind == "split":
            rid = op["source"]["region_id"]
            if rid not in geoms:
                problems.append(f"{op['id']}: нет геометрии у {rid}")
                continue
            if op["id"] == "SPL-SAKHALIN":
                a, b = split_sakhalin(geoms[rid])
            elif op["id"] == "SPL-WEST-TIMOR":
                nb = shape(world_geom["ASI-0354"])
                a, b = split_west_timor(geoms[rid], nb)
            else:
                problems.append(f"{op['id']}: правило раздела не реализовано")
                continue
            if a.is_empty or b.is_empty:
                problems.append(f"{op['id']}: одна из частей пуста — правило не разделило")
                continue
            total = op["source"]["area_km2"]
            pop = op["source"]["population"]
            # Площадь делится по геодезической доле частей — это верно.
            # Население делится ТОЙ ЖЕ долей, и вот это уже оценка: люди по
            # площади не размазаны. Настоящее деление — по слою демографии.
            ta, tb = true_area_km2(a), true_area_km2(b)
            frac = ta / (ta + tb)
            for part, geom, share, name in (
                ("A", a, frac, op["into"][0]),
                ("B", b, 1 - frac, op["into"][1]),
            ):
                props = base_props(rid)
                props.update({
                    "region_id": rid if part == "A" else f"{rid}-B",
                    "name_en": name["name_en"],
                    "name_ru": name["name_ru"],
                    "area_km2": round(total * share, 1),
                    "population": round(pop * share),
                    "op": "split",
                    "op_id": op["id"],
                    "rule": op["rule"],
                    "split_from": rid,
                    "true_area_km2": round(ta if part == "A" else tb, 1),
                    "provisional": ("площадь поделена геодезически; НАСЕЛЕНИЕ поделено той же "
                                    "долей и является оценкой — пересчитать по слою демографии"),
                    "polygons": len(parts_of(geom)),
                })
                produced.append((props, geom))
            consumed.add(rid)

        elif kind == "resplit_from_source":
            # Филиппины ждут указаний пользователя — регионы остаются, но помечены
            for m in op["replaces"]:
                rid = m["region_id"]
                if rid not in geoms:
                    continue
                props = base_props(rid)
                props.update({"op": "pending", "op_id": op["id"], "rule": op["rule"],
                              "pending": "пере-нарезка по region_sub не применена"})
                produced.append((props, geoms[rid]))
                consumed.add(rid)

    for rid, g in geoms.items():
        if rid in consumed:
            continue
        props = base_props(rid)
        props["op"] = "unchanged"
        produced.append((props, g))

    area_after = round(sum(p["area_km2"] for p, _ in produced), 1)
    pop_after = sum(p["population"] for p, _ in produced)
    if abs(area_after - area_before) > AREA_TOL_KM2:
        problems.append(f"площадь не сохранилась: было {area_before:,.1f}, стало {area_after:,.1f}")

    if problems:
        print("ОШИБКИ — предпросмотр не сохранён:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        raise SystemExit(1)

    gj = {
        "type": "FeatureCollection",
        "_meta": {
            "generated_by": "scripts/map/build/build_islands_preview.py",
            "status": "ПРЕДПРОСМОТР. Живая карта не изменена.",
            "applied_from": f"scripts/map/out/{EDITS}",
            "not_applied": "RSP-PHILIPPINES — ждёт указаний пользователя",
            "counts": {
                "regions_before": len(geoms),
                "regions_after": len(produced),
                "delta": len(produced) - len(geoms),
                "area_km2_before": area_before,
                "area_km2_after": area_after,
                "population_before": pop_before,
                "population_after": pop_after,
            },
        },
        "features": [
            {"type": "Feature", "properties": p, "geometry": mapping(g)}
            for p, g in sorted(produced, key=lambda x: -x[0]["area_km2"])
        ],
    }
    with open(out(OUT_NAME), "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)

    c = gj["_meta"]["counts"]
    print(f"островных регионов: {c['regions_before']} -> {c['regions_after']} ({c['delta']:+})")
    print(f"площадь: {c['area_km2_before']:,.1f} -> {c['area_km2_after']:,.1f} км²  (сохранена)")
    print(f"население: {c['population_before']:,} -> {c['population_after']:,}")
    print()
    for p, _ in sorted(produced, key=lambda x: -x[0]["area_km2"]):
        if p["op"] == "merge":
            print(f"  merge  {p['merged_count']:2} -> 1  {p['area_km2']:>10,.0f} км² "
                  f"{p['polygons']:3} полиг.  {p['name_en']}")
    for p, _ in produced:
        if p["op"] == "split":
            print(f"  split       {p['area_km2']:>10,.0f} км² {p['polygons']:3} полиг.  "
                  f"{p['name_en']}  (оценка, provisional)")
        elif p["op"] == "rename":
            print(f"  rename      {p['area_km2']:>10,.0f} км²       {p['renamed_from']} -> {p['name_en']}")
    print(f"\nне применено: {gj['_meta']['not_applied']}")
    print(f"записано: out/{OUT_NAME}")


if __name__ == "__main__":
    main()
