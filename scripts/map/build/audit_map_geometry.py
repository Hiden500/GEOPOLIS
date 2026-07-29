"""
audit_map_geometry.py — единая приёмка геометрии карты (2026-07-29).

ЗАЧЕМ. До этого скрипта диагностика была россыпью из четырёх независимых
инструментов (diagnose_coastline_gaps / _sea_holes / _missing_land /
_scattered_regions), каждый со своей метрикой, своим форматом вывода и
своим запуском. Пользователь смотрел на карту и находил дефекты, которых
НИ ОДИН из четырёх не показывал, потому что:

  - `diagnose_scattered_regions.py` явно пропускал SEA-/LAK- (моря вообще
    не проверялись) и искал только "часть далеко от своего тела", но не
    "часть, приросшая к ЧУЖОЙ стране";
  - никто не сверял площадь региона с сырым `game_map.json` — из-за чего
    "Washington — San Juan" жил с 9706 км² при 412 км² реальной суши
    (96% — акватория пролива Хуан-де-Фука и 2475 км² канадской земли
    севернее 49-й параллели), а `clip_sea_by_land.py` покорно резал МОРЕ
    по этой ложной суше, разбив North Pacific — American Sector на 17
    кусков (1 кусок в 628a3bd → 15 в main → 17 к 2026-07-29: дефект
    молча РОС с каждой серией фиксов берега);
  - никто не искал тонкие иглы-выступы (обе "линии" у входов Панамского
    канала).

ЧТО ДЕЛАЕТ. Один вход, один отчёт, ВОСЕМЬ классов дефектов, и — главное —
baseline: множество уже известных находок в
`config/geometry_audit_baseline.json`. Появилась находка, которой в
baseline нет → ненулевой exit. Это и есть защита от "числа молча растут":
любая правка геометрии, породившая новый дефект, валит пайплайн сразу, а
не через три сессии по чужому скриншоту.

Классы (ID стабильны — по ним ведётся baseline):

  INFLATED        площадь региона не подтверждена сырым game_map.json
                  (>INFLATED_FRACTION). Ловит "суша, покрывающая
                  акваторию" — корневой класс San Juan.
  ORPHAN_FOREIGN  отсоединённая часть фичи, касающаяся ЧУЖОЙ фичи
                  (другой iso_a2) и НЕ касающаяся своего тела. Ловит
                  "3 куска British Columbia, приписанные Вашингтону".
  WATER_SHATTERED водная фича, разбитая на куски, каждый из которых мал
                  относительно главного. Ловит изрезанное сушей море.
  SPIKE           тонкий выступ (морфологическое открытие срезает кусок
                  >SPIKE_MIN_KM2). Ловит иглы у входов канала.
  COASTLINE_GAP   непокрытая ячейка суша↔вода (переиспользует проверенный
                  `_gap_cells` из diagnose_coastline_gaps.py).
  SEA_HOLE        дыра-остров в море без покрывающей суши
                  (переиспользует find_holes/classify из
                  diagnose_sea_holes.py).
  MISSING_LAND    сырая фича, чей representative_point не покрыт выходной
                  сушей (логика бывшего diagnose_missing_land.py, слой 3).
  SCATTERED       части фичи разбросаны дальше порога (логика бывшего
                  diagnose_scattered_regions.py, теперь И ДЛЯ ВОДЫ ТОЖЕ).

diagnose_missing_land.py и diagnose_scattered_regions.py удалены — их
логика здесь. diagnose_coastline_gaps.py и diagnose_sea_holes.py
ОСТАВЛЕНЫ: они импортируются fix_*-скриптами как библиотеки (_gap_cells,
find_holes) и несут собственный рендер; отдельный запуск их CLI больше не
нужен — всё, что они считают, попадает в этот отчёт.

ЗАПУСК:
  python scripts/map/build/audit_map_geometry.py            # проверить
  python scripts/map/build/audit_map_geometry.py --update-baseline
  python scripts/map/build/audit_map_geometry.py --only INFLATED,SPIKE
  python scripts/map/build/audit_map_geometry.py --quick    # без тяжёлых

Читает out/world_1946.geojson (НЕ client/public — у того другая схема
свойств, без region_type, см. references/build_pipeline_gotchas.md).
"""
import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import game_map, out  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import shape, box as shp_box  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from shapely.strtree import STRtree  # noqa: E402

