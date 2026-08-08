"""
freeze_master_map.py — фиксация мастер-карты как стартового источника
(2026-07-30).

ИДЕЯ (пользователь, 2026-07-30): «Мы сначала заполняем море по game_map.
Потом режем сушу по морю. Потом что данные с разных источников и не
совпадают полностью. Попробуй упростить задачу, чтобы каждый раз одно и то
же не делать. Сделать, например, новый стартовый json.»

До этого каждая пересборка заново прогоняла 31 шаг согласования
несовпадающих источников, результат ложился в gitignored `out/*.geojson`, и
следующая пересборка начинала борьбу с нуля. Теперь геометрия согласована
ОДИН РАЗ (`weld_map_gaps.py` закрыл 718 внутренних дыр,
`rebuild_shared_edges.py` сделал границы соседей общими рёбрами), и результат
фиксируется здесь как данные, а не как процесс.

ЧТО ЭТО ДАЁТ, помимо упрощения:
  - позиционные `region_id` перестают ездить. Раньше они присваивались по
    порядку фич при каждой сборке, из-за чего целая сессия ушла на ремонт
    каскадов в `out/ownership_1946.json`, `out/names_ru.json`,
    `economy_1946/capital_overrides.py` (~33 + 213 + 26 записей). У
    зафиксированного файла порядок неизменен — класс дефекта исчезает;
  - откат становится возможен: файл в git, `git checkout` возвращает любое
    состояние, diff ревьюится. Бэкап в scratchpad этого не давал — он
    потерялся при перезапуске сессии, что и подтвердило необходимость git;
  - правки границ становятся коммитами с историей, а не эфемерными
    мутациями невидимого файла.

Мастер хранит все фичи с уже присвоенными `region_id`, то есть берёт на себя
роль, которую играл `merge_world_1946.py`. Формат — GeoJSON, а не TopoJSON:
клиент и весь существующий код читают GeoJSON, а гарантию общих рёбер даёт
аудитор (`audit_map_geometry.py`), не формат.

Рядом пишется `master.meta.json` с контрольными числами — чтобы расхождение
мастера и ожиданий было видно сразу, без повторного анализа геометрии.

Запуск: python scripts/map/build/freeze_master_map.py
        python scripts/map/build/freeze_master_map.py --verify   (только сверка)
"""
import argparse
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from paths import out  # noqa: E402
from geometry_cleanup import area_km2  # noqa: E402
import shapely  # noqa: E402
from shapely.geometry import shape, Polygon  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

MASTER_DIR = Path(__file__).resolve().parents[1] / "master"
MASTER_PATH = MASTER_DIR / "world_1946.master.geojson"
META_PATH = MASTER_DIR / "master.meta.json"


