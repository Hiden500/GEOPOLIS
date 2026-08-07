"""
reconstruct_aral_sea_1946.py

Заменяет геометрию Аральского моря в `out/lakes_1946.geojson` (LAK-0011)
НА МЕСТЕ — с калиброванного эллипса (заглушка с 2026-07-20/22, см. старый
`note` фичи) на форму, синтезированную из реальных береговых ориентиров и
задокументированных исторических габаритов.

Контекст (2026-07-23, пользователь): "Попробуй сделать у него более точные
границы. Сейчас это просто овал." Точного архивного контура/шейпфайла 1946
года через WebSearch/WebFetch найти не удалось (проверено: cartographyvectors.com
недоступен по сети в моменте; github.com/aourednik/historical-basemaps — только
границы стран, не водоёмы; cawater-info.net — только растровые исторические
карты, не векторные данные). Прямая деформация современных остатков
(South/North Aral Sea из `sources/naturalearth/ne_10m_lakes.geojson`,
масштабирование от угла) дала нереалистичную змеевидную форму — метод
отброшен (см. ExecPlan `.agent/plans/clip-land-by-water.md` для истории
попыток).

Метод: полигон по опорным точкам вдоль побережья — 2 РЕАЛЬНЫЕ якорные
координаты (Муйнак, южный порт на кромке воды в 1946 — 59.025°в.д.,
43.784°с.ш.; Аральск, северо-восточный порт — 61.664°в.д., 46.803°с.ш.,
WebSearch), остальные точки — синтез по задокументированным габаритам
(428-435 км Ю-С, 234-290 км З-В по независимым источникам, среднее взято)
и общей форме (вытянутое NE-SW тело с плечом-заливом у Аральска). Точки
уплотнены (+4 промежуточные на сегмент) со случайным смещением по нормали
(seed=1946 для воспроизводимости) — реальная береговая линия изрезанная,
не гладкий многоугольник. Итоговая площадь откалибрована обратно к
задокументированным ~68,000 km2 (тем же числом 67822.0, что было и у
эллипса-заглушки — только сама ПЛОЩАДЬ уже была откалибрована верно,
менялась только ФОРМА).

О. Возрождения (45.15°с.ш., 59.317°в.д., реальный остров 1946 г.) лежит
ВНУТРИ нового контура (не смоделирован как отдельная дыра — см. Progress
в ExecPlan, отдельная задача при необходимости).

ЧЕСТНОЕ ОГРАНИЧЕНИЕ: это синтез по опорным точкам и документированным
габаритам, НЕ трассировка официального архивного контура (такого источника
через доступные инструменты не нашлось) — заметно точнее эллипса-заглушки
(правильные пропорции, 2 реальных якоря на кромке, изрезанный берег), но
не музейная точность. Если найдётся настоящий исторический шейпфайл —
заменить эту реконструкцию, не достраивать поверх неё.

lakes_1946.geojson — внешний, hand-maintained input (как ownership_
1946.json), ни один build-скрипт его не перегенерирует целиком. Этот
скрипт ИДЕМПОТЕНТЕН (тот же seed -> та же геометрия каждый прогон) и НЕ
входит в FULL_REBUILD_STEPS — тот же паттерн, что `refresh_lakes_from_
ne10m.py`/`extract_kinneret.py`.

Позиционная безопасность: озеро заменяется НА МЕСТЕ (LAK-0011, та же
позиция в файле) — downstream (ownership_1946.json/names_ru.json) не
сдвигается.

ВАЖНО (2026-07-29): суша вокруг (Aqtöbe/Qyzylorda/Karakalpakstan,
out/asia_1946.geojson) обрезана ПО ПРЕДЫДУЩЕЙ форме озера — после любой
замены формы здесь ОБЯЗАТЕЛЬНО прогнать `fix_aral_sea_raw_boundaries.py`
следом (переобрезает те же 3 провинции по НОВОЙ форме прямо из
оригинальных полигонов game_map.json — заменил более ранний `fix_aral_
sea_coastline_gaps.py`, который растил провинции к воде absorb_slivers'ом
и давал некрасивое "прилипание" к каждому изгибу берега, см. docs/
DECISIONS.md 2026-07-29 "клип оригинальных... границ"). Забытый повторный
прогон этого скрипта откатывает `out/lakes_1946.geojson` к старому
placeholder-овалу при любом восстановлении рабочего дерева из устаревшей
копии (тот же класс бага, что у South America/Great Lakes/Panama в этой
сессии, см. docs/DECISIONS.md 2026-07-29) — если карта снова показывает
идеальный овал вместо изрезанного берега, сначала проверь именно это, не
деформацию.

Запуск: python scripts/map/build/reconstruct_aral_sea_1946.py &&
        python scripts/map/build/fix_aral_sea_raw_boundaries.py
"""
from paths import out
import json
import random
import sys
from shapely.geometry import Polygon, mapping
from shapely.affinity import scale
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
LAKES_OUT = out("lakes_1946.geojson")
LAKE_NAME = "Аральское море (1946, полный размер)"
TARGET_AREA_KM2 = 67822.0

