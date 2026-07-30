#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_1946.py — оркестратор пайплайна сценария 1946 (docs/plans/05_DATA_LAYOUT.md,
Срез 5). Падает на первом ненулевом коде возврата (subprocess check=True) —
не продолжает цепочку по битым данным.

ГЕОМЕТРИЯ БЕРЁТСЯ ИЗ МАСТЕРА (2026-07-30). `scripts/map/master/
world_1946.master.geojson` — единственный стартовый источник: вся геометрия
согласована ОДИН РАЗ (`build/weld_map_gaps.py` закрыл 718 внутренних дыр,
`build/rebuild_shared_edges.py` сделал границы соседей общими рёбрами) и
зафиксирована в git. Раньше каждая сборка заново прогоняла 31 шаг
согласования несовпадающих источников, результат ложился в gitignored
`out/*.geojson`, и следующая сборка начинала с нуля.

Что это дало, помимо простоты: позиционные `region_id` перестали ездить (их
порядок больше не пересчитывается — раньше это регулярно ломало
`out/ownership_1946.json`, `out/names_ru.json`,
`economy_1946/capital_overrides.py`), а откат стал возможен через
`git checkout`.

Два режима:

  python scripts/map/make_1946.py
      Обычный путь: мастер + ownership/names/экономика -> валидный сценарий.
      Экспорт каталога ресурсов (Node/tsx) -> audit_map_geometry ->
      import_to_game -> generate_country_registry -> fill_region_economy_1946
      -> validate_region_economy_1946 -> тест структурных инвариантов.
      Геометрию НЕ пересобирает.

  python scripts/map/make_1946.py --rebuild-master
      Восстановление мастера с нуля из scripts/map/sources/ (31 шаг:
      build_europe_1946.py -> ... -> translate_world.py -> сшивка). Нужны
      shapely/pyproj/pyshp и внешние источники (лежат в ОСНОВНОМ checkout,
      в linked worktree их нет — путь задаётся через PAXMAP_SOURCES, см.
      build/paths.py). Требуется только при правке самой геометрии/границ;
      после прогона мастер замораживается `build/freeze_master_map.py`.
      `--full-rebuild` оставлен синонимом для совместимости.
"""
import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MAP_DIR = REPO_ROOT / "scripts" / "map"
SERVER_DIR = REPO_ROOT / "server"

# Восстановление МАСТЕРА с нуля — не часть обычной сборки (2026-07-30).
# Запускается вручную через --rebuild-master, только когда правится сама
# геометрия. Список не сокращён намеренно: в этих скриптах лежит всё знание о
# согласовании несовпадающих источников (какой контур авторитетнее, чем
# резать, где исторические исключения), и терять его нельзя — но и прогонять
# при каждой сборке больше не нужно, результат зафиксирован в мастере.
# Порядок — docs/plans/README.md/scripts/map/README.md "Порядок запуска".
MASTER_REBUILD_STEPS = [
    "build/build_europe_1946.py",
    "build/merge_kiel_canal_zone.py",
    "build/build_china_1946_v2.py",
    "build/build_asia_1946.py",
    "build/build_namerica_1946.py",
    "build/build_us_states_split_1946.py",
    # Сразу после сборки county-кластеров: границы округов США юридически
    # идут ПО ВОДЕ, поэтому акватория попадает в карту как суша (San Juan
    # 9706 км² при 412 км² настоящей земли). Должен стоять до любых
    # clip_*/fix_*, которые доверяют собранной суше как истине.
    "build/clip_us_counties_to_raw_land.py",
    "build/fill_us_border_gaps.py",
    "build/restore_panama_canal_zone.py",
    "build/give_canal_zone_spike_to_water.py",
    "build/build_brazil_1946.py",
    "build/build_southamerica_1946.py",
    "build/build_africa_1946.py",
    "build/fill_palestine_egypt_gap.py",
    "build/build_oceania_1946.py",
    "build/fix_sea_coastline_gaps.py",
    "build/fill_sea_holes.py",
    "build/fix_lake_coastline_gaps.py",
    "build/clip_land_by_water.py",
    "build/clip_sea_by_land.py",
    "build/resolve_brazil_paraguay_overlap.py",
    "build/fix_ponta_pora_matogrosso_gap.py",
    "build/fix_ponta_pora_junction_gap.py",
    "build/fix_santafe_tacuarembo_gap.py",
    "build/fix_alaska_coastline_gaps.py",
    "build/fix_alaska_coastline_gaps_pointfix.py",
    "build/fix_washington_sanjuan_orphans.py",
    "build/fix_puget_sound_coastline_gaps.py",
    # Сшивка — завершающая часть восстановления мастера. Ставится ПОСЛЕ всех
    # точечных fix_*, потому что закрывает то, что они по построению не могут:
    # weld_map_gaps берёт дыры из interior_rings глобального union (без
    # порогов формы, в отличие от absorb_slivers), а rebuild_shared_edges
    # делает границу двух соседей одним физическим ребром.
    "build/weld_map_gaps.py",
    "build/rebuild_shared_edges.py",
    "build/merge_world_1946.py",
    "build/build_neighbor_graph.py",
    "build/translate_world.py",
    # Заморозка: проверяет 0 дыр + coverage_is_valid и только тогда пишет
    # мастер. Отказывается писать рваную карту.
    "build/freeze_master_map.py",
]

STANDARD_STEPS = [
    "test_country_entities_1946.py",
    # Приёмка геометрии ДО импорта в игру: сверяет восемь классов дефектов
    # с baseline и падает на любой находке вне списка известных. Стоит
    # первой из содержательных проверок, потому что раздутый/рваный
    # полигон делает бессмысленными все последующие (экономику считают по
    # площади, соседство — по касаниям). Раньше такой проверки не
    # существовало вовсе: пайплайн рапортовал "завершён успешно", имея в
    # мире регион с 96% ложной площади (см. docs/DECISIONS.md 2026-07-29).
    "build/audit_map_geometry.py",
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
        "--rebuild-master", "--full-rebuild", dest="rebuild_master",
        action="store_true",
        help="Восстановить МАСТЕР с нуля из scripts/map/sources/ (нужны внешние "
             "источники; в linked worktree задай PAXMAP_SOURCES на основной "
             "checkout). Обычной сборке не требуется — геометрия берётся из "
             "scripts/map/master/. `--full-rebuild` — синоним для совместимости.",
    )
    args = parser.parse_args()

    try:
        if args.rebuild_master:
            for rel_path in MASTER_REBUILD_STEPS:
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
