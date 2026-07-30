#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""audit_region_fragments.py — реестр отделённых кусков регионов.

ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ЕЩЁ ОДИН КЛАСС В audit_map_geometry.py

`audit_map_geometry.py` отвечает на вопрос «есть ли дефект» — да/нет, счёт,
baseline. Здесь вопрос другой: «вот кусок земли, оторванный от своего
региона, — он законный или мусор?». Ответ на него не бинарный, требует
нескольких признаков сразу и, главное, ЧЕЛОВЕЧЕСКОГО решения по каждому
спорному случаю. Смешивать это с пороговым аудитом нельзя: аудит должен
падать на новом дефекте, а реестр — накапливать разобранные случаи.

ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ BASELINE

`config/geometry_audit_baseline.json` означает «дефект известен, терпим».
Список исключений здесь означает противоположное: «это НЕ дефект, так и
должно быть». Разница не косметическая — запись в baseline это долг,
который когда-то надо закрыть, а запись в allowlist закрыта навсегда и
защищает кусок от того, чтобы будущий скрипт его «починил».

ТРИ ГРУППЫ (постановка пользователя, 2026-07-30)

  orphan     настоящая сирота — кусок приписан не тому региону, убирать
  island     законный остров — отделён водой, но принадлежит региону
  enclave    законное админделение — эксклав/анклав внутри суши

ПОЧЕМУ РЕШАЮЩИЙ ПРИЗНАК — СЫРОЙ ИСТОЧНИК, А НЕ ГЕОМЕТРИЯ

Соблазн классифицировать по форме («далеко» + «мелкий» = мусор) не
работает и уже приводил к ложным выводам: остров Ванкувер законно оторван
от материковой British Columbia, Огненная Земля поделена между Чили и
Аргентиной, Бруней физически разрезан Сараваком. Все они «далеко» и
«отдельно», но абсолютно законны.

Устойчивый эталон — Natural Earth ADM1 (`game_map.json`, 4596 фич). Под
каждым куском есть сырая административная единица. Вопрос: входит ли эта
единица в состав региона?

Наивное сравнение «ADM1 под куском против ADM1 под главным телом» НЕ
работает — проверено на данных, дало 1315 ложных находок. Регион 1946
часто крупнее современной единицы: Северо-Западные территории тогда
включали земли, которые сегодня — отдельный Нунавут (выделен в 1999), и
каждый их остров выглядел «чужим». То же с Гренландией и Фиджи.

Рабочий критерий — сколько РЕГИОН покрывает от самой ADM1:

  регион покрывает >= 25% этой ADM1 → единица входит в регион, кусок свой
  регион покрывает доли процента    → регион случайно залез в соседа

Он устойчив к исторической переразметке в обе стороны: СЗТ покрывают
почти весь Нунавут (значит законно включают его), а Washington — San Juan
покрывает 0.01% British Columbia (значит куски канадские, это сирота).

Страна проверяется тем же способом, но отдельно и раньше: кусок на земле
другого государства — сирота независимо от долей. Сравнение идёт с
грунтом главной части, а НЕ с номинальным `iso_a2` региона: историческая
переразметка 1946 (NF, SUN, YUG, CSK) сдвигает код у всего региона
сразу, и Ньюфаундленд, лежащий на современном `CA`, иначе выглядел бы
«чужим» целиком.

ЧТО СКРИПТ НЕ ДЕЛАЕТ

Ничего не удаляет и не меняет геометрию. Только читает, классифицирует и
печатает. Удаление сирот — отдельная задача и отдельное решение
пользователя по конкретному списку.

Запуск:

  python scripts/map/build/audit_region_fragments.py
  python scripts/map/build/audit_region_fragments.py --group orphan
  python scripts/map/build/audit_region_fragments.py --json out/fragments.json
  python scripts/map/build/audit_region_fragments.py --propose-allowlist
