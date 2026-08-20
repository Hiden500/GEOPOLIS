"""
verify_derived_freshness.py — производный файл под git обязан описывать ЖИВУЮ
карту, а не ту, при которой он был сгенерирован.

ЗАЧЕМ. `out/` целиком в .gitignore, но двенадцать файлов из него внесены в git
руками: их читает пайплайн, а пересобрать их в свежем дереве нечем (8 из 15
внешних входов лежат вне репозитория). Отсюда тот же дефект, который уже
сторожит `verify_master_freshness.py` для самого мастера, только этажом ниже:
карта живёт, файл лежит, и НИЧТО не сообщает, что он описывает другой мир.

Как это выглядело на практике (замер 2026-08-09 на 92c1aa9):
закоммиченный `out/islands_index.json` заявлял 1444 региона сценария и 200
компонент суши, тогда как живая карта даёт 1389 и 154. Разница — не округление:
это 55 регионов и 46 компонент, то есть другая нарезка мира. Пайплайн при этом
проходил целиком с кодом 0, потому что этот файл никто не сверял.

КАК УСТРОЕНО. У каждого сторожимого файла — свой чекер, который достаёт из
файла ЕГО СОБСТВЕННОЕ утверждение о мире и считает ту же величину по живым
данным (мастер `master/world_1946.master.geojson`, сценарий
`server/data/scenarios/1946/`, исходники `shared/`). Расходится — падаем и
печатаем обе величины: «в файле / на живой карте», чтобы решение принимал
человек, а не умолчание.

ЧЕГО ЭТОТ ШАГ НЕ ЛОВИТ (называю прямо, потому что «всегда» без гарантии —
повторяющийся дефект). Сверяется УНИВЕРСУМ регионов и объявленные счётчики, а
не геометрия. Если полигон изменился, а состав region_id остался прежним,
производный файл этой проверкой стар не окажется. Полный ответ на это —
пересборка файла, а её в дереве без внешних входов сделать нельзя.

ЧТО ДЕЛАТЬ ПРИ ПАДЕНИИ. Прогнать генератор названного файла и закоммитить
результат — ровно так закрывается штатный случай. Молча править числа в
производном файле руками нельзя: это и есть жест, который создаёт расхождение.

КЛАССИФИКАЦИЯ. Умолчание «сторожим всё, что в `out/` под git» неверно: там
лежат ещё и ВХОДЫ, и кураторские ЭТАЛОНЫ, которым отставать от живой карты
положено по устройству (`region_edits_islands.json` намеренно называет ещё не
созданные id). Поэтому оба списка — явные, с причиной у каждой записи, а
нераспределённый файл роняет шаг: новый файл в `out/` под git обязан быть
классифицирован человеком, а не молча пропущен.

Запуск: python scripts/map/build/verify_derived_freshness.py
        python scripts/map/build/verify_derived_freshness.py --list
        python scripts/map/build/verify_derived_freshness.py --why-excluded
"""
import argparse
import json
import re
import subprocess
import sys
from collections import namedtuple
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from paths import REPO_ROOT, world_geojson  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT_DIR = REPO_ROOT / "scripts" / "map" / "out"
SCENARIO_DIR = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
CONFIG_DIR = REPO_ROOT / "scripts" / "map" / "config"
SHARED_DIR = REPO_ROOT / "shared" / "src"

# Антарктида в игру не импортируется: у её секторов нет владельца и не будет.
# `import_to_game.py` пропускает регион без владельца молча, поэтому «суши в
# мастере» и «регионов в сценарии» различаются ровно на эти сектора. Это
# устройство, а не пробел в ownership.
UNOWNED_PREFIX = "ANT-"

# Регионы, у которых в `names_ru.json` нет записи, из-за чего `import_to_game.py`
# кладёт в русский словарь сценария сам region_id («AFR-0007» вместо «Гамбия»).
# Замерено 2026-08-09; это СОДЕРЖАТЕЛЬНЫЙ пробел перевода, а не устаревание
# файла относительно мастера, и чинится он записью имён, а не пересборкой.
# Список явный: любой НОВЫЙ регион без записи шаг роняет.
NAMES_RU_KNOWN_GAPS = {
    "AFR-0007": "Gambia — записи нет, в сценарии имя = region_id",
    "EUR-0197": "Noord-Brabant — записи нет, в сценарии имя = region_id",
    "EUR-0198": "Zuid-Holland — записи нет, в сценарии имя = region_id",
}

