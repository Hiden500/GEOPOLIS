#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
split_ocean_shelves.py — нарезка океанских монолитов на именованные шельфовые
зоны.

Работает ПОСЛЕ `build_seas_from_iho.py`, над его выходом
`out/seas_iho_coastline.geojson`, и пишет отдельный файл
`out/seas_iho_shelves.geojson`. Внутрь `build_seas_from_iho.py` нарезка не
лезет намеренно — его докстрока прямо оставляет океаны целыми и отдаёт нарезку
отдельному скрипту.

Зачем. Шесть монолитов держат 81.4% воды: у `South Pacific Ocean` 47
прибрежных регионов 25 стран, у `North Atlantic Ocean` — 112. Как игровая
клетка такая зона бессмысленна: любое действие в ней не имеет масштаба.
Эталон плотности задают уже существующие моря — Северное 23 прибрежных
региона, Японское 24, Балтика 18.

Правило нарезки: **режем берег, а не океан.** Из монолита вырезается
прибрежная полоса, разделённая на именованные зоны; абиссальное ядро остаётся
одним куском и сохраняет имя океана. Отсюда прямое следствие: выдуманных имён
не появляется вовсе — кусок либо ложится на существующее географическое имя из
конфига, либо остаётся океаном.

`Southern Ocean` не режется: 7 прибрежных регионов и одна «страна» —
Антарктида. Резать нечего.

Как считается зона (всё в конфиге `config/shelf_zones.json`):

    зона = монолит ∩ ячейка_Вороного(якоря зоны)
                   ∩ буфер(ближняя суша, coast_reach_deg)
                   ∩ буфер(якоря зоны, anchor_reach_deg)

- **ячейка Вороного** делит воду по ближайшему якорю: это и есть «какому имени
  принадлежит точка». Якоря лежат в воде вдоль берега;
- **буфер суши** оставляет только прибрежную полосу — то, что дальше от берега,
  остаётся ядру. Без него зоны замостили бы весь океан;
- **буфер якорей** отсекает далёкий берег, попавший в ячейку по бедности
  соседей. Без него Сан-Томе (0.2°N, 6.6°E) уходил бы в `Guinea Plateau` за
  2000 км — ячейка-то ближайшая.

**Линия перемены дат.** Монолит, лежащий по обе стороны ±180, обрабатывается в
сдвинутой системе координат (`wrap_lon` в конфиге): там он непрерывен, и ни
одна граница Вороного не может пройти вдоль шва. Обратный сдвиг режет
результат по ±180 ровно там, где уже разрезан исходный файл, — зона остаётся
ОДНОЙ фичей из нескольких частей, как все шесть «датских» фич сегодня.

**Площадь.** Своя сферическая формула на кольце вокруг полюса возвращает
дополнение (Арктика считается как 505 млн км² вместо 5.2), поэтому
`area_km2` источника авторитетнее вычисленной. Куски монолита получают площадь
пропорционально вычисленной, но НОРМИРОВАННУЮ на исходную `area_km2` монолита:
сумма по слою сохраняется точно, а не «в пределах погрешности».

Запуск (из корня репозитория):

    python scripts/map/build/split_ocean_shelves.py
    python scripts/map/build/split_ocean_shelves.py --only "North Atlantic Ocean"
    python scripts/map/build/split_ocean_shelves.py --dry-run
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from shapely.affinity import translate
from shapely.geometry import (MultiPoint, MultiPolygon, Point, Polygon,
                              box as shp_box, mapping, shape)
from shapely.ops import unary_union, voronoi_diagram
from shapely.strtree import STRtree

from paths import out, REPO_ROOT
from geometry_cleanup import area_km2
import sea_graph as sg

CONFIG = REPO_ROOT / "scripts" / "map" / "config" / "shelf_zones.json"
CHOKEPOINTS = REPO_ROOT / "scripts" / "map" / "config" / "sea_chokepoints.json"
OUT_NAME = "seas_iho_shelves.geojson"
GRAPH_NAME = "sea_graph.json"

# Куски мельче этого — мусор разреза (обрезки на стыке ячеек), не акватория.
MIN_PIECE_KM2 = 1.0

# Допуск инварианта покрытия. Не ноль: разность двух полигонов с сотнями тысяч
# вершин оставляет нити машинной точности. Порог на четыре порядка ниже
# наименьшей настоящей зоны слоя (Strait of Gibraltar, 1638 км²).
COVERAGE_EPS_KM2 = 0.1

