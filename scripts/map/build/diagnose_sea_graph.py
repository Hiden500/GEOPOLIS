#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
diagnose_sea_graph.py — постоянная диагностика слоя морских зон.

Не шаг пайплайна и не разовый черновик: это метрика, по которой принимается
любая правка морских зон. Ничего не меняет, только считает и печатает.

Что печатает и зачем:

  зоны, сумма area_km2      разрез не создаёт и не теряет воду;
  рёбра, из них через ±180  смежность у линии дат — отдельный случай, который
                            легко потерять молча (см. `adjacency.py`);
  компоненты, изолированные зона без соседей — тупик, куда нельзя приплыть;
  степени                   насколько зона связна: степень 1 — тупиковый залив;
  прибрежные регионы        главная метрика нарезки. Зона, у которой их
                            десятки, как игровая клетка бессмысленна;
  острова-одиночки          регион без сухопутных соседей обязан иметь морского,
                            иначе он недостижим вообще ничем;
  океаны                    путь между любой парой океанов обязан существовать;
  мосты                     рёбра, снятие которых рвёт карту надвое. Кандидаты
                            в узкие места — и проверка тех, что помечены.

Запуск (из корня репозитория):

    python scripts/map/build/diagnose_sea_graph.py
    python scripts/map/build/diagnose_sea_graph.py --zones scripts/map/out/seas_iho_shelves.geojson
    python scripts/map/build/diagnose_sea_graph.py --top 20