BASELINE_PATH = (Path(__file__).resolve().parents[1] / "config"
                 / "geometry_audit_baseline.json")

# --- пороги (менять осознанно: сдвиг порога = сдвиг всего baseline) ---

# Доля площади, не подтверждённая сырым источником, выше которой регион
# считается раздутым. 15% выбрано по фактическому распределению: реальные
# расхождения оцифровки берега дают <10%, а найденные дефекты — 15%+.
INFLATED_FRACTION = 0.15
INFLATED_MIN_KM2 = 50.0        # мелочь ниже этого не разбираем

# Отсоединённая часть считается "приросшей к чужому", если она ближе
# этого к фиче с другим iso_a2 (и дальше от собственного тела).
FOREIGN_TOUCH_DEG = 0.005
ORPHAN_MIN_KM2 = 0.05

# Вода: кусок меньше этой доли главного и есть — признак изрезанности.
WATER_PART_MAX_FRACTION = 0.02
WATER_MIN_PARTS = 3

# Игла: морфологическое открытие с этим радиусом (в градусах) срезает
# кусок площадью больше порога.
SPIKE_ERODE_DEG = 0.004        # ~440 м
SPIKE_MIN_KM2 = 3.0

SCATTERED_THRESHOLD_DEG = 0.5
ANTIMERIDIAN_DEG = 180.0       # разброс больше — артефакт склейки, не дефект


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def valid(g):
    return g if g.is_valid else g.buffer(0)


def parts_of(g):
    return list(g.geoms) if g.geom_type == "MultiPolygon" else [g]


def finding(cls, fid, name, value, detail):
    """value — числовая величина дефекта (км² / штуки / градусы). В
    baseline сравниваются ТОЛЬКО (cls, fid): величина печатается для
    человека и может дрейфовать от float-шума, ключ — нет.

    ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: для пофичевых классов (SPIKE, ORPHAN_*,
    SCATTERED) fid — это region_id, поэтому несколько находок в ОДНОМ
    регионе схлопываются в один ключ, и вторая игла у уже известного
    региона не поднимет тревогу. Осознанный компромисс: ключ с
    координатами был бы точнее, но дрейфует от float-шума при каждой
    пересборке и превращал бы baseline в постоянный источник ложных
    "новых" находок. Классы, где место важнее фичи (COASTLINE_GAP,
    SEA_HOLE), используют координатный ключ с округлением до 0.01°."""
    return {"class": cls, "id": fid, "name": name,
            "value": round(float(value), 2), "detail": detail}


# ----------------------------------------------------------------------
# Проверки
# ----------------------------------------------------------------------

def check_inflated(world, raw_geoms, raw_tree):
    """Площадь региона против сырого источника.

    Именно этот чек находит корневой дефект класса "суша нарисована
    поверх воды": пайплайн такую сушу считает истиной и режет по ней
    море (clip_sea_by_land.py), поэтому НИ проверка пересечений, НИ
    проверка разрывов её не видят — с точки зрения топологии всё
    сходится, просто вода объявлена землёй."""
    res = []
    for ft in world:
        p = ft["properties"]
        if p.get("region_type") != "land":
            continue
        g = valid(shape(ft["geometry"]))
        a = area_km2(g)
        if a < INFLATED_MIN_KM2:
            continue
        idx = raw_tree.query(g)
        covered = 0.0
        if len(idx):
            cov = unary_union([raw_geoms[int(i)] for i in idx])
            covered = area_km2(g.intersection(cov))
        frac = 1.0 - covered / a if a > 0 else 0.0
        if frac > INFLATED_FRACTION:
            res.append(finding(
                "INFLATED", p.get("region_id"), p.get("name"), a - covered,
                f"{frac*100:.1f}% площади ({a - covered:.0f} из {a:.0f} км²) "
                f"не подтверждено сырым game_map.json"))
    return res