# Допуск проверки на дыры. На порядок мягче: он вынужденно включает шум
# `unary_union`, измеренный на этих данных (худший случай — Индийский океан,
# 7.7 км² одним пятном у Мозамбикского пролива). Настоящая дыра — потерянная
# зона или забытый кусок — на два-три порядка крупнее.
HOLE_EPS_KM2 = 25.0

# Широты, севернее/южнее которых вода считается ледовой при расчёте флага `ice`.
ICE_NORTH_LAT = 66.5   # северный полярный круг
ICE_SOUTH_LAT = -60.0  # северная граница Южного океана по IHO
ICE_AREA_SHARE = 0.5   # доля площади за этими широтами, начиная с которой ice=True

SEAM_EPS_DEG = 1e-9


# --------------------------------------------------------------------------
# система координат вокруг линии перемены дат
# --------------------------------------------------------------------------

def wrap(geom, cut):
    """Перевести геометрию в систему `(cut, cut+360]`.

    Монолит, разрезанный ±180 на части, становится непрерывным, и работа с ним
    (Вороной, буферы, разности) идёт без особых случаев. `cut` выбирается там,
    где рядом нет ничего интересного: для тихоокеанских монолитов это 20°E.
    """
    if cut is None or geom.is_empty:
        return geom
    east = geom.intersection(shp_box(cut, -90.0, 180.0, 90.0))
    west = geom.intersection(shp_box(-180.0, -90.0, cut, 90.0))
    parts = [p for p in (east, translate(west, xoff=360.0)) if not p.is_empty]
    return unary_union(parts) if parts else geom


def unwrap(geom, cut):
    """Обратный перевод: результат снова лежит в [-180, 180]."""
    if cut is None or geom.is_empty:
        return geom
    left = geom.intersection(shp_box(cut, -90.0, 180.0, 90.0))
    right = geom.intersection(shp_box(180.0, -90.0, cut + 360.0, 90.0))
    parts = [p for p in (left, translate(right, xoff=-360.0)) if not p.is_empty]
    return unary_union(parts) if parts else geom


def wrap_point(x, y, cut):
    if cut is not None and x < cut:
        x += 360.0
    return (x, y)


# --------------------------------------------------------------------------
# нарезка одного монолита
# --------------------------------------------------------------------------

def voronoi_cells(anchor_points, envelope):
    """`{индекс якоря: ячейка}` — разбиение плоскости по ближайшему якорю.

    `voronoi_diagram` не гарантирует порядок ячеек, поэтому соответствие
    восстанавливается по вхождению точки, а не по индексу: иначе имена зон
    молча перемешались бы между запусками разных версий GEOS.
    """
    diagram = voronoi_diagram(MultiPoint(anchor_points), envelope=envelope)
    cells = [g for g in diagram.geoms if g.area > 0]
    tree = STRtree(cells)
    result = {}
    for idx, (x, y) in enumerate(anchor_points):
        p = Point(x, y)
        for k in tree.query(p):
            k = int(k)
            if cells[k].intersects(p):
                result[idx] = cells[k]
                break
    missing = [i for i in range(len(anchor_points)) if i not in result]
    if missing:
        raise RuntimeError(f"ячейка Вороного не нашлась для якорей {missing}")
    return result


