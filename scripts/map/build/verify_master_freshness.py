"""
verify_master_freshness.py — мастер обязан отражать ТЕКУЩИЕ версии скриптов,
которые его порождают.

ЗАЧЕМ. Мастер заморожен один раз и дальше читается как данные. Это и есть его
смысл — но у него есть обратная сторона, которая уже дважды стоила отдельной
сессии: скрипты-генераторы продолжают жить, а мастер остаётся прежним, и
НИЧТО об этом не сообщает. Пересобрать его нельзя (8 из 11 входов пайплайна
отсутствуют), поэтому расхождение не всплывает даже при полном прогоне —
`make_1946.py` честно рапортует «завершён успешно» на устаревшей геометрии.

Как это выглядело на практике (2026-08-08, найдено пользователем, не
проверкой): мастер заморожен 2026-07-30, а `build_seas_from_iho.py` после
этого менялся СЕМЬ раз — берег из game_map, одно правило заполнения вместо
шести заплаток, диагональ вместо лестницы на линиях раздела (вершин −57%),
чистка лишних точек, разбор неглавных частей, курируемые линии раздела. Восемь
дней карта несла старые моря: у Чёрного 1285 вершин против 1098, линия раздела
с Азовским шла не поперёк горла Керченского пролива. Заметить это можно было
только открыв два файла рядом.

КАК УСТРОЕНО. `freeze_master_map.py` записывает в `master.meta.json` блок
`generators`: для каждого скрипта-генератора — коммит, которым он был на момент
заморозки. Этот шаг сверяет записанное с текущим состоянием git. Разошлось —
падаем и печатаем, ЧТО именно поменялось, чтобы решение принимал человек, а не
умолчание.

ЧТО ДЕЛАТЬ ПРИ ПАДЕНИИ. Два честных исхода, и оба требуют действия:

  1. правка генератора меняет геометрию — прогнать его, подставить результат в
     мастер (`build/apply_*.py`) и заморозить заново; блок `generators`
     обновится сам;
  2. правка геометрии не меняет (комментарий, рефакторинг) — заморозить
     мастер заново без правки данных: содержимое не изменится, а запись
     догонит. Молча править `master.meta.json` руками нельзя: это ровно тот
     жест, который и создаёт расхождение.

Список генераторов берётся из `make_1946.py::MASTER_REBUILD_STEPS` (полная
цепочка восстановления мастера) плюс скрипты, правящие мастер хирургически.
Дублировать список здесь нельзя — разойдётся.

Запуск: python scripts/map/build/verify_master_freshness.py
        python scripts/map/build/verify_master_freshness.py --list
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import REPO_ROOT  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

META = REPO_ROOT / "scripts" / "map" / "master" / "master.meta.json"

# Скрипты, определяющие содержимое мастера, но НЕ входящие в
# `MASTER_REBUILD_STEPS`. Именно здесь и была дыра: `build_seas_from_iho.py`
# строит весь водный слой, но в цепочке восстановления его нет — она берёт уже
# готовый `out/seas_1946.geojson`. Поэтому семь правок водного слоя за
# 2026-07-31…08-01 не сторожил никто.
OFF_CHAIN = [
    "build/build_seas_from_iho.py",
    "build/refresh_lakes_from_ne10m.py",
    "build/apply_sea_zones.py",
    "build/apply_iho_sea_layer.py",
    "build/apply_ph_regions.py",
    "build/apply_region_edits_islands.py",
    "build/fix_dalian_rio_master.py",
    "build/restore_china_curation_master.py",
    "build/geo_partition.py",
]


# Шаги цепочки, которые геометрию НЕ порождают, а записывают или проверяют
# уже готовую. Их правка устареть мастер не может по построению, поэтому в
# сторожа они не идут — иначе он падает на самом себе: добавление блока
# `generators` в `freeze_master_map.py` тут же объявляло мастер устаревшим по
# скрипту, который его и записал.
NOT_GENERATORS = {
    "build/freeze_master_map.py",     # пишет мастер и проверяет дыры/покрытие
    "build/build_neighbor_graph.py",  # производит граф соседей, не геометрию
}


def generator_paths():
    """Пути генераторов относительно корня репозитория, без дублей."""
    sys.path.insert(0, str(REPO_ROOT / "scripts" / "map"))
    from make_1946 import MASTER_REBUILD_STEPS  # noqa: E402

    seen, out = set(), []
    for rel in [r for r in MASTER_REBUILD_STEPS if r not in NOT_GENERATORS] + OFF_CHAIN:
        p = f"scripts/map/{rel}"
        if p not in seen and (REPO_ROOT / p).is_file():
            seen.add(p)
            out.append(p)
    return out


def last_commit(path):
    r = subprocess.run(["git", "log", "-1", "--format=%H", "--", path],
                       capture_output=True, text=True, encoding="utf-8",
                       cwd=str(REPO_ROOT))
    return (r.stdout or "").strip() or None


def commits_between(path, old_sha):
    r = subprocess.run(["git", "log", "--format=%h %ad %s", "--date=short",
                        f"{old_sha}..HEAD", "--", path],
                       capture_output=True, text=True, encoding="utf-8",
                       cwd=str(REPO_ROOT))
    return [l for l in (r.stdout or "").split("\n") if l.strip()]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true",
                    help="показать список сторожимых генераторов и выйти")
    args = ap.parse_args()

    paths = generator_paths()
    if args.list:
        print(f"сторожатся {len(paths)} генераторов:")
        for p in paths:
            print(f"   {p}")
        return 0

    if not META.is_file():
        print(f"  нет {META} — мастер не заморожен, проверять нечего")
        return 0
    meta = json.loads(META.read_text(encoding="utf-8"))
    recorded = meta.get("generators")
    if not recorded:
        print("  ОТКАЗ: в master.meta.json нет блока `generators`.\n"
              "  Мастер заморожен версией freeze_master_map.py, которая его не\n"
              "  писала. Заморозь мастер заново: содержимое не изменится, а\n"
              "  запись о версиях генераторов появится.", file=sys.stderr)
        return 1

    moved, fresh, untracked = [], [], []
    for p in paths:
        now = last_commit(p)
        was = recorded.get(p)
        if now is None:
            untracked.append(p)          # ещё не в git — сравнивать не с чем
        elif was is None:
            fresh.append(p)              # новый генератор, запись догонит
        elif now != was:
            moved.append((p, was, now))

    print(f"  сторожится генераторов: {len(paths)}; записано в мастере: {len(recorded)}")
    # Новый или ещё не закоммиченный генератор сам по себе НЕ значит, что
    # мастер устарел: запись догонит при следующей заморозке. Падать надо на
    # том, что уже было записано и с тех пор УШЛО ВПЕРЁД, — это и есть дефект.
    for label, items in (("новых генераторов (запись догонит)", fresh),
                         ("ещё не в git", untracked)):
        if items:
            print(f"  {label}: {len(items)}")
            for p in items:
                print(f"      {p}")
    if not moved:
        print("OK: мастер отражает текущие версии генераторов.")
        return 0

    if moved:
        print(f"\n  ГЕНЕРАТОРЫ УШЛИ ВПЕРЁД МАСТЕРА: {len(moved)}", file=sys.stderr)
        for p, was, now in moved:
            print(f"\n    {p}", file=sys.stderr)
            print(f"      в мастере: {was[:9]}   сейчас: {now[:9]}", file=sys.stderr)
            for line in commits_between(p, was):
                print(f"        {line}", file=sys.stderr)
        print("\n  Мастер несёт УСТАРЕВШУЮ геометрию по этим скриптам. Прогони их и\n"
              "  подставь результат, либо заморозь мастер заново, если правка\n"
              "  геометрии не меняет. Править master.meta.json руками нельзя.",
              file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
