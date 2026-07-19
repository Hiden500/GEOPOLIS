"""
fill_palestine_egypt_gap.py

Межконтинентальный шов Азия<->Африка: Газа/Беэр-Шева/Акаба
(asia_1946.geojson) против Египта/Синая (africa_1946.geojson).
build_asia_1946.py строится ДО build_africa_1946.py (см. make_1946.py,
FULL_REBUILD_STEPS), поэтому клипы/absorb внутри build_asia физически не
видят Египет — на момент их запуска africa_1946.geojson ещё не существует.
Этот шаг запускается ПОСЛЕ обоих continent-скриптов, читает оба файла и
правит ТОЛЬКО азиатскую сторону (Египет авторитетен — context, не
двигается). Найдено 2026-07-19 по прямому скриншоту пользователя: разрыв
Газа-Синай ~0.0205°, Беэр-Шева-Синай ~0.0109°, touches()==False.

v2 (2026-07-19-e): buffer-based метод заменён на gap-first absorb_slivers
(см. geometry_cleanup.py за методом, защитами и причинами замены — прежний
буферный вариант дал "пипку" на Газе из-за круглого join и требовал
пост-обрезки взаимного наложения Газа/Беэр-Шева). Это тот же вызов, что
чистит внутриазиатские швы в build_asia_1946.py::absorb_middle_east_slivers.
"""
from paths import out
import json
from shapely.geometry import shape, box as shp_box
from shapely.ops import unary_union
from geometry_cleanup import absorb_slivers_until_stable, load_water_geoms

ASIA_PATH = out("asia_1946.geojson")
AFRICA_PATH = out("africa_1946.geojson")

# JO тоже граничит с Египтом (крошечный участок у Акабы/Табы) — включаем,
# чтобы тройной стык PS/JO/EG закрылся за один и тот же проход.
MUTABLE_ISO = {"PS", "JO"}


def main():
    with open(ASIA_PATH, encoding="utf-8") as f:
        asia_fc = json.load(f)
    with open(AFRICA_PATH, encoding="utf-8") as f:
        africa_fc = json.load(f)

    mutable = [ft for ft in asia_fc["features"]
                if ft["properties"].get("iso_a2") in MUTABLE_ISO]
    egypt_geoms = [shape(ft["geometry"]) for ft in africa_fc["features"]
                    if ft["properties"].get("iso_a2") == "EG"]
    if not mutable or not egypt_geoms:
        print("  нет фич для одной из сторон, пропуск")
        return

    minx, miny, maxx, maxy = unary_union(
        [shape(ft["geometry"]) for ft in mutable]).bounds
    clip_box = shp_box(minx - 0.5, miny - 0.5, maxx + 0.5, maxy + 0.5)

    # Контекст: Египет + остальная Азия вокруг (SY/LB/SA... — чтобы слайвер
    # у другого стыка не был ошибочно приписан PS/JO).
    context = []
    for g in egypt_geoms:
        if g.intersects(clip_box):
            context.append(g.intersection(clip_box))
    for ft in asia_fc["features"]:
        if ft["properties"].get("iso_a2") in MUTABLE_ISO:
            continue
        g = shape(ft["geometry"])
        if g.intersects(clip_box):
            context.append(g.intersection(clip_box))

    water = load_water_geoms(clip_box)
    absorb_slivers_until_stable(mutable, context, water, clip_box, label="PS/JO-EG")

    with open(ASIA_PATH, "w", encoding="utf-8") as f:
        json.dump(asia_fc, f, ensure_ascii=False)
    print("Сохранено в asia_1946.geojson.")


if __name__ == "__main__":
    main()