def split_monolith(mono_geom, spec, land_geoms, land_tree):
    """Разрезать монолит. Возвращает `[(имя, спец, геометрия)]` + ядро."""
    cut = spec.get("wrap_lon")
    mono = wrap(mono_geom, cut)

    zones = spec["zones"]
    anchor_points, owner = [], []
    for zi, z in enumerate(zones):
        for x, y in z["anchors"]:
            anchor_points.append(wrap_point(x, y, cut))
            owner.append(zi)

    minx, miny, maxx, maxy = mono.bounds
    envelope = shp_box(minx - 60.0, miny - 60.0, maxx + 60.0, maxy + 60.0)
    cells = voronoi_cells(anchor_points, envelope)

    carved = []
    for zi, z in enumerate(zones):
        cell = unary_union([cells[ai] for ai, o in enumerate(owner) if o == zi])
        reach = float(z.get("coast_reach_deg", spec.get("coast_reach_deg", 3.0)))
        anchor_reach = float(z.get("anchor_reach_deg", spec.get("anchor_reach_deg", 12.0)))

        area = mono.intersection(cell)
        if area.is_empty:
            carved.append((z["name"], z, area))
            continue

        # берег, до которого зоне есть дело: только он формирует полосу
        probe = unwrap(area.buffer(reach), cut) if cut is not None else area.buffer(reach)
        near = [land_geoms[int(k)] for k in land_tree.query(probe)]
        near = [g for g in near if probe.intersects(g)]
        if near:
            band = unary_union([wrap(g, cut).buffer(reach) for g in near])
            area = area.intersection(band)

        pts = [Point(*wrap_point(x, y, cut)) for x, y in z["anchors"]]
        area = area.intersection(unary_union([p.buffer(anchor_reach) for p in pts]))
        carved.append((z["name"], z, area))

    # Крошки выбрасываются ДО вычитания ядра, а не после: иначе кусок, убранный
    # из зоны, оказывался бы вычтен из ядра и не добавлен никуда — в слое
    # появлялась бы дыра. Порядок здесь несущий, а не косметический.
    #
    # Возврат в исходную систему координат делается ЗДЕСЬ, до вычисления ядра:
    # круговой перевод wrap→unwrap подрезает границу на величину машинной
    # точности, и ядро, посчитанное в сдвинутой системе, вылезало за пределы
    # исходного монолита на 10.6 км². Дополнительное пересечение с монолитом
    # закрывает вопрос по построению, а не «в пределах допуска».
    out_zones = []
    for name, z, g in carved:
        g = drop_crumbs(unwrap(g, cut))
        out_zones.append((name, z, g.intersection(mono_geom) if not g.is_empty else g))

    # Ядро вычитается ОДНОЙ операцией, а не восемнадцатью подряд: каждая
    # `difference` подрезает границу на величину машинной точности, и на
    # Северной Атлантике накопленная разница между итеративным и однократным
    # вычитанием составила 3123 км² — больше двух Гибралтарских проливов.
    zone_union = unary_union([g for _, _, g in out_zones if not g.is_empty])
    core = mono_geom.difference(zone_union) if not zone_union.is_empty else mono_geom

    # Ядро крошками не чистится: мелкий отдельный кусок открытой воды —
    # законная часть океана, а не мусор разреза.
    return out_zones, core


def drop_crumbs(geom, min_km2=None):
    """Выбросить обрезки разреза: они не акватория, а мусор на стыке ячеек.

    Порог читается ИЗ МОДУЛЯ, а не подставляется значением по умолчанию:
    значения по умолчанию в Python вычисляются один раз при определении
    функции, и `MIN_PIECE_KM2`, поставленный туда, замерзал бы — тест,
    подменяющий константу, молча проверял бы старый порог.
    """
    if min_km2 is None:
        min_km2 = MIN_PIECE_KM2
    if geom.is_empty or geom.geom_type == "Polygon":
        return geom
    kept = [p for p in geom.geoms if area_km2(p) >= min_km2]
    if not kept:
        return type(geom)()
    return unary_union(kept)


# --------------------------------------------------------------------------
# атрибуты
# --------------------------------------------------------------------------

def ice_flag(geom):
    """Доля площади за полярными широтами не ниже `ICE_AREA_SHARE`.

    Правило, а не список: список из семи имён устарел бы при первой нарезке
    Арктики. Флаг заведомо грубый — Охотское и Балтийское замерзают, но лежат
    южнее круга; задача флага сейчас — отметить арктические зоны и Южный океан.
    """
    total = area_km2(geom)
    if total <= 0:
        return False
    polar = geom.intersection(shp_box(-180.0, ICE_NORTH_LAT, 180.0, 90.0))
    south = geom.intersection(shp_box(-180.0, -90.0, 180.0, ICE_SOUTH_LAT))
    cold = area_km2(polar) + area_km2(south)
    return (cold / total) >= ICE_AREA_SHARE


def zone_type(name, declared):
    if declared:
        return declared
    return "open_ocean" if name.endswith("Ocean") else "enclosed"


