"""
fill_sea_holes.py

Пост-обработка: закрывает дыры-острова из diagnose_sea_holes.py, у которых
ЕСТЬ сырой источник в game_map.json (>30% площади дыры перекрыто одной
сырой ADM1-фичой — значит остров РЕАЛЬНО существует в данных, просто не
дошёл до выхода, скорее всего съеден threshold-based cleanup разбросанных
фрагментов при геомерже штата/провинции). Дыры БЕЗ источника (нужен синтез
суши прямо из формы дыры) сюда не входят — отдельное решение по владельцу,
см. отчёт diagnose_sea_holes.py.

Метод: геометрия дыры (НЕ сырой фичи!) добавляется unary_union'ом к
БЛИЖАЙШЕЙ существующей выходной фиче того же iso_a2 в соответствующем
continent-файле (по raw_match['iso_a2'], континент определяется по факту
использования этого iso_a2 в остальных continent-файлах). Дыра гарантированно
бесшовно стыкуется с морем по построению (она и есть точная вырезка в
море) — в отличие от геометрии сырой фичи, которая могла быть оцифрована
по другому источнику береговой линии и не совпасть день-в-день. Слияние с
ближайшей feature (не с самой близкой по имени/коду) — часто единственный
практичный якорь: у многих штатов (Alaska, США) выход — geometric-кластер
по 1-2 "победившим" уездам, а не честный county-split, так что нет 1:1
соответствия сырой county-код -> выходная фича.

ВАЖНО (2026-07-23, найдено на этой же правке): читает и пишет
continent-файлы (`out/<continent>_1946.geojson`) НАПРЯМУЮ, а не
`client/public/world_1946.geojson` — те continent-файлы гитигнорены
(`*.geojson`) и полностью перезаписываются с нуля при любом запуске
`build_<continent>_1946.py`. Патч поверх `client/public/world_1946.geojson`
пережил бы ТОЛЬКО до следующей пересборки того континента по любой другой
причине — тихая потеря фикса (см. README чек-лист п.5, "любой
постпроцессинг встраивать в сам pipeline"). Поэтому этот скрипт — часть
`FULL_REBUILD_STEPS` (make_1946.py), идёт сразу после
`fix_sea_coastline_gaps.py` (море уже стабилизировано) и до `merge_world_
1946.py`. НЕ меняет число регионов ни в одном континенте (сливает В
существующие фичи) — `remap_region_ids.py` не нужен.

Идемпотентен: на уже исправленных continent-файлах находит 0 дыр этого
класса и ничего не перезаписывает.

Побочный эффект (2026-07-23, найдено при повторном полном ребилде):
"ближайшая фича того же iso_a2" — не то же самое, что "ближайшая по
смыслу" (см. докстринг выше про Alaska), и при СЛОЖНЫХ geometric-кластерах
может отдать дыру фиче A, хотя дыра при этом накладывается на СОСЕДНЮЮ
фичу B того же штата/провинции (пример: San Juan Islands, WA — дыра ушла
в "Washington — Adams", хотя касалась уже существующей "Washington — San
Juan"). После заливки — обязательный проход `resolve_same_iso_overlaps`:
для каждой пары фич ОДНОГО iso_a2 в одном континенте, если они теперь
пересекаются, пересечение отдаётся той из двух, чья ГРАНИЦА (не центроид)
ближе к пересечению — тем самым не трогает уже-существовавшие "легальные"
касания (санов-хуановский залив и т.п.), только НОВЫЕ наложения от этого
прохода.

Запуск: python scripts/map/build/fill_sea_holes.py
"""
from paths import game_map, out
import json
import pathlib
import sys
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from diagnose_sea_holes import find_holes, classify, MATCH_RATIO  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

GEOD = Geod(ellps="WGS84")