"""
import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from geometry_cleanup import area_km2  # noqa: E402
from paths import game_map, out  # noqa: E402

MAP_DIR = Path(__file__).resolve().parents[1]
MASTER = MAP_DIR / "master" / "world_1946.master.geojson"
ALLOWLIST_PATH = MAP_DIR / "config" / "region_fragment_allowlist.json"

# --- пороги -----------------------------------------------------------
# Ниже этой площади кусок не разбирается: на карте 1946 таких «крошек»
# сотни, они не видны ни на одном игровом зуме, и разбор каждой руками
# не окупается. Порог намеренно НЕ используется как «значит мусор» —
# крошки просто не попадают в реестр.
MIN_FRAGMENT_KM2 = 1.0

# Касание своего же тела: части MultiPolygon, соединённые в точке, —
# это одно тело, а не сирота.
TOUCH_DEG = 1e-6

# Какую долю САМОЙ сырой ADM1 должен покрывать регион, чтобы единица
# считалась входящей в него. Нормировка на площадь ADM1, а не региона —
# принципиальна: она отличает «регион поглотил единицу» от «регион задел
# соседа краем». 25% выбрано с запасом вниз: регион 1946 может делить
# современную единицу с соседом (Огненная Земля, Тимор), и половины не
# наберётся, тогда как случайный залаз даёт доли процента.
MEMBER_COVER_FRACTION = 0.25

# Доля периметра, лежащая у воды, при которой кусок считается островом.
# Не 1.0: у берега всегда есть узлы, где вода отходит на доли метра.
ISLAND_WATER_FRACTION = 0.95

# Допуск при измерении «граница куска идёт вдоль воды» — 1e-5° ≈ 1.1 м,
# та же величина, что в клиентском TopologyBuilder.
SHARED_EDGE_DEG = 1e-5

# Точность ключа в allowlist: 0.01° ≈ 1.1 км. Крупнее — разные куски
# схлопнутся в один ключ; мельче — ключ будет дрейфовать от float-шума
# при каждой пересборке (та же ошибка, что описана в audit_map_geometry
# про координатные ключи).
KEY_PRECISION = 2


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def valid(g):
    return g if g.is_valid else g.buffer(0)


def planar_km2(g):
    b = g.bounds
    lat = (b[1] + b[3]) / 2.0
    return g.area * 111.0 * 111.0 * abs(math.cos(math.radians(lat)))


def safe_area_km2(g):
    """Геодезическая площадь, ограниченная планарной оценкой.

    Тот же приём, что в audit_map_geometry.safe_area_km2: на фигурах,
    вытянутых вдоль параллели, pyproj завышает площадь на порядки
    (полоса вдоль 60°N дала 25 070 км² вместо 0.4)."""
    return min(area_km2(g), planar_km2(g))


def frag_key(region_id, geom):
    c = geom.representative_point()
    return f"{region_id}@{round(c.x, KEY_PRECISION)},{round(c.y, KEY_PRECISION)}"


def load_allowlist():
    if not ALLOWLIST_PATH.exists():
        return {}
    with open(ALLOWLIST_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return {e["key"]: e for e in data.get("allowed", [])}


class RawIndex:
    """Сырой Natural Earth ADM1 с поиском «какая единица лежит под фигурой»."""

    def __init__(self, raw):
        self.raw = raw
        self.geoms = [valid(shape(ft["geometry"])) for ft in raw]
        self.tree = STRtree(self.geoms)
        self._area = {}

    def area_of(self, i):
        if i not in self._area:
            self._area[i] = safe_area_km2(self.geoms[i])
        return self._area[i]

    def owner(self, geom):
        """Доминирующая по площади пересечения сырая ADM1 под фигурой.

        Возвращает (idx, adm1_code, name_en, iso_a2) либо None, если сырьё
        эту область не покрывает вовсе."""
        best, best_a = None, 0.0
        for i in self.tree.query(geom):
            i = int(i)
            inter = geom.intersection(self.geoms[i])
            if inter.is_empty:
                continue
            a = safe_area_km2(inter)
            if a > best_a:
                best_a, best = a, i
        if best is None:
            return None
        p = self.raw[best]["properties"]
        return (best, p.get("adm1_code"),
                p.get("name_en") or p.get("name"), p.get("iso_a2"))

    def members_of(self, region_geom):
        """Множество индексов ADM1, которые ВХОДЯТ в регион.

        Единица считается входящей, если регион покрывает не меньше
        MEMBER_COVER_FRACTION её собственной площади. Именно эта
        нормировка (на площадь ADM1, а не региона) отличает «регион
        законно поглотил единицу целиком» от «регион случайно задел
        соседа краем»."""
        members = set()
        for i in self.tree.query(region_geom):
            i = int(i)
            inter = region_geom.intersection(self.geoms[i])
            if inter.is_empty:
                continue
            total = self.area_of(i)
            if total <= 0:
                continue
            if safe_area_km2(inter) / total >= MEMBER_COVER_FRACTION:
                members.add(i)
        return members


def water_fraction(part, water_tree, water_geoms):
    """Доля периметра куска, идущая вдоль воды.

    Именно этот признак отделяет остров от эксклава: у острова почти вся
    граница общая с морем/озером, у эксклава — с сушей соседей."""
    b = part.boundary
    if b.length <= 0:
        return 0.0
    idx = water_tree.query(part.buffer(SHARED_EDGE_DEG * 10))
    if not len(idx):
        return 0.0
    wu = unary_union([water_geoms[int(i)] for i in idx])
    shared = b.intersection(wu.buffer(SHARED_EDGE_DEG))
    return min(1.0, shared.length / b.length)


def classify(part_owner, main_owner, members, wfrac):
    """Группа куска и человекочитаемая причина.

    Порядок проверок важен: «чужая страна» перебивает всё остальное —
    остров у чужого берега всё равно приписан не туда."""
    if part_owner is None:
        return ("unsourced",
                "сырьё не покрывает этот кусок — либо синтез из дыры моря, "
                "либо мусор сборки")
    if main_owner is None:
        return ("unsourced",
                "тело региона само не подтверждено сырьём, сравнивать не с чем")

    p_idx, _p_code, p_name, p_iso = part_owner
    _m_idx, _m_code, m_name, m_iso = main_owner

    if p_iso != m_iso and p_iso not in (None, "-1"):
        return ("orphan",
                f"лежит в «{p_name}» ({p_iso}), а тело региона — "
                f"в «{m_name}» ({m_iso}): кусок чужой страны")
    if p_idx not in members:
        return ("foreign_adm1",
                f"лежит в «{p_name}», которая в состав региона не входит "
                f"(регион покрывает её меньше чем на "
                f"{MEMBER_COVER_FRACTION*100:.0f}%): нужен разбор")
    if wfrac >= ISLAND_WATER_FRACTION:
        return ("island",
                f"{wfrac*100:.0f}% периметра по воде, «{p_name}» входит в регион")
    return ("enclave",
            f"суша примыкает к соседям ({(1-wfrac)*100:.0f}% периметра), "
            f"«{p_name}» входит в регион")


GROUP_TITLES = {
    "orphan": "НАСТОЯЩИЕ СИРОТЫ — кусок чужой страны, убирать",
    "foreign_adm1": "СПОРНЫЕ — своя страна, чужая административная единица",
    "unsourced": "БЕЗ ИСТОЧНИКА — сырьё не подтверждает",
    "island": "ЗАКОННЫЕ ОСТРОВА",
    "enclave": "ЗАКОННОЕ АДМИНДЕЛЕНИЕ — эксклавы/анклавы",
}
GROUP_ORDER = ["orphan", "foreign_adm1", "unsourced", "enclave", "island"]


def collect(world_path):
    world = load_features(world_path)
    raw = RawIndex(load_features(game_map()))

    water_geoms, land = [], []
    for ft in world:
        p = ft["properties"]
        g = valid(shape(ft["geometry"]))
        if p.get("region_type") in ("sea", "lake"):
            water_geoms.append(g)
        elif p.get("region_type") == "land":
            land.append((p, g))
    water_tree = STRtree(water_geoms)

    frags = []
    for p, g in land:
        if g.geom_type != "MultiPolygon":
            continue
        ps = sorted(g.geoms, key=lambda q: -q.area)
        main = ps[0]
        candidates = [q for q in ps[1:]
                      if safe_area_km2(q) >= MIN_FRAGMENT_KM2
                      and q.distance(main) >= TOUCH_DEG]
        if not candidates:
            continue
        main_owner = raw.owner(main)
        # Единица под главным телом — своя по определению. Без этого
        # регионы МЕЛЬЧЕ своей ADM1 (county-кластеры США, секторы
        # Антарктиды, бразильские микрорегионы) не наберут 25% и все их
        # законные острова уедут в «спорные»: замерено — 262 находки, из
        # которых Антарктида, Albany, Ponta Porã и San Juan были ложными.
        members = raw.members_of(g)
        if main_owner is not None:
            members.add(main_owner[0])
        for part in candidates:
            a = safe_area_km2(part)
            wfrac = water_fraction(part, water_tree, water_geoms)
            group, reason = classify(raw.owner(part), main_owner, members, wfrac)
            c = part.representative_point()
            frags.append({
                "key": frag_key(p.get("region_id"), part),
                "region_id": p.get("region_id"),
                "name": p.get("name"),
                "group": group,
                "area_km2": round(a, 2),
                "dist_km": round(part.distance(main) * 111.0, 1),
                "water_fraction": round(wfrac, 3),
                "at": [round(c.x, 4), round(c.y, 4)],
                "reason": reason,
            })
    return frags


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--world", default=None,
                    help="путь к world geojson (по умолчанию мастер)")
    ap.add_argument("--group", default=None,
                    help="показать только одну группу: " + ", ".join(GROUP_ORDER))
    ap.add_argument("--json", dest="json_out", default=None,
                    help="выгрузить полный реестр в файл")
    ap.add_argument("--propose-allowlist", action="store_true",
                    help="напечатать заготовку списка исключений из island/enclave "
                         "(в файл НЕ пишет: каждая строка требует глаза человека)")
    ap.add_argument("--show-allowed", action="store_true",
                    help="показывать и те куски, что уже в списке исключений")
    args = ap.parse_args()

    world_path = args.world or (str(MASTER) if MASTER.exists()
                                else out("world_1946.geojson"))
    print(f"  геометрия: {Path(world_path).name}", flush=True)
    print(f"  сырьё:     {Path(game_map()).name}", flush=True)

    frags = collect(world_path)
    allowed = load_allowlist()

    known = [f for f in frags if f["key"] in allowed]
    fresh = [f for f in frags if f["key"] not in allowed]
    shown = frags if args.show_allowed else fresh

    by_group = defaultdict(list)
    for f in shown:
        by_group[f["group"]].append(f)

    print(f"\nкусков разобрано: {len(frags)} (порог {MIN_FRAGMENT_KM2} км²), "
          f"в списке исключений: {len(known)}")

    for grp in GROUP_ORDER:
        items = by_group.get(grp, [])
        if args.group and grp != args.group:
            continue
        if not items:
            continue
        print(f"\n=== {GROUP_TITLES[grp]} — {len(items)} ===")
        for f in sorted(items, key=lambda x: -x["area_km2"]):
            mark = "  [в исключениях]" if f["key"] in allowed else ""
            print(f"  {f['area_km2']:9.2f} км²  {f['region_id']} ({f['name']}){mark}")
            print(f"      {f['at'][0]}, {f['at'][1]}  в {f['dist_km']} км от тела")
            print(f"      {f['reason']}")

    if args.propose_allowlist:
        proposal = [{
            "key": f["key"], "region_id": f["region_id"], "name": f["name"],
            "group": f["group"], "area_km2": f["area_km2"], "at": f["at"],
            "reason": f["reason"],
        } for f in fresh if f["group"] in ("island", "enclave")]
        print("\n--- заготовка для config/region_fragment_allowlist.json ---")
        print(json.dumps({"allowed": proposal}, ensure_ascii=False, indent=2))

    if args.json_out:
        Path(args.json_out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump({"fragments": frags}, f, ensure_ascii=False, indent=2)
        print(f"\nреестр записан: {args.json_out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
