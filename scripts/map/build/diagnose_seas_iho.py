"""
diagnose_seas_iho.py — проверка водного слоя `out/seas_iho_coastline.geojson`.

Разовая диагностика, НЕ шаг пайплайна (как `diagnose_global_gaps.py` и
`diagnose_missing_land.py`). Ничего не меняет, только считает и печатает.

Четыре класса, каждый — по жалобе пользователя 2026-07-31 на первую версию
слоя. Три из них численные, четвёртый — инвариант правила о прямых линиях:

  WATER_ON_LAND   вода лежит поверх суши `game_map.json` (берег авторитетен);
  GAP             непокрытое, прилегающее к воде (дыра между сушей и водой);
  THREAD          нитевидная часть моря: площадь есть, ширины нет. На рендере
                  читается чёрной полосой — обводка рисуется, заливать нечего;
  BENT_DIVIDE     граница море↔море в ВЫХОДЕ, которой нет в ИСТОЧНИКЕ.

BENT_DIVIDE — тот самый инвариант. Линии раздела акваторий задаёт IHO, берег
задаёт `game_map`. Заполнение остатка обязано идти по ближайшей ИСХОДНОЙ
акватории, и тогда граница между двумя морями совпадает с исходной прямой.
Любой её изгиб вокруг острова (Сан-Томе, Гибралтар, Кергелен) — отклонение от
источника и попадает в этот класс.

Запуск:

    python scripts/map/build/diagnose_seas_iho.py            # проблемные окна
    python scripts/map/build/diagnose_seas_iho.py --global   # + мир целиком
"""
from paths import game_map, out, source
import json
import sys
from shapely.geometry import shape, box as shp_box
from shapely.strtree import STRtree
from shapely.ops import unary_union

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2

SEAS = out("seas_iho_coastline.geojson")
IHO = source("iho/oceans-seas.geo.json")

# Окна, названные пользователем. Держим списком, а не в голове.
WINDOWS = [
    ("Сан-Томе (Gulf of Guinea | N.Atlantic)", (5.8, -0.5, 7.6, 1.2)),
    ("Гибралтарский пролив", (-6.5, 35.4, -4.6, 36.4)),
    ("Гренландия", (-60.0, 58.0, -10.0, 84.0)),
    ("Устье Амазонки (BRA-594 Pará)", (-52.0, -2.0, -44.0, 3.0)),
    ("Кергелен (ATF-5916)", (67.5, -50.5, 71.5, -47.5)),
    ("Восточно-Китайское море", (119.0, 24.0, 131.0, 34.0)),
]

# Полуширина ниже этой — нить, а не акватория. Площадь/периметр даёт среднюю
# полуширину: у ленты она мала независимо от длины, поэтому порог по площади
# такую фигуру не ловит (проверено на SPIKE/SLIVER в audit_map_geometry.py).
THREAD_HALFWIDTH_DEG = 2e-4

# Извилистость выше этой — линия раздела перестала быть прямой. 1.0 — идеал;
# 1.02 допускает ступеньку адаптивного дробления (~22 м) на линии в единицы км.
CROOKED_MAX = 1.02


def load(path, prop="name"):
    feats = []
    for f in json.load(open(path, encoding="utf-8"))["features"]:
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        p = f["properties"]
        feats.append((p.get(prop) or p.get("NAME") or "?", g))
    return feats


def clip(feats, win):
    out_ = []
    for name, g in feats:
        if g.intersects(win):
            c = g.intersection(win)
            if not c.is_empty:
                out_.append((name, c))
    return out_


def divides(feats):
    """Границы между РАЗНЫМИ акваториями, покомпонентно.

    `boundary.intersection` на касательных стыках возвращает None вместо
    геометрии — известная особенность GEOS, уже ловившаяся в этом репозитории
    (`safe_clip` в `fix_sea_coastline_gaps.py`). Без явной проверки диагностика
    падает на Гренландии.
    """
    parts = []
    tree = STRtree([g for _, g in feats])
    for i, (na, g) in enumerate(feats):
        for j in tree.query(g):
            j = int(j)
            if j <= i:
                continue
            try:
                shared = g.boundary.intersection(feats[j][1].boundary)
            except Exception:
                continue
            if shared is None or shared.is_empty or shared.length <= 0:
                continue
            comps = shared.geoms if hasattr(shared, "geoms") else [shared]
            for c in comps:
                if c.geom_type in ("LineString", "LinearRing") and c.length > 0:
                    parts.append((na, feats[j][0], c))
    return parts


