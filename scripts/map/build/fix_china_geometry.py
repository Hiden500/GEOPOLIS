"""
fix_china_geometry.py

Пост-обработка `scripts/map/out/china_1946_historical.json` (47 фич) —
НЕ регенерация через `build_china_1946_v2.py` (его внешний источник
Virtual Shanghai shapefile `china_hist/1947-49` нигде не найден и никогда
не коммитился, см. docs/DECISIONS.md 2026-07-22). Идемпотентен, НЕ в
FULL_REBUILD_STEPS — тот же паттерн, что `extract_kinneret.py`.

Чинит найденный (2026-07-22, разведка + пользователь: "Далянь и Циндао
плохо вырезаны") класс разрывов: `build_china_1946_v2.py` режет каждый из
6 спецмуниципалитетов (Nanjing/Qingdao/Guangzhou/Hankou/Harbin/Dalian) как
`city = уезд ∩ host_провинция`, затем `host.difference(city.buffer(0.001))`
— раздутие на ~95 м оставляет ничейное кольцо шириной ~95 м вокруг каждого
города (пример: -47 km2 на город), которое не забирает НИ город, НИ host.
Прохода закрытия разрывов для Китая в пайплайне нет вообще (v2 отключил
`fill_china_gaps`/`clip_china_to_neighbors`).

Метод: тот же gap-first движок, что уже чинит разрывы суши
(`geometry_cleanup.py::absorb_slivers_until_stable`) — mutable = все 47
китайских фич ОДНОВРЕМЕННО (спорная ячейка отдаётся тому, с кем самая
длинная граница — та же логика, что уже решила порядко-зависимость в
приклейке морей), context = сырая суша соседей (Индия/Пакистан/Монголия/
СССР/Вьетнам/Мьянма/Корея и т.д. из game_map.json, БЕЗ iso_a2='CN' —
китайские 32 сырые ADM1-фичи НЕ используются, `china_1946_historical.json`
построен на другом/современном источнике и полностью его заменяет), water
= моря/озёра (Dalian/Qingdao/Guangzhou/Hankou прибрежные).

Дополнительно: полигонизация того же множества естественно захватывает и
шов Кашмира/Аксай-Чин (Китай-Индия-Пакистан, спорная граница) — ничейные
ячейки на границе, касающиеся Xinjiang/Xizang, тоже отдаются Китаю тем же
проходом (осознанный игровой выбор, не историческая претензия на 1946 год
— граница там де-факто не администрировалась ни одной стороной).

Второй шаг (после absorb): у Qingdao (`county_boundary`) 2 из 4 частей
MultiPolygon — вырожденные слайверы-иглы (0.66 и 0.07 км², compactness
<0.05, визуально подтверждено рендером — острые треугольники-«клинья» у
горловины залива Цзяочжоу, не похожи на реальные острова), артефакт
intersection/difference при вычислении `city = уезд ∩ host_провинция`.
Отбрасываются точечно, ТОЛЬКО для Qingdao (не общая чистка всех
многочастных китайских фич — у Shandong/Liaoning десятки мелких частей,
это настоящие прибрежные острова, трогать их не в scope этой находки).

Третий шаг (2026-07-23, найдено ПОСЛЕ первого прохода absorb — отдельный
QA-рендер поймал белый клин у горловины зал. Цзяочжоу, суша↔море, НЕ
город↔host): точечный `bbox.difference(china ∪ context ∪ water)` для
конкретного bbox из `MANUAL_GAP_PATCHES` — 0.66 км² между Shandong и морем,
absorb_slivers его не поймал (скорее всего эта конкретная ячейка
polygonize слилась с намного бо́льшей смежной water-ячейкой при разбиении
плоскости и не прошла `MAX_COMPACT_AREA`). Прямая проверка по всему
bbox Китая (2026-07-23) — это ЕДИНСТВЕННЫЙ такой разрыв (0 остатка везде
кроме этой точки), не системный паттерн — точечный патч, не общий проход.

Запуск: python scripts/map/build/fix_china_geometry.py
"""
from paths import game_map, out
import json
import sys
from shapely.geometry import shape, mapping, box as shp_box
from shapely.ops import unary_union

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import absorb_slivers_until_stable, area_km2

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CHINA_PATH = out("china_1946_historical.json")
# Грубый bbox вокруг Китая + приграничных спорных зон (с запасом) —
# ограничивает polygonize разумным масштабом, не всем миром.
CHINA_BBOX = shp_box(68, 15, 136, 55)