CONTINENT_FILES = {
    "EUR": out("europe_1946.geojson"),
    "ASI": out("asia_1946.geojson"),
    "NAM": out("namerica_1946.geojson"),
    "SAM": out("southamerica_1946.geojson"),
    "AFR": out("africa_1946.geojson"),
    "OCE": out("oceania_1946.geojson"),
    "ANT": out("antarctica_1946.geojson"),
}


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def resolve_same_iso_overlaps(feats, label=""):
    """После заливки дыр фичи ОДНОГО iso_a2 в одном continent-файле могут
    начать пересекаться (см. докстринг модуля, San Juan/Adams-случай).
    Для каждой найденной пары — общая ячейка пересечения отдаётся той из
    двух, у кого длиннее общая граница с этой ячейкой (тот же принцип
    "самая длинная граница", что и в absorb_slivers/geometry_cleanup.py),
    отбирается у другой через .difference(). Точечный проход только по
    парам, которые ДЕЙСТВИТЕЛЬНО пересекаются сейчас — не трогает штатные
    касания (dist=0, но area=0)."""
    n_fixed = 0
    by_iso = {}
    for i, ft in enumerate(feats):
        by_iso.setdefault(ft["properties"].get("iso_a2"), []).append(i)

    for iso, idxs in by_iso.items():
        if len(idxs) < 2:
            continue
        for a in range(len(idxs)):
            for b in range(a + 1, len(idxs)):
                ia, ib = idxs[a], idxs[b]
                ga = shape(feats[ia]["geometry"])
                gb = shape(feats[ib]["geometry"])
                overlap = ga.intersection(gb)
                if overlap.geom_type == "GeometryCollection":
                    polys = [g for g in overlap.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
                    overlap = unary_union(polys) if polys else None
                if overlap is None or overlap.geom_type not in ("Polygon", "MultiPolygon"):
                    continue
                if overlap.is_empty or overlap.area < 1e-12:
                    continue
                shared_a = overlap.boundary.intersection(ga.boundary).length
                shared_b = overlap.boundary.intersection(gb.boundary).length
                loser_idx = ib if shared_a >= shared_b else ia
                winner_name = feats[ia]["properties"].get("name") if loser_idx == ib else feats[ib]["properties"].get("name")
                loser_ft = feats[loser_idx]
                loser_g = shape(loser_ft["geometry"])
                new_g = loser_g.difference(overlap)
                if not new_g.is_valid:
                    new_g = new_g.buffer(0)
                loser_ft["geometry"] = mapping(new_g)
                if "area_km2" in loser_ft["properties"]:
                    loser_ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
                print(f"  [OVERLAP-FIX/{label}] {loser_ft['properties'].get('name')} уступает "
                      f"{area_km2(overlap):.3f} km2 в пользу {winner_name} (длиннее общая граница)")
                n_fixed += 1
    return n_fixed


def main():
    continent_feats = {}
    all_land = []
    iso_to_continent = {}
    for continent, path in CONTINENT_FILES.items():
        feats = load_features(path)
        continent_feats[continent] = feats
        for ft in feats:
            iso = ft["properties"].get("iso_a2")
            iso_to_continent.setdefault(iso, continent)
            all_land.append((shape(ft["geometry"]), ft["properties"].get("name")))
    print(f"  суша по всем континентам: {len(all_land)} фич")

    seas_lakes = load_features(out("seas_1946.geojson")) + load_features(out("lakes_1946.geojson"))
    print(f"  моря+озёра: {len(seas_lakes)} фич")

    with open(game_map(), encoding="utf-8") as f:
        raw_feats = json.load(f)["features"]
    raw_geoms = []
    for ft in raw_feats:
        try:
            g = shape(ft["geometry"])
        except Exception:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        raw_geoms.append((g, ft["properties"]))

    holes = find_holes(all_land, seas_lakes)
    holes = classify(holes, raw_geoms)
    matched = [h for h in holes if h["raw_match"]]
    print(f"  дыр с сырым источником (>{int(MATCH_RATIO*100)}%): {len(matched)}")

    by_continent = {}
    for h in matched:
        iso = h["raw_match"][1]
        continent = iso_to_continent.get(iso)
        if continent is None:
            print(f"  ПРОПУЩЕНО (нет континента для iso={iso}): {h['sea_name']} {h['centroid']}")
            continue
        by_continent.setdefault(continent, []).append((h, iso))

    total_filled = 0
    for continent in CONTINENT_FILES:
        path = CONTINENT_FILES[continent]
        feats = continent_feats[continent]
        items = by_continent.get(continent, [])
        by_iso = {}
        for ft in feats:
            by_iso.setdefault(ft["properties"].get("iso_a2"), []).append(ft)

        n_here = 0
        for h, iso in items:
            candidates = by_iso.get(iso)
            if not candidates:
                print(f"  ПРОПУЩЕНО ({continent}, нет фич с iso={iso}): {h['sea_name']} {h['centroid']}")
                continue
            hole_geom = h["geom"]
            best_ft, best_dist = None, None
            for ft in candidates:
                g = shape(ft["geometry"])
                d = hole_geom.distance(g)
                if best_dist is None or d < best_dist:
                    best_dist, best_ft = d, ft
            g = shape(best_ft["geometry"])
            new_g = unary_union([g, hole_geom])
            if not new_g.is_valid:
                new_g = new_g.buffer(0)
            best_ft["geometry"] = mapping(new_g)
            if "area_km2" in best_ft["properties"]:
                best_ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
            n_here += 1
            total_filled += 1

        # Проверяем наложения ВСЕГДА (не только когда в этом прогоне были
        # новые дыры) — leftover-наложение от предыдущего прогона иначе
        # никогда не поймается повторным (идемпотентным) запуском.
        n_overlap_fixed = resolve_same_iso_overlaps(feats, label=continent)
        if n_here or n_overlap_fixed:
            fc = {"type": "FeatureCollection", "features": feats}
            with open(path, "w", encoding="utf-8") as f:
                json.dump(fc, f, ensure_ascii=False)
            suffix = f", исправлено наложений: {n_overlap_fixed}" if n_overlap_fixed else ""
            print(f"  {continent}: залито {n_here} дыр -> {path}{suffix}")

    print(f"Итого залито: {total_filled} из {len(matched)}")


if __name__ == "__main__":
    main()