# Файлы `out/` под git, которые НЕ производны от живой карты. Каждому — причина:
# без неё список превращается в свалку «оно почему-то падало».
NOT_DERIVED = {
    "region_edits_islands.json":
        "ЗАПИСЬ РЕШЕНИЙ пользователя (2026-08-02), вход "
        "`apply_region_edits_islands.py`. Применена к мастеру коммитом 6a997ad "
        "(суша 1444 -> 1396) НЕ ЦЕЛИКОМ: филиппинский resplit отложен и до сих "
        "пор называет 16 ещё не созданных id, а остальные операции называют id "
        "ДО ремапа — применитель ищет участников по паре (имя, площадь) именно "
        "поэтому. Расхождение с живой картой — свойство исторической записи.",
    "world_after_edits.json":
        "ЗАПИСЬ предпросмотра: сама объявляет `_meta.status` = «НЕ ПРИМЕНЕНО к "
        "живой карте» и несёт `regions_before: 1444` как исторический факт "
        "того прогона.",
    "china_1946_historical.json":
        "КУРАТОРСКИЙ ЭТАЛОН китайской нарезки; сторожится отдельно и по своему "
        "принципу — `build/verify_china_curation.py` сверяет с ним мастер.",
    "palestine_1946_historical.json":
        "КУРАТОРСКИЙ ЭТАЛОН палестинских границ, справочный выход "
        "`build/build_palestine_1946.py` (см. его шапку).",
    "ph_provinces_1946.json":
        "КУРАТОРСКИЙ ЭТАЛОН филиппинских провинций: вход "
        "`build/build_ph_regions_1946.py`, снят с источника, а не с карты.",
}

Claim = namedtuple("Claim", "label in_file live detail")
Claim.__new__.__defaults__ = ("",)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Live:
    """Живые данные, читаемые по требованию: `--list` не должен грузить мир."""

    def __init__(self):
        self._cache = {}

    def _get(self, key, fn):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    @property
    def world_path(self):
        return self._get("world_path", world_geojson)

    @property
    def features(self):
        return self._get("features", lambda: load_json(self.world_path)["features"])

    @property
    def region_ids(self):
        return self._get("ids", lambda: {f["properties"]["region_id"] for f in self.features})

    @property
    def land_ids(self):
        return self._get("land", lambda: {
            f["properties"]["region_id"] for f in self.features
            if f["properties"].get("region_type", "land") == "land"
        })

    @property
    def game_land_ids(self):
        """Суша, которая вообще может попасть в игру (без Антарктиды)."""
        return {r for r in self.land_ids if not r.startswith(UNOWNED_PREFIX)}

    @property
    def core(self):
        return self._get("core", lambda: load_json(SCENARIO_DIR / "regions.core.json"))

    @property
    def countries(self):
        return self._get("countries", lambda: load_json(SCENARIO_DIR / "countries.json"))

    @property
    def country_ids(self):
        return {c["id"] for c in self.countries}

    @property
    def overlay(self):
        """Оккупационный оверлей + исторические переопределения владельца."""
        def build():
            import import_to_game as itg
            ov = {k: v for k, v in load_json(CONFIG_DIR / "occupation_overlay.json").items()
                  if not k.startswith("_")}
            ov.update(itg.load_historical_region_overrides())
            return ov
        return self._get("overlay", build)

    def resolve_owner(self, region_id, ownership):
        """Владелец региона ровно так, как его выведет `import_to_game.py`.

        Переиспользуем его функцию, а не переписываем: расхождение между гейтом
        и импортом было бы новым источником того же класса дефектов.
        """
        import import_to_game as itg
        return itg.resolve_owner(region_id, ownership, self.overlay)


# --------------------------------------------------------------------------
# чекеры: файл -> список утверждений «в файле / на живой карте»
# --------------------------------------------------------------------------

