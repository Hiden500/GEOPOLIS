"""
resolve_brazil_paraguay_overlap.py

Устраняет единственное известное во всём датасете наложение суша↔суша:
Ponta Porã (Бразилия, кластер муниципалитетов Mato Grosso do Sul) и
Presidente Hayes (Парагвай — ВСЯ страна одним регионом, 18 сырых
провинций слиты в 1 при геометрической кластеризации, см. build_
southamerica_1946.py). Не территориальный спор — обе страны независимо
оцифрованы (разные ADM1-источники), их общая граница не совпадает день-в-
день на всём ~240-км протяжении, что даёт классический "зиппер"-эффект:
33 отдельных мелких фрагмента наложения (0.0002-44.7 км² каждый, суммарно
~211 км²), не один большой спорный участок.

Метод: для каждого из 33 фрагментов пересечения — сравнить длину общей
границы с Ponta Porã и с Presidente Hayes, отдать фрагмент той стороне, с
кем граница длиннее (тот же принцип "самая длинная граница", что уже
использует `absorb_slivers`/`resolve_same_iso_overlaps` в этом кодбейзе —
здесь между РАЗНЫМИ странами, не одним и тем же iso_a2, поэтому не
переиспользует ту функцию напрямую, а применяет тот же принцип точечно).
Реальная международная граница Бразилия-Парагвай в этом районе (Rio Apa/
сухопутный участок) стабильна с XIX века — не историческая развилка,
которую нужно исследовать заново для 1946 года, обычная задача сведения
двух независимых оцифровок.

Читает и пишет `out/southamerica_1946.geojson` НАПРЯМУЮ (гитигнорен,
перезаписывается `build_southamerica_1946.py`/`build_brazil_1946.py` при
пересборке) — часть `FULL_REBUILD_STEPS`, после `clip_sea_by_land.py`, до
`merge_world_1946.py`.

Идемпотентен: на уже разрешённом наложении находит 0 пересечения и ничего
не перезаписывает.

Запуск: python scripts/map/build/resolve_brazil_paraguay_overlap.py
"""
from paths import out
import json
import sys
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SAM_PATH = out("southamerica_1946.geojson")
NAME_A = "Ponta Porã"
NAME_B = "Presidente Hayes"


def main():
    with open(SAM_PATH, encoding="utf-8") as f:
        feats = json.load(f)["features"]

    idx_a = next((i for i, ft in enumerate(feats) if ft["properties"].get("name") == NAME_A), None)
    idx_b = next((i for i, ft in enumerate(feats) if ft["properties"].get("name") == NAME_B), None)
    if idx_a is None or idx_b is None:
        print(f"  ВНИМАНИЕ: '{NAME_A}' или '{NAME_B}' не найдены — прерываю")
        return

    ga = shape(feats[idx_a]["geometry"])
    gb = shape(feats[idx_b]["geometry"])
    overlap = ga.intersection(gb)
    if overlap.geom_type == "GeometryCollection":
        polys = [g for g in overlap.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        overlap = unary_union(polys) if polys else None
    if overlap is None or overlap.is_empty or overlap.area < 1e-9:
        print(f"  {NAME_A} / {NAME_B}: наложения нет — уже разрешено")
        return

    parts = list(overlap.geoms) if overlap.geom_type == "MultiPolygon" else [overlap]
    to_a, to_b = [], []
    for part in parts:
        shared_a = part.boundary.intersection(ga.boundary).length
        shared_b = part.boundary.intersection(gb.boundary).length
        (to_a if shared_a >= shared_b else to_b).append(part)

    area_to_a = sum(area_km2(p) for p in to_a)
    area_to_b = sum(area_km2(p) for p in to_b)
    print(f"  {len(parts)} фрагментов пересечения: {len(to_a)} ({area_to_a:.1f} km2) отходят "
          f"{NAME_A} (снимаются с {NAME_B}), {len(to_b)} ({area_to_b:.1f} km2) отходят "
          f"{NAME_B} (снимаются с {NAME_A})")

    before_a, before_b = area_km2(ga), area_km2(gb)
    if to_b:
        new_a = to_polygonal(ga.difference(unary_union(to_b)))
        feats[idx_a]["geometry"] = mapping(new_a)
        if "area_km2" in feats[idx_a]["properties"]:
            feats[idx_a]["properties"]["area_km2"] = round(area_km2(new_a), 1)
    if to_a:
        new_b = to_polygonal(gb.difference(unary_union(to_a)))
        feats[idx_b]["geometry"] = mapping(new_b)
        if "area_km2" in feats[idx_b]["properties"]:
            feats[idx_b]["properties"]["area_km2"] = round(area_km2(new_b), 1)

    after_a = area_km2(shape(feats[idx_a]["geometry"]))
    after_b = area_km2(shape(feats[idx_b]["geometry"]))
    print(f"  {NAME_A}: {before_a:.1f} -> {after_a:.1f} km2")
    print(f"  {NAME_B}: {before_b:.1f} -> {after_b:.1f} km2")

    with open(SAM_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)
    print(f"  Записано: {SAM_PATH}")


if __name__ == "__main__":
    main()