"""
import argparse
import statistics
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import sea_graph as sg

# Порог из задания: зона с бо́льшим числом прибрежных регионов слишком велика
# как игровая клетка. Не жёсткая проверка, а флаг в отчёте — архипелаг бывает
# законным исключением, но обязан быть названным вслух.
COASTAL_MAX = 25


def summarize(zones, land, top=10, chokepoints=None):
    names = [n for n, _, _ in zones]
    geoms = [g for _, _, g in zones]
    areas = [p.get("area_km2", 0.0) for _, p, _ in zones]

    edges, seam_only = sg.zone_edges(geoms)
    comps = sg.components(len(zones), edges)
    adj = sg.adjacency_list(len(zones), edges)
    degrees = [len(adj[i]) for i in range(len(zones))]
    isolated = [names[i] for i in range(len(zones)) if degrees[i] == 0]

    coastal = sg.coastal_by_zone(geoms, [g for _, g in land])
    per_zone = sorted(((len(coastal.get(i, ())), names[i]) for i in range(len(zones))),
                      reverse=True)

    ledges = sg.land_edges([g for _, g in land])
    ladj = sg.adjacency_list(len(land), ledges)
    lonely = [i for i in range(len(land)) if not ladj[i]]
    zone_of_land = set()
    for i, js in coastal.items():
        zone_of_land |= js
    lonely_with_sea = [i for i in lonely if i in zone_of_land]

    print(f"зон:                        {len(zones)}")
    print(f"сумма area_km2:             {sum(areas):,.0f}".replace(",", " "))
    print(f"рёбер:                      {len(edges)}")
    print(f"  из них только через ±180: {seam_only}")
    print(f"компонент связности:        {len(comps)}"
          + ("" if len(comps) == 1 else f"  (размеры: {[len(c) for c in comps]})"))
    print(f"изолированных зон:          {len(isolated)}"
          + ("" if not isolated else f"  {isolated[:10]}"))
    print(f"степень: мин {min(degrees)} | медиана {statistics.median(degrees):.0f} | "
          f"макс {max(degrees)}  ({names[degrees.index(max(degrees))]})")
    hist = Counter(degrees)
    print("  распределение: " + "  ".join(f"{d}:{hist[d]}" for d in sorted(hist)))

    print(f"прибрежных регионов на зону: макс {per_zone[0][0]} ({per_zone[0][1]})")
    over = [(c, n) for c, n in per_zone if c > COASTAL_MAX]
    print(f"  зон свыше {COASTAL_MAX}: {len(over)}")
    for c, n in per_zone[:top]:
        flag = "!" if c > COASTAL_MAX else " "
        print(f"   {flag} {c:4d}  {n}")

    print(f"островов-одиночек:          {len(lonely)}"
          f"  (морской сосед есть у {len(lonely_with_sea)} из {len(lonely)})")
    if len(lonely_with_sea) != len(lonely):
        missing = [land[i][0] for i in lonely if i not in zone_of_land]
        print(f"  БЕЗ морского соседа: {missing[:20]}")

    oceans = [i for i, n in enumerate(names) if n.endswith("Ocean")]
    print(f"океанов (имя ...Ocean):     {len(oceans)}  {[names[i] for i in oceans]}")
    unreachable = []
    for a in range(len(oceans)):
        for b in range(a + 1, len(oceans)):
            if sg.shortest_path(len(zones), edges, oceans[a], oceans[b]) is None:
                unreachable.append((names[oceans[a]], names[oceans[b]]))
    print(f"  пар океанов без пути:     {len(unreachable)}"
          + ("" if not unreachable else f"  {unreachable}"))

    brs = sg.bridges(len(zones), edges)
    print(f"мостов (снятие рвёт карту): {len(brs)}")
    for a, b in sorted(brs, key=lambda e: (names[e[0]], names[e[1]]))[:top]:
        print(f"      {names[a]} | {names[b]}")

    if chokepoints:
        check_chokepoints(names, edges, brs, chokepoints)

    return {
        "zones": len(zones), "area_km2": sum(areas), "edges": len(edges),
        "seam_only": seam_only, "components": len(comps),
        "isolated": len(isolated), "degree_median": statistics.median(degrees),
        "coastal_max": per_zone[0][0], "coastal_over": len(over),
        "lonely": len(lonely), "lonely_with_sea": len(lonely_with_sea),
        "ocean_pairs_unreachable": len(unreachable), "bridges": len(brs),
    }


def check_chokepoints(names, edges, brs, chokepoints):
    """Помеченное узкое место обязано быть мостом — иначе пометка врёт.

    Ребро, снятие которого ничего не рвёт, узким местом не является: флот
    обойдёт его стороной, и запирать там нечего.
    """
    index = {n: i for i, n in enumerate(names)}
    print(f"\nузких мест помечено:        {len(chokepoints)}")
    for cp in chokepoints:
        a, b = cp["zones"]
        ia, ib = index.get(a), index.get(b)
        key = (min(ia, ib), max(ia, ib)) if (ia is not None and ib is not None) else None
        if ia is None or ib is None:
            state = "ЗОНЫ НЕТ В СЛОЕ"
        elif cp.get("status") == "closed":
            state = "закрыто (ребра нет)" if key not in edges else "ОШИБКА: ребро существует"
        elif key not in edges:
            state = "ОШИБКА: ребра нет"
        elif key in brs:
            state = "мост — снятие рвёт карту"
        else:
            state = "НЕ мост — обходится"
        print(f"   {cp['name']:<24} {a} | {b}  -> {state}")


def main():
    ap = argparse.ArgumentParser(description="диагностика графа морских зон")
    ap.add_argument("--zones", default=None, help="слой зон (по умолчанию out/seas_iho_coastline.geojson)")
    ap.add_argument("--land", default=None, help="слой суши (по умолчанию мастер-карта)")
    ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--chokepoints", default=None, help="config/sea_chokepoints.json")
    args = ap.parse_args()

    zones = sg.load_zones(args.zones)
    land = sg.load_land(args.land)
    cps = None
    if args.chokepoints:
        import json
        cps = json.load(open(args.chokepoints, encoding="utf-8"))["chokepoints"]

    print(f"слой зон: {args.zones or sg.SEAS_DEFAULT}")
    print(f"суша:     {len(land)} land-регионов мастер-карты\n")
    summarize(zones, land, top=args.top, chokepoints=cps)


if __name__ == "__main__":
    main()