def check_islands_index(data, live):
    """Индекс островов заявляет счётчики мира прямо в `_meta.counts`."""
    from build_islands_index import CONTINENT_MIN_REGIONS, land_components

    counts = data.get("_meta", {}).get("counts", {})
    comps = land_components(live.core)
    islands = [c for c in comps if len(c) <= CONTINENT_MIN_REGIONS]
    return [
        Claim("регионов сценария", counts.get("scenario_regions"), len(live.core)),
        Claim("компонент суши", counts.get("land_components"), len(comps)),
        Claim("островов", counts.get("islands"), len(islands)),
        Claim("островных регионов", counts.get("island_regions"),
              sum(len(c) for c in islands)),
    ]


def check_neighbor_graph(data, live):
    """Граф соседей обязан покрывать ровно фичи мастера и не ссылаться в пустоту."""
    neighbors = data.get("neighbors", {})
    ids = set(neighbors)
    dangling = sorted({n for vs in neighbors.values() for n in vs} - live.region_ids)
    edges = sum(len(v) for v in neighbors.values()) // 2
    return [
        Claim("регионов в графе", len(ids), len(live.region_ids),
              _diff_detail(ids, live.region_ids)),
        Claim("ссылок на несуществующие регионы", len(dangling), 0,
              ", ".join(dangling[:10])),
        Claim("edge_count", data.get("edge_count"), edges),
    ]


def check_ownership(data, live):
    """Владение: ни одного лишнего id и ни одного игрового региона без владельца.

    Сверки «регионов с владельцем == регионов в сценарии» здесь СОЗНАТЕЛЬНО
    нет, хотя величины сходятся (1396 суши − 7 секторов Антарктиды = 1389).
    Шаг стоит ВЫШЕ `import_to_game.py`, а сценарий пишет именно он: правка
    мастера сделала бы такую сверку красной до импорта и заблокировала бы
    единственную команду, которая её же и чинит. Гейт обязан называть
    виновника, а не запирать выход.
    """
    phantom = sorted(set(data) - live.region_ids)
    # без владельца штатно остаётся только Антарктида; остальное — регион,
    # про который ownership ещё не знает, и он молча выпадет из игры
    unowned = sorted(r for r in live.game_land_ids if not live.resolve_owner(r, data))
    return [
        Claim("записей о несуществующих регионах", len(phantom), 0, ", ".join(phantom[:10])),
        Claim("игровых регионов без владельца", len(unowned), 0, ", ".join(unowned[:10])),
    ]


def check_names_ru(data, live):
    """Имена: ни одного лишнего id и ни одного нового региона без записи."""
    ids = {e["region_id"] for e in data}
    phantom = sorted(ids - live.region_ids)
    missing = sorted(live.game_land_ids - ids - set(NAMES_RU_KNOWN_GAPS))
    return [
        Claim("записей о несуществующих регионах", len(phantom), 0, ", ".join(phantom[:10])),
        Claim("игровых регионов без записи имени", len(missing), 0, ", ".join(missing[:10]),),
    ]


def check_countries(data, live):
    """Каталог стран обязан знать всех, кто владеет живой землёй.

    Сверять каталог со СПИСКОМ СТРАН СЦЕНАРИЯ нельзя, хотя соблазн есть:
    `generate_country_registry.py` минтит поверх каталога свои коды (зоны
    оккупации Q**, склеенные колониальные блоки), и 37 стран сценария в
    каталоге отсутствуют штатно. Живая связь идёт в другую сторону — от
    владельцев регионов к каталогу.
    """
    ownership = load_json(OUT_DIR / "ownership_1946.json")
    owners = {v.get("owner") for v in ownership.values()} | \
             {v.get("controller") for v in ownership.values()}
    owners.discard(None)
    missing_owners = sorted(owners - set(data))
    # Сюзерен зависимой территории обязан быть в том же каталоге: реестр ходит
    # по этой ссылке, обрыв даёт страну без метрополии. У кондоминиума
    # (Англо-Египетский Судан) `subject_of` — список, а не код.
    suzerains = set()
    for v in data.values():
        s = v.get("subject_of")
        suzerains.update(s if isinstance(s, list) else [s] if s else [])
    dangling = sorted(suzerains - set(data))
    return [
        Claim("владельцев вне каталога", len(missing_owners), 0, ", ".join(missing_owners[:10])),
        Claim("ссылок subject_of в никуда", len(dangling), 0, ", ".join(dangling[:10])),
    ]


