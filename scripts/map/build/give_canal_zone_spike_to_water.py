"""
give_canal_zone_spike_to_water.py — тонкая игла Зоны Панамского канала
отдаётся воде (2026-07-29).

Пользователь (2026-07-29, аннотированный скриншот, вопрос "Что это за
линии??"): на тихоокеанском входе канала из Зоны торчит узкая длинная
"игла" — на карте читается как случайная линия, а не как территория. Это
дамба Амадор (Amador Causeway) к островам Наос/Перико/Фламенко: объект
реальный и исторически действительно входивший в Canal Zone, но на игровом
масштабе он шириной ~1 км при длине ~5 км, то есть визуально — артефакт.

Решение пользователя, дословно: "Тебе просто надо полигон Панамского
канал присоединить к воде. Другие соседние не трогать". То есть игла
уходит МОРЮ, а Panama (3) / Los Santos (7) / Colón не затрагиваются
вообще (клин суши у Колона — отдельный объект, оставлен как есть).

Метод. Морфологическое открытие (erode → dilate радиусом
SPIKE_ERODE_DEG) отделяет всё, что тоньше 2*радиуса; разница с исходным
полигоном — иглы. Из них берутся только те, что (а) крупнее
SPIKE_MIN_KM2 и (б) примыкают ИСКЛЮЧИТЕЛЬНО к воде. Второе условие —
защита, а не формальность: игла, касающаяся суши, может быть перешейком,
связывающим части региона, и её удаление развалило бы регион. У дамбы
Амадор рядом только "Сев. Пасифика — Американский сектор" (0.0005°),
никакой суши — поэтому передача воде безопасна.

Мелкие иглы (0.03–0.06 км² — обычная изрезанность контура на входах
канала) порогом отсекаются: они не читаются как линии на карте и их
удаление только огрубило бы берег.

ВАЖНО — почему просто `union(море, игла)` НЕДОСТАТОЧНО. Игла не касалась
моря: между ними шла граница Зоны, и после вырезания оставался зазор
~0.0005° (несовпадение узлов двух независимо оцифрованных контуров).
`unary_union` такие полигоны НЕ сливает — первая версия скрипта из-за
этого разорвала "Сев. Пасифика — Американский сектор" на 2 части, и
пользовательская "линия" осталась на карте, только теперь водяная: узкий
выступ моря по-прежнему обводился контуром. Поэтому игла перед
объединением расширяется на WELD_DEG в сторону моря (морфологическое
замыкание щели), а затем результат вычитается из ВСЕЙ прочей суши, чтобы
расширение не залезло на Panama (3)/Los Santos/Colón — "соседние не
трогать" соблюдается буквально. Итог проверяется по числу частей моря:
их не должно стать больше, чем было.

Читает/пишет out/namerica_1946.geojson и out/seas_1946.geojson.
Идемпотентен: после передачи игла в Зоне отсутствует, повторный прогон
находит 0. Отдельно доваривает уже отсоединённые части моря (случай
"первый прогон был старой версией скрипта").
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402
from shapely.geometry import shape, mapping  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

NAM_PATH = out("namerica_1946.geojson")
SEAS_PATH = out("seas_1946.geojson")
TARGET_ISO = "PA_CZ"
SPIKE_ERODE_DEG = 0.006     # ~660 м: дамба (~1 км шириной) отделяется
SPIKE_MIN_KM2 = 1.0
WATER_TOUCH_DEG = 0.01      # примыкание к воде
LAND_CLEAR_DEG = 0.01       # суши в этом радиусе быть не должно
# Заваривание щели между иглой и телом моря. 0.002° (~220 м) — больше
# наблюдавшегося зазора 0.0005° с запасом, но меньше любой реальной
# протоки, которую нельзя схлопывать.
WELD_DEG = 0.002
# Запас при вырезании иглы, чтобы не остался "ус" нулевой ширины на её
# острие (~55 м — меньше любого значимого объекта, больше точности узлов).
TIP_MARGIN_DEG = 0.0005


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def flood_area_with_water(sea_geom, area_box, all_land):
    """В пределах area_box отдаёт воде ВСЁ, что не занято сушей.

    Почему не `union(море, игла)`: игла узкая, и объединение оставляет у
    моря тонкий вырожденный отросток — на рендере он обводится контуром и
    выглядит той же самой "линией", на которую жаловался пользователь,
    только теперь водяной (проверено 2026-07-29: море стало цельным, но
    штрих на карте остался). Заливка целой области снимает вопрос: там
    просто нет ничего тоньше берега — либо суша, либо вода."""
    water_here = area_box.difference(all_land)
    if water_here.is_empty:
        return sea_geom
    return to_polygonal(unary_union([sea_geom, water_here]))


def weld_stray_parts(sea_geom, anchor_geom, max_gap_deg=WELD_DEG):
    """Сливает с телом моря его же мелкие части, отстоящие меньше
    max_gap_deg — щель заваривается локальным замыканием (dilate→erode)
    только вокруг самих частей, а не по всему полигону моря (буфер по
    геометрии в 11 млн км² недопустимо дорог и меняет весь берег).

    anchor_geom нужен, чтобы не заваривать части, не имеющие отношения к
    правке: обрабатываются только те, что рядом с ним."""
    if sea_geom.geom_type != "MultiPolygon":
        return sea_geom, 0
    parts = sorted(sea_geom.geoms, key=lambda p: -p.area)
    body, welded = parts[0], 0
    keep = [body]
    for p in parts[1:]:
        if p.distance(anchor_geom) > max_gap_deg * 5 or p.distance(body) > max_gap_deg:
            keep.append(p)
            continue
        bridge = unary_union([p, body]).buffer(max_gap_deg).buffer(-max_gap_deg)
        body = to_polygonal(unary_union([body, p, bridge]))
        welded += 1
    merged = to_polygonal(unary_union(keep[1:] + [body])) if len(keep) > 1 else body
    return merged, welded


def main():
    nam = load(NAM_PATH)
    seas = load(SEAS_PATH)

    cz_ft = next((ft for ft in nam["features"]
                  if ft["properties"].get("iso_a2") == TARGET_ISO), None)
    if cz_ft is None:
        print(f"  ВНИМАНИЕ: фича iso_a2={TARGET_ISO} не найдена — прерываю")
        return
    cz = shape(cz_ft["geometry"]).buffer(0)
    before = area_km2(cz)

    opened = cz.buffer(-SPIKE_ERODE_DEG).buffer(SPIKE_ERODE_DEG)
    diff = cz.difference(opened)
    cand = [p for p in (diff.geoms if diff.geom_type == "MultiPolygon" else [diff])
            if not p.is_empty and area_km2(p) >= SPIKE_MIN_KM2]

    land_geoms = [shape(ft["geometry"]) for ft in nam["features"]
                  if ft["properties"].get("iso_a2") != TARGET_ISO]

    if not cand:
        # Игла уже вырезана (или её не было). Но прошлый прогон мог оставить
        # её отсоединённым куском моря — доварим, если так.
        fixed_any = False
        for sea_ft in seas["features"]:
            sg = shape(sea_ft["geometry"]).buffer(0)
            if sg.geom_type != "MultiPolygon" or sg.distance(cz) > WELD_DEG * 5:
                continue
            merged, welded = weld_stray_parts(sg, cz)
            if welded:
                sea_ft["geometry"] = mapping(merged)
                if "area_km2" in sea_ft["properties"]:
                    sea_ft["properties"]["area_km2"] = round(area_km2(merged), 1)
                n_before = len(sg.geoms)
                n_after = len(merged.geoms) if merged.geom_type == "MultiPolygon" else 1
                print(f"  {sea_ft['properties'].get('name')}: заварено "
                      f"{welded} отсоединённых част(и/ей), {n_before} -> {n_after}")
                fixed_any = True
        if fixed_any:
            with open(SEAS_PATH, "w", encoding="utf-8") as f:
                json.dump(seas, f, ensure_ascii=False)
            print(f"  Записано: {SEAS_PATH}")
        else:
            print("  игл крупнее порога нет — нечего отдавать")
        return

    chosen, target_sea_idx = [], None
    for spike in cand:
        near_land = [g for g in land_geoms if g.distance(spike) < LAND_CLEAR_DEG]
        if near_land:
            print(f"  игла {area_km2(spike):.2f} км² у {spike.centroid.x:.3f},"
                  f"{spike.centroid.y:.3f} касается суши — НЕ трогаю "
                  f"(может быть перешейком)")
            continue
        touching = [i for i, ft in enumerate(seas["features"])
                    if shape(ft["geometry"]).distance(spike) < WATER_TOUCH_DEG]
        if len(touching) != 1:
            print(f"  игла {area_km2(spike):.2f} км² примыкает к {len(touching)} "
                  f"водным фичам (нужна ровно 1) — НЕ трогаю")
            continue
        if target_sea_idx is not None and touching[0] != target_sea_idx:
            print("  иглы примыкают к РАЗНЫМ морям — обработаю только первое")
            continue
        target_sea_idx = touching[0]
        chosen.append(spike)

    if not chosen:
        print("  подходящих игл нет")
        return

    sea_ft = seas["features"][target_sea_idx]
    spikes = unary_union(chosen)
    sea_geom = shape(sea_ft["geometry"]).buffer(0)
    n_parts_before = len(sea_geom.geoms) if sea_geom.geom_type == "MultiPolygon" else 1

    # Сначала убираем иглу из Зоны, затем заливаем ВСЮ её окрестность
    # водой (кроме суши) — так у моря не остаётся вырожденного отростка.
    #
    # Вырезаем игру с запасом TIP_MARGIN_DEG: на самом остриё иглы полигон
    # сходится в точку, и чистый `difference(spikes)` оставляет там "ус"
    # нулевой ширины — контур уходит в кончик и возвращается. Площади у
    # такого уса нет, поэтому ни проверка пересечений, ни проверка площади
    # его не видят, а на рендере он рисуется ЧЁРНОЙ ЛИНИЕЙ поперёк воды:
    # ровно та "линия", на которую жаловался пользователь, только теперь
    # оставленная моей же правкой (найдено 2026-07-29 разбором координат
    # exterior — точка (-79.5163, 8.9103) с прыжком на 2 км к следующей).
    new_cz = to_polygonal(cz.difference(spikes.buffer(TIP_MARGIN_DEG)))
    if new_cz.is_empty:
        print("  ВНИМАНИЕ: Зона канала обрезалась бы в ПУСТО — прерываю")
        return

    all_land_after = unary_union(land_geoms + [new_cz]) if land_geoms else new_cz
    area_box = spikes.buffer(WELD_DEG).envelope
    new_sea = flood_area_with_water(sea_geom, area_box, all_land_after)
    new_sea, welded = weld_stray_parts(new_sea, spikes)
    n_parts_after = len(new_sea.geoms) if new_sea.geom_type == "MultiPolygon" else 1
    if n_parts_after > n_parts_before:
        print(f"  ВНИМАНИЕ: море разорвалось бы ({n_parts_before} -> "
              f"{n_parts_after} частей) — прерываю, ничего не пишу")
        return

    cz_ft["geometry"] = mapping(new_cz)
    cz_ft["properties"]["area_km2"] = round(area_km2(new_cz), 1)
    sea_ft["geometry"] = mapping(new_sea)
    if "area_km2" in sea_ft["properties"]:
        sea_ft["properties"]["area_km2"] = round(area_km2(new_sea), 1)

    print(f"  Зона канала: {before:.1f} -> {area_km2(new_cz):.1f} км² "
          f"(отдано воде {area_km2(spikes):.2f} км², игл: {len(chosen)})")
    print(f"  получатель — {sea_ft['properties'].get('name')}: "
          f"{area_km2(sea_geom):.1f} -> {area_km2(new_sea):.1f} км²")

    with open(NAM_PATH, "w", encoding="utf-8") as f:
        json.dump(nam, f, ensure_ascii=False)
    with open(SEAS_PATH, "w", encoding="utf-8") as f:
        json.dump(seas, f, ensure_ascii=False)
    print(f"  Записано: {NAM_PATH}, {SEAS_PATH}")


if __name__ == "__main__":
    main()
