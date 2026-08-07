"""Переименование морских зон в названия из свободных источников.

Правило: имя зоны обязано подтверждаться свободным справочником (GEBCO
Gazetteer, Natural Earth, game_map.json). Имя, которое встречается только в
локализации HOI4 / World Ablaze, заменяется на самый заметный объект GEBCO
внутри зоны.

Ключевая тонкость, из-за которой наивная проверка была бы неверной:
совпадение с именем мода САМО ПО СЕБЕ нарушением не является. `Kerguelen
Plateau` — реальная форма рельефа дна, она есть в GEBCO, и то, что мод назвал
зону так же, ничего не меняет. Запрещены только СОБСТВЕННЫЕ конструкции
чужой локализации — те, что не подтверждаются ни одним свободным источником
(`South Atlantic Platau`, `Central N.E. Pacific`).

Читает  zones_<ocean>.geojson
Пишет   zones_<ocean>.named.geojson  (исходники не трогает)
        rename_report.json
"""

from __future__ import annotations

import json
import glob
import math
import os
import re
import sys

from shapely.geometry import shape
from shapely.strtree import STRtree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SOURCES = os.path.join(ROOT, "scripts", "map", "sources")

HOI4_LOC = [
    r"D:/SteamLibrary/steamapps/workshop/content/394360/2149567872"
    r"/localisation/english/strategic_region_names_l_english.yml",
    r"D:/SteamLibrary/steamapps/common/Hearts of Iron IV"
    r"/localisation/english/strategic_region_names_l_english.yml",
]

# происхождение делимитации описано в провенансе, а не продублировано в каждой
# записи данных
SOURCE_TAG = "see docs/provenance/MAP_GEOMETRY_PROVENANCE.md"


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def load_free_names() -> set[str]:
    """Названия из источников со свободной лицензией."""
    free: set[str] = set()

    for path in glob.glob(os.path.join(SOURCES, "gebco", "*.geojson")):
        for ft in json.load(open(path, encoding="utf-8"))["features"]:
            p = ft["properties"]
            name = (p.get("NAME") or "").strip()
            kind = (p.get("TYPE") or "").strip()
            if not name:
                continue
            free.add(name)
            if kind:
                # GEBCO хранит имя и тип раздельно: NAME="Puysegur", TYPE="Bank"
                free.add(f"{name} {kind}")

    for path in glob.glob(os.path.join(SOURCES, "naturalearth", "*.geojson")):
        for ft in json.load(open(path, encoding="utf-8"))["features"]:
            for key in ("name", "name_en", "NAME"):
                val = ft["properties"].get(key)
                if isinstance(val, str) and val.strip():
                    free.add(val.strip())

    game_map = os.path.join(ROOT, "client", "src", "assets", "game_map.json")
    for ft in json.load(open(game_map, encoding="utf-8"))["features"]:
        p = ft["properties"]
        for key in ("name", "name_en", "admin", "geonunit", "gn_name",
                    "name_alt", "region", "subregion"):
            val = p.get(key)
            if isinstance(val, str) and val.strip():
                free.add(val.strip())

    return free


def load_forbidden(free_norm: set[str]) -> set[str]:
    """Собственные конструкции чужой локализации — всё, что не подтверждено."""
    theirs: set[str] = set()
    for path in HOI4_LOC:
        if not os.path.exists(path):
            print(f"ВНИМАНИЕ: не найдена локализация {path}", file=sys.stderr)
            continue
        for line in open(path, encoding="utf-8-sig", errors="replace"):
            m = re.match(r'\s*([A-Za-z0-9_]+):\s*\d*\s*"(.*)"\s*$', line)
            if m and m.group(2).strip():
                theirs.add(m.group(2).strip())
    return {n for n in theirs if norm(n) not in free_norm}