def check_flags(data, live):
    """Манифест флагов должен покрывать ровно страны сценария."""
    codes = set(data.get("flags", {})) | set(data.get("custom", {}))
    return [
        Claim("codesInScenario", data.get("_meta", {}).get("codesInScenario"),
              len(live.country_ids)),
        Claim("стран сценария без флага", len(live.country_ids - codes), 0,
              ", ".join(sorted(live.country_ids - codes)[:10])),
        Claim("флагов вне сценария", len(codes - live.country_ids), 0,
              ", ".join(sorted(codes - live.country_ids)[:10])),
    ]


def check_resource_catalog(data, live):
    """Каталог ресурсов производен от shared/ — сверяем с самими исходниками.

    Разбор TypeScript регуляркой намеренно самопроверяем: не нашли ни одного
    ресурса или константы — падаем на «разбор не удался», а не выдаём тихое
    совпадение нуля с нулём.
    """
    catalog_ts = (SHARED_DIR / "data" / "resources" / "resourceCatalog.ts").read_text(encoding="utf-8")
    defines_ts = (SHARED_DIR / "defines" / "resources.ts").read_text(encoding="utf-8")
    body = catalog_ts.split("export const RESOURCE_CATALOG", 1)[-1].split("} as const", 1)[0]
    ids = set(re.findall(r"^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*\{", body, re.M))
    m = re.search(r"export const MAX_EXTRACTION_LEVEL\s*=\s*(\d+)", defines_ts)
    if not ids or not m:
        raise SystemExit("разбор shared/src не удался: ресурсов найдено "
                         f"{len(ids)}, MAX_EXTRACTION_LEVEL {'найден' if m else 'НЕ найден'}. "
                         "Почини разбор в check_resource_catalog, не проверку.")
    have = set(data.get("resources", {}))
    return [
        Claim("ресурсов", len(have), len(ids), _diff_detail(have, ids)),
        Claim("maxExtractionLevel", data.get("maxExtractionLevel"), int(m.group(1))),
    ]


WATCHED = {
    "islands_index.json": (
        "счётчики мира лежат прямо в `_meta.counts`; именно он и устарел на 92c1aa9",
        check_islands_index),
    "neighbor_graph.json": (
        "`import_to_game.py` строит по нему landNeighboringRegionIds сценария",
        check_neighbor_graph),
    "ownership_1946.json": (
        "владелец региона в сценарии берётся отсюда; регион без записи молча выпадает",
        check_ownership),
    "names_ru.json": (
        "имена регионов сценария берутся отсюда, а не из мастера",
        check_names_ru),
    "countries_1946.json": (
        "из него выводится реестр стран (`generate_country_registry.py`)",
        check_countries),
    "flags_1946.json": (
        "курируемое соответствие «код страны сценария -> файл флага»",
        check_flags),
    "resource_catalog.json": (
        "производен от shared/src; экономику региона считают по нему",
        check_resource_catalog),
}


def _diff_detail(have, want):
    extra, missing = sorted(have - want), sorted(want - have)
    parts = []
    if missing:
        parts.append(f"нет в файле: {', '.join(missing[:8])}")
    if extra:
        parts.append(f"лишние: {', '.join(extra[:8])}")
    return "; ".join(parts)


def tracked_out_files():
    """Файлы `out/`, внесённые в git, — только их и нужно классифицировать."""
    r = subprocess.run(["git", "ls-files", "scripts/map/out"],
                       capture_output=True, text=True, encoding="utf-8", cwd=str(REPO_ROOT))
    return sorted(Path(l).name for l in (r.stdout or "").split("\n") if l.strip())


