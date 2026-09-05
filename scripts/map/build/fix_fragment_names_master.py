"""
fix_fragment_names_master.py — хирургическая правка мастер-карты: имена двух
фрагментов, не найденные ни курацией, ни `names_ru.json` (2026-08-30).

ПОЧЕМУ ХИРУРГИЯ, А НЕ ПЕРЕСБОРКА. `make_1946.py --rebuild-master` недоступен
(G7, замер 2026-08-09: 8 из 15 входов пайплайна отсутствуют), поэтому правка
идёт по мастеру напрямую — тем же приёмом, что `fix_dalian_rio_master.py`.

ЧТО НАЙДЕНО. Оба региона — `KNOWN_EMPTY_NAMES` в `verify_geojson_field_contract.py`
с технической причиной «имени нет ни в мастере, ни в names_ru.json». Имя не
искали во внешнем источнике — искали по координатам самого мастера:

  - SAM-0040 (CO, 6,1 км², bbox 4,00°N/-81,60°W..3,96°N/-81,58°W) — координаты
    совпадают с островом Малпело (Колумбия): Wikipedia даёт 04°00'12"N
    81°36'27"W, что внутри bbox фичи;
  - SAM-0055 (VE, 0,2 км², bbox 15,696-15,703°N/-63,639..-63,635°W) —
    совпадает с островом Авес (Венесуэла): Wikipedia даёт 15°40'12"N
    63°37'07"W, тоже внутри bbox.

Внешний датасет не покупается и не импортируется — только имя (2 строки),
которое эти координаты уже сами называют однозначно. Полигон в обоих случаях
шире реального острова (6,1 км² против физических ~1,2 км² у Малпело, 0,2 км²
против ~0,1 км² у Авеса) — как и у прочих мелких островных фрагментов мастера
(ср. Clipperton 3,1 км² в файле против ~6 км² острова), это не признак ошибки
идентификации, а огрубление источника.

Правится только `properties.name`. Геометрия и `area_km2` не трогаются.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER_PATH = MAP_DIR / "master" / "world_1946.master.geojson"

FIXES = {
    "SAM-0040": "Malpelo Island",
    "SAM-0055": "Aves Island",
}


def main():
    with open(MASTER_PATH, encoding="utf-8") as f:
        data = json.load(f)
    by_rid = {ft["properties"]["region_id"]: ft for ft in data["features"]}

    changed = []
    for rid, name in FIXES.items():
        ft = by_rid.get(rid)
        if ft is None:
            raise SystemExit(f"ОТКАЗ: {rid} не найден в мастере")
        was = ft["properties"].get("name", "")
        if was == name:
            continue
        ft["properties"]["name"] = name
        changed.append((rid, was, name))

    if not changed:
        print("  изменений нет — имена уже проставлены")
        return 0

    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(f"  мастер перезаписан: {MASTER_PATH}")
    for rid, was, now in changed:
        print(f"    {rid}: {was!r} -> {now!r}")
    print("  дальше: python scripts/map/regen_names_ru.py (или make_1946.py целиком)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