def seam_boundary_length(geom):
    """Длина границы, лежащей вдоль ±180. Инвариант: разрез её не увеличивает."""
    total = 0.0
    for line in (geom.boundary.geoms if hasattr(geom.boundary, "geoms") else [geom.boundary]):
        coords = list(line.coords)
        for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
            if abs(abs(x1) - 180.0) < SEAM_EPS_DEG and abs(abs(x2) - 180.0) < SEAM_EPS_DEG:
                total += abs(y2 - y1)
    return total


# --------------------------------------------------------------------------
# сборка
# --------------------------------------------------------------------------

def build(config, only=None):
    zones_in = sg.load_zones()
    land = sg.load_land()
    land_geoms = [g for _, g in land]
    land_tree = STRtree(land_geoms)

    specs = config["monoliths"]
    targets = {k: v for k, v in specs.items() if only is None or k == only}
    if only and not targets:
        raise SystemExit(f"монолита '{only}' нет в конфиге")

    features = []
    report = []
    coverage = []
    seam_before = 0.0
    seam_after = 0.0

    for name, props, geom in zones_in:
        seam_before += seam_boundary_length(geom)
        if name not in targets:
            features.append((name, dict(props), geom, None))
            continue

        spec = targets[name]
        carved, core = split_monolith(geom, spec, land_geoms, land_tree)

        # Инвариант разреза: куски покрывают монолит ровно, без потерь и без
        # выхода за его пределы. Проверяется геометрией, а не суммой площадей:
        # сумму можно свести нормировкой, покрытие — нельзя.
        pieces = [g for _, _, g in carved if not g.is_empty] + [core]
        labels = [n for n, _, g in carved if not g.is_empty] + [name + " (ядро)"]

        # Выход за пределы монолита — покусочно, БЕЗ union: слияние соседних
        # кусков само по себе сдвигает общую границу наружу (на Индийском
        # океане 7.7 км² одним пятном у Мозамбикского пролива), и проверка
        # мерила бы собственный артефакт вместо данных.
        for lbl, g in zip(labels, pieces):
            spill = area_km2(g.difference(geom))
            if spill > COVERAGE_EPS_KM2:
                raise RuntimeError(f"{name}: кусок '{lbl}' выходит за монолит на {spill:.3f} км²")

        # Наложения кусков друг на друга — тоже попарно и точно.
        tree = STRtree(pieces)
        for i, g in enumerate(pieces):
            for k in tree.query(g):
                k = int(k)
                if k <= i:
                    continue
                over = area_km2(g.intersection(pieces[k]))
                if over > COVERAGE_EPS_KM2:
                    raise RuntimeError(
                        f"{name}: куски '{labels[i]}' и '{labels[k]}' налегают на {over:.3f} км²")

        # Дыры. Здесь union неизбежен, поэтому допуск другой и назван вслух:
        # шум слияния завышает покрытие и потому может лишь ЗАНИЗИТЬ дыру, а
        # настоящая дыра (потерянная зона, забытый кусок) на порядки крупнее.
        lost = area_km2(geom.difference(unary_union(pieces)))
        if lost > HOLE_EPS_KM2:
            raise RuntimeError(f"{name}: разрез потерял {lost:.3f} км²")
        coverage.append((name, lost))

        pieces = [(zname, z, g) for zname, z, g in carved if not g.is_empty]
        raw = [(zname, area_km2(g), g, z) for zname, z, g in pieces]
        core_area = area_km2(core)
        total_raw = sum(a for _, a, _, _ in raw) + core_area
        target_area = props["area_km2"]
        scale = target_area / total_raw if total_raw > 0 else 1.0

        for zname, a, g, z in raw:
            features.append((zname, {
                "name": zname,
                "area_km2": round(a * scale, 1),
                "source": f"{props['source']} + split_ocean_shelves.py",
            }, g, z))
        features.append((name, {
            "name": name,
            "area_km2": round(core_area * scale, 1),
            "source": f"{props['source']} + split_ocean_shelves.py",
        }, core, {"type": "open_ocean"}))

        report.append((name, target_area, len(raw), core_area * scale, total_raw, scale))

    out_features = []
    for name, props, geom, spec in features:
        props["type"] = zone_type(name, (spec or {}).get("type"))
        props["ice"] = bool((spec or {}).get("ice", ice_flag(geom)))
        seam_after += seam_boundary_length(geom)
        out_features.append({
            "type": "Feature",
            "properties": props,
            "geometry": mapping(geom),
        })

    return out_features, report, seam_before, seam_after, coverage


