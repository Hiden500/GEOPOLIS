"""
diagnose_scattered_regions.py — разовый диагностический скрипт (НЕ шаг
пайплайна): находит land-регионы, чья геометрия — MultiPolygon с частями,
далеко разбросанными от главной (материковой/самой крупной) части.

Зачем (2026-07-22, пользователь: "отдельно проверить все острова на слияние
в архипелаги" — концепт "архипелаг": разбросанные острова с политической
значимостью ~0 сливаются в 1 полигон, но важны для флота, базы/дальность):
такие регионы — кандидаты на консолидацию (материк отдельно, острова одним
"архипелагом" рядом) ЛИБО на разделение (если "остров" на самом деле —
самостоятельная политическая единица). Это СЮРВЕЙ — только отчёт, никаких
автоматических правок региона (реформа существующих регионов меняет их
идентичность и высокорискова — решение по каждому конкретному региону
остаётся за пользователем).

Метод: для каждой land-фичи с MultiPolygon-геометрией — берём самую большую
часть ("материк"), считаем расстояние и площадь каждой ОСТАЛЬНОЙ части до
неё. Регион попадает в отчёт, если МАКСИМАЛЬНОЕ расстояние среди его частей
превышает порог (по умолчанию 0.5° ~55 км на широте экватора, меньше у
полюсов — грубая, но достаточная для сюрвея эвристика).

СЦЕНАРИО-НЕЗАВИСИМ: путь к world geojson параметризуем.

Запуск: python scripts/map/build/diagnose_scattered_regions.py [world.geojson] [порог_град]
"""
import json
import sys
from shapely.geometry import shape
from pyproj import Geod

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GEOD = Geod(ellps="WGS84")
DEFAULT_THRESHOLD_DEG = 0.5


def area_km2(g):
    a, _ = GEOD.geometry_area_perimeter(g)
    return abs(a) / 1e6


def main(argv):
    repo_root = __import__("pathlib").Path(__file__).resolve().parents[3]
    world_path = argv[0] if len(argv) > 0 else str(repo_root / "client" / "public" / "world_1946.geojson")
    threshold = float(argv[1]) if len(argv) > 1 else DEFAULT_THRESHOLD_DEG

    with open(world_path, encoding="utf-8") as f:
        data = json.load(f)

    rows = []
    for ft in data["features"]:
        p = ft["properties"]
        if p.get("type") == "ocean":
            continue
        rid = p.get("region_id", "")
        if rid.startswith("SEA-") or rid.startswith("LAK-"):
            continue
        g = shape(ft["geometry"])
        if g.geom_type != "MultiPolygon":
            continue
        parts = list(g.geoms)
        if len(parts) <= 1:
            continue
        main_idx = max(range(len(parts)), key=lambda i: parts[i].area)
        main_part = parts[main_idx]
        max_dist = 0.0
        others_area = 0.0
        for i, part in enumerate(parts):
            if i == main_idx:
                continue
            d = part.distance(main_part)
            max_dist = max(max_dist, d)
            others_area += area_km2(part)
        if max_dist < threshold:
            continue
        rows.append({
            "region_id": rid,
            "name": p.get("name"),
            "iso_a2": p.get("iso_a2"),
            "n_parts": len(parts),
            "main_area_km2": round(area_km2(main_part), 1),
            "others_area_km2": round(others_area, 1),
            "max_dist_deg": round(max_dist, 3),
        })

    # Расстояние > 180° геометрически невозможно как "разрыв" — shapely
    # .distance() не знает о переходе через антимеридиан ±180°, и часть
    # региона на другой стороне даёт огромное ложное число (тот же класс
    # бага, что уже был найден и исправлен в приклейке морей). Такие строки
    # отделяются в отдельный список - "ВЕРОЯТНО антимеридиан", не в основной
    # отчёт по разбросу.
    antimeridian_suspect = [r for r in rows if r["max_dist_deg"] > 180]
    rows = [r for r in rows if r["max_dist_deg"] <= 180]

    rows.sort(key=lambda r: -r["max_dist_deg"])
    print(f"Порог: {threshold}° | Регионов с разбросанными частями: {len(rows)}")
    print("-" * 100)
    for r in rows:
        print(f"  {r['region_id']:10} {r['iso_a2']:4} {r['name'][:35]:35} "
              f"частей={r['n_parts']:3} гл.тело={r['main_area_km2']:>10,.0f} км² "
              f"прочее={r['others_area_km2']:>10,.0f} км² макс.разрыв={r['max_dist_deg']}°")

    if antimeridian_suspect:
        print()
        print(f"ВЕРОЯТНО артефакт антимеридиана (не реальный разброс), "
              f"{len(antimeridian_suspect)} шт. — проверять по bounds, не по этому числу:")
        for r in antimeridian_suspect:
            print(f"  {r['region_id']:10} {r['iso_a2']:4} {r['name'][:35]:35} частей={r['n_parts']}")


if __name__ == "__main__":
    main(sys.argv[1:])
