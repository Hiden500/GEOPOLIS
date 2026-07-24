"""
clip_land_by_water.py

Обрезает СУШУ по морю/озеру там, где они накладываются — обратное
направление `fix_sea_coastline_gaps.py`/`fix_lake_coastline_gaps.py` (там
вода растёт до авторитетной суши; здесь наоборот — суша авторитетна ВЕЗДЕ,
КРОМЕ мест, где она перекрывает уже существующую воду).

Контекст: известное с 2026-07-19 ограничение — `fix_sea_coastline_gaps.py`
явно откладывало этот проход ("клипать море по кураторской суше сейчас
означало бы искажать уже приклеенное побережье... устранение ОТЛОЖЕНО на
будущий проход, который будет резать СУШУ по линии моря"). Пользователь
(2026-07-23): "обрежь полигоны суши по водным полигонам".

Метод: для каждой сухопутной фичи (все 7 континентов) — найти все море/
озеро-фичи, с которыми она пересекается (`STRtree`, площадь пересечения
> `MIN_OVERLAP_DEG2`), и вычесть их объединение:
`land = land.difference(unary_union(overlapping_water))`. `to_polygonal()`
(`geometry_cleanup.py`) чистит вырожденные фрагменты, которые может дать
`.difference()` на сложном стыке (тот же класс артефакта, что уже ловился
в `absorb_slivers`/`resolve_same_iso_overlaps`).

Не трогает: 1 известную пару суша↔суша (Ponta Porã/Presidente Hayes,
Бразилия/Парагвай, ~160 км²) — другой класс проблемы (граница двух стран,
не суша против воды), не в scope этого прохода.

Аральское море — крупнейший случай (Aqtöbe/Qyzylorda/Karakalpakstan,
суммарно ~68,000 км²): исторически обоснован (см. `docs/HISTORICAL_
ACCURACY.md` — "мир обязан начинаться с исторически достоверного
состояния для выбранной даты"; сама пометка "полный размер (1946)" у
озера уже была решением моделировать историческую, не современную
постсоветскую пересохшую границу). Обрезка современных ADM1-регионов по
исторически точному контуру озера — прямое применение уже принятого
принципа, форма озера уже восстановлена (`reconstruct_aral_sea_1946.py`,
2026-07-23) специально для того, чтобы эта обрезка была осмысленной, а не
по грубому эллипсу.

ВАЖНО (2026-07-23, найдено на первом же прогоне): наивный клип "всё, что
пересекается — обрезать" КАТАСТРОФИЧЕН для части фич. Некоторые "моря" в
этом датасете — грубые океанские СЕКТОРЫ (напр. "Сев. Пасифика —
Американский сектор", bbox от экватора до 49.7°с.ш.!) или просто крупные
именованные моря низкого разрешения (English Channel и т.п.), БЕЗ точных
вырезов под мелкие острова/полуострова внутри их bbox. Первый прогон снёс
Washington — San Juan на 94.4% (7704.6 → 425.4 км²) и French Southern
Territories на 97.7% (7244.4 → 165.8 км²) — реальные, обитаемые
территории, не мелкие швы. Восстановлено через регенерацию континентов
(континенты гитигнорены, `--full-rebuild` из сырых источников + повтор
`fill_sea_holes.py`/`fix_lake_coastline_gaps.py` — см. `docs/DECISIONS.md`).

Защита: клип применяется автоматически, только если снимаемая доля
площади фичи < `MAX_SAFE_FRACTION`. Пересчёт по всем 83 сухопутным фичам
с наложением показал чёткий разрыв в распределении — от 0% до ~10%
плавно (нормальные швы побережья), затем скачок к 14%+ (подозрительно) и
9 случаев ровно 100% (остров целиком внутри грубого моря). Всё ⩾ порога
пропускается и печатается как "ТРЕБУЕТ РЕВЬЮ" — НЕ обрезается автоматически,
кроме явно проверенных исключений в `MANUAL_REVIEW_APPROVED` (сейчас —
только Aral/Aqtöbe/Qyzylorda/Karakalpakstan, каждая пара проверена
визуально при реконструкции формы озера). Не подтверждённые вручную
случаи (Sан-Хуан, French Southern Territories, Virginia — Accomack,
Херд/Макдональд, Fernando de Noronha, French Polynesia и др.) остаются
как есть — задокументированы в `docs/TODO.md`, не в scope этого прохода
(нужна либо более точная геометрия моря, либо ручное решение по каждому).

Читает и пишет continent-файлы (`out/<continent>_1946.geojson`) НАПРЯМУЮ —
тот же паттерн, что `fill_sea_holes.py`/`fix_lake_coastline_gaps.py` (эти
файлы гитигнорены и полностью перезаписываются при пересборке континента
по любой причине; патч поверх `client/public/world_1946.geojson` был бы
тихо потерян). Часть `FULL_REBUILD_STEPS`, идёт последним из geometry-фиксов
(после `fix_lake_coastline_gaps.py`, до `merge_world_1946.py`) — оперирует
на финальном состоянии суши/воды перед мержем.

Идемпотентен: на уже обрезанной суше находит 0 наложений и ничего не
перезаписывает.

Запуск: python scripts/map/build/clip_land_by_water.py
"""
from paths import out
import json
import sys
from shapely.geometry import shape, mapping
from shapely.strtree import STRtree
from shapely.ops import unary_union

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CONTINENT_FILES = {
    "EUR": out("europe_1946.geojson"),
    "ASI": out("asia_1946.geojson"),
    "NAM": out("namerica_1946.geojson"),
    "SAM": out("southamerica_1946.geojson"),
    "AFR": out("africa_1946.geojson"),
    "OCE": out("oceania_1946.geojson"),
    "ANT": out("antarctica_1946.geojson"),
}

