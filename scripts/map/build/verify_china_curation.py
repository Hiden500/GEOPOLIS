r"""
verify_china_curation.py — приёмка: карта не разошлась с кураторским Китаем.

ЗАЧЕМ ЭТОТ ШАГ СУЩЕСТВУЕТ. Курация Китая от 2026-07-23 (Далянь, Циндао,
Nenjiang — реальные исторические границы вместо county-пилы) была снесена
пересборкой `628a3bd` 2026-07-27 МОЛЧА. Численный аудит геометрии
(`build/audit_map_geometry.py`) на этом дефекте был ЗЕЛЁНЫМ во всех двенадцати
классах: регионы остались валидными, связными, без дыр и ложных берегов — у
них просто стала другая, некурированная нарезка. Дефект прожил одиннадцать
дней и нашёлся глазами.

Корень в том, что `build_china_1946_v2.py` не входит в `STANDARD_STEPS`: его
внешний вход (историческая оцифровка Virtual Shanghai) отсутствует, запуск
затёр бы собственный выход, и это осознанный выбор. Значит курация живёт
ТОЛЬКО в мастере — и любая правка, трогающая китайскую геометрию, способна её
снести, ничего не сломав формально.

Задача шага — не пересобрать Китай, а СДЕЛАТЬ РАСХОЖДЕНИЕ ВИДИМЫМ: сверить все
47 китайских фич карты с эталоном `out/china_1946_historical.json` и упасть,
назвав регионы. Стоит в `STANDARD_STEPS` рядом с `build/audit_map_geometry.py`
и до `import_to_game.py` — по тому же принципу: приёмка геометрии раньше
импорта в игру.

ЧЕМ СВЕРЯЕТ. Площадью по `pyproj.Geod` (не по свойству `area_km2`: оно
записано в файл и разошлось бы вместе с геометрией) и числом связных частей.
Площадь — грубая мера, и это здесь достоинство: она не реагирует на
переоцифровку в пределах метров, но ловит перенос кусков между регионами,
которым и был регресс (115,5 / 18 610 / 9 639 / 4 238 / 4 234 / 498 км²).

ALLOWLIST — не «список исключений», а список ЗАЯВЛЕННЫХ расхождений с
объяснением и ПОТОЛКОМ. Расхождение сверх потолка роняет прогон даже для
региона из списка: иначе запись однажды перестала бы что-либо проверять.

ЧЕГО ЭТОТ ШАГ НЕ ДЕЛАЕТ. Он не сверяет геометрию покоординатно и не заметит
подмену формы региона с сохранением площади. Мастер уже защищён от этого
`freeze_master_map.py --verify` и `audit_map_geometry.py`; здесь проверяется
ровно одно свойство — состав кураторской нарезки.

Запуск:
    python scripts/map/build/verify_china_curation.py
    python scripts/map/build/verify_china_curation.py --world <снимок>

Негативный контроль (обязателен при правке порогов или allowlist):
    git show 628a3bd:client/public/world_1946.geojson > /tmp/w.geojson
    python scripts/map/build/verify_china_curation.py --world /tmp/w.geojson
падает и называет Qingdao, Shandong и пять маньчжурских регионов.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from geometry_cleanup import area_km2  # noqa: E402
from shapely.geometry import shape  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER_PATH = MAP_DIR / "master" / "world_1946.master.geojson"
OUT_WORLD = MAP_DIR / "out" / "world_1946.geojson"
CHINA_REF = MAP_DIR / "out" / "china_1946_historical.json"

# Расхождение площади, которое ещё считается той же нарезкой. Регресс 27.07
# давал 115,5 км² на самом мелком из задетых регионов — запас в 380 раз.
# Снизу порог упирается в шум переоцифровки: на нетронутых регионах он
# доходит до 0,16 км² (Yunnan, замер 2026-08-08), поэтому не ниже 0,3 —
# иначе шаг начнёт падать на регионах, которых никто не трогал.
TOL_AREA_KM2 = 0.3

# Заявленные расхождения: регион -> (потолок в км², почему).
ALLOWLIST = {
    "Gansu": (
        25.0,
        "−18,5 км² от другого события (не 628a3bd); граница с Ningxia/Shaanxi. "
        "Найдено 2026-08-08, отдельная задача — правка Ганьсу не согласована.",
    ),
    "Xinjiang": (
        5.0,
        "+1,6 км² от того же события, что Ганьсу. Отдельная задача.",
    ),
    "Songjiang": (
        1.0,
        "+0,4 км²: стык Songjiang/Heilongjiang/Hejiang взят из МАСТЕРА, а не из "
        "эталона — эталонный стык лежит на 0,0037° в стороне, и перенос его "
        "сдвинул бы границу Hejiang, регион вне согласованного scope "
        "(build/restore_china_curation_master.py, 2026-08-08).",
    ),
    "Heilongjiang": (
        1.0,
        "−0,4 км², обратная сторона того же стыка, что у Songjiang.",
    ),
}

# Части эталона меньше этого — вырожденные артефакты его оцифровки (эталонный
# Songjiang несёт «часть» 0,001 км² посреди Heilongjiang), а не эксклавы. В
# мастере их нет намеренно: они дали бы соседу внутреннее кольцо.
SPECK_KM2 = 0.01


def parts_of(geom):
    if geom.is_empty:
        return []
    return list(geom.geoms) if geom.geom_type.startswith("Multi") else [geom]


def real_parts(geom):
    return [p for p in parts_of(geom) if area_km2(p) >= SPECK_KM2]


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def key_of(name):
    """Ключ сопоставления — имя без пояснения в скобках.

    Дословное имя для этого не годится: в снимке 628a3bd регион зовётся
    `Dalian`, а сейчас — `Dalian (Port Arthur / Kwantung Leased Territory)`.
    Негативный контроль тогда падал бы на переименовании, а не на геометрии,
    то есть проверял бы не то, что заявляет."""
    return name.split(" (")[0].strip()


def china_features(features, label):
    """Китайские фичи по ключу имени. `iso_a2` есть и в мастере, и в клиентском
    экспорте, а `region_type`/`type` у них разные — поэтому фильтр по iso_a2.
    Сопоставление по имени, а не по `region_id`: id позиционен и в
    историческом снимке мог означать другой регион."""
    by_key = {}
    for ft in features:
        p = ft["properties"]
        if p.get("iso_a2") != "CN":
            continue
        key = key_of(p.get("name", ""))
        if key in by_key:
            raise SystemExit(f"ОТКАЗ: в {label} две китайские фичи с ключом "
                             f"«{key}» — сопоставление по имени невозможно")
        by_key[key] = ft
    return by_key


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--world", default=None,
                    help="путь к world geojson (по умолчанию мастер, иначе "
                         "out/world_1946.geojson); нужен для негативного "
                         "контроля на историческом снимке")
    args = ap.parse_args()

    world_path = args.world or (MASTER_PATH if MASTER_PATH.exists() else OUT_WORLD)
    print(f"  геометрия: {Path(world_path).name}")
    print(f"  эталон:    {CHINA_REF.name}")

    world = china_features(load_features(world_path), Path(world_path).name)
    ref = china_features(load_features(CHINA_REF), CHINA_REF.name)

    missing = sorted(set(ref) - set(world))
    extra = sorted(set(world) - set(ref))
    if missing or extra:
        print("\n  ОТКАЗ: состав китайских регионов разошёлся с эталоном.")
        if missing:
            print(f"    нет в карте:  {', '.join(missing)}")
        if extra:
            print(f"    нет в эталоне: {', '.join(extra)}")
        return 1

    problems, allowed = [], []
    for name in sorted(ref):
        got = shape(world[name]["geometry"])
        want = shape(ref[name]["geometry"])
        d = area_km2(got) - area_km2(want)
        dp = len(parts_of(got)) - len(real_parts(want))
        if abs(d) <= TOL_AREA_KM2 and dp == 0:
            continue
        limit, why = ALLOWLIST.get(name, (None, None))
        row = (name, area_km2(got), area_km2(want), d,
               len(parts_of(got)), len(real_parts(want)))
        if limit is not None and abs(d) <= limit and dp == 0:
            allowed.append((row, why))
        else:
            problems.append((row, why, limit))

    if allowed:
        print(f"\n  заявленные расхождения ({len(allowed)}):")
        for (name, got, want, d, np_, nw), why in allowed:
            print(f"    {name:14} {got:12.1f} км² против {want:12.1f} "
                  f"({d:+8.3f}) — {why}")

    print(f"\n  сверено фич: {len(ref)}, расхождений вне заявленных: "
          f"{len(problems)}")
    if not problems:
        print("\nOK: кураторская нарезка Китая на месте.")
        return 0

    print("\n  ПРОВАЛ: китайская нарезка разошлась с эталоном "
          f"{CHINA_REF.name}:")
    for (name, got, want, d, np_, nw), why, limit in problems:
        note = ""
        if limit is not None:
            note = (f"  [заявлено ≤{limit} км²: {why}]" if abs(d) > limit
                    else f"  [заявлено, но разошлось число частей]")
        print(f"    {name:14} {got:12.1f} км² / {np_} частей   против эталона "
              f"{want:12.1f} / {nw}   дельта {d:+.3f} км²{note}")
    print("\n  Это НЕ повод обновить эталон. Эталон — выход "
          "build_china_1946_v2.py, где курация 2026-07-23 зафиксирована; "
          "разошлась карта.")
    print("  Вернуть: python scripts/map/build/restore_china_curation_master.py")
    print("  Если расхождение осознанное — запись в ALLOWLIST этого файла "
          "с потолком и причиной плюс датированная запись в docs/DECISIONS.md.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