def check_orphan_foreign(world, raw):
    """Отсоединённая часть, лежащая на ЧУЖОЙ земле по сырому источнику.

    Отличается от SCATTERED: там вопрос "далеко ли часть от своего тела"
    (архипелаг — это нормально), здесь — "не принадлежит ли она на самом
    деле соседу".

    Первая версия чека (2026-07-29) считала признаком дефекта "часть
    оторвана от своего тела И касается чужой фичи" — и выдала 74
    находки, из которых почти все ЛОЖНЫЕ: остров Ванкувер законно
    оторван от материковой British Columbia и касается соседа, Огненная
    Земля разделена между Чили и Аргентиной, Бруней физически разрезан
    Сараваком, Тимор — между Индонезией и португальской частью. Касание
    соседа на общем острове — норма, а не дефект.

    Решающий признак — не топология, а СЫРОЙ ИСТОЧНИК: если земля под
    частью в game_map.json принадлежит другому iso_a2, значит кусок
    приписан не той стране (ровно случай трёх кусков британской
    Колумбии, оказавшихся у Washington — San Juan).

    Сравнение идёт НЕ с номинальным iso_a2 региона, а с грунтом его
    ГЛАВНОЙ части. Вторая версия чека сравнивала с номинальным — и снова
    дала ложные: Ньюфаундленд числится за `NF` (отдельный доминион 1946),
    а сырьё современное и знает там только `CA`, так что каждый его
    остров выглядел "чужим". Историческая переразметка (NF/SUN/YUG/CSK и
    прочие 1946-исключения) сдвигает номинальный код у ВСЕГО региона
    сразу, поэтому грунт главной части — устойчивый эталон: у
    Ньюфаундленда и тело, и острова лежат на CA (совпадает → норма), у
    Washington — San Juan тело на US, а спорные куски на CA (расходится
    → дефект).

    Часть, не покрытая сырьём вообще, репортится отдельной формулировкой:
    это либо синтез из дыры моря (легитимный, уходит в baseline), либо
    мусор."""
    res = []
    raw_geoms = [valid(shape(ft["geometry"])) for ft in raw]
    raw_tree = STRtree(raw_geoms)

    def ground_iso(geom):
        """Доминирующий iso_a2 сырой земли под геометрией (None — нет)."""
        by_iso = {}
        for ci in raw_tree.query(geom):
            ci = int(ci)
            inter = geom.intersection(raw_geoms[ci])
            if inter.is_empty:
                continue
            iso = raw[ci]["properties"].get("iso_a2")
            by_iso[iso] = by_iso.get(iso, 0.0) + area_km2(inter)
        if not by_iso:
            return None
        return max(by_iso, key=by_iso.get)

    for ft in world:
        if ft["properties"].get("region_type") != "land":
            continue
        g = valid(shape(ft["geometry"]))
        if g.geom_type != "MultiPolygon":
            continue
        ps = sorted(g.geoms, key=lambda q: -q.area)
        main = ps[0]
        main_iso = ground_iso(main)
        if main_iso is None:
            # Тело региона само не подтверждено сырьём (регион целиком
            # синтезирован из дыр моря — Tokelau, Yap, San Andrés). Эталона
            # для сравнения нет, любая часть на реальной земле выглядела бы
            # "чужой" — это ложный сигнал. Раздутость такого региона ловит
            # INFLATED, здесь сравнивать не с чем.
            continue
        for part in ps[1:]:
            a = area_km2(part)
            if a < ORPHAN_MIN_KM2:
                continue
            if part.distance(main) < FOREIGN_TOUCH_DEG:
                continue  # висит на своём же теле — не сирота
            owner_iso = ground_iso(part)
            if owner_iso is None:
                # Отдельный класс, а не ORPHAN_FOREIGN: почти всегда это
                # легитимный синтез острова из дыры моря (атоллы Французской
                # Полинезии, дельта Амазонки, Понпеи) — большой стабильный
                # baseline. Держать их вместе с "лежит на чужой земле"
                # значило бы утопить редкий острый сигнал в постоянном шуме.
                res.append(finding(
                    "ORPHAN_UNSOURCED", ft["properties"].get("region_id"),
                    ft["properties"].get("name"), a,
                    f"часть {a:.1f} км² у {part.centroid.x:.3f},"
                    f"{part.centroid.y:.3f} не покрыта сырым источником вообще"))
                continue
            # "-1" в Natural Earth = спорная/безISO территория: она законно
            # входит в состав соседа, это не признак чужого грунта
            if owner_iso in (main_iso, "-1", None):
                continue
            res.append(finding(
                "ORPHAN_FOREIGN", ft["properties"].get("region_id"),
                ft["properties"].get("name"), a,
                f"часть {a:.1f} км² у {part.centroid.x:.3f},"
                f"{part.centroid.y:.3f} лежит на земле {owner_iso}, "
                f"а тело региона — на {main_iso}"))
    return res


