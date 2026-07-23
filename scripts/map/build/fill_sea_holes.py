"""
fill_sea_holes.py

Пост-обработка: закрывает дыры-острова из diagnose_sea_holes.py.

Два независимых механизма владельца:
  1. Дыры с сырым источником в game_map.json (>30% площади дыры перекрыто
     одной сырой ADM1-фичой — остров РЕАЛЬНО существует в данных, просто
     не дошёл до выхода, скорее всего съеден threshold-based cleanup
     разбросанных фрагментов при геомерже штата/провинции) — владелец
     `raw_match['iso_a2']` берётся из самого источника.
  2. Дыры БЕЗ сырого источника (2026-07-23) — владелец не выводится из
     данных автоматически, взят из `UNSOURCED_HOLE_OWNERS` (см. ниже,
     ручная таблица по centroid, обоснование каждой записи — там же).

Метод (общий для обоих механизмов): геометрия дыры (НЕ сырой фичи!)
добавляется unary_union'ом к БЛИЖАЙШЕЙ существующей выходной фиче того же
iso_a2 в соответствующем continent-файле (континент определяется по факту
использования этого iso_a2 в остальных continent-файлах). Дыра гарантированно
бесшовно стыкуется с морем по построению (она и есть точная вырезка в
море) — в отличие от геометрии сырой фичи, которая могла быть оцифрована
по другому источнику береговой линии и не совпасть день-в-день. Слияние с
ближайшей feature (не с самой близкой по имени/коду) — часто единственный
практичный якорь: у многих штатов (Alaska, США) выход — geometric-кластер
по 1-2 "победившим" уездам, а не честный county-split, так что нет 1:1
соответствия сырой county-код -> выходная фича. Для механизма 2 это же
свойство даёт географически осмысленное название/владельца "бесплатно" —
дыра растворяется в АДМИНИСТРАТИВНО ближайшем существующем регионе (напр.
атолл Туамоту — во "Французскую Полинезию" целиком, не в новый регион с
придуманным именем).

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
from geometry_cleanup import resolve_same_iso_overlaps  # noqa: E402

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

# Владелец для 20 дыр БЕЗ сырого источника (diagnose_sea_holes.py,
# 2026-07-23, ключ — centroid дыры, округлённый find_holes() до 4 знаков —
# см. вывод diagnose_sea_holes.py "БЕЗ источника"). Каждый iso_a2 выбран НЕ
# независимым историческим исследованием, а по ближайшей УЖЕ
# СУЩЕСТВУЮЩЕЙ фиче того же места в этом же датасете — то есть переиспользует
# решение по 1946-суверенитету, которое уже проверено/закоммичено раньше в
# этой сессии (см. docs/DECISIONS.md, запись "2026-07-23 — 20 дыр без
# источника"). Единственное действие здесь — geometric: слить форму дыры с
# ближайшей фичой того же iso_a2.
UNSOURCED_HOLE_OWNERS = {
    # Туамоту/о-ва Общества, франц. Полинезия — сюзерен не менялся с XIX в.
    (-146.6892, -15.7529): "PF",
    (-143.1763, -17.0203): "PF",
    (-144.3665, -17.1085): "PF",
    (-145.4724, -17.4275): "PF",
    # устье Амазонки (Marajó/Amapá), ближайшая фича — Pará, Бразилия
    (-52.0702, -1.5358): "BR",
    (-51.2785, -1.1047): "BR",
    (-51.0661, -0.9622): "BR",
    (-52.2706, -1.4402): "BR",
    (-50.8794, -0.4651): "BR",
    (-50.8877, -0.7859): "BR",
    # Яп/Понпеи, Каролинские о-ва — ближайшие фичи уже владеет QPS ("U.S.
    # Naval Administration of the Former Japanese Mandated Islands",
    # countries.json) — реальная переходная 1946 администрация после
    # капитуляции Японии (1945), до формального Trust Territory (1947).
    (139.6607, 9.9741): "FM",
    (151.7246, 7.3735): "FM",
    # банка у San Andrés y Providencia, Карибское море — Колумбия
    # (Bárcenas–Esguerra Treaty 1928, бесспорно для 1946 г.)
    (-81.1759, 14.2702): "CO",
    # чилийские фьорды/Магальянес — ближе к Чили, чем к Аргентине во всех
    # 3 случаях (0.06-0.14° против 1.0-2.9°)
    (-74.0156, -51.2971): "CL",
    (-74.3424, -45.0967): "CL",
    (-70.1166, -54.981): "CL",
    # пролив Дэвиса: гренландская сторона (GRL — отдельная разыгрываемая
    # фича в этом датасете, не слита в Данию) и баффинова сторона (Canada,
    # Northwest Territories — до выделения Нунавута в 1999 г.)
    (-52.0983, 68.159): "GL",
    (-64.9316, 63.4844): "CA",
    # атолл Нукунону, Токелау — под управлением Новой Зеландии с 1925 г.
    (-171.8219, -9.1603): "TK",
    # Земля Франца-Иосифа/Баренцево море — советская территория (аннексия
    # 1926 г., бесспорно к 1946 г.)
    (57.8187, 80.5845): "RU",
}


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def _merge_hole_into_nearest(candidates, hole_geom):
    """Возвращает (фича, расстояние) с наименьшим расстоянием до дыры среди
    кандидатов того же iso_a2, либо (None, None), если кандидатов нет."""
    best_ft, best_dist = None, None
    for ft in candidates:
        g = shape(ft["geometry"])
        d = hole_geom.distance(g)
        if best_dist is None or d < best_dist:
            best_dist, best_ft = d, ft
    return best_ft, best_dist


def _apply_merge(best_ft, hole_geom):
    g = shape(best_ft["geometry"])
    new_g = unary_union([g, hole_geom])
    if not new_g.is_valid:
        new_g = new_g.buffer(0)
    best_ft["geometry"] = mapping(new_g)
    if "area_km2" in best_ft["properties"]:
        best_ft["properties"]["area_km2"] = round(area_km2(new_g), 1)


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
    unmatched = [h for h in holes if not h["raw_match"]]
    print(f"  дыр с сырым источником (>{int(MATCH_RATIO*100)}%): {len(matched)}")
    print(f"  дыр без источника, с ручным владельцем: {len(unmatched)}")

    by_continent = {}
    n_unmapped = 0
    for h in matched:
        iso = h["raw_match"][1]
        continent = iso_to_continent.get(iso)
        if continent is None:
            print(f"  ПРОПУЩЕНО (нет континента для iso={iso}): {h['sea_name']} {h['centroid']}")
            continue
        by_continent.setdefault(continent, []).append((h, iso))
    for h in unmatched:
        iso = UNSOURCED_HOLE_OWNERS.get(h["centroid"])
        if iso is None:
            n_unmapped += 1
            continue
        continent = iso_to_continent.get(iso)
        if continent is None:
            print(f"  ПРОПУЩЕНО (нет континента для iso={iso}): {h['sea_name']} {h['centroid']}")
            continue
        by_continent.setdefault(continent, []).append((h, iso))
    if n_unmapped:
        print(f"  ВНИМАНИЕ: {n_unmapped} дыр без источника НЕ в UNSOURCED_HOLE_OWNERS "
              f"(новые/сдвинутые с прошлого прогона — нужна ручная разметка)")

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
            best_ft, _ = _merge_hole_into_nearest(candidates, h["geom"])
            _apply_merge(best_ft, h["geom"])
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

    print(f"Итого залито: {total_filled} из {len(matched) + len(unmatched) - n_unmapped}")


if __name__ == "__main__":
    main()
