"""
verify_area_matches_geometry.py — свойство `area_km2` обязано быть пересчитано
по геометрии, которая рядом с ним лежит (2026-08-10, T-8).

ЗАЧЕМ. `area_km2` — не украшение: `import_to_game.py` кладёт его в
`regions.core.json.area`, а по площади считается экономика региона. Пишут его
билдеры геодезически (`round(area_km2(g), 1)` через
`Geod(WGS84).geometry_area_perimeter`), и на 2026-08-10 оно сходится у всех
1591 фичи. Но сходится ПО ПОСТРОЕНИЮ, а не потому, что кто-то сторожит: файл
мастера пишут четыре скрипта — `build/freeze_master_map.py` (заморозка) и три
хирургических (`build/fix_dalian_rio_master.py`,
`build/restore_china_curation_master.py`,
`build/apply_field_contract_master.py`), и первые два из хирургических
пересчитывают площадь только потому, что автор об этом помнил. Скрипт, который
подвинет полигон и
забудет строку `props["area_km2"] = round(area_km2(geom), 1)`, сегодня пройдёт
весь пайплайн с кодом 0: `build/audit_map_geometry.py` смотрит на форму
полигонов, `build/verify_derived_freshness.py` — на состав `region_id`,
`verify_geojson_field_contract.py` — на набор полей и знак числа. Ни один из
них не сравнивает ЧИСЛО с ГЕОМЕТРИЕЙ.

ЧТО ЛОВИТ: расхождение заявленной площади с пересчитанной больше допуска —
с именем региона, заявленным и пересчитанным значением. Плюс отсутствие
`area_km2` и нечисловое значение (шаг стоит ДО контракта полей, полагаться на
его проверки не может).

ЧЕГО НЕ ЛОВИТ (называю прямо): верность самой ГЕОМЕТРИИ. Полигон Ватикана
занижен в сорок раз, и `area_km2 = 0.0` — честное округление честного
пересчёта ЭТОГО полигона; здесь он проходит и обязан проходить. Такие случаи
названы поимённо в `KNOWN_ZERO_AREA` в `verify_geojson_field_contract.py`.
Не ловит и копию площади в `regions.core.json`: шаг стоит до импорта и читает
мастер.

ДОПУСК — 0,06 км², АБСОЛЮТНЫЙ. Обоснование замером (2026-08-10, все 1591
фича мастера):

  - билдеры пишут `round(area_km2(g), 1)`, значит честное расхождение не может
    превысить половину шага округления — 0,05 км²;
  - фактический максимум по миру — 0,0500 км² (`AFR-0092 Manyara`: заявлено
    216 042,1, пересчёт 216 042,1500). То есть пересчёт совпадает с тем, что
    считали билдеры, буква в букву: сверх округления не набежало НИЧЕГО;
  - 0,06 = 0,05 + запас на то, что максимум лежит ровно на границе.

ОТНОСИТЕЛЬНОГО СЛАГАЕМОГО НЕТ, и это тоже результат замера, а не вкуса.
Мелкие острова расходятся с геометрией на 1–15% ОТНОСИТЕЛЬНО (`OCE-0003
Coral Sea Islands` 13,2%, `SAM-0055` 4,9%, `ASI-0014 Paracel Islands` 1,7%,
`NAM-0006 Clipperton Island` 1,6%) — но абсолютно все четыре укладываются в
0,0494 км², то есть в то же округление. Абсолютный порог их пропускает сам;
относительный порог им ничего не добавил бы, а вот стоил бы дорого: 0,1% от
`EUR-0300 Sverdlovsk Oblast` — это 195 км² незамеченного сдвига. Порог в форме
`max(абсолютный, относительный)` слепнет тем сильнее, чем крупнее регион, — а
крупные регионы и стоят дороже всего в экономике.

Строки с наибольшим расхождением печатаются КАЖДЫЙ прогон, и в успешном тоже:
«ok» без числа неотличимо от «проверка ничего не считала».

Запуск: python scripts/map/verify_area_matches_geometry.py
        python scripts/map/verify_area_matches_geometry.py --master X
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "build"))

from shapely.geometry import shape  # noqa: E402

# Та же функция, которой площадь ПИШУТ билдеры, — намеренно, а не по лени.
# Проверяемое свойство здесь «число пересчитано после правки полигона», а не
# «формула геодезической площади верна»: своя копия формулы разошлась бы с
# оригиналом при первой же правке и превратила бы гейт в генератор ложных
# срабатываний. Формулу держит pyproj, а не этот файл.
from geometry_cleanup import area_km2  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parents[2]
MASTER_DEFAULT = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"

# Шаг округления, которым билдеры пишут area_km2 (`round(area_km2(g), 1)`).
ROUND_STEP_KM2 = 0.1
# Допуск: половина шага округления + запас (обоснование — в докстроке).
TOLERANCE_KM2 = 0.06

SHOWN_ROWS = 5
MAX_SHOWN_ERRORS = 30


def load(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def measure(features) -> tuple[list[dict], list[str]]:
    """Пересчитывает площадь каждой фичи. Возвращает (строки замера, ошибки
    чтения). Ошибка чтения — отсутствующее или нечисловое `area_km2`: без
    числа сверять нечего, и молчать об этом нельзя."""
    rows: list[dict] = []
    errors: list[str] = []

    for idx, ft in enumerate(features):
        props = ft.get("properties") or {}
        rid = props.get("region_id") or f"фича #{idx}"
        name = props.get("name") or ""
        declared = props.get("area_km2")

        if declared is None:
            errors.append(f"{rid} «{name}»: нет area_km2 — сверять нечего")
            continue
        if isinstance(declared, bool) or not isinstance(declared, (int, float)):
            errors.append(f"{rid} «{name}»: area_km2={declared!r} — не число")
            continue

        actual = area_km2(shape(ft["geometry"]))
        diff = abs(actual - float(declared))
        rows.append({
            "region_id": rid,
            "name": name,
            "declared": float(declared),
            "actual": actual,
            "diff": diff,
            "rel": diff / actual if actual > 0 else 0.0,
        })

    return rows, errors


def check(rows, tolerance: float = TOLERANCE_KM2) -> list[str]:
    """Расхождение больше допуска — ошибка, названная поимённо и с обоими
    числами: без них сообщение не отличает «полигон подвинули» от «свойство
    испортили»."""
    errors: list[str] = []
    for row in sorted(rows, key=lambda r: -r["diff"]):
        if row["diff"] > tolerance:
            errors.append(
                f"{row['region_id']} «{row['name']}»: заявлено "
                f"{row['declared']:,.4f} км², пересчёт {row['actual']:,.4f} км², "
                f"расхождение {row['diff']:,.4f} км² ({row['rel'] * 100:.4f}%) "
                f"при допуске {tolerance} км²")
    return errors


def report(rows, tolerance: float = TOLERANCE_KM2) -> None:
    """Максимум печатается всегда. «OK» без числа неотличимо от проверки,
    которая ничего не посчитала. Допуск печатается ФАКТИЧЕСКИЙ, а не константа
    по умолчанию: с `--tolerance` шапка иначе врёт про то, чем мерили."""
    if not rows:
        print("  сверено 0 фич — читать было нечего")
        return

    worst_abs = max(rows, key=lambda r: r["diff"])
    worst_rel = max(rows, key=lambda r: r["rel"])
    why = (f" (половина шага округления {ROUND_STEP_KM2} + запас)"
           if tolerance == TOLERANCE_KM2 else " (задан вручную --tolerance)")
    print(f"  сверено фич: {len(rows)}; допуск {tolerance} км²{why}")
    print(f"  максимум АБСОЛЮТНЫЙ: {worst_abs['diff']:.4f} км² — "
          f"{worst_abs['region_id']} «{worst_abs['name']}» "
          f"(заявлено {worst_abs['declared']:,.1f}, пересчёт {worst_abs['actual']:,.4f})")
    print(f"  максимум ОТНОСИТЕЛЬНЫЙ: {worst_rel['rel'] * 100:.4f}% — "
          f"{worst_rel['region_id']} «{worst_rel['name']}» "
          f"(заявлено {worst_rel['declared']:,.4f}, пересчёт {worst_rel['actual']:,.4f}, "
          f"расхождение {worst_rel['diff']:.4f} км²)")

    # Относительные лидеры — это мелкие острова, у которых 0,1 км² округления
    # составляют проценты. Они печатаются строками, а не описываются словами:
    # иначе «допуск их пропускает» — утверждение, которое нечем проверить.
    print(f"  наибольшие ОТНОСИТЕЛЬНЫЕ расхождения (округление у мелких фич):")
    for row in sorted(rows, key=lambda r: -r["rel"])[:SHOWN_ROWS]:
        print(f"    {row['region_id']:9} «{row['name'] or '—'}»: заявлено "
              f"{row['declared']:>10,.4f}, пересчёт {row['actual']:>10,.4f}, "
              f"расхождение {row['diff']:.4f} км² ({row['rel'] * 100:.2f}%)")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--master", default=str(MASTER_DEFAULT))
    ap.add_argument("--tolerance", type=float, default=TOLERANCE_KM2,
                    help="допуск в км² (по умолчанию %(default)s)")
    args = ap.parse_args()

    features = load(Path(args.master))["features"]
    rows, errors = measure(features)
    report(rows, args.tolerance)
    errors += check(rows, args.tolerance)

    if not errors:
        print("OK: area_km2 сходится с геометрией у всех фич мастера")
        return 0

    # Замер уже напечатан в stdout; без явного сброса он в логе пайплайна
    # оказывается ПОСЛЕ списка ошибок из stderr, и падение читается задом наперёд.
    sys.stdout.flush()
    print(f"\n  ПЛОЩАДЬ РАЗОШЛАСЬ С ГЕОМЕТРИЕЙ: {len(errors)}", file=sys.stderr)
    for line in errors[:MAX_SHOWN_ERRORS]:
        print(f"    {line}", file=sys.stderr)
    if len(errors) > MAX_SHOWN_ERRORS:
        print(f"    … ещё {len(errors) - MAX_SHOWN_ERRORS}", file=sys.stderr)
    print("\n  Скрипт, меняющий геометрию мастера, обязан в том же проходе\n"
          "  переписать area_km2: props['area_km2'] = round(area_km2(geom), 1).\n"
          "  Если разошлась не площадь, а полигон — чинится полигон, а число\n"
          "  пересчитывается по нему, не наоборот.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
