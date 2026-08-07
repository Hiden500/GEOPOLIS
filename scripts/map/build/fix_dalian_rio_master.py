"""
fix_dalian_rio_master.py — хирургическая правка мастер-карты: два дефекта
геометрии, которые нельзя починить пересборкой (2026-08-07).

ПОЧЕМУ ХИРУРГИЯ, А НЕ ПЕРЕСБОРКА. Замер 2026-08-02: 8 из 10 входов пайплайна
отсутствуют в `scripts/map/sources/` (каталог в .gitignore по конвенции
«внешние тяжёлые входы вне git»), `make_1946.py --rebuild-master` сегодня
невозможен — `build_brazil_1946.py` падает с FileNotFoundError на первой же
строке чтения муниципий. Геометрия при этом не потеряна: мастер под git.
Потеряна воспроизводимость, поэтому обе правки делаются по мастеру напрямую,
а этот скрипт существует, чтобы правка осталась воспроизводимой и ревьюируемой.

ДЕФЕКТ 1: Далянь потерял 1 424,2 км² при топологической пересборке.
`rebuild_shared_edges.py` (коммит a9530ea) нодирует границы всех слоёв,
полигонизует и раздаёт каждую ячейку фиче, содержащей её representative point.
Далянь ушёл с 4 частей / 3 540,7 км² до 1 части / 2 116,6 км², а Ляонин
прибавил ровно столько же (55 984,0 -> 57 408,2) и вырос с 4 частей до 21.
Совпадение точное — это перенос, не потеря. Из 1 424,2 км² только 271,7 —
острова; крупнейший кусок 1 152,5 км² — срез суши Ляодунского полуострова,
сваренный с материковой частью Ляонина, то есть сдвинулась и сухопутная
граница.

Эталон — `out/china_1946_historical.json`, живой промежуточный выход
`build_china_1946_v2.py`: там Далянь 3 540,7 и Ляонин 55 984,0, те же числа,
что в снимке клиента коммита 0946506. Источник same-provenance, а не графт.

Переносится геометрия САМОГО МАСТЕРА, а не эталона, и переносится ПО ЧАСТЯМ:

  - 17 частей Ляонина лежат внутри эталонного Даляня целиком — они переезжают
    verbatim, координата в координату;
  - одна часть (материк, 56 975 км²) пересекает границу — только она режется,
    причём резать можно исключительно ВНУТРИ суши.

Прямолинейное `Ляонин ∩ эталон` этого различия не делает и потому НЕ ГОДИТСЯ
(замер 2026-08-07): пересечение подрезает островам БЕРЕГОВУЮ линию по чужой
оцифровке, и мастер перестаёт проходить собственный гейт —
`coverage_is_valid: False`, 0,10722428° несовпадающих рёбер между `ASI-0042`
и `SEA-0055` (Жёлтое море). Числа площадей при этом сходятся идеально, то есть
по площадям дефект невидим.

ДЕФЕКТ 2: столица Бразилии 1946 года окружена рвом.
`build_brazil_1946.py` режет штат как `modern["Rio de Janeiro"].difference(
rj_city_geom.buffer(0.01))`. Буфер оставляет между городом (SAM-0013) и штатом
(SAM-0014) ров шириной 0,00997° ≈ 1,11 км, занятый морем SEA-0096, — у
федерального округа ноль сухопутных соседей.

ВАЖНО ПРО ШИРИНУ ВОЗВРАТА (замер 2026-08-07, решение пользователя того же дня).
Наивное «кольцо города ∩ море» даёт 217,0 км², но это НЕ ров: 130 из них —
открытая Атлантика перед побережьем города. Отдав их штату, получаем границу
город↔штат длиной 1,90069° и границу город↔море длиной РОВНО НОЛЬ, то есть
портовая столица Бразилии становится сухопутной. Билдер срезал сушу (вычитание
идёт из современного штата), моря он не трогал — возвращать надо только сушу.

КАК ОТДЕЛЯЕТСЯ РОВ ОТ ОКЕАНА (три подхода забракованы замером, см. ниже).
Признак рва — не расстояние и не ширина, а СЛЕД САМОГО БУФЕРА: в сегменте рва
граница штата равноудалена от города ровно на 0,01° (замер: среднее 0,01000,
стандартное отклонение 0,00003), потому что там граница штата — это и есть
дуга `buffer(0.01)`. У настоящего берега расстояние гуляет.

Забраковано замером, чтобы не пробовали заново:
  - `кольцо ∩ буфер штата` — режет коридор ВДОЛЬ границы города и оставляет
    волосяные щели: `coverage_is_valid` падает (0,0657° плохих рёбер у города),
    а разрез отсекает 7 осколков моря общей площадью 2,65 км²;
  - `set_precision` поверх этого — рвёт общие рёбра ещё сильнее, граница
    город↔море обнуляется;
  - морфологическое замыкание суши — перестраивает всю границу буфером, те же
    несовпадающие рёбра плюс залитые устья настоящих бухт.
Работает только разрез ПОПЕРЁК канала, причём кончаться он обязан в
СУЩЕСТВУЮЩЕЙ вершине границы города: разрез, оканчивающийся в интерполированной
точке, добавляет вершину, которой у города нет, и гейт справедливо считает
ребро несовпадающим.

Поэтому: коридор нодируется вместе с поперечными отрезами и полигонизуется
(идиома `absorb_slivers`), ячейки классифицируются по следу буфера, ров
отдаётся штату. Все рёбра вдоль города и штата берутся из карты verbatim,
новыми являются только поперечные отрезы — и они одинаковы у обеих сторон
разреза.

Классификация НАМЕРЕННО КОНСЕРВАТИВНА: ячейка, у которой ребро со штатом
короче половины ребра с городом, отбрасывается, даже если след буфера
идеальный. Из 0,66572° дуг карве возвращается 0,62083°; оставшиеся ~0,045°
(участок в бухте Гуанабара, ячейка 5,8 км²) остаются водой. Цена ошибки
несимметрична: не дочинить участок рва — косметика, отдать штату настоящую
воду бухты — новый дефект поверх исправленного.

Скрипт идемпотентен по построению: после первого прогона `Ляонин ∩ эталонный
Далянь` пусто, а у коридора не остаётся дуг со следом буфера.

Запуск:
    python scripts/map/build/fix_dalian_rio_master.py --dry-run
    python scripts/map/build/fix_dalian_rio_master.py
Затем обязательно:
    python scripts/map/build/freeze_master_map.py --verify
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import shapely  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import LineString, MultiLineString, mapping, shape  # noqa: E402
from shapely.ops import linemerge, polygonize, unary_union  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER_PATH = MAP_DIR / "master" / "world_1946.master.geojson"
CHINA_REF = MAP_DIR / "out" / "china_1946_historical.json"

DALIAN = "ASI-0042"
LIAONING = "ASI-0027"
YELLOW_SEA = "SEA-0055"
# Часть Ляонина, лежащая в эталонном Даляне на столько и больше, переносится
# целиком: резать её нельзя, иначе подрежется береговая линия.
WHOLE_PART_FRACTION = 0.99
RIO_CITY = "SAM-0013"
RIO_STATE = "SAM-0014"
RIO_SEA = "SEA-0096"

# Буфер, которым build_brazil_1946.py прорезал ров. Коридор берём на 10% шире,
# чтобы захватить ров целиком с запасом на округление (фактическая ширина рва
# 0,00997°).
BUILDER_BUFFER_DEG = 0.01
CORRIDOR_DEG = BUILDER_BUFFER_DEG * 1.1
# Допуски классификации «след буфера»: ребро со штатом равноудалено от города.
MOAT_MEAN_TOL = 0.001
MOAT_STD_TOL = 0.0005
# Ячейка с коротким ребром со штатом — открытая вода, а не ров (см. докстринг).
MOAT_MIN_STATE_SHARE = 0.5


def polygons_only(geom):
    """Пересечения дают GeometryCollection с линиями и точками на общих
    рёбрах — в геометрию региона годятся только полигоны."""
    if geom.is_empty:
        return geom
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    parts = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(parts) if parts else geom


def n_parts(geom):
    return len(_parts(geom))


def describe(label, geom):
    print(f"    {label}: {area_km2(geom):.1f} км², частей {n_parts(geom)}, "
          f"валидна {geom.is_valid}")


def load_reference_dalian():
    with open(CHINA_REF, encoding="utf-8") as f:
        fc = json.load(f)
    for ft in fc["features"]:
        if ft["properties"].get("name", "").startswith("Dalian"):
            return shape(ft["geometry"])
    raise SystemExit(f"в {CHINA_REF} нет фичи Dalian — эталон недоступен")


def snap_chain_ends(chain, vertices):
    """Концы разреза сажаются на существующие вершины границы куска: разрез,
    оканчивающийся в интерполированной точке, добавил бы соседу-морю вершину,
    которой у него нет, и общее ребро перестало бы совпадать."""
    coords = list(chain.coords)
    for idx in (0, -1):
        d = np.hypot(vertices[:, 0] - coords[idx][0], vertices[:, 1] - coords[idx][1])
        coords[idx] = tuple(vertices[int(d.argmin())])
    return LineString(coords)


def split_liaoning_parts(liaoning, ref):
    """Части Ляонина -> (что уходит Даляню, что остаётся). Целые части
    переносятся verbatim, пересекающая границу режется внутри суши."""
    to_dalian, to_liaoning = [], []
    for part in _parts(liaoning):
        inside = part.intersection(ref)
        part_area = area_km2(part)
        frac = area_km2(inside) / part_area if part_area > 0 else 0.0
        if frac > WHOLE_PART_FRACTION:
            to_dalian.append(part)          # остров целиком — берег не трогаем
            continue
        if area_km2(inside) < 0.001:
            to_liaoning.append(part)
            continue

        vertices = np.array([c for g in _parts(part.boundary) for c in g.coords])
        chains = [g for g in _parts(ref.boundary.intersection(part))
                  if g.geom_type == "LineString" and g.length > 1e-9]
        merged = [g for g in _parts(linemerge(MultiLineString(chains)))
                  if g.geom_type == "LineString"] if chains else []
        cuts = [snap_chain_ends(c, vertices) for c in merged if c.length > 1e-6]
        cells = [c for c in polygonize(unary_union([part.boundary] + cuts))
                 if part.contains(c.representative_point())]
        print(f"    режется часть {part_area:.1f} км²: цепей {len(cuts)}, "
              f"ячеек {len(cells)}")
        for cell in cells:
            if area_km2(cell) < 1e-6:
                continue
            (to_dalian if ref.contains(cell.representative_point())
             else to_liaoning).append(cell)
    return to_dalian, to_liaoning


def fix_dalian(by_rid):
    print("  [1] Далянь: возврат кусков из Ляонина")
    dalian = shape(by_rid[DALIAN]["geometry"])
    liaoning = shape(by_rid[LIAONING]["geometry"])
    ref = load_reference_dalian()
    describe("Далянь до", dalian)
    describe("Ляонин до", liaoning)

    to_dalian, to_liaoning = split_liaoning_parts(liaoning, ref)
    moved_area = sum(area_km2(g) for g in to_dalian)
    if moved_area < 0.001:
        print("    переносить нечего — правка уже применена")
        return None
    print(f"    переносится {moved_area:.1f} км² в {len(to_dalian)} кусках")

    new_dalian = unary_union([dalian] + to_dalian)
    new_liaoning = unary_union(to_liaoning)
    describe("Далянь после", new_dalian)
    describe("Ляонин после", new_liaoning)

    before = area_km2(dalian) + area_km2(liaoning)
    after = area_km2(new_dalian) + area_km2(new_liaoning)
    print(f"    сумма суши: было {before:.3f}, стало {after:.3f}, "
          f"дельта {after - before:+.6f} км²")
    overlap = area_km2(new_dalian.intersection(new_liaoning))
    print(f"    перекрытие Далянь∩Ляонин: {overlap:.9f} км²")

    # Жёлтое море — сосед по всей береговой линии Даляня. Прямолинейное
    # `Ляонин ∩ эталон` ломало общие рёбра именно с ним, а по площадям это
    # было не видно.
    sea = shape(by_rid[YELLOW_SEA]["geometry"])
    before_ok = shapely.coverage_is_valid(
        np.array([dalian, liaoning, sea], dtype=object), gap_width=0.0)
    after_ok = shapely.coverage_is_valid(
        np.array([new_dalian, new_liaoning, sea], dtype=object), gap_width=0.0)
    print(f"    coverage_is_valid(Далянь,Ляонин,Жёлтое море): было {before_ok}, "
          f"стало {after_ok}")

    if abs(after - before) > 0.01 or overlap > 1e-6:
        raise SystemExit("ОТКАЗ: перенос не сохранил площадь или дал перекрытие")
    if before_ok and not after_ok:
        raise SystemExit("ОТКАЗ: общие рёбра с Жёлтым морем перестали совпадать")
    return {DALIAN: new_dalian, LIAONING: new_liaoning}


def extract_moat(city, state, sea):
    """Ров: ячейки коридора вдоль города, чьё внешнее ребро — след buffer(0.01).

    Коридор режется ПОПЕРЁК в устье каждой дуги «коридор↔штат». Отрез идёт из
    конца дуги в БЛИЖАЙШУЮ СУЩЕСТВУЮЩУЮ вершину границы города — иначе разрез
    добавил бы городу вершину, которой у него нет, и общее ребро перестало бы
    совпадать (гейт `coverage_is_valid`).
    """
    corridor = polygons_only(sea.intersection(city.buffer(CORRIDOR_DEG)))
    if corridor.is_empty:
        return None

    city_vertices = []
    for pl in _parts(city):
        for ring in [pl.exterior, *pl.interiors]:
            city_vertices.extend(ring.coords)
    city_vertices = np.array(city_vertices)

    raw_chains = [g for g in _parts(corridor.boundary.intersection(state.boundary))
                  if g.geom_type == "LineString"]
    if not raw_chains:
        return None
    chains = [g for g in _parts(linemerge(MultiLineString(raw_chains)))
              if g.geom_type == "LineString"]
    print(f"    дуг коридор↔штат: {len(chains)}, суммарно "
          f"{sum(c.length for c in chains):.5f}°")

    cuts = []
    for c in chains:
        for pt in (c.coords[0], c.coords[-1]):
            d = np.hypot(city_vertices[:, 0] - pt[0], city_vertices[:, 1] - pt[1])
            seg = LineString([pt, tuple(city_vertices[int(d.argmin())])])
            if seg.length > 1e-12:
                cuts.append(seg)

    raw_cells = list(polygonize(unary_union([corridor.boundary] + cuts)))
    # polygonize заливает и дырку кольца (сам город) — берём только коридор
    cells = [c for c in raw_cells if corridor.contains(c.representative_point())]

    keep = []
    for cell in sorted(cells, key=area_km2, reverse=True):
        edge = cell.boundary.intersection(state.boundary)
        len_state = edge.length
        len_city = cell.boundary.intersection(city.boundary).length
        lines = [g for g in _parts(edge) if g.geom_type == "LineString" and g.length > 1e-9]
        if not lines or len_city < 1e-9:
            verdict, mean, std = False, None, None
        else:
            pts = []
            for ln in lines:
                n = max(3, int(ln.length / 0.0005))
                pts += [ln.interpolate(t, normalized=True) for t in np.linspace(0, 1, n)]
            d = np.array([p.distance(city) for p in pts])
            mean, std = float(d.mean()), float(d.std())
            verdict = (abs(mean - BUILDER_BUFFER_DEG) < MOAT_MEAN_TOL
                       and std < MOAT_STD_TOL
                       and len_state >= MOAT_MIN_STATE_SHARE * len_city)
        shown = f"{mean:.5f}±{std:.5f}" if mean is not None else "—"
        print(f"      ячейка {area_km2(cell):8.3f} км²  штат {len_state:.5f}° "
              f"город {len_city:.5f}°  расст {shown:>16}  "
              f"{'РОВ' if verdict else 'вода'}")
        if verdict:
            keep.append(cell)
    return unary_union(keep) if keep else None


def _parts(geom):
    if geom.is_empty:
        return []
    return list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]


def fix_rio(by_rid):
    print("  [2] Рио: ров между городом и штатом возвращается штату")
    city = shape(by_rid[RIO_CITY]["geometry"])
    state = shape(by_rid[RIO_STATE]["geometry"])
    sea = shape(by_rid[RIO_SEA]["geometry"])
    describe("город до", city)
    describe("штат до", state)
    print(f"    расстояние город↔штат: {city.distance(state):.8f}°, "
          f"общая граница {city.boundary.intersection(state.boundary).length:.5f}°")
    print(f"    общая граница город↔море: "
          f"{city.boundary.intersection(sea.boundary).length:.5f}°")

    moat = extract_moat(city, state, sea)
    if moat is None or moat.is_empty:
        print("    рва нет — правка уже применена")
        return None
    describe("ров", moat)

    new_state = unary_union([state, moat])
    new_sea = sea.difference(moat)
    describe("штат после", new_state)
    describe("море после", new_sea)

    print(f"    touches(город, штат): {city.touches(new_state)}, "
          f"расстояние {city.distance(new_state):.9f}°")
    print(f"    общая граница город↔штат: "
          f"{city.boundary.intersection(new_state.boundary).length:.5f}°")
    print(f"    общая граница город↔море: "
          f"{city.boundary.intersection(new_sea.boundary).length:.5f}°")
    print(f"    перекрытие город∩штат: {area_km2(city.intersection(new_state)):.9f} км²")
    print(f"    перекрытие штат∩море:  {area_km2(new_state.intersection(new_sea)):.9f} км²")

    covered_before = area_km2(unary_union([city, state, sea]))
    covered_after = area_km2(unary_union([city, new_state, new_sea]))
    print(f"    покрытие город+штат+море: было {covered_before:.1f}, "
          f"стало {covered_after:.1f}, дельта {covered_after - covered_before:+.3f} км²")

    # Общие рёбра тройки — тот же критерий, что гейт мастера применяет ко всем
    # 1577 фичам. Три забракованных подхода валились именно здесь.
    before_ok = shapely.coverage_is_valid(np.array([city, state, sea], dtype=object),
                                          gap_width=0.0)
    after_ok = shapely.coverage_is_valid(np.array([city, new_state, new_sea], dtype=object),
                                         gap_width=0.0)
    print(f"    coverage_is_valid(город,штат,море): было {before_ok}, стало {after_ok}")

    if not city.touches(new_state):
        raise SystemExit("ОТКАЗ: город так и не касается штата")
    if before_ok and not after_ok:
        raise SystemExit("ОТКАЗ: общие рёбра тройки перестали совпадать")
    if abs(covered_after - covered_before) > 0.01:
        raise SystemExit("ОТКАЗ: изменилось суммарное покрытие — появилась дыра или нахлёст")
    return {RIO_STATE: new_state, RIO_SEA: new_sea}


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true",
                    help="посчитать и напечатать, ничего не записывать")
    args = ap.parse_args()

    with open(MASTER_PATH, encoding="utf-8") as f:
        data = json.load(f)
    by_rid = {ft["properties"]["region_id"]: ft for ft in data["features"]}

    updates = {}
    for fix in (fix_dalian, fix_rio):
        result = fix(by_rid)
        if result:
            updates.update(result)

    if not updates:
        print("  изменений нет")
        return 0

    if args.dry_run:
        print("\n  --dry-run: мастер не тронут")
        return 0

    for rid, geom in updates.items():
        if not geom.is_valid:
            raise SystemExit(f"ОТКАЗ: {rid} получил невалидную геометрию")
        by_rid[rid]["geometry"] = mapping(geom)
        by_rid[rid]["properties"]["area_km2"] = round(area_km2(geom), 1)

    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"\n  мастер перезаписан: {MASTER_PATH}")
    print("  дальше: python scripts/map/build/freeze_master_map.py --verify")
    return 0


if __name__ == "__main__":
    sys.exit(main())
