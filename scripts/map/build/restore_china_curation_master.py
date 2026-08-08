r"""
restore_china_curation_master.py — возврат кураторских решений по Китаю от
2026-07-23, снесённых пересборкой 27.07 (правка мастер-карты, 2026-08-08).

ЧТО СНЕСЛО. Коммит `628a3bd` (2026-07-27, «restore Panama Canal Zone, fix Kiel
Canal Zone stray fragment») откатил курацию Китая целиком. Прослежено по прямой
линии предков HEAD (`git rev-list HEAD -- client/public/world_1946.geojson`;
`git log` смешивает ветки по дате и для такого вопроса непригоден):

    f7455b2 … f59b754  (23–24.07)   Циндао 955,6/1   Шаньдун 154934,2/3
    628a3bd … HEAD     (27.07 →)    Циндао 1071,1/2  Шаньдун 154818,5/10

Далянь пострадал тем же событием и починен отдельно
(`fix_dalian_rio_master.py`, 2026-08-07). Здесь возвращаются остальные девять
регионов: Циндао/Шаньдун и семь маньчжурских.

ЭТАЛОН — `out/china_1946_historical.json`, живой промежуточный выход
`build_china_1946_v2.py`, отслеживаемый git. Курация в нём цела. Источник
same-provenance (та же оцифровка, что и мастер), а не графт из чужой.
`build_china_1946_v2.py` сегодня НЕ ЗАПУСКАЕТСЯ — его внешний вход (Virtual
Shanghai) отсутствует, и запуск затрёт эталон. Отсюда хирургия по мастеру.

ПЕРВОИСТОЧНИК РЕШЕНИЙ — `docs/decisions/2026-07.md`:
  - «2026-07-23 — Далянь/Циндао: реальные историч. границы вместо county-пилы»:
    западный кусок 138,5 км² на том берегу зал. Цзяочжоувань → Шаньдуну,
    четыре косы Шаньдуна (19,4 + 1,8 + 1,7 + 0,05) → Циндао;
  - «2026-07-23 — Nenjiang: оторванный кусок + узкий рукав распущены».

ДВА СЛУЧАЯ УСТРОЕНЫ ПО-РАЗНОМУ, И ЭТО ГЛАВНОЕ.

[1] Циндао/Шаньдун — перенос ЦЕЛЫХ ЧАСТЕЙ, без единого разреза. Каждая часть
мастера целиком лежит либо в эталонном Циндао, либо в эталонном Шаньдуне; ни
одна границу не пересекает. Части переезжают verbatim, координата в координату.
Скрипт ОТКАЗЫВАЕТ, если хоть одна часть не классифицируется целиком: значит
предпосылка изменилась, и резать наугад нельзя.

Почему не `Шаньдун ∩ эталон`: на Даляне прямолинейное пересечение подрезало
островам БЕРЕГОВУЮ линию по чужой оцифровке — мастер терял `coverage_is_valid`,
а по площадям дефект был невидим (докстрока `fix_dalian_rio_master.py`).
Здесь резать не нужно вообще.

[2] Маньчжурия — семь регионов (Nenjiang, Heilongjiang, Songjiang, Jilin,
Xing'an, Liaobei, Harbin). Перенос целых частей не проходит: узкий рукав
Nenjiang резался по 125,6°E с раздачей соседям, граница внутренняя. Резать
здесь МОЖНО, и вот почему (замер 2026-08-08): объединение семи в мастере и в
эталоне совпадает — `мастер \ эталон` = 0 м². Значит меняется только ВНУТРЕННЯЯ
нарезка, а внешний контур (границы с Ляонином, СССР, Кореей, Внутренней
Монголией) не двигается вовсе. Разрез целиком внутри суши группы и ни одной
береговой линии не касается — то самое условие, при котором докстрока
`fix_dalian_rio_master.py` разрешает резать.

КАК ИМЕННО РЕЖЕТСЯ (и почему не «пересечение с эталоном» в лоб). Наивное
`new_i = U ∩ ref_i` даёт правильные площади, но оставляет три дефекта:
взаимные перекрытия пар (13 377 м² замером), непокрытый остаток (6 347 м²) и —
главное — САЖАЕТ НА ВНЕШНИЙ КОНТУР НОВЫЕ ВЕРШИНЫ там, где внутренняя граница
эталона упирается в него не в той точке, что у мастера. Соседняя фича (Ляонин,
СССР) такой вершины не имеет, и общее ребро перестаёт совпадать —
`coverage_is_valid` падает, а по площадям это опять невидимо.

Поэтому строится ПОКРЫТИЕ, а не пересечения:

  1. `U` = объединение семи регионов МАСТЕРА — авторитетный внешний контур.
  2. Внутренние линии реза = границы `U ∩ ref_i` МИНУС `∂U`. Вычитание точное:
     внешние куски этих границ — буквально сегменты `∂U`.
  3. Концы каждой цепи реза, упирающиеся в `∂U`, САЖАЮТСЯ НА БЛИЖАЙШУЮ
     СУЩЕСТВУЮЩУЮ вершину `∂U` (идиома `snap_chain_ends` из
     `fix_dalian_rio_master.py`). Разрез, оканчивающийся в интерполированной
     точке, добавил бы соседу вершину, которой у него нет.
  4. `polygonize(∂U ∪ рез)` -> ячейки, ТОЧНО замощающие `U`. Отсюда структурно:
     перекрытий нет, непокрытого остатка нет, внешний контур — `∂U` verbatim.
  5. Каждая ячейка достаётся тому эталонному региону, который её содержит.

Дословно копировать геометрию эталона ЗАПРЕЩЕНО: у эталонного объединения 23
вырожденных внутренних кольца, у мастера ноль — пайплайн их уже закрыл. Здесь
они не могут появиться по построению: ячейки замощают `U` целиком, а `U`
внутренних колец не имеет.

Скрипт идемпотентен: повторный прогон видит, что площади уже сошлись с
эталоном, и ничего не пишет.

Запуск:
    python scripts/map/build/restore_china_curation_master.py --dry-run
    python scripts/map/build/restore_china_curation_master.py
Затем обязательно:
    python scripts/map/build/freeze_master_map.py --verify
    python scripts/map/build/audit_map_geometry.py
и пересчёт экономики — площадь регионов изменилась.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import shapely  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import LineString, MultiLineString, Point, mapping, shape  # noqa: E402
from shapely.ops import linemerge, polygonize, unary_union  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER_PATH = MAP_DIR / "master" / "world_1946.master.geojson"
CHINA_REF = MAP_DIR / "out" / "china_1946_historical.json"

QINGDAO = "ASI-0044"
SHANDONG = "ASI-0011"

# Семь маньчжурских регионов. Liaobei и Harbin площади не меняют, но входят в
# группу: без них объединение не замкнётся, и «внутренний» рез вышел бы наружу.
MANCHURIA = ["ASI-0029", "ASI-0030", "ASI-0031", "ASI-0033", "ASI-0034",
             "ASI-0035", "ASI-0047"]

# Часть мастера считается лежащей в эталонном регионе целиком при такой доле
# площади. Ниже 1 - TOL_WHOLE_PART считается лежащей снаружи целиком; всё
# промежуточное — отказ (часть пересекает границу, переносить нельзя).
TOL_WHOLE_PART = 0.005
# Допуск схождения с эталоном по площади региона.
TOL_AREA_KM2 = 0.5
# Допуск на сумму площадей пары/группы: перекладывание не создаёт и не теряет.
TOL_SUM_KM2 = 0.01
# Перекрытие соседей и утечка контура наружу — ноль с точностью до счёта.
TOL_OVERLAP_KM2 = 1e-6
# Мусор polygonize: ячейки меньше этого — численный шум, не география.
MIN_CELL_KM2 = 1e-9
# «Конец цепи реза лежит на внешнем контуре»: цепи получены вычитанием ∂U,
# поэтому такие концы лежат на нём с точностью счёта, но НЕ ТОЧНО — из-за чего
# GEOS их и не нодирует, см. докстроку.
ON_BOUNDARY_TOL_DEG = 1e-9
# Вырожденная крошка эталона: ячейка меньше этого, целиком окружённая ОДНИМ
# соседом, достаётся ему, а не тому, кого назвал эталон. Иначе у соседа
# появляется внутреннее кольцо — ровно тот мусор, который запрещено вносить.
SPECK_KM2 = 0.01


def parts_of(geom):
    if geom.is_empty:
        return []
    return list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]


def polygons_only(geom):
    """Пересечения дают GeometryCollection с линиями и точками на общих
    рёбрах — в геометрию региона годятся только полигоны."""
    if geom.is_empty or geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(polys) if polys else geom


def interior_rings(geom):
    return sum(len(p.interiors) for p in parts_of(geom))


def describe(label, geom):
    print(f"    {label}: {area_km2(geom):.1f} км², частей {len(parts_of(geom))}, "
          f"внутр. колец {interior_rings(geom)}, валидна {geom.is_valid}")


def load_reference():
    """Эталонные геометрии по имени фичи. Имена мастера и эталона совпадают
    один-в-один по всем 47 китайским фичам (проверено 2026-08-08)."""
    with open(CHINA_REF, encoding="utf-8") as f:
        fc = json.load(f)
    return {ft["properties"]["name"]: shape(ft["geometry"]) for ft in fc["features"]}


def ref_for(ref_by_name, feature):
    name = feature["properties"]["name"]
    if name not in ref_by_name:
        raise SystemExit(f"ОТКАЗ: в эталоне нет фичи «{name}» — эталон не тот")
    return ref_by_name[name]


# --------------------------------------------------------------------------
# [1] Циндао / Шаньдун: перенос целых частей
# --------------------------------------------------------------------------

def classify_whole_parts(geom, ref_here, ref_there, label):
    """Части -> (остаются, уходят). Часть, не лежащая целиком ни там ни тут,
    роняет прогон: резать здесь запрещено."""
    stay, move = [], []
    for part in parts_of(geom):
        total = area_km2(part)
        if total <= 0:
            continue
        frac_there = area_km2(polygons_only(part.intersection(ref_there))) / total
        frac_here = area_km2(polygons_only(part.intersection(ref_here))) / total
        if frac_there > 1.0 - TOL_WHOLE_PART:
            move.append(part)
            print(f"      {label}: часть {total:9.2f} км² -> соседу "
                  f"(доля в эталоне соседа {frac_there:.6f})")
        elif frac_here > 1.0 - TOL_WHOLE_PART:
            stay.append(part)
        else:
            raise SystemExit(
                f"ОТКАЗ: часть {label} площадью {total:.3f} км² не лежит целиком "
                f"ни в одном эталонном регионе (доли {frac_here:.4f}/{frac_there:.4f}). "
                f"Предпосылка «перенос без разрезов» больше не верна — "
                f"останавливаюсь, а не режу наугад.")
    return stay, move


def restore_qingdao_shandong(by_rid, ref_by_name):
    print("  [1] Циндао/Шаньдун: перенос целых частей")
    q_ft, s_ft = by_rid[QINGDAO], by_rid[SHANDONG]
    q, s = shape(q_ft["geometry"]), shape(s_ft["geometry"])
    ref_q, ref_s = ref_for(ref_by_name, q_ft), ref_for(ref_by_name, s_ft)
    describe("Циндао до", q)
    describe("Шаньдун до", s)

    if (abs(area_km2(q) - area_km2(ref_q)) < TOL_AREA_KM2
            and abs(area_km2(s) - area_km2(ref_s)) < TOL_AREA_KM2):
        print("    площади уже совпадают с эталоном — правка применена ранее")
        return None

    q_stay, q_move = classify_whole_parts(q, ref_q, ref_s, "Циндао")
    s_stay, s_move = classify_whole_parts(s, ref_s, ref_q, "Шаньдун")
    if not q_move and not s_move:
        print("    переносить нечего")
        return None

    new_q = unary_union(q_stay + s_move)
    new_s = unary_union(s_stay + q_move)
    describe("Циндао после", new_q)
    describe("Шаньдун после", new_s)

    check_pair(new_q, new_s, q, s, ref_q, ref_s, ("Циндао", "Шаньдун"))
    return {QINGDAO: new_q, SHANDONG: new_s}


def check_pair(new_q, new_s, old_q, old_s, ref_q, ref_s, names):
    before = area_km2(old_q) + area_km2(old_s)
    after = area_km2(new_q) + area_km2(new_s)
    overlap = area_km2(polygons_only(new_q.intersection(new_s)))
    union_delta = area_km2(unary_union([new_q, new_s]).symmetric_difference(
        unary_union([old_q, old_s])))
    print(f"    сумма пары: было {before:.3f}, стало {after:.3f}, "
          f"дельта {after - before:+.6f} км²")
    print(f"    перекрытие пары: {overlap:.9f} км²")
    print(f"    внешний контур пары, симметрическая разность: "
          f"{union_delta * 1e6:.3f} м²")

    for name, new, ref in ((names[0], new_q, ref_q), (names[1], new_s, ref_s)):
        d = area_km2(new) - area_km2(ref)
        print(f"    {name}: {area_km2(new):.1f} км² / {len(parts_of(new))} частей "
              f"(эталон {area_km2(ref):.1f} / {len(parts_of(ref))}), "
              f"расхождение {d:+.3f} км²")
        if abs(d) > TOL_AREA_KM2:
            raise SystemExit(f"ОТКАЗ: {name} не сошёлся с эталоном ({d:+.3f} км²)")
        if len(parts_of(new)) != len(parts_of(ref)):
            raise SystemExit(f"ОТКАЗ: у {name} {len(parts_of(new))} частей, "
                             f"в эталоне {len(parts_of(ref))}")
        if interior_rings(new) != interior_rings(ref):
            raise SystemExit(f"ОТКАЗ: у {name} {interior_rings(new)} внутренних "
                             f"колец, в эталоне {interior_rings(ref)}")
        if not new.is_valid:
            raise SystemExit(f"ОТКАЗ: {name} получил невалидную геометрию")
    if abs(after - before) > TOL_SUM_KM2:
        raise SystemExit("ОТКАЗ: перекладывание изменило суммарную площадь пары")
    if overlap > TOL_OVERLAP_KM2:
        raise SystemExit("ОТКАЗ: части наложились друг на друга")
    if union_delta * 1e6 > 1.0:
        raise SystemExit("ОТКАЗ: сдвинулся внешний контур пары")


# --------------------------------------------------------------------------
# [2] Маньчжурия: покрытие из ∂U и внутренних линий эталона
# --------------------------------------------------------------------------

def snap_to_vertices(chain, vertices, outer):
    """Концы цепи реза, упирающиеся во внешний контур, сажаются на ближайшую
    его СУЩЕСТВУЮЩУЮ вершину.

    Две причины, обе замерены 2026-08-08:
      - без посадки конец лежит на ∂U с точностью счёта, но не точно, GEOS его
        не нодирует, и разрез не замыкается: Songjiang не отделился от
        Heilongjiang вовсе (одна ячейка на 314 374 км² вместо двух);
      - посадка на ПРОЕКЦИЮ (точную точку ∂U) замыкает разрез, но добавляет на
        внешний контур вершину, которой нет у соседа за ним, — прогон без
        посадки давал 0,0734° несовпадающих рёбер у Hejiang (ASI-0032).
    Ближайшая существующая вершина — это стык, который мастер уже имеет с
    внешним соседом. Цена — расхождение с эталоном на площадь клина между его
    и мастеровым стыком; она печатается и проверяется допуском."""
    coords = list(chain.coords)
    moved = 0.0
    for idx in (0, -1):
        if Point(coords[idx]).distance(outer) > ON_BOUNDARY_TOL_DEG:
            continue  # внутренний стык трёх регионов — трогать нечего
        d = np.hypot(vertices[:, 0] - coords[idx][0], vertices[:, 1] - coords[idx][1])
        j = int(d.argmin())
        moved = max(moved, float(d[j]))
        coords[idx] = tuple(vertices[j])
    return LineString(coords), moved


def build_cut_network(union_geom, cands):
    """∂U + внутренние линии реза (с посаженными концами)."""
    outer = union_geom.boundary
    vertices = np.array([c for g in parts_of(outer) for c in g.coords])

    raw = unary_union([c.boundary for c in cands]).difference(outer)
    chains = [g for g in parts_of(linemerge(raw))
              if g.geom_type == "LineString" and g.length > 1e-12]
    snapped, worst, n_moved = [], 0.0, 0
    for c in chains:
        line, moved = snap_to_vertices(c, vertices, outer)
        if moved > 0:
            n_moved += 1
            print(f"      цепь длиной {c.length:8.5f}°: конец посажен на "
                  f"вершину контура, сдвиг {moved:.8f}°")
        worst = max(worst, moved)
        if line.length > 1e-12:
            snapped.append(line)
    print(f"    цепей реза: {len(snapped)}, суммарно "
          f"{sum(c.length for c in snapped):.5f}°, концов сдвинуто {n_moved}, "
          f"максимальная посадка {worst:.9f}°")
    return unary_union([outer] + snapped)


def assign_cells(cells, refs, rids):
    """Ячейка достаётся эталонному региону, который её содержит; если ни один
    не содержит — тому, с кем перекрытие больше; если и его нет — ближайшему.
    Порядок обхода фиксирован списком регионов, поэтому результат не зависит
    от порядка выдачи ячеек polygonize.

    Вырожденные крошки эталона (эталонный Songjiang несёт отдельным «куском»
    пятно 0,001 км² посреди Heilongjiang — один из его 23 артефактов) в
    ячейки не превращаются: посаженный разрез их не выделяет. Если бы
    выделил, ячейка досталась бы Songjiang и проделала бы в Heilongjiang
    дыру — это поймает проверка на внутренние кольца, а не молчание."""
    owner = {}
    n_fallback_overlap = n_fallback_near = 0
    for k, cell in enumerate(cells):
        rp = cell.representative_point()
        hit = [rid for rid, r in zip(rids, refs) if r.contains(rp)]
        if len(hit) == 1:
            owner[k] = hit[0]
            continue
        areas = [area_km2(polygons_only(cell.intersection(r))) for r in refs]
        best = int(np.argmax(areas))
        if areas[best] > 0:
            n_fallback_overlap += 1
        else:
            best = int(np.argmin([cell.distance(r) for r in refs]))
            n_fallback_near += 1
        owner[k] = rids[best]
    if n_fallback_overlap or n_fallback_near:
        print(f"    ячеек без однозначного вмещения: по перекрытию "
              f"{n_fallback_overlap}, по близости {n_fallback_near}")

    buckets = {rid: [] for rid in rids}
    for k, cell in enumerate(cells):
        buckets[owner[k]].append(cell)
    return buckets


def restore_manchuria(by_rid, ref_by_name):
    print("  [2] Маньчжурия: возврат внутренней нарезки семи регионов")
    feats = [by_rid[rid] for rid in MANCHURIA]
    olds = [shape(ft["geometry"]) for ft in feats]
    refs = [ref_for(ref_by_name, ft) for ft in feats]

    if all(abs(area_km2(o) - area_km2(r)) < TOL_AREA_KM2 for o, r in zip(olds, refs)):
        print("    площади уже совпадают с эталоном — правка применена ранее")
        return None

    union_geom = unary_union(olds)
    ref_union = unary_union(refs)
    print(f"    объединение семи (мастер): {area_km2(union_geom):.3f} км², "
          f"частей {len(parts_of(union_geom))}, "
          f"внутр. колец {interior_rings(union_geom)}")
    print(f"    объединение семи (эталон): {area_km2(ref_union):.3f} км², "
          f"частей {len(parts_of(ref_union))}, "
          f"внутр. колец {interior_rings(ref_union)}  <- вырожденные, не копируем")
    print(f"    мастер \\ эталон: "
          f"{area_km2(union_geom.difference(ref_union)) * 1e6:.0f} м², "
          f"эталон \\ мастер: "
          f"{area_km2(ref_union.difference(union_geom)) * 1e6:.0f} м²")

    cands = [polygons_only(union_geom.intersection(r)) for r in refs]
    network = build_cut_network(union_geom, cands)
    cells = [c for c in polygonize(network)
             if union_geom.contains(c.representative_point())
             and area_km2(c) > MIN_CELL_KM2]
    print(f"    ячеек внутри контура: {len(cells)}, "
          f"их суммарная площадь {sum(area_km2(c) for c in cells):.3f} км²")

    buckets = assign_cells(cells, refs, MANCHURIA)
    news = []
    for rid in MANCHURIA:
        if not buckets[rid]:
            raise SystemExit(f"ОТКАЗ: региону {rid} не досталось ни одной ячейки")
        news.append(unary_union(buckets[rid]))

    check_group(news, olds, refs, feats, union_geom)
    return dict(zip(MANCHURIA, news))


def real_parts(geom):
    """Части без вырожденных крошек эталона (см. SPECK_KM2): по ним и
    сравнивается связность, иначе артефакт оцифровки читался бы как эксклав."""
    return [p for p in parts_of(geom) if area_km2(p) >= SPECK_KM2]


def check_group(news, olds, refs, feats, union_geom):
    print(f"    {'регион':14} {'было':>10} {'стало':>10} {'дельта':>10} "
          f"{'эталон':>10} {'расх.':>8}  части  кольца")
    for ft, old, new, ref in zip(feats, olds, news, refs):
        name = ft["properties"]["name"]
        d = area_km2(new) - area_km2(ref)
        print(f"    {name:14} {area_km2(old):10.1f} {area_km2(new):10.1f} "
              f"{area_km2(new) - area_km2(old):+10.1f} {area_km2(ref):10.1f} "
              f"{d:+8.3f}  {len(parts_of(old))}->{len(parts_of(new))} "
              f"(эт. {len(parts_of(ref))}, без крошек {len(real_parts(ref))})  "
              f"{interior_rings(new)}")
        if abs(d) > TOL_AREA_KM2:
            raise SystemExit(f"ОТКАЗ: {name} не сошёлся с эталоном ({d:+.3f} км²)")
        if len(parts_of(new)) != len(real_parts(ref)):
            raise SystemExit(f"ОТКАЗ: у {name} {len(parts_of(new))} частей, "
                             f"в эталоне (без вырожденных крошек) "
                             f"{len(real_parts(ref))}")
        if interior_rings(new) != 0:
            raise SystemExit(f"ОТКАЗ: у {name} появилось {interior_rings(new)} "
                             f"внутренних колец — попал вырожденный мусор эталона")
        if not new.is_valid:
            raise SystemExit(f"ОТКАЗ: {name} получил невалидную геометрию")

    worst_pair, worst_overlap = None, 0.0
    for i in range(len(news)):
        for j in range(i + 1, len(news)):
            o = area_km2(polygons_only(news[i].intersection(news[j])))
            if o > worst_overlap:
                worst_pair, worst_overlap = (
                    feats[i]["properties"]["name"], feats[j]["properties"]["name"]), o
    print(f"    худшее перекрытие пары: {worst_overlap * 1e6:.3f} м² {worst_pair or ''}")

    new_union = unary_union(news)
    leak_out = area_km2(new_union.difference(union_geom)) * 1e6
    leak_in = area_km2(union_geom.difference(new_union)) * 1e6
    print(f"    внешний контур: утечка наружу {leak_out:.3f} м², "
          f"непокрытый остаток внутри {leak_in:.3f} м²")
    print(f"    сумма семи: было {sum(area_km2(g) for g in olds):.3f}, "
          f"стало {sum(area_km2(g) for g in news):.3f}, "
          f"контур {area_km2(union_geom):.3f} км²")

    before_ok = shapely.coverage_is_valid(np.array(olds, dtype=object), gap_width=0.0)
    after_ok = shapely.coverage_is_valid(np.array(news, dtype=object), gap_width=0.0)
    print(f"    coverage_is_valid(семь регионов): было {before_ok}, стало {after_ok}")

    if worst_overlap > TOL_OVERLAP_KM2:
        raise SystemExit("ОТКАЗ: внутри группы остались перекрытия")
    if leak_out > 1.0 or leak_in > 1.0:
        raise SystemExit("ОТКАЗ: внешний контур группы сдвинулся или внутри "
                         "остался непокрытый участок")
    if abs(sum(area_km2(g) for g in news) - area_km2(union_geom)) > TOL_SUM_KM2:
        raise SystemExit("ОТКАЗ: сумма семи площадей разошлась с контуром группы")
    if before_ok and not after_ok:
        raise SystemExit("ОТКАЗ: общие рёбра внутри группы перестали совпадать")


# --------------------------------------------------------------------------

def check_neighbours(by_rid, updates):
    """Общие рёбра с ВНЕШНИМИ соседями — то, ради чего концы реза сажались на
    существующие вершины. Проверяется тем же критерием, что и гейт мастера."""
    changed = [shape(by_rid[rid]["geometry"]) for rid in updates]
    touching = []
    for rid, ft in by_rid.items():
        if rid in updates:
            continue
        g = shape(ft["geometry"])
        if any(g.distance(c) < 1e-9 for c in changed):
            touching.append((rid, ft["properties"]["name"], g))
    print(f"\n  внешних соседей у изменённых регионов: {len(touching)} "
          f"({', '.join(n for _, n, _ in touching)})")
    old_arr = np.array(changed + [g for _, _, g in touching], dtype=object)
    new_arr = np.array([updates[rid] for rid in updates]
                       + [g for _, _, g in touching], dtype=object)
    before_ok = bool(shapely.coverage_is_valid(old_arr, gap_width=0.0))
    after_ok = bool(shapely.coverage_is_valid(new_arr, gap_width=0.0))
    print(f"  coverage_is_valid(изменённые + соседи): было {before_ok}, "
          f"стало {after_ok}")
    if before_ok and not after_ok:
        edges = shapely.coverage_invalid_edges(new_arr, gap_width=0.0)
        for lab, e in zip(list(updates) + [r for r, _, _ in touching], edges):
            if e is not None and not e.is_empty:
                print(f"    {lab}: несовпадающих рёбер {e.length:.8f}°")
        raise SystemExit("ОТКАЗ: общие рёбра с внешними соседями перестали "
                         "совпадать")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    args = ap.parse_args()

    with open(MASTER_PATH, encoding="utf-8") as f:
        data = json.load(f)
    by_rid = {ft["properties"]["region_id"]: ft for ft in data["features"]}
    ref_by_name = load_reference()

    updates = {}
    for fix in (restore_qingdao_shandong, restore_manchuria):
        result = fix(by_rid, ref_by_name)
        if result:
            updates.update(result)

    if not updates:
        print("\n  изменений нет")
        return 0

    check_neighbours(by_rid, updates)

    if args.dry_run:
        print("\n  --dry-run: мастер не тронут")
        return 0

    for rid, geom in updates.items():
        by_rid[rid]["geometry"] = mapping(geom)
        by_rid[rid]["properties"]["area_km2"] = round(area_km2(geom), 1)

    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"\n  мастер перезаписан: {MASTER_PATH}")
    print("  дальше: python scripts/map/build/freeze_master_map.py --verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