# Ниже этого раствор пересечения не считается реальным наложением — тот же
# принцип, что MIN_CELL_AREA_DEG2 в geometry_cleanup.py (защита от
# машинного шума), но отдельная константа: здесь речь о РЕАЛЬНОМ
# пересечении двух уже существующих полигонов (не о фантомной ячейке
# polygonize), порог может быть меньше — даже честные 0.0001 deg2
# (Fernando de Noronha, ~1 км²) реальны и должны обрезаться.
MIN_OVERLAP_DEG2 = 1e-7

# Доля площади фичи, которую клип может снять БЕЗ ручного подтверждения —
# см. докстринг про эмпирический разрыв в распределении (0-10% нормальные
# швы, 14%+ подозрительно, 9 случаев 100%).
MAX_SAFE_FRACTION = 0.10

# Пары (имя суши, имя воды), для которых клип ОДОБРЕН вручную несмотря на
# долю >= MAX_SAFE_FRACTION — проверено визуально при восстановлении формы
# Аральского моря (2026-07-23, см. docs/DECISIONS.md), не автоматическое
# решение.
MANUAL_REVIEW_APPROVED = {
    ("Aqtöbe", "Аральское море (1946, полный размер)"),
    ("Qyzylorda (3)", "Аральское море (1946, полный размер)"),
    ("Karakalpakstan (3)", "Аральское море (1946, полный размер)"),
}


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    continent_feats = {}
    all_land = []  # (continent, idx, geom)
    for continent, path in CONTINENT_FILES.items():
        feats = load_features(path)
        continent_feats[continent] = feats
        for i, ft in enumerate(feats):
            all_land.append((continent, i, shape(ft["geometry"])))

    seas_feats = load_features(out("seas_1946.geojson"))
    lakes_feats = load_features(out("lakes_1946.geojson"))
    water_items = []  # (geom, name)
    for ft in seas_feats + lakes_feats:
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        water_items.append((g, ft["properties"].get("name")))
    water_tree = STRtree([g for g, _ in water_items])
    print(f"  суша: {len(all_land)} фич, море+озёра: {len(water_items)} фич")

    touched_continents = set()
    n_clipped = 0
    total_removed = 0.0
    needs_review = []
    for continent, idx, land_g in all_land:
        cand_idxs = [int(j) for j in water_tree.query(land_g)]
        overlapping = []
        overlap_names = []
        for j in cand_idxs:
            wg, wname = water_items[j]
            inter = land_g.intersection(wg)
            if not inter.is_empty and inter.area > MIN_OVERLAP_DEG2:
                overlapping.append(wg)
                overlap_names.append(wname)
        if not overlapping:
            continue

        land_name = continent_feats[continent][idx]["properties"].get("name")
        land_area = area_km2(land_g)
        water_union = unary_union(overlapping)
        overlap_km2 = area_km2(land_g.intersection(water_union))
        frac = overlap_km2 / land_area if land_area > 0 else 0

        approved = any((land_name, wn) in MANUAL_REVIEW_APPROVED for wn in overlap_names)
        if frac >= MAX_SAFE_FRACTION and not approved:
            needs_review.append((frac, continent, land_name, land_area, overlap_km2, overlap_names))
            continue

        new_g = land_g.difference(water_union)
        if not new_g.is_valid:
            new_g = new_g.buffer(0)
        new_g = to_polygonal(new_g)
        if new_g.is_empty or new_g.geom_type not in ("Polygon", "MultiPolygon"):
            print(f"  ОТКАЗ ({continent}/{land_name}): клип дал {new_g.geom_type} — не применено")
            continue

        after_km2 = area_km2(new_g)
        removed = land_area - after_km2
        ft = continent_feats[continent][idx]
        ft["geometry"] = mapping(new_g)
        if "area_km2" in ft["properties"]:
            ft["properties"]["area_km2"] = round(after_km2, 1)
        touched_continents.add(continent)
        n_clipped += 1
        total_removed += removed
        tag = " [APPROVED>=10%]" if approved else ""
        print(f"  {continent}/{land_name}: {land_area:.1f} -> {after_km2:.1f} km2 (-{removed:.1f}){tag}")

    for continent in touched_continents:
        path = CONTINENT_FILES[continent]
        fc = {"type": "FeatureCollection", "features": continent_feats[continent]}
        with open(path, "w", encoding="utf-8") as f:
            json.dump(fc, f, ensure_ascii=False)
        print(f"  Записано: {path}")

    print(f"\nВсего обрезано фич: {n_clipped}, снято площади: {total_removed:.1f} km2")

    if needs_review:
        needs_review.sort(reverse=True)
        print(f"\nТРЕБУЕТ РЕВЬЮ ({len(needs_review)} фич, доля >= {MAX_SAFE_FRACTION*100:.0f}%, НЕ обрезано):")
        for frac, continent, name, total, overlap, wnames in needs_review:
            print(f"  {frac*100:6.2f}%  {continent}/{name}  total={total:.1f} overlap={overlap:.1f}  vs {wnames}")


if __name__ == "__main__":
    main()
