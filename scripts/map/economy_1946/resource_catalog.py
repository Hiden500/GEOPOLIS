"""
resource_catalog.py — читает scripts/map/out/resource_catalog.json, единый
источник истины по ресурсам (RESOURCE_CATALOG в
shared/src/data/resources/resourceCatalog.ts, экспортируется
server/scripts/exportResourceCatalog.ts). Заменяет ранее дублировавшиеся
вручную ACTIVE_RESOURCES_1946/POST_1946_RESOURCES/MAX_EXTRACTION_LEVEL
(docs/plans/05_DATA_LAYOUT.md, Срез 3).
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = REPO_ROOT / "scripts" / "map" / "out" / "resource_catalog.json"


def load_resource_catalog() -> dict:
    if not CATALOG_PATH.exists():
        raise FileNotFoundError(
            f"{CATALOG_PATH} не найден — прогони `npm run export:resource-catalog` "
            f"в server/ (или make_1946.py целиком) перед этим скриптом."
        )
    with open(CATALOG_PATH, encoding="utf-8") as f:
        return json.load(f)


def resources_active_by(catalog: dict, year: int) -> set[str]:
    """Ресурсы каталога, введённые не позже year (eraIntroduced <= year)."""
    return {rid for rid, meta in catalog["resources"].items() if meta["eraIntroduced"] <= year}


def resources_introduced_after(catalog: dict, year: int) -> set[str]:
    """Ресурсы каталога, введённые позже year (eraIntroduced > year)."""
    return {rid for rid, meta in catalog["resources"].items() if meta["eraIntroduced"] > year}