def check_water_shattered(world):
    """Вода, изрезанная на мелкие куски.

    Море, разбитое сушей, — не косметика: сироты моря ломают соседство
    (build_neighbor_graph) и выглядят на карте как рваная акватория.
    Крупные океанские секторы законно состоят из нескольких частей
    (антимеридиан), поэтому критерий — не число частей само по себе, а
    сколько частей ПРЕНЕБРЕЖИМО малы относительно главной."""
    res = []
    for ft in world:
        p = ft["properties"]
        if p.get("region_type") not in ("sea", "lake"):
            continue
        g = valid(shape(ft["geometry"]))
        if g.geom_type != "MultiPolygon":
            continue
        ps = sorted(g.geoms, key=lambda q: -q.area)
        main_a = area_km2(ps[0])
        small = [q for q in ps[1:] if area_km2(q) < main_a * WATER_PART_MAX_FRACTION]
        if len(small) >= WATER_MIN_PARTS:
            res.append(finding(
                "WATER_SHATTERED", p.get("region_id"), p.get("name"), len(small),
                f"{len(small)} мелких кусков (из {len(ps)}), "
                f"суммарно {sum(area_km2(q) for q in small):.1f} км²"))
    return res


def check_spikes(world):
    """Тонкие иглы-выступы.

    Морфологическое открытие (erode → dilate) убирает всё тоньше
    2*SPIKE_ERODE_DEG; разница с оригиналом — как раз иглы. Порог по
    площади отсекает обычную изрезанность берега (она даёт множество
    крошечных срезов), оставляя выраженные "шипы".

    Устойчивость: buffer на сложных берегах регулярно рождает геометрию,
    на которой GEOS падает с "non-noded intersection" (поймано на Мичигане
    при первом полном прогоне). Поэтому каждый шаг нормализуется buffer(0),
    а вся тройка erode/dilate/difference обёрнута в try — упавшая фича
    пропускается с предупреждением, а не роняет весь аудит: диагностика,
    которая падает на одной фиче из полутора тысяч, бесполезна как
    приёмка."""
    res = []
    skipped = 0
    for ft in world:
        p = ft["properties"]
        g = valid(shape(ft["geometry"]))
        try:
            opened = valid(valid(g.buffer(-SPIKE_ERODE_DEG)).buffer(SPIKE_ERODE_DEG))
            if opened.is_empty:
                continue
            diff = g.difference(opened)
        except Exception as exc:
            skipped += 1
            print(f"      [SPIKE] пропущен {p.get('region_id')} {p.get('name')}: "
                  f"{type(exc).__name__}", flush=True)
            continue
        if diff.is_empty:
            continue
        for piece in parts_of(diff):
            a = area_km2(piece)
            if a >= SPIKE_MIN_KM2:
                res.append(finding(
                    "SPIKE", p.get("region_id"), p.get("name"), a,
                    f"тонкий выступ {a:.1f} км² у "
                    f"{piece.centroid.x:.3f},{piece.centroid.y:.3f}"))
    if skipped:
        print(f"      [SPIKE] всего пропущено фич из-за ошибок GEOS: {skipped}")
    return res


def check_scattered(world):
    """Разброс частей — теперь и для воды тоже (раньше SEA-/LAK- явно
    пропускались, из-за чего изрезанные моря были невидимы)."""
    res = []
    for ft in world:
        p = ft["properties"]
        g = valid(shape(ft["geometry"]))
        if g.geom_type != "MultiPolygon":
            continue
        ps = sorted(g.geoms, key=lambda q: -q.area)
        main = ps[0]
        dmax = max((q.distance(main) for q in ps[1:]), default=0.0)
        if SCATTERED_THRESHOLD_DEG < dmax < ANTIMERIDIAN_DEG:
            res.append(finding(
                "SCATTERED", p.get("region_id"), p.get("name"), dmax,
                f"{len(ps)} частей, максимальный разброс {dmax:.2f}°"))
    return res


