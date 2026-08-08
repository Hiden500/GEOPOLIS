"""
render_region.py — рендер одного региона с соседями. Для глазной приёмки шва.

Зачем. Скилл `map-geometry-qa` требует per-region рендер обязательным шагом
приёмки: численная проверка отвечает на заданный вопрос, а рендер показывает
вопрос, который не задали. В проекте он ловил то, чего не поймала ни одна
цифра — белые пятна Washington — San Juan оказались рендер-багом, и первая
«починка» скрыла два настоящих разрыва. При этом инструмента под него не было:
`diagnose_coastline_gaps.py --render` рисует ячейки разрывов, а не регион, и
каждый рендер писался заново.

Геометрия берётся из МАСТЕРА (`master/world_1946.master.geojson`) — он под git
и является каноническим источником. Fallback на `out/world_1946.geojson` для
момента пересборки мастера.

Цвета несут смысл, а не украшают: цель оранжевая, прочая суша серая, море
синее, озёра светлее моря. Дырки в полигонах вырезаются явно — иначе
намеренная дыра (озеро внутри региона) выглядит как заливка и дефект не виден.

Запуск:
    python scripts/map/build/render_region.py ASI-0044
    python scripts/map/build/render_region.py Qingdao --out /tmp/q.png --pad 0.8
    python scripts/map/build/render_region.py SAM-0013 --neighbours   # подписать соседей

Аргумент — `region_id` (`ASI-0044`) либо английское имя (`Qingdao`).
По умолчанию файл пишется в `out/render_<region_id>.png`.
"""
import argparse
import json
import math
import sys
from pathlib import Path

from paths import REPO_ROOT, out

# Без этого скрипт падает UnicodeEncodeError на последней строке отчёта
# («км²» в консоли cp1251) уже ПОСЛЕ записи PNG: картинка есть, числа к ней
# нет, а код возврата 1. Тот же приём стоит в остальных скриптах пайплайна.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon as MplPoly
    from shapely.geometry import shape, box as shp_box
    from shapely.strtree import STRtree
    from pyproj import Geod
except ImportError:  # pragma: no cover - зависимость пайплайна
    print("Нужны matplotlib, shapely и pyproj", file=sys.stderr)
    raise

GEOD = Geod(ellps="WGS84")
SCENARIO = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"

BG = "#0f1620"
COLORS = {
    "target": ("#c85a2a", "#ffb27a", 2.0),
    "land": ("#2b3440", "#55637a", 1.0),
    "sea": ("#16344d", "#2a5f86", 0.7),
    "lake": ("#1d4a6b", "#2a5f86", 0.7),
}
# Подписывать сушу мельче этого не стоит: подпись перекроет сам полигон.
LABEL_MIN_KM2 = 300.0


def km2(geom):
    return sum(abs(GEOD.geometry_area_perimeter(p)[0]) for p in parts_of(geom)) / 1e6


def parts_of(geom):
    return list(getattr(geom, "geoms", [geom]))


def draw(ax, geom, kind, zorder):
    face, edge, lw = COLORS[kind]
    for p in parts_of(geom):
        if p.is_empty or not hasattr(p, "exterior"):
            continue
        ax.add_patch(MplPoly(list(p.exterior.coords), closed=True,
                             facecolor=face, edgecolor=edge, linewidth=lw, zorder=zorder))
        # дырка вырезается фоном: намеренная дыра обязана быть видна как дыра
        for ring in p.interiors:
            ax.add_patch(MplPoly(list(ring.coords), closed=True, facecolor=BG,
                                 edgecolor=edge, linewidth=lw * 0.7, zorder=zorder + 0.1))


def load_world():
    path = MASTER if MASTER.exists() else Path(out("world_1946.geojson"))
    if not path.is_file():
        raise SystemExit(f"не найдена геометрия: ни {MASTER}, ни out/world_1946.geojson")
    with open(path, encoding="utf-8") as f:
        return path, json.load(f)["features"]