# Точечная чистка: имя фичи -> порог площади (км2), части МЕНЬШЕ порога
# отбрасываются (вырожденные иглы-слайверы, не реальные острова).
DROP_SLIVER_PARTS = {
    "Qingdao": 1.0,
}

# Точечные разрывы суша<->море, не пойманные absorb_slivers (см. докстринг,
# шаг 3): (имя фичи-получателя, bbox вокруг разрыва). Считается gap =
# bbox.difference(вся_суша ∪ вся_вода) и добавляется к фиче целиком.
# Идемпотентно: на уже исправленном файле gap пуст, union с пустой
# геометрией — no-op.
MANUAL_GAP_PATCHES = [
    ("Shandong", (120.05, 36.15, 120.15, 36.25)),  # горловина зал. Цзяочжоу
]


def apply_manual_gap_patches(feats, context, water, label=""):
    by_name = {ft["properties"].get("name"): ft for ft in feats}
    full_land = unary_union([shape(ft["geometry"]) for ft in feats] + list(context))
    full = unary_union([full_land] + list(water))
    for name, bbox in MANUAL_GAP_PATCHES:
        ft = by_name.get(name)
        if ft is None:
            print(f"  [GAP-PATCH/{label}] ВНИМАНИЕ: '{name}' не найдена")
            continue
        gap = shp_box(*bbox).difference(full)
        if gap.is_empty or area_km2(gap) < 0.05:
            continue
        g = shape(ft["geometry"])
        new_g = unary_union([g, gap])
        if not new_g.is_valid:
            new_g = new_g.buffer(0)
        ft["geometry"] = mapping(new_g)
        ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
        print(f"  [GAP-PATCH/{label}] {name}: +{area_km2(gap):.2f} km2 (bbox {bbox})")


def drop_named_slivers(feats, label=""):
    for ft in feats:
        thresh = DROP_SLIVER_PARTS.get(ft["properties"].get("name"))
        if thresh is None:
            continue
        g = shape(ft["geometry"])
        if g.geom_type != "MultiPolygon":
            continue
        kept = [p for p in g.geoms if area_km2(p) >= thresh]
        dropped = [p for p in g.geoms if area_km2(p) < thresh]
        if not dropped:
            continue
        new_g = unary_union(kept) if len(kept) > 1 else kept[0]
        ft["geometry"] = mapping(new_g)
        ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
        dropped_area = sum(area_km2(p) for p in dropped)
        print(f"  [SLIVER-DROP/{label}] {ft['properties']['name']}: "
              f"отброшено {len(dropped)} частей ({dropped_area:.2f} km2)")


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    with open(CHINA_PATH, encoding="utf-8") as f:
        china_fc = json.load(f)
    china_feats = china_fc["features"]
    print(f"  Китай: {len(china_feats)} фич")

    raw_feats = load_features(game_map())
    context = []
    for ft in raw_feats:
        if ft["properties"].get("iso_a2") == "CN":
            continue  # china_1946_historical.json полностью заменяет сырые CN-фичи
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if not g.intersects(CHINA_BBOX):
            continue
        clipped = g.intersection(CHINA_BBOX)
        if not clipped.is_empty and clipped.geom_type in ("Polygon", "MultiPolygon"):
            context.append(clipped)
    print(f"  контекст (соседи, обрезано по bbox): {len(context)} фич")

    water = []
    for fname in ("seas_1946.geojson", "lakes_1946.geojson"):
        for ft in load_features(out(fname)):
            g = shape(ft["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            if not g.intersects(CHINA_BBOX):
                continue
            clipped = g.intersection(CHINA_BBOX)
            if not clipped.is_empty and clipped.geom_type in ("Polygon", "MultiPolygon"):
                water.append(clipped)
    print(f"  вода (моря+озёра, обрезано по bbox): {len(water)} фич")

    before_total = sum(area_km2(shape(ft["geometry"])) for ft in china_feats)
    absorb_slivers_until_stable(china_feats, context, water, CHINA_BBOX, label="China", max_passes=5)
    after_total = sum(area_km2(shape(ft["geometry"])) for ft in china_feats)
    print(f"  добавлено суммарно: +{after_total - before_total:.1f} km2")

    drop_named_slivers(china_feats, label="China")
    apply_manual_gap_patches(china_feats, context, water, label="China")

    with open(CHINA_PATH, "w", encoding="utf-8") as f:
        json.dump(china_fc, f, ensure_ascii=False)
    print(f"Записано: {CHINA_PATH}")


if __name__ == "__main__":
    main()