# Формы рельефа, которые описывают локальную деталь, а не область. Каньон
# бывает длиннее хребта, но названием для миллиона км² воды не служит.
LOCAL_FORMS = {
    "canyon", "valley", "seachannel", "channel", "spur", "gap", "passage",
    "saddle", "sill", "moat", "levee", "terrace", "apron", "shelf-edge",
}
LOCAL_WEIGHT = 0.45


def load_candidates() -> list[tuple[str, str, str, object, str | None]]:
    """Именованные объекты-кандидаты: GEBCO + Natural Earth marine polys.

    GEBCO даёт формы рельефа дна, NE — акватории. Для крупной зоны имя
    акватории уместнее имени подводного холма, поэтому источники смешаны и
    соревнуются по одной метрике.
    """
    out: list[tuple[str, str, str, object, str | None]] = []

    for kind in ("polygons", "lines", "points"):
        path = os.path.join(SOURCES, "gebco", f"gebco_{kind}.geojson")
        for ft in json.load(open(path, encoding="utf-8"))["features"]:
            p = ft["properties"]
            name = (p.get("NAME") or "").strip()
            if not name:
                continue
            try:
                geom = shape(ft["geometry"])
            except Exception:
                continue
            if geom.is_empty:
                continue
            out.append((kind, name, (p.get("TYPE") or "").strip(), geom, None))

    ne_path = os.path.join(SOURCES, "naturalearth",
                           "ne_10m_geography_marine_polys.geojson")
    for ft in json.load(open(ne_path, encoding="utf-8"))["features"]:
        p = ft["properties"]
        cla = (p.get("featurecla") or "").strip().lower()
        # ocean — это родитель зоны, а не её имя; bay/lagoon/fjord/inlet/river
        # и риф — прибрежная мелочь: заливом Сан-Франциско океанскую зону в
        # 51 тыс. км² называть нельзя
        if cla in ("ocean", "bay", "lagoon", "fjord", "inlet", "river", "reef"):
            continue
        name = (p.get("name_en") or p.get("name") or "").strip()
        if not name:
            continue
        try:
            geom = shape(ft["geometry"])
        except Exception:
            continue
        if geom.is_empty:
            continue
        out.append(("marine", name, "", geom, (p.get("name_ru") or "").strip() or None))

    return out


def prominence(kind: str, kindname: str, geom, zone, lat0: float) -> float:
    """Заметность объекта внутри зоны, в километрах.

    Градусы долготы у полюса короче, поэтому масштаб берётся по широте зоны:
    без этого объект в Арктике выглядел бы крупнее экваториального.
    """
    kx = 111.32 * max(math.cos(math.radians(lat0)), 0.05)
    ky = 110.57
    try:
        part = geom.intersection(zone)
    except Exception:
        return 0.0
    if part.is_empty:
        return 0.0
    weight = LOCAL_WEIGHT if kindname.strip().lower() in LOCAL_FORMS else 1.0
    if kind in ("polygons", "marine"):
        # площадь -> линейный размер, чтобы сравнивать с длиной линий
        return math.sqrt(max(part.area, 0.0) * kx * ky) * weight
    if kind == "lines":
        return part.length * (kx + ky) / 2.0 * weight
    return 1.0  # точка: годится только когда больше ничего нет


