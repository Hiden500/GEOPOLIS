#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Инварианты морской смежности сценария 1946 — контракт стыка К-6
(.agent/orchestration/lead.md). Проверяет то, что произвёл import_to_game.py:
regions.core.json (landNeighboringRegionIds + adjacentWaterIds) и waters.json
(neighboringIds).

Запуск: python scripts/map/validate_sea_adjacency_1946.py
Возвращает exit code 0 при отсутствии нарушений, 1 иначе.

Что здесь НЕ проверяется и почему:

* достижимость по воде («остров A и остров B в контакте») — К-6 запрещает её
  хранить: это запрос к графу, а транзитивное замыкание раздуло бы сценарий и
  завело полный обход мира;
* симметрия суша<->суша — она уже под проверкой 9 в
  validate_region_economy_1946.py, дублировать её здесь незачем;
* «рёбер lake<->sea ноль» — это сегодняшнее состояние мира, а НЕ инвариант.
  Форма их разрешает намеренно (Волго-Дон соединяет Каспий-озеро с Азовом-морем),
  и проверка, закрепляющая ноль, сломалась бы ровно в тот день, когда появится
  канал. Что валидатор такое ребро не отвергает — показано фикстурой в
  test_validate_sea_adjacency_1946.py.

Ребро суша<->вода хранится С ОДНОЙ СТОРОНЫ: у водного узла из К-6 ровно одно
новое поле, neighboringIds, и оно про вода<->вода. Поэтому симметрия такого
ребра проверяется не внутри сценария (внутри её негде нарушить), а сверкой с
источником — out/neighbor_graph.json, в обе стороны сразу:
check_against_neighbor_graph().
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from economy_1946.region_files import SCENARIO_DIR, load_json

REPO_ROOT = Path(__file__).resolve().parents[2]
CORE_PATH = SCENARIO_DIR / "regions.core.json"
WATERS_PATH = SCENARIO_DIR / "waters.json"
NEIGHBOR_GRAPH_PATH = REPO_ROOT / "scripts" / "map" / "out" / "neighbor_graph.json"


def _names(regions: list[dict], waters: list[dict]) -> dict[int, str]:
    """id -> geoJsonId. Нарушение обязано называть УЗЕЛ, а не только число:
    «сосед 1502 не существует» не говорит, где искать, «MEX-0012 -> 1502» —
    говорит."""
    return {n["id"]: n.get("geoJsonId", "?") for n in [*regions, *waters]}


def check_id_spaces(regions: list[dict], waters: list[dict]) -> list[str]:
    """Пространства id суши и воды не пересекаются.

    Границы (сегодня суша 1-1389, вода 1397-1591) не зашиты числами: они
    сдвинутся при следующей нарезке мира, а инвариант — именно
    непересечение."""
    land_ids = {r["id"] for r in regions}
    water_ids = {w["id"] for w in waters}
    names_land = {r["id"]: r.get("geoJsonId", "?") for r in regions}
    names_water = {w["id"]: w.get("geoJsonId", "?") for w in waters}
    return [
        f"id {i} принадлежит обоим пространствам: суша {names_land[i]} и вода {names_water[i]}."
        for i in sorted(land_ids & water_ids)
    ]


def check_no_self_loop(regions: list[dict], waters: list[dict]) -> list[str]:
    """Узел не смежен сам себе — ни по суше, ни по воде."""
    violations = []
    for r in regions:
        for field in ("landNeighboringRegionIds", "adjacentWaterIds"):
            if r["id"] in (r.get(field) or []):
                violations.append(
                    f"петля: регион {r.get('geoJsonId', '?')} ({r['id']}) в собственном {field}."
                )
    for w in waters:
        if w["id"] in (w.get("neighboringIds") or []):
            violations.append(
                f"петля: водный узел {w.get('geoJsonId', '?')} ({w['id']}) в собственном neighboringIds."
            )
    return violations