# Реальные береговые ориентиры 1946 г. (WebSearch, см. докстринг).
MUYNAK = (59.025, 43.784)   # южный порт, Каракалпакстан/Узбекистан
ARALSK = (61.664, 46.803)   # северо-восточный порт, Казахстан

# Опорные точки по часовой от севера — единое неразделённое озеро (реальный
# раскол Small/Large Aral произошёл только в 1987, см. докстринг), общие
# габариты ~428-435 км Ю-С, ~234-290 км З-В. MUYNAK/ARALSK — реальные
# якоря, остальное — синтез по форме/пропорциям.
WAYPOINTS = [
    (60.3, 47.05), (61.5, 46.95), ARALSK, (61.3, 46.35), (60.9, 46.15),
    (61.1, 45.6), (60.8, 44.95), (60.3, 44.35), (59.85, 43.95), MUYNAK,
    (58.35, 44.05), (58.0, 44.75), (58.15, 45.55), (58.55, 46.05),
    (58.35, 46.55), (59.0, 46.9), (60.3, 47.05),
]


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def densify_jitter(points, n_between=4, jitter_deg=0.045, seed=1946):
    """Уплотняет ломаную промежуточными точками со смещением по нормали —
    имитирует изрезанный реальный берег вместо гладкого многоугольника.
    Якорные точки (Муйнак/Аральск) не трогаются, джиттер только на
    промежуточных. Детерминированно (фиксированный seed)."""
    rng = random.Random(seed)
    out_pts = []
    for i in range(len(points) - 1):
        p0, p1 = points[i], points[i + 1]
        out_pts.append(p0)
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        length = (dx ** 2 + dy ** 2) ** 0.5 or 1
        nx, ny = -dy / length, dx / length
        for k in range(1, n_between + 1):
            t = k / (n_between + 1)
            x = p0[0] + dx * t
            y = p0[1] + dy * t
            j = rng.uniform(-jitter_deg, jitter_deg)
            out_pts.append((x + nx * j, y + ny * j))
    out_pts.append(points[-1])
    return out_pts


def build_geometry():
    dense = densify_jitter(WAYPOINTS)
    poly = Polygon(dense)
    if not poly.is_valid:
        poly = poly.buffer(0)
    corr = (TARGET_AREA_KM2 / area_km2(poly)) ** 0.5
    centroid = poly.centroid.coords[0]
    return scale(poly, xfact=corr, yfact=corr, origin=centroid)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    with open(LAKES_OUT, encoding="utf-8") as f:
        lakes = json.load(f)

    updated = False
    for ft in lakes["features"]:
        if ft["properties"].get("name") != LAKE_NAME:
            continue
        new_g = build_geometry()
        before_km2 = ft["properties"].get("area_km2")
        ft["geometry"] = mapping(new_g)
        ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
        ft["properties"]["note"] = (
            "Реконструкция по реальным береговым ориентирам (Муйнак/Аральск, "
            "порты на кромке воды 1946 г.) и задокументированным габаритам "
            "(~428-435 км Ю-С, ~234-290 км З-В) — не трассировка архивного "
            "контура (не найден через доступные источники, см. reconstruct_"
            "aral_sea_1946.py). Заменяет калиброванный эллипс-заглушку "
            "(2026-07-23)."
        )
        updated = True
        print(f"  {LAKE_NAME}: {before_km2} -> {ft['properties']['area_km2']} km2 (форма заменена)")
        bounds = new_g.bounds
        print(f"  bounds: ({bounds[0]:.3f},{bounds[1]:.3f})-({bounds[2]:.3f},{bounds[3]:.3f})")

    if not updated:
        print(f"  ВНИМАНИЕ: фича '{LAKE_NAME}' не найдена в {LAKES_OUT} — ничего не изменено")
        return

    with open(LAKES_OUT, "w", encoding="utf-8") as f:
        json.dump(lakes, f, ensure_ascii=False)
    print(f"Записано: {LAKES_OUT}")


if __name__ == "__main__":
    main()
