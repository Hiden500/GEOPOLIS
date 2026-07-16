#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_1946.py — оркестратор пайплайна сценария 1946 (docs/plans/05_DATA_LAYOUT.md,
Срез 5). Падает на первом ненулевом коде возврата (subprocess check=True) —
не продолжает цепочку по битым данным.

Два режима:

  python scripts/map/make_1946.py
      Стандартный путь: из уже готовых scripts/map/out/*.geojson+*.json
      (build_*/merge_world_1946/translate_world НЕ перезапускаются — по
      умолчанию репозиторий держит готовые выходы, см. scripts/map/README.md)
      до валидного сценария. Экспорт каталога ресурсов (Node/tsx) ->
      import_to_game -> generate_country_registry -> fill_region_economy_1946 ->
      validate_region_economy_1946 -> тест структурных инвариантов.

  python scripts/map/make_1946.py --full-rebuild
      То же самое, но сначала полностью пересобирает геометрию из
      scripts/map/sources/ (build_europe_1946.py -> ... -> translate_world.py).
      Нужны shapely/pyproj/pyshp и внешние источники — см. README "Внешние
      источники". Не нужно для рутинного изменения экономики/владения/каталога
      ресурсов — только при правке самой геометрии/границ.
"""
import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MAP_DIR = REPO_ROOT / "scripts" / "map"
SERVER_DIR = REPO_ROOT / "server"

# Порядок — docs/plans/README.md/scripts/map/README.md "Порядок запуска".
FULL_REBUILD_STEPS = [
    "build/build_europe_1946.py",
    "build/build_china_1946_v2.py",
    "build/build_asia_1946.py",
    "build/build_namerica_1946.py",
    "build/build_us_states_split_1946.py",
    "build/fill_us_border_gaps.py",
    "build/build_brazil_1946.py",
    "build/build_southamerica_1946.py",
    "build/build_africa_1946.py",
    "build/build_oceania_1946.py",
    "build/merge_world_1946.py",
    "build/build_neighbor_graph.py",
    "build/translate_world.py",
]

STANDARD_STEPS = [
    "test_country_entities_1946.py",
    "import_to_game.py",
    "generate_country_registry.py",
    "fill_region_economy_1946.py",
    "validate_region_economy_1946.py",
    "test_validate_region_economy_1946.py",
]


def run_python_step(rel_path: str) -> None:
    script = MAP_DIR / rel_path
    print(f"\n=== {rel_path} ===", flush=True)
    subprocess.run([sys.executable, str(script)], check=True, cwd=str(MAP_DIR))


def run_resource_catalog_export() -> None:
    print("\n=== export:resource-catalog (npm run, server/) ===", flush=True)
    subprocess.run(
        ["npm", "run", "export:resource-catalog"],
        check=True, cwd=str(SERVER_DIR), shell=(sys.platform == "win32"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--full-rebuild", action="store_true",
        help="Пересобрать геометрию из scripts/map/sources/ перед импортом (нужны внешние источники).",
    )
    args = parser.parse_args()

    try:
        if args.full_rebuild:
            for rel_path in FULL_REBUILD_STEPS:
                run_python_step(rel_path)

        run_resource_catalog_export()
        for rel_path in STANDARD_STEPS:
            run_python_step(rel_path)
    except subprocess.CalledProcessError as exc:
        print(f"\nПАЙПЛАЙН ОСТАНОВЛЕН на шаге {exc.cmd!r} (код {exc.returncode}).", file=sys.stderr)
        return 1

    print(
        "\nПайплайн 1946 завершён успешно: server/data/scenarios/1946/*.json + "
        "client/public/world_1946.geojson готовы.",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
