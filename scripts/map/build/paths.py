"""
paths.py — единая точка конфигурации путей для пайплайна сборки карты.

Заменяет жёстко зашитые песочные пути (/mnt/user-data/..., /home/claude/...),
которые остались от среды, где датасет собирался изначально. Все пути теперь
репо-относительные и переопределяемы через переменные окружения.

Соглашения:
  REPO_ROOT      — корень репозитория (3 уровня вверх от этого файла).
  GAME_MAP       — первичная геометрия, из которой собран весь датасет.
                   Лежит В ХРАНИЛИЩЕ рядом с прочими источниками (см. ниже),
                   а не в репозитории: 36,9 МБ в git не нужны. НЕ удалять.
  SOURCES_DIR    — внешние входные данные: geoBoundaries ADM2 (BRA/USA/CHN),
                   исторические шейпы Китая, IHO, Natural Earth lakes.
  OUT_DIR        — выходные артефакты континентальных билдеров и merge/translate.

ГДЕ ЛЕЖАТ ИСТОЧНИКИ (решение пользователя 2026-08-07). Один общий каталог на
машину, вне репозитория; путь задаётся переменной `PAXMAP_SOURCES_STORE`.
Каждое рабочее дерево получает на него junction в `scripts/map/sources/` —
это делает `scripts/worktree-new.ps1` тем же приёмом, каким подключает
`node_modules`. Данные не дублируются по деревьям и не уходят в git; на GitHub
вместо них — реестр со ссылками и благодарностями
(`docs/provenance/MAP_GEOMETRY_PROVENANCE.md`).

Порядок разрешения путей — от частного к общему, чтобы ничего не сломать:
  1. точечная переменная (`PAXMAP_GAME_MAP`, `PAXMAP_SOURCES`, `PAXMAP_OUT`);
  2. общее хранилище `PAXMAP_SOURCES_STORE`;
  3. каталог внутри репозитория (прежнее поведение).
"""
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Общее хранилище источников: одно на машину, вне репозитория.
STORE = os.environ.get("PAXMAP_SOURCES_STORE")
_STORE_DIR = Path(STORE) if STORE else None


def _resolve(explicit_env: str, store_name: str | None, in_repo: Path) -> Path:
    """Точечная переменная -> общее хранилище -> путь внутри репозитория."""
    explicit = os.environ.get(explicit_env)
    if explicit:
        return Path(explicit)
    if _STORE_DIR is not None and store_name is not None:
        candidate = _STORE_DIR / store_name
        if candidate.exists():
            return candidate
    return in_repo


# Каталог источников: `scripts/map/sources` в дереве обычно junction на
# хранилище, но если junction не создан, читаем хранилище напрямую.
SOURCES_DIR = _resolve(
    "PAXMAP_SOURCES", ".",
    REPO_ROOT / "scripts" / "map" / "sources",
)

# game_map лежит среди источников. Через SOURCES_DIR он находится и когда
# junction создан (переменная в этот момент уже не нужна), и когда путь задан
# напрямую. Старое место в client/ остаётся последним запасным путём — для
# веток, где файл ещё под git.
_GAME_MAP_ENV = os.environ.get("PAXMAP_GAME_MAP")
if _GAME_MAP_ENV:
    GAME_MAP = Path(_GAME_MAP_ENV)
elif (SOURCES_DIR / "game_map.json").exists():
    GAME_MAP = SOURCES_DIR / "game_map.json"
else:
    GAME_MAP = REPO_ROOT / "client" / "src" / "assets" / "game_map.json"
OUT_DIR = Path(os.environ.get(
    "PAXMAP_OUT",
    REPO_ROOT / "scripts" / "map" / "out",
))


# Живая геометрия мира — в порядке убывания авторитетности.
MASTER_GEOJSON = REPO_ROOT / "scripts" / "map" / "master" / "world_1946.master.geojson"
CLIENT_GEOJSON = REPO_ROOT / "client" / "public" / "world_1946.geojson"


def world_geojson() -> Path:
    """Живая геометрия мира: мастер -> выход пайплайна -> копия клиента.

    ЗАЧЕМ ОБЩАЯ ТОЧКА. Мастер — единственный стартовый источник геометрии с
    2026-07-30 (`make_1946.py`), но `out/world_1946.geojson` под git не лежит и
    в свежем дереве отсутствует, а пересобрать его нельзя: 8 из 15 входов
    пайплайна не в репозитории. Скрипт, который жёстко читает `out/`, в чужом
    дереве просто падает `FileNotFoundError` — так и было у
    `build_islands_preview.py`. Скрипт, который читает `client/public` первым,
    работает по счастливой случайности: копия клиента совпадает с мастером
    ровно до следующего прогона `import_to_game.py`.

    Порядок здесь и означает «живая»: мастер авторитетен, `out/` — свежий
    промежуточный результат, копия клиента — последний запасной путь для
    дерева, где нет ни того, ни другого.

    ВНИМАНИЕ: `import_to_game.py` держит СВОЙ, более узкий резолвер (мастер ->
    `out/`) и этой функцией пользоваться не должен: `client/public/
    world_1946.geojson` — его собственный ВЫХОД, и чтение своего выхода как
    входа замкнуло бы его на себя.

    Поля свойств у трёх файлов различаются (`region_type`/`name`/`area_km2` у
    мастера против `type`/`name` у копии клиента) — общий у всех только
    `region_id`. Читатель, которому нужно больше, обязан разбирать оба вида.
    """
    for candidate in (MASTER_GEOJSON, OUT_DIR / "world_1946.geojson", CLIENT_GEOJSON):
        if candidate.is_file():
            return candidate
    raise SystemExit(
        "не найдена геометрия мира: ни "
        + ", ни ".join(str(p) for p in (MASTER_GEOJSON, OUT_DIR / "world_1946.geojson", CLIENT_GEOJSON))
    )


def out(name: str) -> str:
    """Путь к выходному артефакту в OUT_DIR (создаёт каталог при нужде)."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    return str(OUT_DIR / name)


def source(name: str) -> str:
    """Путь к внешнему входному файлу в SOURCES_DIR."""
    return str(SOURCES_DIR / name)


def game_map() -> str:
    """Путь к исходной геометрии game_map.json."""
    return str(GAME_MAP)