def resolve(target, feats, names):
    """Принимает region_id или английское имя."""
    by_id = {f["properties"]["region_id"]: f for f in feats}
    if target in by_id:
        return target
    hits = [rid for rid, n in names.items() if n == target]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise SystemExit(f"имя {target!r} неоднозначно: {hits}")
    raise SystemExit(f"не найден регион {target!r} ни по id, ни по имени")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("region", help="region_id (ASI-0044) или английское имя (Qingdao)")
    ap.add_argument("--out", default=None, help="путь к PNG (по умолчанию out/render_<id>.png)")
    ap.add_argument("--pad", type=float, default=0.45, help="поля вокруг региона в градусах")
    ap.add_argument("--neighbours", action="store_true", help="подписать соседнюю сушу")
    ap.add_argument("--dpi", type=int, default=140)
    args = ap.parse_args()

    world_path, feats = load_world()
    names = json.loads((SCENARIO / "names.en.json").read_text(encoding="utf-8"))
    rid = resolve(args.region, feats, names)
    by_id = {f["properties"]["region_id"]: f for f in feats}
    tgt = shape(by_id[rid]["geometry"])

    minx, miny, maxx, maxy = tgt.bounds
    view = shp_box(minx - args.pad, miny - args.pad, maxx + args.pad, maxy + args.pad)

    geoms = [shape(f["geometry"]) for f in feats]
    tree = STRtree(geoms)
    near = [int(i) for i in tree.query(view)]

    fig, ax = plt.subplots(figsize=(11, 11))
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)

    for i in near:
        f = feats[i]
        if f["properties"]["region_id"] == rid:
            continue
        clipped = geoms[i].intersection(view)
        if clipped.is_empty:
            continue
        kind = f["properties"].get("region_type", "land")
        draw(ax, clipped, kind if kind in COLORS else "land",
             {"sea": 1, "lake": 1.5}.get(kind, 2))

    draw(ax, tgt, "target", 3)

    if args.neighbours:
        for i in near:
            f = feats[i]
            nid = f["properties"]["region_id"]
            if nid == rid or f["properties"].get("region_type", "land") != "land":
                continue
            clipped = geoms[i].intersection(view)
            if clipped.is_empty or km2(clipped) < LABEL_MIN_KM2:
                continue
            c = max(parts_of(clipped), key=lambda p: p.area).representative_point()
            ax.text(c.x, c.y, names.get(nid, nid), color="#9fb0c8", fontsize=9,
                    ha="center", va="center", zorder=5)

    c = max(parts_of(tgt), key=lambda p: p.area).representative_point()
    ax.text(c.x, c.y, names.get(rid, rid), color="#fff1e6", fontsize=13,
            fontweight="bold", ha="center", va="center", zorder=6)

    ax.set_xlim(view.bounds[0], view.bounds[2])
    ax.set_ylim(view.bounds[1], view.bounds[3])
    # широтная поправка: без неё север выглядит растянутым и швы врут на глаз
    ax.set_aspect(1 / max(0.2, abs(math.cos(math.radians((miny + maxy) / 2)))))
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_color("#2a3442")

    ax.set_title(f"{names.get(rid, rid)}  ({rid})   {km2(tgt):,.0f} км²   "
                 f"частей {len(parts_of(tgt))}", color="#e8eef7", fontsize=13, pad=12)

    png = args.out or out(f"render_{rid}.png")
    fig.savefig(png, dpi=args.dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    print(f"{rid} ({names.get(rid, '?')}): {km2(tgt):,.1f} км², частей {len(parts_of(tgt))}")
    print(f"  bbox lon[{minx:.3f},{maxx:.3f}] lat[{miny:.3f},{maxy:.3f}]")
    print(f"  геометрия из: {world_path.relative_to(REPO_ROOT)}")
    print(f"записано: {png}")


if __name__ == "__main__":
    main()