def check_resolvable(regions: list[dict], waters: list[dict]) -> list[str]:
    """Каждый id из любого списка смежности существует И лежит в своём
    пространстве: сухопутный — в regions.core.json, водный — в waters.json.

    Ссылка на существующий узел ЧУЖОГО типа — тоже нарушение, и сообщение
    называет её отдельно: висячая ссылка и «море записано соседом по суше» —
    разные дефекты с разными причинами."""
    land_ids = {r["id"] for r in regions}
    water_ids = {w["id"] for w in waters}
    names = _names(regions, waters)
    violations: list[str] = []

    def resolve(owner: str, field: str, ids, expected: set, other: set, other_kind: str) -> None:
        for i in ids or []:
            if i in expected:
                continue
            if i in other:
                violations.append(
                    f"{owner}.{field}: {i} ({names[i]}) — это {other_kind}, не то пространство."
                )
            else:
                violations.append(
                    f"{owner}.{field}: {i} не существует ни в regions.core.json, ни в waters.json."
                )

    for r in regions:
        owner = f"регион {r.get('geoJsonId', '?')}"
        resolve(owner, "landNeighboringRegionIds", r.get("landNeighboringRegionIds"),
                land_ids, water_ids, "вода")
        resolve(owner, "adjacentWaterIds", r.get("adjacentWaterIds"),
                water_ids, land_ids, "суша")
    for w in waters:
        owner = f"водный узел {w.get('geoJsonId', '?')}"
        resolve(owner, "neighboringIds", w.get("neighboringIds"),
                water_ids, land_ids, "суша")
    return violations


def check_water_symmetry(waters: list[dict]) -> list[str]:
    """b в neighboringIds(a) <=> a в neighboringIds(b). Ребро вода<->вода
    хранится с обеих сторон, поэтому нарушить симметрию тут есть где."""
    by_id = {w["id"]: w for w in waters}
    violations = []
    for w in waters:
        for other_id in w.get("neighboringIds") or []:
            other = by_id.get(other_id)
            if other is None:
                continue  # висячую ссылку называет check_resolvable
            if w["id"] not in (other.get("neighboringIds") or []):
                violations.append(
                    f"несимметричное ребро вода<->вода: {w.get('geoJsonId', '?')} -> "
                    f"{other.get('geoJsonId', '?')}, но обратной ссылки нет."
                )
    return violations


def check_coast_of_landlocked_graph(regions: list[dict]) -> list[str]:
    """Головной инвариант К-6: регион без сухопутных соседей обязан иметь
    водного. Иначе он выпадает из симуляции целиком — ровно то, ради чего
    контракт и писался (сегодня таких регионов 133, но число считается из
    данных, а не зашивается)."""
    return [
        f"регион {r.get('geoJsonId', '?')} ({r['id']}) без сухопутных соседей и без "
        "adjacentWaterIds — изолирован от мира."
        for r in regions
        if not (r.get("landNeighboringRegionIds") or []) and not (r.get("adjacentWaterIds") or [])
    ]


def land_water_pairs_from_graph(neighbors: dict, water_geo_ids: set) -> set:
    """Рёбра суша<->вода источника, как пары (суша, вода).

    Тип узла берётся из waters.json, а не из world-геометрии: экспорт кладёт
    в waters.json ВСЕ водные фичи, поэтому «не вода» здесь равно «суша»."""
    return {
        (a, b)
        for a, ns in neighbors.items()
        for b in ns
        if a not in water_geo_ids and b in water_geo_ids
    }


def water_water_pairs_from_graph(neighbors: dict, water_geo_ids: set) -> set:
    """Рёбра вода<->вода источника, как неупорядоченные пары."""
    return {
        tuple(sorted((a, b)))
        for a, ns in neighbors.items()
        for b in ns
        if a in water_geo_ids and b in water_geo_ids
    }