def check_missing_land(world, raw):
    """Сырая фича, чей representative_point не покрыт выходной сушей
    (слой 3 бывшего diagnose_missing_land.py). Точки, попавшие в
    вырезанное озеро, — не пропажа (приозёрный район), помечаются и не
    считаются дефектом."""
    lands, lake_geoms = [], []
    for ft in world:
        rt = ft["properties"].get("region_type")
        if rt == "land":
            lands.append(valid(shape(ft["geometry"])))
        elif rt == "lake":
            lake_geoms.append(valid(shape(ft["geometry"])))
    tree = STRtree(lands)
    lake_tree = STRtree(lake_geoms) if lake_geoms else None

    res = []
    for ft in raw:
        g = valid(shape(ft["geometry"]))
        if g.is_empty:
            continue
        rp = g.representative_point()
        if any(lands[int(i)].contains(rp) for i in tree.query(rp)):
            continue
        if lake_tree is not None and any(
                lake_geoms[int(i)].contains(rp) for i in lake_tree.query(rp)):
            continue
        p = ft["properties"]
        code = p.get("adm1_code") or p.get("name")
        res.append(finding(
            "MISSING_LAND", code, p.get("name"), area_km2(g),
            f"сырая фича {code} ({p.get('iso_a2')}) не покрыта выходной сушей"))
    return res


def check_coastline_gaps():
    """Переиспользует проверенный _gap_cells из diagnose_coastline_gaps.py
    (не переписан заново — своя реализация поиска ячеек уже однажды дала
    0 находок там, где настоящая нашла реальные разрывы).

    TILES там — СПИСОК пар (label, bbox), не словарь: первая версия этой
    обёртки вызывала .items() по памяти и падала. Сверяться с реальной
    сигнатурой, а не с воспоминанием о ней."""
    from diagnose_coastline_gaps import TILES, load_all_geoms, _gap_cells
    res = []
    for label, (minx, miny, maxx, maxy) in TILES:
        b = shp_box(minx, miny, maxx, maxy)
        land, water = load_all_geoms(b)
        for cell, a, pt, cat in _gap_cells(b, land, water):
            if cat != "COASTLINE":
                continue
            res.append(finding(
                "COASTLINE_GAP", f"{label}@{pt[0]:.2f},{pt[1]:.2f}", label, a,
                f"разрыв суша↔вода {a:.1f} км² в тайле {label}"))
    return res


def check_sea_holes(world, raw):
    """Переиспользует find_holes/classify из diagnose_sea_holes.py.

    Дефектом считается дыра БЕЗ сырого источника: дыра, под которой
    нашёлся реальный остров в game_map.json, — это уже задача
    fill_sea_holes.py, а не признак поломки."""
    from diagnose_sea_holes import find_holes, classify
    land_feats = [ft for ft in world if ft["properties"].get("region_type") == "land"]
    water_feats = [ft for ft in world
                   if ft["properties"].get("region_type") in ("sea", "lake")]
    world_land = [(valid(shape(ft["geometry"])), ft["properties"].get("name"))
                  for ft in land_feats]
    raw_geoms = [(valid(shape(ft["geometry"])), ft["properties"]) for ft in raw]

    res = []
    for h in classify(find_holes(world_land, water_feats), raw_geoms):
        if h.get("raw_match"):
            continue
        cx, cy = h["centroid"]
        res.append(finding(
            "SEA_HOLE", f"{h['sea_name']}@{cx:.2f},{cy:.2f}", h["sea_name"],
            h["residual_km2"],
            f"дыра {h['residual_km2']:.1f} км² в воде без сырого источника"))
    return res


CHECKS = {
    "INFLATED": ("raw", check_inflated),
    # один проход даёт находки двух классов — регистрируем обе, чтобы они
    # существовали в baseline даже когда пусты
    "ORPHAN_FOREIGN": ("world+raw", check_orphan_foreign),
    "ORPHAN_UNSOURCED": ("alias", "ORPHAN_FOREIGN"),
    "WATER_SHATTERED": ("world", check_water_shattered),
    "SPIKE": ("world", check_spikes),
    "SCATTERED": ("world", check_scattered),
    "MISSING_LAND": ("world+raw", check_missing_land),
    "COASTLINE_GAP": ("none", check_coastline_gaps),
    "SEA_HOLE": ("world+raw", check_sea_holes),
}
HEAVY = {"COASTLINE_GAP", "SEA_HOLE", "MISSING_LAND", "SPIKE"}


