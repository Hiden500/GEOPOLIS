"""
fix_small_region_consolidation_master.py — хирургическая правка мастер-карты:
слияние избыточно мелкой нарезки трёх незначительных территорий в одну игровую
единицу каждая (решение пользователя 2026-08-30).

ПОЧЕМУ ХИРУРГИЯ. `make_1946.py --rebuild-master` недоступен (G7). Правка идёт
по мастеру напрямую, тем же приёмом, что и другие `fix_*_master.py`.

НАХОДКА, ПОРОДИВШАЯ ПРАВКУ. Игра почти везде режет регионы по СОВРЕМЕННЫМ
official admin-1 единицам страны, спроецированным на границы 1946 года — метод
даёт неравномерную гранулярность по конструкции: страна с современным мелким
дроблением получает много регионов, страна с немногими крупными — мало.
Пользователь указал на два перегруженных случая:

  - `QRU` (Ruanda-Urundi, слияние стран решением 2026-07-18) несёт **8**
    регионов — 5 современных провинций Руанды (Eastern/Southern/Western/
    Northern/Kigali City, `AFR-0008..0012`) + 3 провинции Бурунди
    (Bujumbura Rural/Makamba/Ruyigi, `AFR-0193..0195`) — для территории
    ~50 000 км² под одной довоенной администрацией это избыточно;
  - территория современной Буркина-Фасо (в 1946 не существует отдельно —
    Верхняя Вольта упразднена 1932, восстановлена только в сентябре 1947)
    несёт **13** регионов под `QFW` (French West Africa),
    `AFR-0030..0042` — все современные провинции Буркина-Фасо один в один.

РЕШЕНИЕ (пользователь, 2026-08-30): Руанда и Бурунди остаются РАЗНЫМИ
регионами (реальные различные территории под одной колониальной властью,
схлопывать в одну было бы неверно) — 5→1 и 3→1. Территория Буркина-Фасо —
13→1 (она и не претендует на собственную структуру в 1946).

ПОЗИЦИОННЫЙ РИСК (см. `.claude/skills/map-geometry-qa/SKILL.md`,
«Positional-file fragility»). Порядок континентов в мастере:
`EUR ASI NAM SAM AFR OCE ANT SEA LAK` — удаление 18 фич из AFR сдвигает
позиционные id ВСЕХ последующих континентов (OCE, ANT). Составной,
неравномерный сдвиг внутри самого AFR (три группы на разных позициях
блока) — решается НЕ вычислением офсета, а `remap_region_ids.py
--old-master <снимок до правки> --prefix <XXX-> --apply` для КАЖДОГО из
трёх континентов (AFR, OCE, ANT), сопоставление по содержимому
(name, iso_a2), не по позиции. Три слитых региона получат НОВЫЕ имена и
не совпадут ни с одной старой записью — remap корректно отметит их
составляющие как "нерезолвлено" (сущность исчезла) и не создаст новую
запись сам; позиционные записи для трёх выживших id добавляются вручную
ПОСЛЕ remap (см. следующий шаг).

Правится геометрия (union) и area_km2 выживших id. Свойство `name`
выживших фич выставляется явно (Rwanda/Burundi/Haute-Volta) — не заглушка,
финальное плоское имя отдельно проверяется через
`region_name_overrides.json` тем же приёмом, что SAM-0040/SAM-0055.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from shapely.geometry import mapping, shape  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER_PATH = MAP_DIR / "master" / "world_1946.master.geojson"

# (список кусков, выживший id, новое имя)
GROUPS = [
    (["AFR-0008", "AFR-0009", "AFR-0010", "AFR-0011", "AFR-0012"],
     "AFR-0008", "Rwanda"),
    (["AFR-0193", "AFR-0194", "AFR-0195"],
     "AFR-0193", "Burundi"),
    (["AFR-0030", "AFR-0031", "AFR-0032", "AFR-0033", "AFR-0034", "AFR-0035",
      "AFR-0036", "AFR-0037", "AFR-0038", "AFR-0039", "AFR-0040", "AFR-0041",
      "AFR-0042"],
     "AFR-0030", "Haute-Volta"),
]


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(MASTER_PATH, encoding="utf-8") as f:
        data = json.load(f)
    by_rid = {ft["properties"]["region_id"]: ft for ft in data["features"]}

    to_remove = set()
    report = []
    for members, survivor_rid, new_name in GROUPS:
        geoms = []
        for rid in members:
            ft = by_rid.get(rid)
            if ft is None:
                raise SystemExit(f"ОТКАЗ: {rid} не найден в мастере")
            geoms.append(shape(ft["geometry"]))
        merged = unary_union(geoms)
        if not merged.is_valid:
            raise SystemExit(f"ОТКАЗ: слияние {members} -> {survivor_rid} дало невалидную геометрию")
        a = round(area_km2(merged), 1)
        report.append((members, survivor_rid, new_name, a))
        if not args.dry_run:
            survivor = by_rid[survivor_rid]
            survivor["geometry"] = mapping(merged)
            survivor["properties"]["area_km2"] = a
            survivor["properties"]["name"] = new_name
        to_remove.update(m for m in members if m != survivor_rid)

    print("  Слияние:")
    for members, survivor_rid, new_name, a in report:
        print(f"    {len(members)} кусков -> {survivor_rid} «{new_name}», {a:.1f} км²")
    print(f"\n  Фич будет удалено: {len(to_remove)} (мир 1591 -> {1591 - len(to_remove)})")

    if args.dry_run:
        print("\n  --dry-run: мастер не тронут")
        return 0

    data["features"] = [ft for ft in data["features"]
                        if ft["properties"]["region_id"] not in to_remove]

    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"\n  мастер перезаписан: {MASTER_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