def check_against_neighbor_graph(regions: list[dict], waters: list[dict], neighbors: dict):
    """Сверка обеих смежностей с источником — out/neighbor_graph.json.

    Для ребра суша<->вода это единственное место, где проверяется симметрия:
    хранится оно с одной стороны, и «потеряли направление» видно только против
    источника. Проверяется в обе стороны сразу: каждое ребро источника попало
    ровно в один adjacentWaterIds, и каждый записанный id имеет ребро-источник.

    Возвращает (нарушения, рёбра, чья суша не доехала до сценария). Второе —
    НЕ нарушение: регион без владельца import_to_game.py выбрасывает целиком,
    вместе со всеми его рёбрами, и происходит это до морской смежности.
    """
    water_geo = {w["geoJsonId"] for w in waters}
    water_by_id = {w["id"]: w["geoJsonId"] for w in waters}
    scenario_land = {r["geoJsonId"] for r in regions}

    stored_lw = {
        (r["geoJsonId"], water_by_id[i])
        for r in regions
        for i in r.get("adjacentWaterIds") or []
        if i in water_by_id
    }
    graph_lw = land_water_pairs_from_graph(neighbors, water_geo)
    dropped = sorted(pair for pair in graph_lw if pair[0] not in scenario_land)
    expected_lw = {pair for pair in graph_lw if pair[0] in scenario_land}

    violations = [
        f"ребро суша<->вода потеряно экспортом: {land} <-> {water} есть в "
        "neighbor_graph.json, но не в adjacentWaterIds."
        for land, water in sorted(expected_lw - stored_lw)
    ] + [
        f"ребро суша<->вода выдумано экспортом: {land} <-> {water} записано в "
        "adjacentWaterIds, но в neighbor_graph.json его нет."
        for land, water in sorted(stored_lw - expected_lw)
    ]

    stored_ww = {
        tuple(sorted((w["geoJsonId"], water_by_id[i])))
        for w in waters
        for i in w.get("neighboringIds") or []
        if i in water_by_id
    }
    graph_ww = water_water_pairs_from_graph(neighbors, water_geo)
    violations += [
        f"ребро вода<->вода потеряно экспортом: {a} <-> {b} есть в "
        "neighbor_graph.json, но не в neighboringIds."
        for a, b in sorted(graph_ww - stored_ww)
    ] + [
        f"ребро вода<->вода выдумано экспортом: {a} <-> {b} записано в "
        "neighboringIds, но в neighbor_graph.json его нет."
        for a, b in sorted(stored_ww - graph_ww)
    ]
    return violations, dropped


def validate_scenario_invariants(regions: list[dict], waters: list[dict]) -> list[str]:
    """Инварианты, проверяемые ВНУТРИ сценария — без источника. Отдельно от
    сверки с графом, чтобы быть тестируемыми на синтетической фикстуре."""
    return (
        check_id_spaces(regions, waters)
        + check_no_self_loop(regions, waters)
        + check_resolvable(regions, waters)
        + check_water_symmetry(waters)
        + check_coast_of_landlocked_graph(regions)
    )


def main() -> int:
    regions = load_json(CORE_PATH)
    waters = load_json(WATERS_PATH)
    neighbors = load_json(NEIGHBOR_GRAPH_PATH)["neighbors"]

    violations = validate_scenario_invariants(regions, waters)
    graph_violations, dropped = check_against_neighbor_graph(regions, waters, neighbors)
    violations += graph_violations

    land_water_links = sum(len(r.get("adjacentWaterIds") or []) for r in regions)
    water_water_edges = sum(len(w.get("neighboringIds") or []) for w in waters) // 2
    landlocked_graph = [r for r in regions if not (r.get("landNeighboringRegionIds") or [])]
    with_coast = [r for r in landlocked_graph if r.get("adjacentWaterIds")]
    land_ids = [r["id"] for r in regions]
    water_ids = [w["id"] for w in waters]

    print(f"Регионов: {len(regions)} (id {min(land_ids)}-{max(land_ids)}), "
          f"водных узлов: {len(waters)} (id {min(water_ids)}-{max(water_ids)})")
    print(f"  [ok] adjacentWaterIds: {land_water_links} связей суша<->вода "
          f"(в neighbor_graph.json {land_water_links + len(dropped)})")
    print(f"  [ok] neighboringIds: {water_water_edges} рёбер вода<->вода")
    print(f"  [ok] без сухопутных соседей: {len(landlocked_graph)} регионов, "
          f"из них с берегом {len(with_coast)}")
    if dropped:
        print(f"  [ok] не доехало до сценария {len(dropped)} рёбер суша<->вода — "
              "суша без владельца, выброшена import_to_game.py целиком: "
              + ", ".join(f"{a}<->{b}" for a, b in dropped))

    if violations:
        print(f"\nНАРУШЕНИЯ ({len(violations)}):")
        for v in violations:
            print(f"  [FAIL] {v}")
        return 1

    print("\nВсе проверки пройдены чисто.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