def why_excluded(live):
    """Показать замером, что умолчание «сторожим всё из out/» уронило бы шаг."""
    print("Файлы `out/` под git, которые гейт НЕ сторожит, и что было бы иначе:\n")
    for name, reason in NOT_DERIVED.items():
        path = OUT_DIR / name
        print(f"  {name}\n    причина: {reason}")
        if not path.is_file():
            print("    замер: файла нет в дереве")
            continue
        raw = path.read_text(encoding="utf-8")
        data = load_json(path)
        ids = set(re.findall(r'"region_id":\s*"([^"]+)"', raw))
        meta = data.get("_meta", {}) if isinstance(data, dict) else {}
        counts = meta.get("counts", {})
        if ids:
            alien = sorted(ids - live.region_ids)
            print(f"    замер: region_id всего {len(ids)}, из них ОТСУТСТВУЮТ в мастере "
                  f"{len(alien)}{': ' + ', '.join(alien[:6]) if alien else ''}")
        else:
            # эталоны адресуются своими ключами (имя провинции, код), а не
            # region_id живой карты — сверять их с мастером нечем по построению
            top = [k for k in (data if isinstance(data, dict) else {}) if k != "_meta"]
            print(f"    замер: поля `region_id` нет вовсе; адресуется своими ключами "
                  f"({', '.join(top[:4]) or 'список'})")
        if counts:
            print(f"    замер: объявленные счётчики {json.dumps(counts, ensure_ascii=False)}")
        if meta.get("status"):
            print(f"    замер: _meta.status = {meta['status']!r}")
    print("\nНи один из них шагом не проверяется — падать не на чем.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true",
                    help="показать классификацию файлов out/ и выйти")
    ap.add_argument("--why-excluded", action="store_true",
                    help="замером показать, почему пять файлов не сторожатся")
    args = ap.parse_args()

    live = Live()

    if args.list:
        print(f"сторожатся {len(WATCHED)}:")
        for name, (reason, _) in WATCHED.items():
            print(f"   {name}\n      {reason}")
        print(f"\nне сторожатся {len(NOT_DERIVED)}:")
        for name, reason in NOT_DERIVED.items():
            print(f"   {name}\n      {reason}")
        return 0

    if args.why_excluded:
        return why_excluded(live)

    # Нераспределённый файл — отказ: классификация решается человеком.
    tracked = tracked_out_files()
    unclassified = [n for n in tracked if n not in WATCHED and n not in NOT_DERIVED]
    if unclassified:
        print("  ОТКАЗ: в `out/` под git появились файлы без классификации:",
              file=sys.stderr)
        for n in unclassified:
            print(f"      {n}", file=sys.stderr)
        print("  Внеси каждый в WATCHED (с чекером) или в NOT_DERIVED (с причиной)\n"
              "  в scripts/map/build/verify_derived_freshness.py.", file=sys.stderr)
        return 1

    print(f"  живая геометрия: {live.world_path.relative_to(REPO_ROOT)}")
    print(f"  сторожится производных файлов: {len(WATCHED)}; "
          f"не сторожится записей и эталонов: {len(NOT_DERIVED)} (--why-excluded)")

    stale, missing = [], []
    for name, (_, checker) in WATCHED.items():
        path = OUT_DIR / name
        if not path.is_file():
            missing.append(name)
            continue
        bad = [c for c in checker(load_json(path), live) if c.in_file != c.live]
        if bad:
            stale.append((name, bad))

    if missing:
        print(f"  нет в дереве (проверять нечего): {len(missing)}")
        for n in missing:
            print(f"      {n}")
    if NAMES_RU_KNOWN_GAPS:
        print(f"  известных пробелов перевода в names_ru.json: {len(NAMES_RU_KNOWN_GAPS)} "
              f"({', '.join(sorted(NAMES_RU_KNOWN_GAPS))})")

    if not stale:
        print("OK: производные файлы описывают живую карту.")
        return 0

    print(f"\n  ПРОИЗВОДНЫЕ ФАЙЛЫ ОТСТАЛИ ОТ ЖИВОЙ КАРТЫ: {len(stale)}", file=sys.stderr)
    for name, bad in stale:
        print(f"\n    scripts/map/out/{name}", file=sys.stderr)
        for c in bad:
            print(f"      {c.label}: в файле {c.in_file} / на живой карте {c.live}",
                  file=sys.stderr)
            if c.detail:
                print(f"        {c.detail}", file=sys.stderr)
    print("\n  Файл описывает другой мир, чем мастер и сценарий. Прогони его\n"
          "  генератор и закоммить результат; править числа руками нельзя.",
          file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
