"""
resync_capital_overrides.py — пересинхронизация столичных регионов после
изменения числа регионов.

ЗАЧЕМ. `economy_1946/capital_overrides.py::CAPITAL_REGION_OVERRIDES` —
СЕДЬМОЙ позиционный файл и второй, привязанный к ЧИСЛОВОМУ `id`
(`regions.core.json`), а не к строковому `region_id`. Пайплайн его не
пересчитывает, `remap_region_ids.py` не видит. Дрейфовал уже четырежды:
46/61 записей 2026-07-23, ещё 8/61 2026-07-26, ещё 26/68 2026-07-29 и
57/55 сегодня. Каждый раз чинился вручную одним и тем же протоколом —
скилл `map-geometry-qa` называет это «дешёвым, чисто поисковым» шагом.
Здесь протокол записан кодом, чтобы пятый раз не делать руками.

ПРОТОКОЛ (тот же, что в скилле). Рядом с таблицей id живёт
`CAPITAL_REGION_ANCHOR_NAMES` — ожидаемое английское имя столичного региона.
Имя от порядка сборки не зависит, поэтому:

  1. страна, у которой имя региона на текущем id совпадает с якорем, — цела,
     не трогаем;
  2. иначе ищем в `names.en.json` регион с ТОЧНО таким именем;
  3. если кандидатов несколько — фильтруем по `ownerCountryId == код страны`
     (якорные имена вроде «Northern» и «Eastern» встречаются у нескольких
     африканских стран);
  4. единственный кандидат — это и есть новый id. Ноль или больше одного —
     печатаем и НЕ трогаем: угадывать здесь нечего.

Правится только число в строке записи; комментарии рядом с ней сохраняются —
в них лежит история каждой предыдущей починки.

Запуск:
    python scripts/map/build/resync_capital_overrides.py [--dry-run]
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import REPO_ROOT  # noqa: E402
from economy_1946.capital_overrides import (  # noqa: E402
    CAPITAL_REGION_ANCHOR_NAMES, CAPITAL_REGION_OVERRIDES,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCENARIO = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
TABLE = REPO_ROOT / "scripts" / "map" / "economy_1946" / "capital_overrides.py"


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    core = json.loads((SCENARIO / "regions.core.json").read_text(encoding="utf-8"))
    state = json.loads((SCENARIO / "regions.state.json").read_text(encoding="utf-8"))
    names = json.loads((SCENARIO / "names.en.json").read_text(encoding="utf-8"))
    gid_by_num = {r["id"]: r["geoJsonId"] for r in core}
    num_by_gid = {r["geoJsonId"]: r["id"] for r in core}
    owner_by_num = {r["id"]: r.get("ownerCountryId") for r in state}
    name_by_num = {num: names.get(gid) for num, gid in gid_by_num.items()}

    by_name = {}
    for gid, nm in names.items():
        by_name.setdefault(nm, []).append(num_by_gid.get(gid))

    ok, fixed, failed = [], [], []
    for code, cur_id in CAPITAL_REGION_OVERRIDES.items():
        anchor = CAPITAL_REGION_ANCHOR_NAMES.get(code)
        if anchor is None:
            failed.append((code, cur_id, "нет якорного имени"))
            continue
        if name_by_num.get(cur_id) == anchor:
            ok.append(code)
            continue
        cands = [n for n in by_name.get(anchor, []) if n is not None]
        if len(cands) > 1:
            cands = [n for n in cands if owner_by_num.get(n) == code]
        if len(cands) == 1:
            fixed.append((code, cur_id, cands[0], anchor))
        else:
            failed.append((code, cur_id,
                           f"кандидатов по имени «{anchor}»: {len(cands)}"))

    print(f"записей {len(CAPITAL_REGION_OVERRIDES)}: целы {len(ok)}, "
          f"переставлено {len(fixed)}, не разрешено {len(failed)}")
    for code, old, new, anchor in fixed:
        print(f"   {code}: {old} -> {new}   «{anchor}» "
              f"(на {old} сейчас «{name_by_num.get(old)}»)")
    for code, cur, why in failed:
        print(f"   ⚠ {code}: {cur} — {why}; на нём сейчас "
              f"«{name_by_num.get(cur)}»")

    if not fixed:
        print("\n  менять нечего")
        return 1 if failed else 0
    if args.dry_run:
        print("\n  --dry-run: файл не изменён")
        return 0

    text = TABLE.read_text(encoding="utf-8")
    # Именно ОБЪЯВЛЕНИЯ, а не первые упоминания: обе таблицы подробно описаны
    # в докстринге выше, и поиск по голому имени вырезал бы кусок докстринга,
    # молча ничего не заменив.
    start = text.index("CAPITAL_REGION_OVERRIDES: dict[str, int] = {")
    end = text.index("CAPITAL_REGION_ANCHOR_NAMES: dict[str, str] = {")
    head, block, tail = text[:start], text[start:end], text[end:]
    for code, old, new, _anchor in fixed:
        pattern = re.compile(rf'("{code}":\s*)\d+')
        block, n = pattern.subn(rf"\g<1>{new}", block, count=1)
        if n != 1:
            print(f"ОТКАЗ: не найдена строка записи {code}", file=sys.stderr)
            return 1
    TABLE.write_text(head + block + tail, encoding="utf-8")
    print(f"\n  записано: {TABLE}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