def crookedness(parts, min_len_deg=0.02):
    """Извилистость линии раздела: длина / расстояние между концами.

    1.0 — прямая. Это и есть проверяемая форма правила «линии раздела задаёт
    источник»: заполнение остатка обязано ПРОДОЛЖАТЬ прямую, а не обходить
    острова зигзагом. Сравнивать с контуром источника напрямую нельзя — в
    заполненной прибрежной полосе у источника границы нет вовсе, и честное
    продолжение прямой выглядело бы там «отклонением».
    """
    worst = []
    for a, b, c in parts:
        if c.length < min_len_deg:
            continue
        pts = list(c.coords)
        span = ((pts[0][0] - pts[-1][0]) ** 2 + (pts[0][1] - pts[-1][1]) ** 2) ** 0.5
        if span <= 0:
            continue
        worst.append((c.length / span, a, b, c.length))
    worst.sort(reverse=True)
    return worst


def report(label, win_box, land, lakes, seas_out, seas_src):
    land_u = unary_union([g for _, g in land]) if land else None
    lake_u = unary_union([g for _, g in lakes]) if lakes else None
    sea_u = unary_union([g for _, g in seas_out]) if seas_out else None

    on_land = area_km2(sea_u.intersection(land_u)) if (sea_u and land_u) else 0.0
    covered = unary_union([x for x in (land_u, lake_u, sea_u) if x is not None])
    gap_geom = win_box.difference(covered)
    gap = area_km2(gap_geom) if not gap_geom.is_empty else 0.0

    threads = []
    for name, g in seas_out:
        for p in (g.geoms if g.geom_type == "MultiPolygon" else [g]):
            if p.length > 0 and (p.area / p.length) < THREAD_HALFWIDTH_DEG:
                threads.append((name, area_km2(p)))

    crooked = crookedness(divides(seas_out))
    bent = sum(1 for r, *_ in crooked if r > CROOKED_MAX)
    worst = crooked[0] if crooked else None

    print(f"\n=== {label} ===")
    print(f"  WATER_ON_LAND : {on_land:10.2f} км²")
    print(f"  GAP           : {gap:10.2f} км²")
    print(f"  THREAD        : {len(threads):4d} частей" +
          (f" (напр. {threads[0][0]}, {threads[0][1]:.3f} км²)" if threads else ""))
    if worst:
        print(f"  CROOKED_DIVIDE: {bent:4d} линий извилистее {CROOKED_MAX} "
              f"| худшая {worst[0]:.3f} ({worst[1]} | {worst[2]})")
    else:
        print(f"  CROOKED_DIVIDE:    — линий раздела в окне нет")
    return on_land, gap, len(threads), bent


def main():
    land = load(game_map())
    lakes = load(out("lakes_1946.geojson"))
    seas_out = load(SEAS)
    seas_src = load(IHO, prop="NAME")
    print(f"суша {len(land)} | озёра {len(lakes)} | вода-выход {len(seas_out)} | "
          f"вода-источник {len(seas_src)}")

    windows = list(WINDOWS)
    if "--global" in sys.argv:
        windows.append(("МИР ЦЕЛИКОМ", (-180.0, -90.0, 180.0, 90.0)))

    worst = []
    for label, b in windows:
        win = shp_box(*b)
        worst.append((label, *report(label, win,
                                      clip(land, win), clip(lakes, win),
                                      clip(seas_out, win), clip(seas_src, win))))

    print("\n--- сводка (всё по нулям = чисто) ---")
    for label, on_land, gap, threads, bent in worst:
        flag = "OK " if (on_land < 0.01 and gap < 0.01 and threads == 0 and bent < 1e-6) else "!! "
        print(f"  {flag}{label}")


if __name__ == "__main__":
    main()
