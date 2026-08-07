"""
build_neighbor_graph.py
Граф смежности для world_1946.geojson: для каждого region_id - список
region_id регионов, с которыми он физически граничит (включая через узкие
проливы/каналы - см. SEA_ADJACENCY_BUFFER).

Два типа смежности:
  - land_border: суша касается суши напрямую (общая граница)
  - sea_crossing: регион касается моря/озера, через которое можно
    переправиться (для проливов уже физически касающихся - Босфор и т.п.
    это будет land-граница через выступы суши с двух сторон моря, а не
    отдельная категория)

Используем небольшой буфер (как везде в проекте) только чтобы поймать
номинально-касающиеся полигоны (общая граница может иметь микрозазор от
разных источников данных), НЕ для перепрыгивания открытой воды - тот же
принцип, что и везде в проекте: соединение не должно создавать связи
там, где их нет физически.
"""
from paths import REPO_ROOT, out
import json
from pathlib import Path
from shapely.geometry import shape
from shapely.strtree import STRtree

# Геометрия берётся из МАСТЕРА, а не из out/world_1946.geojson (2026-08-07).
# Причина: out/ в .gitignore и с ветками не путешествует, а пересобрать его
# нечем — восемь из одиннадцати источников пайплайна отсутствуют. Мастер под
# git, содержит те же 1577 фич и является каноническим источником геометрии;
# `import_to_game.py` перешёл на него ещё 2026-07-30. Fallback на out/ оставлен
# для момента пересборки мастера, когда он ещё не заморожен.
_MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
SRC = str(_MASTER) if _MASTER.exists() else out("world_1946.geojson")
OUT = out("neighbor_graph.json")
BUFFER_DEG = 0.01  # ~1км, ловит цифровые микрозазоры, не реальные проливы


def main():
    with open(SRC, encoding="utf-8") as f:
        fc = json.load(f)
    feats = fc["features"]

    ids = [ft["properties"]["region_id"] for ft in feats]
    geoms = [shape(ft["geometry"]) for ft in feats]
    buffered = [g.buffer(BUFFER_DEG) for g in geoms]

    tree = STRtree(buffered)
    edges = set()
    pair_to_length = {}

    for i, bg in enumerate(buffered):
        idxs = tree.query(bg)
        for j in idxs:
            j = int(j)
            if j <= i:
                continue
            if buffered[i].intersects(buffered[j]):
                inter = buffered[i].intersection(buffered[j])
                # отбрасываем пары, касающиеся только в одной точке
                # (геометрический "угол", не настоящая граница)
                if inter.length < 1e-6 and inter.area < 1e-9:
                    continue
                a, b = ids[i], ids[j]
                edges.add((a, b))

    neighbors = {rid: [] for rid in ids}
    for a, b in edges:
        neighbors[a].append(b)
        neighbors[b].append(a)
    for rid in neighbors:
        neighbors[rid].sort()

    isolated = [rid for rid, lst in neighbors.items() if not lst]

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"neighbors": neighbors, "edge_count": len(edges)}, f, ensure_ascii=False, indent=1)

    print(f"Регионов: {len(ids)}")
    print(f"Рёбер (пар соседей): {len(edges)}")
    print(f"Изолированных (без соседей вообще): {len(isolated)}")
    for rid in isolated[:30]:
        ft = next(f for f in feats if f["properties"]["region_id"] == rid)
        print(f"  {rid} | {ft['properties']['name']} | {ft['properties'].get('region_type')}")


if __name__ == "__main__":
    main()