def load_baseline():
    if not BASELINE_PATH.exists():
        return {}
    with open(BASELINE_PATH, encoding="utf-8") as f:
        return json.load(f).get("known", {})


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update-baseline", action="store_true",
                    help="записать текущие находки как новый baseline")
    ap.add_argument("--only", default=None,
                    help="список классов через запятую")
    ap.add_argument("--quick", action="store_true",
                    help="пропустить тяжёлые проверки (%s)" % ", ".join(sorted(HEAVY)))
    ap.add_argument("--world", default=None,
                    help="путь к world geojson (по умолчанию out/world_1946.geojson); "
                         "нужен для негативного контроля на историческом снимке")
    args = ap.parse_args()

    selected = set(CHECKS)
    if args.only:
        selected = {c.strip().upper() for c in args.only.split(",")}
        unknown = selected - set(CHECKS)
        if unknown:
            print("Неизвестные классы:", ", ".join(sorted(unknown)))
            return 2
    if args.quick:
        selected -= HEAVY

    # класс-алиас считается тем же проходом, что и его источник
    to_run = set()
    for cls in selected:
        kind, target = CHECKS[cls]
        to_run.add(target if kind == "alias" else cls)

    world = load_features(args.world or out("world_1946.geojson"))
    need_raw = any(CHECKS[c][0] in ("raw", "world+raw") for c in to_run)
    raw = load_features(game_map()) if need_raw else []
    raw_geoms = [valid(shape(ft["geometry"])) for ft in raw]
    raw_tree = STRtree(raw_geoms) if raw_geoms else None

    findings = []
    for cls in sorted(to_run):
        kind, fn = CHECKS[cls]
        print(f"  … {cls}", flush=True)
        if kind == "raw":
            findings += fn(world, raw_geoms, raw_tree)
        elif kind == "world":
            findings += fn(world)
        elif kind == "world+raw":
            findings += fn(world, raw)
        else:
            findings += fn()
    # алиасные классы отфильтровываем обратно по фактическому f["class"]
    findings = [f for f in findings if f["class"] in selected]

    baseline = load_baseline()
    by_class = {}
    for f in findings:
        by_class.setdefault(f["class"], []).append(f)

    if args.update_baseline:
        known = {cls: sorted({f["id"] for f in fs}) for cls, fs in by_class.items()}
        for cls in selected:
            known.setdefault(cls, [])
        BASELINE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(BASELINE_PATH, "w", encoding="utf-8") as f:
            json.dump({
                "_comment": "Известные находки audit_map_geometry.py. "
                            "Новая находка вне этого списка = регрессия "
                            "(ненулевой exit). Обновлять ТОЛЬКО осознанно, "
                            "вместе с записью в docs/DECISIONS.md.",
                "known": known,
            }, f, ensure_ascii=False, indent=2)
        print(f"\nBaseline обновлён: {BASELINE_PATH}")
        for cls in sorted(known):
            print(f"  {cls:16s} {len(known[cls])}")
        return 0

    print("\n" + "=" * 72)
    regressions = []
    for cls in sorted(selected):
        fs = by_class.get(cls, [])
        known = set(baseline.get(cls, []))
        new = [f for f in fs if f["id"] not in known]
        gone = known - {f["id"] for f in fs}
        status = "НОВЫЕ: %d" % len(new) if new else "ok"
        print(f"{cls:16s} найдено {len(fs):5d} | известно {len(known):5d} | {status}"
              + (f" | исчезло {len(gone)}" if gone else ""))
        for f in sorted(new, key=lambda x: -x["value"])[:10]:
            print(f"    [NEW] {f['id']} {f['name']}: {f['detail']}")
        if len(new) > 10:
            print(f"    … и ещё {len(new)-10}")
        regressions += new
    print("=" * 72)

    if regressions:
        print(f"\nПРОВАЛ: {len(regressions)} новых находок вне baseline.")
        print("Либо это регрессия (чинить), либо осознанное изменение — тогда")
        print("`--update-baseline` + датированная запись в docs/DECISIONS.md.")
        return 1
    print("\nOK: новых дефектов геометрии нет.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