def git(*args):
    try:
        r = subprocess.run(["git", *args], capture_output=True, text=True,
                           encoding="utf-8", cwd=str(Path(__file__).resolve().parents[3]))
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def measure(features):
    """Контрольные числа мастера. Считаются по той же геометрии, что
    записывается, — чтобы meta нельзя было рассинхронизировать с файлом."""
    geoms = []
    prefixes = Counter()
    by_type = Counter()
    land_area = sea_area = 0.0
    for ft in features:
        p = ft["properties"]
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        geoms.append(g)
        rid = p.get("region_id", "")
        prefixes[rid.split("-")[0]] += 1
        rt = p.get("region_type")
        by_type[rt] += 1
        a = area_km2(g)
        if rt == "land":
            land_area += a
        else:
            sea_area += a

    u = unary_union(geoms)
    parts = list(u.geoms) if u.geom_type == "MultiPolygon" else [u]
    holes, hole_area = 0, 0.0
    for pl in parts:
        for ring in pl.interiors:
            h = Polygon(ring)
            if not h.is_valid:
                h = h.buffer(0)
            if h.is_empty or h.area < 1e-12:
                continue
            holes += 1
            hole_area += area_km2(h)

    import numpy as np
    arr = np.array(geoms, dtype=object)
    try:
        cov_valid = bool(shapely.coverage_is_valid(arr, gap_width=0.0))
        edges = shapely.coverage_invalid_edges(arr, gap_width=0.0)
        bad_len = float(sum(e.length for e in edges if e is not None and not e.is_empty))
    except Exception:
        cov_valid, bad_len = None, None

    n_invalid = sum(1 for g in geoms if not g.is_valid)
    return {
        "features": len(features),
        "by_prefix": dict(sorted(prefixes.items())),
        "by_region_type": dict(sorted(by_type.items(), key=lambda kv: str(kv[0]))),
        "land_area_km2": round(land_area, 1),
        "water_area_km2": round(sea_area, 1),
        "invalid_geometries": n_invalid,
        "union_holes": holes,
        "union_hole_area_km2": round(hole_area, 4),
        "coverage_is_valid": cov_valid,
        "coverage_invalid_edge_length_deg": round(bad_len, 8) if bad_len is not None else None,
    }


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--verify", action="store_true",
                    help="сверить существующий мастер с meta, ничего не писать")
    args = ap.parse_args()

    if args.verify:
        if not MASTER_PATH.exists():
            print(f"  мастера нет: {MASTER_PATH}")
            return 1
        with open(MASTER_PATH, encoding="utf-8") as f:
            m = measure(json.load(f)["features"])
        print("  контрольные числа мастера:")
        for k, v in m.items():
            print(f"    {k}: {v}")
        if META_PATH.exists():
            with open(META_PATH, encoding="utf-8") as f:
                meta = json.load(f)
            diff = {k: (meta["checks"].get(k), v) for k, v in m.items()
                    if meta["checks"].get(k) != v}
            if diff:
                print("\n  РАСХОЖДЕНИЕ с master.meta.json:")
                for k, (was, now) in diff.items():
                    print(f"    {k}: в meta {was}, фактически {now}")
                return 1
            print("\n  мастер совпадает с master.meta.json")
        return 0

    src = out("world_1946.geojson")
    with open(src, encoding="utf-8") as f:
        data = json.load(f)
    checks = measure(data["features"])

    print("  контрольные числа:")
    for k, v in checks.items():
        print(f"    {k}: {v}")

    if checks["union_holes"] != 0:
        print(f"\n  ОТКАЗ: в карте {checks['union_holes']} внутренних дыр "
              f"({checks['union_hole_area_km2']} км²). Мастер должен быть "
              f"сплошным — сначала прогони build/weld_map_gaps.py")
        return 1
    if checks["coverage_is_valid"] is False:
        print("\n  ОТКАЗ: coverage_is_valid=False — границы соседей не общие. "
              "Сначала прогони build/rebuild_shared_edges.py")
        return 1
    if checks["invalid_geometries"]:
        print(f"\n  ОТКАЗ: невалидных геометрий {checks['invalid_geometries']}")
        return 1

    MASTER_DIR.mkdir(parents=True, exist_ok=True)
    with open(MASTER_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    # Провенанс хирургических правок пережил бы пересборку мастера, но не
    # перезапись meta: блок `_surgical_edits` описывает правки, ВНЕСЁННЫЕ В
    # САМ мастер (Далянь/Рио 2026-08-07, курация Китая 2026-08-08), и в
    # геометрии они остаются. Первая же заморозка после них молча стирала
    # запись о них (найдено 2026-08-08) — переносим.
    prior_edits = None
    if META_PATH.exists():
        try:
            with open(META_PATH, encoding="utf-8") as f:
                prior_edits = json.load(f).get("_surgical_edits")
        except (OSError, json.JSONDecodeError):
            prior_edits = None

    # Версии генераторов на момент заморозки. Без этой записи мастер молча
    # отстаёт от скриптов, которые его порождают: пересобрать его нельзя, и
    # расхождение не всплывает даже при полном прогоне. Так восемь дней
    # пролежали старые моря (`build_seas_from_iho.py` ушёл вперёд на семь
    # коммитов) — сторожит `build/verify_master_freshness.py`.
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from verify_master_freshness import generator_paths, last_commit
        generators = {p: last_commit(p) for p in generator_paths()}
        generators = {k: v for k, v in generators.items() if v}
    except Exception as exc:  # pragma: no cover - git недоступен
        print(f"  версии генераторов не записаны: {type(exc).__name__}: {exc}")
        generators = None

    meta = {
        "_comment": "Мастер-карта: единственный стартовый источник геометрии. "
                    "Геометрия согласована один раз (weld_map_gaps.py + "
                    "rebuild_shared_edges.py); пайплайн читает этот файл вместо "
                    "повторного согласования источников. Менять только осознанно, "
                    "вместе с записью в docs/DECISIONS.md.",
        "frozen_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "built_from_commit": git("rev-parse", "HEAD"),
        "built_from_branch": git("rev-parse", "--abbrev-ref", "HEAD"),
        "source": "scripts/map/out/world_1946.geojson",
        "produced_by": [
            "build/weld_map_gaps.py",
            "build/rebuild_shared_edges.py",
            "build/merge_world_1946.py",
            "build/translate_world.py",
        ],
        "checks": checks,
    }
    if generators:
        meta["generators"] = generators
    if prior_edits:
        meta["_surgical_edits"] = prior_edits
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    size_mb = MASTER_PATH.stat().st_size / 1048576
    print(f"\n  Мастер зафиксирован: {MASTER_PATH} ({size_mb:.1f} МБ)")
    print(f"  Метаданные: {META_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
