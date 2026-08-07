"""Проверка имён морских зон.

Свойство, которое held: каждое имя зоны подтверждается источником со свободной
лицензией, и ни одно не является собственной конструкцией чужой локализации.

Негативный контроль — не отдельная фикстура, а тот же прогон на ИСХОДНЫХ
файлах: `python check_zone_names.py --raw` обязан упасть. Проверка, не
показанная падающей, покрытием не считается.

    python check_zone_names.py        # проверяет zones_*.named.geojson
    python check_zone_names.py --raw  # проверяет zones_*.geojson (ожидается FAIL)
"""

from __future__ import annotations

import glob
import json
import os
import sys

from rename_zones import HERE, load_free_names, load_forbidden, norm

FORBIDDEN_SUBSTRINGS = ("world ablaze", "hoi4", "hearts of iron")


def check(raw: bool) -> int:
    pattern = "zones_*.geojson" if raw else "zones_*.named.geojson"
    files = sorted(glob.glob(os.path.join(HERE, pattern)))
    if raw:
        files = [f for f in files if not f.endswith(".named.geojson")]
    if not files:
        print(f"НЕТ входных файлов по маске {pattern}")
        return 1

    free_norm = {norm(x) for x in load_free_names()}
    forbidden_norm = {norm(x) for x in load_forbidden(free_norm)}

    names: list[str] = []
    sources: list[str] = []
    for path in files:
        for ft in json.load(open(path, encoding="utf-8"))["features"]:
            names.append(ft["properties"].get("name") or "")
            sources.append(str(ft["properties"].get("source") or ""))

    errors: list[str] = []

    empty = [i for i, n in enumerate(names) if not n.strip()]
    if empty:
        errors.append(f"зон без имени: {len(empty)}")

    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        errors.append(f"неуникальные имена ({len(dupes)}): {sorted(dupes)[:5]}")

    borrowed = sorted({n for n in names if norm(n) in forbidden_norm})
    if borrowed:
        errors.append(
            f"имена, встречающиеся ТОЛЬКО в чужой локализации ({len(borrowed)}): "
            f"{borrowed[:8]}"
        )

    unbacked = sorted({n for n in names if n.strip() and norm(n) not in free_norm})
    if unbacked:
        errors.append(
            f"имена без подтверждения свободным источником ({len(unbacked)}): "
            f"{unbacked[:8]}"
        )

    tainted = sorted({s for s in sources
                      if any(k in s.lower() for k in FORBIDDEN_SUBSTRINGS)})
    if tainted:
        errors.append(f"поле source ссылается на чужой мод: {tainted}")

    print(f"проверено зон: {len(names)} из {len(files)} файлов")
    if errors:
        print("FAIL")
        for e in errors:
            print("  -", e)
        return 1
    print("PASS: все имена подтверждены свободными источниками и уникальны")
    return 0


if __name__ == "__main__":
    raise SystemExit(check(raw="--raw" in sys.argv))