def graph_document(features, chokepoints):
    """Граф зон с узкими местами КАК АТРИБУТОМ РЕБРА.

    Узкое место не может быть свойством зоны: запирается проход между двумя
    акваториями, а не сама акватория. В geojson рёбер нет — есть только фичи,
    поэтому граф выносится отдельным документом.

    Закрытые узкие места (каналы) попадают сюда записью с `present: false`:
    отсутствие соединения должно быть УТВЕРЖДЕНИЕМ, иначе «канала нет» и «про
    канал забыли» неразличимы, а открытие по эпохе не с чем связать.
    """
    zones = [(f["properties"]["name"], f["properties"], shape(f["geometry"]))
             for f in features]
    names = [n for n, _, _ in zones]
    index = {n: i for i, n in enumerate(names)}
    edges, seam_only = sg.zone_edges([g for _, _, g in zones])

    by_key, missing = {}, []
    for cp in chokepoints:
        a, b = cp["zones"]
        if a not in index or b not in index:
            raise RuntimeError(f"узкое место '{cp['name']}': нет зоны {a!r} или {b!r}")
        key = (min(index[a], index[b]), max(index[a], index[b]))
        if key in edges:
            by_key[key] = cp
        else:
            missing.append((key, cp))

    out_edges = []
    for i, j in sorted(edges):
        edge = {"a": names[i], "b": names[j], "present": True}
        cp = by_key.get((i, j))
        if cp:
            edge["chokepoint"] = {"name": cp["name"], "status": cp["status"],
                                  "why": cp["why"]}
        out_edges.append(edge)
    for (i, j), cp in missing:
        out_edges.append({"a": names[i], "b": names[j], "present": False,
                          "chokepoint": {"name": cp["name"], "status": cp["status"],
                                         "why": cp["why"]}})

    return {
        "zones": [{"name": n, "type": p["type"], "ice": p["ice"],
                   "area_km2": p["area_km2"]} for n, p, _ in zones],
        "edges": out_edges,
        "counts": {"zones": len(zones), "edges": len(edges),
                   "edges_only_via_antimeridian": seam_only,
                   "chokepoints_open": sum(1 for e in out_edges
                                           if e.get("chokepoint") and e["present"]),
                   "chokepoints_closed": len(missing)},
    }


def main():
    ap = argparse.ArgumentParser(description="нарезка океанских монолитов на шельфовые зоны")
    ap.add_argument("--only", default=None, help="резать только этот монолит")
    ap.add_argument("--config", default=str(CONFIG))
    ap.add_argument("--dry-run", action="store_true", help="не писать файл")
    args = ap.parse_args()

    config = json.load(open(args.config, encoding="utf-8"))
    features, report, seam_before, seam_after, coverage = build(config, only=args.only)

    total = sum(f["properties"]["area_km2"] for f in features)
    print(f"зон на выходе: {len(features)}")
    print(f"сумма area_km2: {total:,.0f}".replace(",", " "))
    print(f"граница вдоль ±180: было {seam_before:.6f}° -> стало {seam_after:.6f}°")
    for name, lost in coverage:
        print(f"покрытие {name}: потеряно {lost:.4f} км² (спилл и наложения проверены покусочно, порог {COVERAGE_EPS_KM2} км²)")
    for name, target, n, core_area, raw, scale in report:
        print(f"\n{name}: {n} шельфовых зон + ядро")
        print(f"  исходная площадь {target:,.0f} км²".replace(",", " "))
        print(f"  ядро             {core_area:,.0f} км²  ({core_area / target * 100:.1f}%)".replace(",", " "))
        print(f"  нормировка       x{scale:.6f} (сферическая формула против area_km2 источника)")

    if args.dry_run:
        print("\n--dry-run: файл не записан")
        return

    path = out(OUT_NAME)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False)
    print(f"\nзаписано: {path}")

    if args.only:
        print("--only: граф зон не переписан — он строится по ПОЛНОМУ слою")
        return
    chokepoints = json.load(open(CHOKEPOINTS, encoding="utf-8"))["chokepoints"]
    doc = graph_document(features, chokepoints)
    gpath = out(GRAPH_NAME)
    with open(gpath, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"записано: {gpath}")
    print(f"  {doc['counts']}")


if __name__ == "__main__":
    main()
