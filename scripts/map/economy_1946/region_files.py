"""
region_files.py — общий загрузчик/писатель расслоённых файлов сценария 1946
(docs/plans/05_DATA_LAYOUT.md, Срез 1): regions.core.json (география) +
names.en.json/names.ru.json (локализация) + regions.state.json
(владение/экономика), вместо единого regions.json.

load_regions_combined() восстанавливает старую объединённую форму (все поля
в одном dict на регион) в памяти — существующая логика fill_region_economy_1946.py/
generate_country_registry.py/validate_region_economy_1946.py читает её без
изменений, как и раньше единый regions.json. write_regions_state() пишет
обратно только слой state (никогда не трогает core/names — их меняет только
import_to_game.py, Этап 3).
"""
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SCENARIO_DIR = REPO_ROOT / "server" / "data" / "scenarios" / "1946"

CORE_PATH = SCENARIO_DIR / "regions.core.json"
STATE_PATH = SCENARIO_DIR / "regions.state.json"
NAMES_EN_PATH = SCENARIO_DIR / "names.en.json"
NAMES_RU_PATH = SCENARIO_DIR / "names.ru.json"

# Порядок и состав полей слоя state — единственное, что write_regions_state
# берёт из combined-словаря обратно в файл. occupiedBy сюда не попадает
# никогда (не выставляется пайплайном, только рантаймом WarTick).
STATE_FIELDS = (
    "id", "ownerCountryId", "population", "urbanization",
    "stability", "infrastructure", "development", "gdp", "deposits", "extraction",
)


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# Обратная совместимость внутреннего имени (использовалось внутри модуля).
_load = load_json


def load_regions_layers() -> tuple[list[dict], list[dict], dict[str, str], dict[str, str]]:
    """Сырые (нерасслитые) слои — для проверок, которым важно ЧТО именно
    отсутствует в каком файле (например, полнота локализации по локали),
    что combine_regions() уже замаскировал бы дефолтом на пустую строку."""
    return _load(CORE_PATH), _load(STATE_PATH), _load(NAMES_EN_PATH), _load(NAMES_RU_PATH)


def combine_regions(
    core: list[dict], state: list[dict], names_en: dict[str, str], names_ru: dict[str, str]
) -> list[dict]:
    """Чистая функция слияния — вынесена отдельно от load_regions_combined(),
    чтобы быть тестируемой на синтетических данных без чтения файлов."""
    state_by_id = {s["id"]: s for s in state}
    combined = []
    for c in core:
        s = state_by_id.get(c["id"])
        if s is None:
            raise ValueError(
                f"regions.state.json: нет записи для id={c['id']} (geoJsonId={c['geoJsonId']})"
            )
        merged = {**c, **s}
        merged["names"] = {
            "en": names_en.get(c["geoJsonId"], ""),
            "ru": names_ru.get(c["geoJsonId"], ""),
        }
        combined.append(merged)
    return combined


def load_regions_combined() -> list[dict]:
    return combine_regions(*load_regions_layers())


def write_regions_state(regions: list[dict]) -> None:
    state = [{k: r[k] for k in STATE_FIELDS if k in r} for r in regions]
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")
