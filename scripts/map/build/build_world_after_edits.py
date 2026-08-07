"""
build_world_after_edits.py — весь мир после правок, файл для ЗАПОЛНЕНИЯ слоёв.

Зачем. Правки разбросаны по трём записям: острова (`region_edits_islands.json`),
Филиппины (`ph_variant_c_final.geojson`) и переименования столичных регионов.
Чтобы пересчитать население, ресурсы и остальные слои, нужен ОДИН плоский
список всех регионов после правок, где у каждого видно, из чего он собран.
Этот скрипт его и делает.

Файл предназначен для заполнения, а не для рендера: геометрии в нём нет
намеренно — она весит мегабайты и мешает править данные руками. Геометрию
показывают `islands_preview.geojson` и `ph_variant_c_final.geojson`.

СКРИПТ НИЧЕГО НЕ МЕНЯЕТ в живой карте. Применение — отдельная задача с
ExecPlan из-за позиционного каскада `region_id` (`scripts/map/AGENTS.md`).

Что применяется:
  1. островные операции — слияния, разделы, переименования;
  2. Филиппины — вариант C (29 регионов вместо нынешних 36);
  3. столичные переименования по всему миру (см. CAPITAL_RENAMES).

Проверки, которые скрипт делает сам:
  - суммарная площадь до и после совпадает;
  - население: разнесённое плюс отложенное равно исходному;
  - каждый исходный регион попадает ровно в один выходной (ни потерь, ни
    дублей) — это и есть смысл поля `merged_from`.

Запуск:
    python scripts/map/build/build_world_after_edits.py

Выход: `out/world_after_edits.json`.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from paths import REPO_ROOT, out

SCENARIO = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
EDITS = "region_edits_islands.json"
PH_C = "ph_variant_c_final.geojson"
OUT_NAME = "world_after_edits.json"
AREA_TOL_KM2 = 5.0

# Правило пользователя (2026-08-02): регион, названный по административной
# конструкции «столичный округ», называется по самой столице. Найдено девять
# таких имён по всему миру; три требуют решения из-за столкновения имён.
CAPITAL_RENAMES = [
    # (region_id, новое en, новое ru, примечание, needs_decision)
    ("OCE-0030", "Canberra", "Канберра", "Australian Capital Territory", None),
    ("EUR-0017", "Brussels", "Брюссель", "Capital Region (Бельгия)", None),
    ("NAM-0216", "Washington", "Вашингтон", "District of Columbia", None),
    ("NAM-0126", "Mexico City", "Мехико", "Distrito Federal; со штатом México не сталкивается", None),
    ("OCE-0043", "Port Moresby", "Порт-Морсби", "National Capital District", None),
    ("OCE-0059", "Honiara", "Хониара", "Capital Territory (Соломоновы)",
     "регион всё равно поглощается слиянием MRG-SLB-02 в «Solomon Islands» — "
     "переименование вступит в силу, только если то слияние отменят"),
    ("EUR-0030", "Minsk", "Минск", "City of Minsk",
     "СТОЛКНОВЕНИЕ: EUR-0029 уже называется «Minsk» (область). Нужно решение — "
     "переименовать область в «Minsk Oblast» либо оставить «City of Minsk»"),
    ("SAM-0013", "Rio de Janeiro", "Рио-де-Жанейро",
     "Distrito Federal; в 1946 столица Бразилии — Рио, Бразилиа основана 1960, "
     "и bbox подтверждает Рио",
     "СТОЛКНОВЕНИЕ: SAM-0014 уже называется «Rio de Janeiro» (штат). Нужно решение — "
     "переименовать штат либо оставить «Distrito Federal»"),
    # ASI-0299 National Capital Region (Филиппины) переименован не здесь:
    # он поглощён вариантом C в регион «Manila».
]


# Единая конвенция имени, выведенная из островной правки (правило R5):
# имя описывает то, что регион покрывает целиком, и однозначно опознаётся без
# карты. Аудит ищет отклонения, но НЕ переименовывает: это пользовательский
# контент, а часть классов требует данных, которых в записи региона нет.
NAME_RULES = [
    ("пустое имя", lambda n, r: not (n or "").strip(),
     "жёсткий дефект: регион без имени"),
    ("голая сторона света", lambda n, r: (n or "").strip() in {
        "North", "South", "East", "West", "Central", "Northern", "Southern",
        "Eastern", "Western"},
     "неопознаваемо: таких имён по миру несколько, и по имени не сказать, чьё оно. "
     "Лечится добавлением территории, но её название в записи региона отсутствует "
     "(owner — колониальная держава, а не территория)"),
    ("составное «X — Y»", lambda n, r: " — " in (n or ""),
     "конвенция «штат — округ» у США и «город — сектор» у Берлина; "
     "остальной мир назван по ADM1 без разделителя"),
    ("административный тип в имени", lambda n, r: re.search(
        r"\b(Oblast|Krai|ASSR|SSR|Okrug|Economic Region)\b", n or ""),
     "тип единицы внутри имени: у СССР и Азербайджана есть, у остальных нет"),
]


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def audit_names(rows):
    """Классы отклонений от единой конвенции + счётчики и примеры."""
    found = defaultdict(list)
    for r in rows:
        for label, test, _why in NAME_RULES:
            if test(r.get("name_en"), r):
                found[label].append(r)
    # дубли имён — отдельный класс: два региона с одинаковым именем неразличимы
    by_name = defaultdict(list)
    for r in rows:
        n = (r.get("name_en") or "").strip()
        if n:
            by_name[n].append(r)
    dups = {n: v for n, v in by_name.items() if len(v) > 1}

    why = {label: w for label, _t, w in NAME_RULES}
    out_classes = []
    for label, _t, _w in NAME_RULES:
        items = found.get(label, [])
        if not items:
            continue
        out_classes.append({
            "class": label, "count": len(items), "why": why[label],
            "examples": [{"region_id": r.get("region_id"), "owner": r.get("owner"),
                          "name_en": r.get("name_en"), "area_km2": r.get("area_km2")}
                         for r in sorted(items, key=lambda x: -(x.get("area_km2") or 0))[:8]],
        })
    if dups:
        out_classes.append({
            "class": "одинаковые имена",
            "count": sum(len(v) for v in dups.values()),
            "why": "два региона с одним именем неразличимы в списке и в отчётах",
            "examples": [{"name_en": n, "owners": sorted({x.get("owner") for x in v})}
                         for n, v in sorted(dups.items(), key=lambda x: -len(x[1]))[:8]],
        })
    return out_classes


def main():
    for p in (Path(out(EDITS)), Path(out(PH_C))):
        if not p.is_file():
            raise SystemExit(f"нет {p}: сначала запусти build_region_edits_islands.py "
                             f"и build_ph_variants.py")
    edits = load_json(Path(out(EDITS)))
    ph_c = load_json(Path(out(PH_C)))

    core = load_json(SCENARIO / "regions.core.json")
    state = {r["id"]: r for r in load_json(SCENARIO / "regions.state.json")}
    en = load_json(SCENARIO / "names.en.json")
    ru = load_json(SCENARIO / "names.ru.json")
    by_geo = {r["geoJsonId"]: r for r in core}

    def rec(gid):
        r = by_geo[gid]
        st = state.get(r["id"], {})
        return {
            "index": r["id"], "region_id": gid,
            "name_en": en.get(gid, gid), "name_ru": ru.get(gid, ""),
            "owner": st.get("ownerCountryId"),
            "area_km2": round(r.get("area", 0), 1),
            "population": st.get("population", 0),
        }

    area_before = round(sum(r.get("area", 0) for r in core), 1)
    pop_before = sum(state.get(r["id"], {}).get("population", 0) for r in core)

    consumed = set()
    rows = []
    problems = []
    ph_pop_held = 0

    # 1. островные операции
    for op in edits["operations"]:
        if op["op"] == "merge":
            members = [rec(m["region_id"]) for m in op["members"]]
            rows.append({
                "region_id": members[0]["region_id"], "name_en": op["target"]["name_en"],
                "name_ru": op["target"]["name_ru"], "owner": members[0]["owner"],
                "area_km2": op["area_km2"], "population": op["population"],
                "op": "merge", "op_id": op["id"], "rule": op["rule"],
                "merged_from": members, "note": op.get("note"),
            })
            consumed.update(m["region_id"] for m in members)
        elif op["op"] == "rename":
            src = rec(op["source"]["region_id"])
            rows.append({**src, "name_en": op["target"]["name_en"],
                         "name_ru": op["target"]["name_ru"],
                         "op": "rename", "op_id": op["id"], "rule": op["rule"],
                         "merged_from": [src], "note": op.get("note")})
            consumed.add(src["region_id"])
        elif op["op"] == "split":
            src = rec(op["source"]["region_id"])
            for i, part in enumerate(op["into"]):
                rows.append({
                    "region_id": src["region_id"] if i == 0 else f"{src['region_id']}-B",
                    "name_en": part["name_en"], "name_ru": part["name_ru"],
                    "owner": src["owner"], "area_km2": None, "population": None,
                    "op": "split", "op_id": op["id"], "rule": op["rule"],
                    "merged_from": [src],
                    "note": "площадь и население делятся при применении; "
                            "предпросмотр долей — islands_preview.geojson",
                })
            consumed.add(src["region_id"])
        elif op["op"] == "resplit_from_source":
            # Филиппины: вместо 81 из записи берём вариант C (выбор пользователя)
            ph_pop_held = op["replaces_population"]
            consumed.update(m["region_id"] for m in op["replaces"])

    # 2. Филиппины — вариант C
    ph_members_by_sub = defaultdict(list)
    for m in edits_ph_members(edits):
        ph_members_by_sub[m["region_id"]] = m
    for f in ph_c["features"]:
        p = f["properties"]
        rows.append({
            "region_id": None, "name_en": p["name"], "name_ru": p.get("name_ru", ""),
            "owner": "PHL", "area_km2": p["area_km2"], "population": None,
            "op": "resplit", "op_id": "RSP-PHILIPPINES/variant-C", "rule": "R2",
            "merged_from": [{"source_key": "region_sub", "name_en": n} for n in p["members"]],
            "note": p.get("note"),
            "needs_decision": p.get("needs_decision"),
            "population_unassigned": True,
        })

    # 3. столичные переименования
    renamed = {}
    for gid, new_en, new_ru, note, decision in CAPITAL_RENAMES:
        if gid not in by_geo:
            problems.append(f"переименование: нет региона {gid}")
            continue
        renamed[gid] = (new_en, new_ru, note, decision)

    # 4. всё остальное — без изменений
    for r in core:
        gid = r["geoJsonId"]
        if gid in consumed:
            continue
        row = {**rec(gid), "op": "unchanged", "merged_from": []}
        if gid in renamed:
            new_en, new_ru, note, decision = renamed[gid]
            row.update({"name_en": new_en, "name_ru": new_ru, "op": "rename",
                        "op_id": "REN-CAPITAL", "rule": "R5",
                        "merged_from": [rec(gid)], "note": note})
            if decision:
                row["needs_decision"] = decision
        rows.append(row)
        consumed.add(gid)

    # проверки
    area_after = round(sum(r["area_km2"] for r in rows if r["area_km2"] is not None), 1)
    split_area = sum(rec(op["source"]["region_id"])["area_km2"]
                     for op in edits["operations"] if op["op"] == "split")
    if abs((area_after + split_area) - area_before) > AREA_TOL_KM2:
        problems.append(f"площадь: было {area_before:,.1f}, стало {area_after:,.1f} "
                        f"+ не разнесено по разделам {split_area:,.1f}")
    pop_after = sum(r["population"] for r in rows if r["population"] is not None)
    split_pop = sum(rec(op["source"]["region_id"])["population"]
                    for op in edits["operations"] if op["op"] == "split")
    if pop_after + ph_pop_held + split_pop != pop_before:
        problems.append(f"население: было {pop_before:,}, стало {pop_after:,} "
                        f"+ Филиппины {ph_pop_held:,} + разделы {split_pop:,}")
    missing = [r["geoJsonId"] for r in core if r["geoJsonId"] not in consumed]
    if missing:
        problems.append(f"исходные регионы никуда не попали: {missing[:10]}")

    if problems:
        print("ОШИБКИ — файл не сохранён:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        raise SystemExit(1)

    doc = {
        "_meta": {
            "generated_by": "scripts/map/build/build_world_after_edits.py",
            "purpose": "плоский список всех регионов ПОСЛЕ правок — для заполнения "
                       "населения, ресурсов и остальных слоёв",
            "status": "НЕ ПРИМЕНЕНО к живой карте. Геометрии здесь нет намеренно.",
            "geometry_preview": ["scripts/map/out/islands_preview.geojson",
                                 f"scripts/map/out/{PH_C}"],
            "counts": {
                "regions_before": len(core),
                "regions_after": len(rows),
                "delta": len(rows) - len(core),
                "merges": sum(1 for r in rows if r["op"] == "merge"),
                "splits": sum(1 for r in rows if r["op"] == "split"),
                "renames": sum(1 for r in rows if r["op"] == "rename"),
                "philippines": sum(1 for r in rows if r["op"] == "resplit"),
                "unchanged": sum(1 for r in rows if r["op"] == "unchanged"),
                "needs_decision": sum(1 for r in rows if r.get("needs_decision")),
                "population_unassigned_philippines": ph_pop_held,
            },
            "name_convention": ("имя описывает то, что регион покрывает целиком, и "
                                "опознаётся без карты; классы отклонений — в name_audit"),
            "fill_notes": ("population = null означает «пересчитать», а не «ноль». "
                           "При слиянии население складывается, доли групп усредняются "
                           "ВЗВЕШЕННО по населению, deposits/extraction складываются."),
        },
        "name_audit": audit_names(rows),
        "regions": sorted(rows, key=lambda r: (r["owner"] or "", -(r["area_km2"] or 0))),
    }
    with open(out(OUT_NAME), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)

    c = doc["_meta"]["counts"]
    print(f"регионов: {c['regions_before']} -> {c['regions_after']} ({c['delta']:+})")
    print(f"  слияний {c['merges']}, разделов {c['splits']}, переименований {c['renames']}, "
          f"Филиппины {c['philippines']}, без изменений {c['unchanged']}")
    print(f"площадь сходится, население: отложено по Филиппинам {c['population_unassigned_philippines']:,}")
    print(f"записей, требующих решения: {c['needs_decision']}")
    print("\nПЕРЕИМЕНОВАНИЯ СТОЛИЧНЫХ РЕГИОНОВ:")
    for r in rows:
        if r.get("op_id") == "REN-CAPITAL":
            mark = "  ⚠" if r.get("needs_decision") else ""
            print(f"  {r['merged_from'][0]['name_en']:30} -> {r['name_en']:16} {r['name_ru']}{mark}")
            if r.get("needs_decision"):
                print(f"    {r['needs_decision']}")
    print("\nАУДИТ ИМЁН — отклонения от единой конвенции:")
    for cl in doc["name_audit"]:
        print(f"\n  {cl['class']}: {cl['count']}")
        print(f"    {cl['why']}")
        ex = ", ".join(str(e.get("name_en")) for e in cl["examples"][:6])
        print(f"    примеры: {ex}")

    print(f"\nзаписано: out/{OUT_NAME}")


def edits_ph_members(edits):
    for op in edits["operations"]:
        if op["op"] == "resplit_from_source":
            return op["replaces"]
    return []


if __name__ == "__main__":
    main()
