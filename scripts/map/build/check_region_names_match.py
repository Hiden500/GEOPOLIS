"""
check_region_names_match.py — имя региона в игре обязано совпадать с именем
полигона в мастере.

ЗАЧЕМ. `import_to_game.py` берёт имя НЕ из мастера, а из `out/names_ru.json`
по `region_id`, и падает на мастер только если записи нет вовсе. Значит любой
сдвиг позиционного файла проявляется как чужое имя на живой карте — и ничем
не ловится: тип верный, регион существует, имя осмысленное. Так и случилось:
на 2026-08-08 полигон в Берлине (центроид 13,57 / 52,48) назывался в игре
«Kiel Canal Zone», а сам Кильский канал (9,65 / 54,11) — «Baden +
Württemberg-Hohenzollern», и это пролежало незамеченным.

ЧТО СЧИТАЕТСЯ СОВПАДЕНИЕМ. Игровое имя проходит через `region_name()`:
снимаются шумовые скобочные хвосты («Burgas (5)» -> «Burgas») и применяются
плоские переопределения из `config/region_name_overrides.json`. Проверка
повторяет ровно это преобразование, поэтому расхождение означает именно
рассинхрон, а не нормальную чистку имени.

НЕГАТИВНЫЙ КОНТРОЛЬ. Скрипт умеет работать по ЛЮБОЙ паре мастер/имена
(`--master`, `--names`, `--overrides`), чтобы проверку можно было прогнать на
историческом снимке и увидеть, что она там ПАДАЕТ. Проверка, не показанная
падающей, покрытием не считается.

Запуск:
    python scripts/map/build/check_region_names_match.py
    python scripts/map/build/check_region_names_match.py \
        --master <старый> --names <старый> --overrides <старый>
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import REPO_ROOT  # noqa: E402
import import_to_game  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
NAMES_EN = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "names.en.json"
OVERRIDES = REPO_ROOT / "scripts" / "map" / "config" / "region_name_overrides.json"


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--master", default=str(MASTER))
    ap.add_argument("--names", default=str(NAMES_EN))
    ap.add_argument("--overrides", default=str(OVERRIDES))
    args = ap.parse_args()

    world = json.loads(Path(args.master).read_text(encoding="utf-8"))
    names = json.loads(Path(args.names).read_text(encoding="utf-8"))
    ov = json.loads(Path(args.overrides).read_text(encoding="utf-8")).get("overrides", {})
    # подменяем кэш переопределений, чтобы region_name() работал по ТОМУ файлу,
    # который проверяем, а не по текущему состоянию репозитория
    import_to_game._NAME_OVERRIDES = ov

    checked = stripped = 0
    bad = []
    for ft in world["features"]:
        p = ft["properties"]
        if p.get("region_type") != "land":
            continue
        rid = p["region_id"]
        if rid not in names:
            continue
        raw = p.get("name", "")
        expected = import_to_game.region_name(rid, raw, "en")
        checked += 1
        if expected != raw:
            stripped += 1
        if names[rid] != expected:
            bad.append((rid, raw, expected, names[rid]))

    print(f"мастер: {Path(args.master).name}")
    print(f"имена:  {Path(args.names).name}")
    print(f"сверено регионов: {checked}; имя очищено/переопределено: {stripped}")
    if not bad:
        print("OK: имя в игре совпадает с именем полигона у всех регионов.")
        return 0
    print(f"\nРАСХОЖДЕНИЙ: {len(bad)}")
    for rid, raw, expected, got in bad[:40]:
        print(f"   {rid}: в мастере «{raw}» -> ожидалось «{expected}», "
              f"в игре «{got}»")
    if len(bad) > 40:
        print(f"   … и ещё {len(bad) - 40}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