def main() -> int:
    free = load_free_names()
    free_norm = {norm(x) for x in free}
    forbidden = load_forbidden(free_norm)
    forbidden_norm = {norm(x) for x in forbidden}
    gebco = load_candidates()
    tree = STRtree([c[3] for c in gebco])

    print(f"свободный справочник: {len(free)} названий")
    print(f"собственных конструкций чужой локализации: {len(forbidden)}")
    print(f"объектов-кандидатов (GEBCO + NE marine): {len(gebco)}")

    files = sorted(glob.glob(os.path.join(HERE, "zones_*.geojson")))
    files = [f for f in files if not f.endswith(".named.geojson")]

    zones = []  # (файл, индекс, имя, geometry)
    docs = {}
    for path in files:
        data = json.load(open(path, encoding="utf-8"))
        docs[path] = data
        for i, ft in enumerate(data["features"]):
            zones.append((path, i, ft["properties"]["name"], shape(ft["geometry"])))

    # кандидаты по каждой зоне, отсортированные по убыванию заметности
    candidates: dict[tuple[str, int], list[tuple[float, str, str | None]]] = {}
    keep: dict[tuple[str, int], str] = {}
    parents = {}
    for path, i, name, zg in zones:
        if norm(name) in free_norm and norm(name) not in forbidden_norm:
            keep[(path, i)] = name  # законное название, не трогаем
            continue
        lat0 = (zg.bounds[1] + zg.bounds[3]) / 2.0
        parent = docs[path]["features"][i]["properties"].get("parent", "")
        parents[(path, i)] = parent
        scored = []
        for idx in tree.query(zg):
            kind, nm, tp, g, ru = gebco[idx]
            score = prominence(kind, tp, g, zg, lat0)
            if score <= 0:
                continue
            full = f"{nm} {tp}".strip() if tp else nm
            if norm(full) == norm(parent):
                continue  # зона не может называться так же, как её океан
            scored.append((score, full, ru))
        scored.sort(key=lambda x: (-x[0], x[1]))
        candidates[(path, i)] = scored

    # Раздача глобально жадная: пара (зона, кандидат) с наибольшей заметностью
    # получает имя первой. Прежний порядок «сначала тем, у кого выбор беднее»
    # отдавал крупное имя случайной зоне, а настоящему владельцу оставлял
    # мелочь: Mid-Pacific Seamounts достались Johnston Gap, а S.W. Emperor
    # Chain получил спур в 24 км при своих 1.3 млн км².
    taken = {norm(v) for v in keep.values()}
    assigned: dict[tuple[str, int], str] = {}
    ru_names: dict[tuple[str, int], str] = {}
    # Заметность нормируется на характерный размер зоны: объект важен не сам по
    # себе, а тем, какую долю зоны он собой представляет. Без нормировки
    # крупные зоны разбирают все громкие имена первыми просто потому, что через
    # них проходит больше километров хребта.
    pairs = []
    for key, scored in candidates.items():
        path, i = key
        area = docs[path]["features"][i]["properties"].get("area_km2", 0) or 1
        scale = math.sqrt(area)
        for score, full, ru in scored:
            pairs.append((score / scale, key, full, ru))
    pairs.sort(key=lambda x: (-x[0], x[2]))
    for score, key, full, ru in pairs:
        if key in assigned or norm(full) in taken:
            continue
        assigned[key] = full
        if ru:
            ru_names[key] = ru
        taken.add(norm(full))
    unresolved = [k for k in candidates if k not in assigned]

    # запись
    report = {"kept": {}, "renamed": {}, "unresolved": []}
    for path, data in docs.items():
        for i, ft in enumerate(data["features"]):
            key = (path, i)
            old = ft["properties"]["name"]
            if key in keep:
                report["kept"][old] = old
                new = old
            elif key in assigned:
                new = assigned[key]
                report["renamed"][old] = new
            else:
                report["unresolved"].append(old)
                continue
            ft["properties"]["name"] = new
            ft["properties"]["source"] = SOURCE_TAG
            if key in ru_names:
                ft["properties"]["name_ru"] = ru_names[key]
        out = path.replace(".geojson", ".named.geojson")
        json.dump(data, open(out, "w", encoding="utf-8"),
                  ensure_ascii=False)
        print(f"записан {os.path.basename(out)}")

    json.dump(report, open(os.path.join(HERE, "rename_report.json"), "w",
                           encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\nоставлено законных: {len(report['kept'])}")
    print(f"переименовано:      {len(report['renamed'])}")
    print(f"без имени:          {len(report['unresolved'])} {report['unresolved']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
