"""
paths.py — единая точка конфигурации путей для пайплайна сборки карты.

Заменяет жёстко зашитые песочные пути (/mnt/user-data/..., /home/claude/...),
которые остались от среды, где датасет собирался изначально. Все пути теперь
репо-относительные и переопределяемы через переменные окружения.

Соглашения:
  REPO_ROOT      — корень репозитория (3 уровня вверх от этого файла).
  GAME_MAP       — исходная геометрия, из которой собирался весь датасет
                   (client/src/assets/game_map.json). НЕ удалять.
  SOURCES_DIR    — внешние входные данные, не лежащие в репо: geoBoundaries
                   ADM2 (BRA/USA/CHN), исторические шейпы Китая, заготовки
                   antarctica/seas/lakes. Положить сюда перед запуском билдеров.
  OUT_DIR        — выходные артефакты континентальных билдеров и merge/translate.

Переопределение через окружение:
  PAXMAP_GAME_MAP, PAXMAP_SOURCES, PAXMAP_OUT.
"""
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

GAME_MAP = Path(os.environ.get(
    "PAXMAP_GAME_MAP",
    REPO_ROOT / "client" / "src" / "assets" / "game_map.json",
))
SOURCES_DIR = Path(os.environ.get(
    "PAXMAP_SOURCES",
    REPO_ROOT / "scripts" / "map" / "sources",
))
OUT_DIR = Path(os.environ.get(
    "PAXMAP_OUT",
    REPO_ROOT / "scripts" / "map" / "out",
))


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
