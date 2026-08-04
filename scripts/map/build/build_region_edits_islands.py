"""
build_region_edits_islands.py — запись изменений состава островных регионов.

Зачем. Решения пользователя (2026-08-02) по островам приняты списком, но НЕ
применены: сначала нужна машиночитаемая запись, по которой потом пересчитают
население, ресурсы и остальные слои. Скрипт НИЧЕГО НЕ МЕНЯЕТ в карте — он
собирает запись: что с чем сливается, что делится, что переименовывается,
и по каким правилам.

КУРИРОВАНИЕ ЖИВЁТ В КОДЕ, ЧИСЛА — В ДАННЫХ. Список решений ниже задан
вручную, а состав групп, индексы, площади и население берутся из
`out/islands_index.json` при каждом прогоне. Каждая запись несёт ожидаемое
число регионов и площадь: разошлось — скрипт падает, а не выдаёт молча
устаревшую запись. Иначе первая же пересборка карты сделала бы запись
неверной незаметно.

ПРАВИЛА, ВЫВЕДЕННЫЕ ИЗ РЕШЕНИЙ (обоснование каждого — в `docs/DECISIONS.md`):

  R1  Одна периферийная политическая единица 1946 года = один регион.
  R2  Театр режется по источнику, а не по нашей нарезке (Филиппины по
      `region_sub` из `game_map.json`).
  R3  Островной огрызок административной единицы возвращается в неё.
  R4  Регион не охватывает разные острова: разделённый границей остров и
      удалённая цепь получают свои регионы.
  R5  Имя описывает то, что регион покрывает целиком, а не одну его часть.
  R6  Всё, чего нет в этой записи, остаётся как есть.
  R7  Город-регион вливается в свою область; столица остаётся регионом.
      Китай и Корею правило НЕ затрагивает: их собирает отдельный
      `build_china_1946_v2.py`, где разделение отработано специально.

Запуск:
    python scripts/map/build/build_region_edits_islands.py
    python scripts/map/build/build_region_edits_islands.py --strict   # падать и на открытых вопросах

Выход: `out/region_edits_islands.json`.
"""
import argparse
import json
import sys
from pathlib import Path

from paths import REPO_ROOT, out

SCENARIO = REPO_ROOT / "server" / "data" / "scenarios" / "1946"
INDEX = "islands_index.json"
OUT_NAME = "region_edits_islands.json"

# Допуск сверки площади: индекс округляет до 0.1 км² на регион, суммы копятся.
AREA_TOL_KM2 = 1.0

# ── R1: слияние кластера в один регион ───────────────────────────────────────
# cluster_name — как он лежит в islands_index.json (имя крупнейшей единицы);
# expect_regions / expect_area_km2 — страховка от дрейфа данных.
MERGE_CLUSTERS = [
    # (cluster_name, expect_regions, expect_area_km2, target_en, target_ru, note)
    ("West New Britain", 2, 36013.3, "New Britain", "Новая Британия",
     "две половины одного острова; имя по острову, а не по западной части"),
    ("Guadalcanal", 9, 26264.0, "Solomon Islands", "Соломоновы Острова",
     "британский протекторат целиком; Гуадалканал перестаёт быть отдельной целью — решение пользователя"),
    ("Comoros", 2, 2051.0, "Comoros", "Коморские Острова", "Коморы вместе с Майоттой"),
    ("Zanzibar South and Central", 2, 2504.0, "Zanzibar", "Занзибар",
     "Занзибар и Пемба — один протекторат"),
    ("Grand'Anse", 3, 233.0, "Seychelles", "Сейшельские Острова", "одна колония"),
    ("Santa Catarina", 9, 3912.0, "Cape Verde", "Кабо-Верде", "одна колония, девять регионов"),
    ("Curaçao", 3, 898.0, "Leeward Antilles", "Подветренные Антилы",
     "Кюрасао, Бонайре, Аруба — голландские ABC-острова"),
    ("Nueva Esparta", 2, 1389.0, "Venezuelan Antilles", "Венесуэльские Антилы",
     "Нуэва-Эспарта и федеральные владения"),
    ("Rio Claro-Mayaro", 2, 5117.0, "Trinidad and Tobago", "Тринидад и Тобаго",
     "имя региона было по одному округу Тринидада — дефект класса R5"),
    ("Dominica", 4, 2036.0, "Windward Islands", "Наветренные острова",
     "британская колониальная группа"),
    ("Antigua and Barbuda", 6, 998.0, "Leeward Islands", "Подветренные острова",
     "британская группа; не путать с голландскими Подветренными Антилами"),
    ("São Tomé", 2, 1036.0, "São Tomé and Príncipe", "Сан-Томе и Принсипи", "одна колония"),
    # добавлено 2026-08-02 по ответам на открытые вопросы Q-QND-02, Q-GBR-19, Q-USA-03
    ("Sint Maarten", 3, 45.7, "Windward Netherlands Antilles", "Наветренные Нидерландские Антилы",
     "Синт-Мартен, Саба, Синт-Эстатиус — вторая половина Нидерландских Антил; "
     "первая (ABC) слита как Leeward Antilles"),
    ("Jersey", 2, 187.0, "Channel Islands", "Нормандские острова", "Джерси и Гернси — одна коронная зависимость"),
    ("Hawaii — Hawaii", 4, 16675.2, "Hawaii", "Гавайи",
     "территория США четырьмя регионами; слито по решению пользователя, несмотря на статус базы"),
]

# ── R3: островной огрызок возвращается в свою единицу (Япония) ───────────────
# Япония нарезана традиционными регионами (Тохоку, Канто, Кюсю…), но островные
# части префектур остались отдельными регионами с именами префектур.
MERGE_REGIONS = [
    {
        "id": "MRG-JPN-OKINAWA",
        "rule": "R3",
        "members": ["ASI-0198", "ASI-0424"],
        "target_en": "Okinawa",
        "target_ru": "Окинава",
        "note": "две части Окинавы на одном острове ISL-071",
    },
    {
        "id": "MRG-JPN-WEST-KYUSHU",
        "rule": "R3",
        "members": ["ASI-0199", "ASI-0200", "ASI-0425"],
        "target_en": "Western Kyushu",
        "target_ru": "Западный Кюсю",
        "note": "Сага + материковая Нагасаки + островная Нагасаки; имя выбрано пользователем "
                "2026-08-02 (альтернатива «Nagasaki and Saga» отклонена)",
    },
    {
        "id": "MRG-JPN-KYUSHU",
        "rule": "R3",
        "members": ["ASI-0421", "ASI-0420", "ASI-0190"],
        "target_en": "Kyushu",
        "target_ru": "Кюсю",
        "note": "островные части Кагосимы и Кумамото возвращаются в Кюсю",
    },
    # добавлено 2026-08-02 по ответу на Q-JPN-SADO-AWAJI: тот же класс огрызков
    # префектур, что Кумамото и Кагосима, — возвращаются в свои регионы
    {
        "id": "MRG-JPN-CHUBU",
        "rule": "R3",
        "members": ["ASI-0194", "ASI-0423"],
        "target_en": "Chubu",
        "target_ru": "Тюбу",
        "note": "остров Садо (числится регионом «Niigata») возвращается в Тюбу",
    },
    {
        "id": "MRG-JPN-KINKI",
        "rule": "R3",
        "members": ["ASI-0193", "ASI-0422"],
        "target_en": "Kinki",
        "target_ru": "Кинки",
        "note": "остров Авадзи (числится регионом «Hyōgo») возвращается в Кинки",
    },
]

# ── R5: имя описывает то, что регион покрывает целиком ───────────────────────
# Слияния не требуют, только переименования.
RENAMES = [
    {
        "id": "REN-JAVA",
        "rule": "R5",
        "region_id": "ASI-0121",
        "target_en": "Java",
        "target_ru": "Ява",
        "note": "регион покрывает всю Яву (131 764 км² при 138 800 у острова), "
                "а назван по одной провинции — Jawa Barat",
    },
]

# ── R7: город-регион вливается в свою область, кроме столиц ─────────────────
# Решение пользователя 2026-08-02. Города как объекты не теряются: они станут
# точками на карте (MapFeature), а отдельный регион под город даёт лишний узел.
# Столица остаётся регионом.
# ГРАНИЦА ОБЛАСТИ: Китай и Корея собираются отдельным файлом
# (`build_china_1946_v2.py`), где разделение городов и провинций отработано
# специально. Циндао, Гуанчжоу, Харбин, Далянь и Пусан под это правило НЕ
# попадают без отдельного разрешения пользователя (сказано прямо 2026-08-02).
CITY_MERGES = [
    # (город, область, имя результата en, ru, примечание)
    ("EUR-0321", "EUR-0284", "Leningrad Oblast", "Ленинградская область",
     "Ленинград вливается в свою область"),
    ("EUR-0365", "EUR-0345", "Kiev", "Киев", "Киев-город вливается в Киевскую область"),
    ("EUR-0030", "EUR-0029", "Minsk", "Минск", "Минск-город вливается в Минскую область"),
]

# Столицы, которые ОСТАЮТСЯ отдельными регионами — записаны, чтобы правило
# «влить все города» не применили к ним по ошибке в следующий раз.
KEPT_CAPITALS = [
    ("EUR-0320", "Moscow", "столица СССР"),
    ("NAM-0216", "Washington", "столица США"),
    ("ASI-0152", "Delhi", "столица Индии"),
    ("ASI-0259", "Beirut", "столица Ливана"),
]

# Наблюдения того же вида, но вне разрешённой области — только запись, не работа.
CITY_LIKE_OPEN = [
    ("ASI-0312", "F.C.T.", "соседствует с K.P. и Пенджабом — это Исламабад, созданный в 1960; "
                           "в 1946 его не существовало"),
    ("ASI-0153", "Chandigarh", "создан в 1966 как общая столица Пенджаба и Харьяны; "
                               "в 1946 его не существовало"),
    ("ASI-0044/0045/0047/0042/0228", "города Китая и Кореи",
     "Циндао, Гуанчжоу, Харбин, Далянь, Пусан — тот же вид, но область чужая: "
     "их собирает build_china_1946_v2.py, трогать только по отдельному разрешению"),
]

# ── R4: регион не охватывает разные острова ──────────────────────────────────
SPLITS = [
    {
        "id": "SPL-SAKHALIN",
        "rule": "R4",
        "source": "EUR-0300",
        "into": [
            {"name_en": "Sakhalin", "name_ru": "Сахалин"},
            {"name_en": "Kuril Islands", "name_ru": "Курильские острова"},
        ],
        "method": ("полигоны разделяются по принадлежности к телу Сахалина и к цепи Курил; "
                   "критерий задаёт исполнитель и показывает площади обеих частей"),
        "note": "один регион Sakhalin Oblast несёт и остров, и цепь; Курилы — отдельная "
                "спорная с Японией цепь",
    },
    {
        "id": "SPL-WEST-TIMOR",
        "rule": "R4",
        "source": "ASI-0103",
        "into": [
            {"name_en": "West Timor", "name_ru": "Западный Тимор"},
            {"name_en": "Nusa Tenggara Timur", "name_ru": "Восточные Малые Зондские острова"},
        ],
        "method": ("из Nusa Tenggara Timur выделяются полигоны, лежащие на острове Тимор "
                   "(те, что граничат с ASI-0354 Portuguese Timor); остальное остаётся NTT"),
        "note": "Тимор разделён международной границей — его часть обязана быть своим регионом",
    },
]

# ── R2: театр режется по источнику ───────────────────────────────────────────
RESPLITS = [
    {
        "id": "RSP-PHILIPPINES",
        "rule": "R2",
        "owner": "PHL",
        "source_file": "client/src/assets/game_map.json",
        "source_filter": 'iso_a2 == "PH"',
        "source_key": "region_sub",
        "expect_source_features": 118,
        "expect_target_regions": 81,
        "note": ("текущая нарезка в 36 регионов заменяется нарезкой источника по region_sub; "
                 "region_sub заполнен у всех 118 фич, пустых нет"),
        "cascade_warning": ("рост числа регионов на +45 сдвигает позиционную нумерацию всего, "
                            "что идёт после Филиппин: обязателен build/remap_region_ids.py "
                            "и ExecPlan (scripts/map/AGENTS.md)"),
    },
]

# ── Вопросы, заданные проектировщиком и закрытые пользователем 2026-08-02 ────
# Хранятся вместе с ответом: отклонённое решение обязано быть видно, иначе его
# предложат заново через месяц.
RESOLVED_QUESTIONS = [
    {"id": "Q-QND-02", "answer": "да, слить",
     "what": "Sint Maarten + St. Eustatius + Saba — те же Нидерландские Антилы, что и слитый "
             "кластер Curaçao", "became": "MRG-QND-02"},
    {"id": "Q-GBR-19", "answer": "да, слить",
     "what": "Jersey + Guernsey — Нормандские острова", "became": "MRG-GBR-19"},
    {"id": "Q-SUN-02", "answer": "НЕТ, оставить раздельными",
     "what": "Saare + Hiiu (4 042 км², 487 429 чел) — эстонские острова в составе СССР",
     "became": None},
    {"id": "Q-USA-03", "answer": "да, слить",
     "what": "Гавайи, 4 региона — статус передовой базы США слиянию не помешал",
     "became": "MRG-USA-03"},
    {"id": "Q-JPN-SADO-AWAJI", "answer": "да, вернуть в Тюбу и Кинки",
     "what": "Sado (ASI-0423 «Niigata») и Awaji (ASI-0422 «Hyōgo») — огрызки префектур",
     "became": "MRG-JPN-CHUBU, MRG-JPN-KINKI"},
    {"id": "Q-JAWA-NAME", "answer": "да, переименовать",
     "what": "«Jawa Barat» покрывает всю Яву", "became": "REN-JAVA"},
    {"id": "Q-JPN-WEST-KYUSHU-NAME", "answer": "«Западный Кюсю»",
     "what": "имя для слияния Саги с Нагасаки; альтернатива «Nagasaki and Saga» отклонена",
     "became": "MRG-JPN-WEST-KYUSHU"},
]

OPEN_QUESTIONS = []


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strict", action="store_true",
                    help="ненулевой код возврата, пока есть открытые вопросы")
    args = ap.parse_args()

    index_path = Path(out(INDEX))
    if not index_path.is_file():
        raise SystemExit(f"нет {index_path}: сначала запусти build_islands_index.py")
    index = load_json(index_path)

    core_list = load_json(SCENARIO / "regions.core.json")
    core = {r["geoJsonId"]: r for r in core_list}
    geo_by_index = {r["id"]: r["geoJsonId"] for r in core_list}
    state = {r["id"]: r for r in load_json(SCENARIO / "regions.state.json")}
    names_en = load_json(SCENARIO / "names.en.json")
    names_ru = load_json(SCENARIO / "names.ru.json")
    by_cluster_name = {c["suggested_name"]: c for c in index["clusters"]}

    problems = []

    def region_record(gid):
        r = core.get(gid)
        if r is None:
            problems.append(f"регион {gid} отсутствует в сценарии")
            return None
        st = state.get(r["id"], {})
        return {
            "index": r["id"],
            "region_id": gid,
            "name_en": names_en.get(gid, gid),
            "name_ru": names_ru.get(gid, ""),
            "owner": st.get("ownerCountryId"),
            "area_km2": round(r.get("area", 0), 1),
            "population": st.get("population", 0),
        }

    operations = []

    for cname, exp_regions, exp_area, tgt_en, tgt_ru, note in MERGE_CLUSTERS:
        cl = by_cluster_name.get(cname)
        if cl is None:
            problems.append(f"кластер {cname!r} не найден в {INDEX} — состав островов изменился")
            continue
        if cl["region_count"] != exp_regions:
            problems.append(f"{cname}: регионов {cl['region_count']}, ожидалось {exp_regions}")
        if abs(cl["area_km2"] - exp_area) > AREA_TOL_KM2:
            problems.append(f"{cname}: площадь {cl['area_km2']}, ожидалось {exp_area}")
        # кластер хранит числовые индексы регионов, geoJsonId получаем из сценария
        members = [region_record(geo_by_index[i]) for g in cl["groups"] for i in g["region_indices"]]
        members = [m for m in members if m]
        operations.append({
            "id": f"MRG-{cl['cluster_id']}",
            "op": "merge",
            "rule": "R1",
            "source_cluster": cl["cluster_id"],
            "target": {"name_en": tgt_en, "name_ru": tgt_ru},
            "note": note,
            "member_count": len(members),
            "area_km2": round(sum(m["area_km2"] for m in members), 1),
            "population": sum(m["population"] for m in members),
            "members": sorted(members, key=lambda m: -m["area_km2"]),
        })

    for spec in MERGE_REGIONS:
        members = [region_record(g) for g in spec["members"]]
        members = [m for m in members if m]
        op = {
            "id": spec["id"],
            "op": "merge",
            "rule": spec["rule"],
            "target": {"name_en": spec["target_en"], "name_ru": spec["target_ru"]},
            "note": spec["note"],
            "member_count": len(members),
            "area_km2": round(sum(m["area_km2"] for m in members), 1),
            "population": sum(m["population"] for m in members),
            "members": sorted(members, key=lambda m: -m["area_km2"]),
        }
        if "needs_decision" in spec:
            op["needs_decision"] = spec["needs_decision"]
        operations.append(op)

    for city_gid, prov_gid, tgt_en, tgt_ru, note in CITY_MERGES:
        members = [region_record(prov_gid), region_record(city_gid)]  # область первой: она крупнее
        members = [m for m in members if m]
        if len(members) != 2:
            continue
        operations.append({
            "id": f"MRG-CITY-{city_gid}",
            "op": "merge",
            "rule": "R7",
            "target": {"name_en": tgt_en, "name_ru": tgt_ru},
            "note": note,
            "member_count": len(members),
            "area_km2": round(sum(m["area_km2"] for m in members), 1),
            "population": sum(m["population"] for m in members),
            "members": members,
        })

    for spec in SPLITS:
        src = region_record(spec["source"])
        operations.append({
            "id": spec["id"],
            "op": "split",
            "rule": spec["rule"],
            "source": src,
            "into": spec["into"],
            "method": spec["method"],
            "note": spec["note"],
            "needs_decision": "границы раздела и итоговые площади подтверждает пользователь",
        })

    for spec in RESPLITS:
        current = [region_record(g) for g, r in core.items()
                   if state.get(r["id"], {}).get("ownerCountryId") == spec["owner"]]
        current = [m for m in current if m]
        operations.append({
            "id": spec["id"],
            "op": "resplit_from_source",
            "rule": spec["rule"],
            "owner": spec["owner"],
            "source_file": spec["source_file"],
            "source_filter": spec["source_filter"],
            "source_key": spec["source_key"],
            "expect_source_features": spec["expect_source_features"],
            "expect_target_regions": spec["expect_target_regions"],
            "note": spec["note"],
            "cascade_warning": spec["cascade_warning"],
            "replaces_count": len(current),
            "replaces_area_km2": round(sum(m["area_km2"] for m in current), 1),
            "replaces_population": sum(m["population"] for m in current),
            "replaces": sorted(current, key=lambda m: -m["area_km2"]),
        })

    for spec in RENAMES:
        src = region_record(spec["region_id"])
        if src is None:
            continue
        operations.append({
            "id": spec["id"],
            "op": "rename",
            "rule": spec["rule"],
            "source": src,
            "target": {"name_en": spec["target_en"], "name_ru": spec["target_ru"]},
            "note": spec["note"],
        })

    merged_in = sum(o["member_count"] for o in operations if o["op"] == "merge")
    merged_out = sum(1 for o in operations if o["op"] == "merge")
    split_delta = sum(len(o["into"]) - 1 for o in operations if o["op"] == "split")
    resplit_delta = sum(o["expect_target_regions"] - o["replaces_count"]
                        for o in operations if o["op"] == "resplit_from_source")
    net_delta = (merged_out - merged_in) + split_delta + resplit_delta
    projected = len(core_list) + net_delta
    doc = {
        "_meta": {
            "generated_by": "scripts/map/build/build_region_edits_islands.py",
            "status": "ЗАПИСЬ РЕШЕНИЙ, НЕ ПРИМЕНЕНО. Применение — отдельная задача с ExecPlan.",
            "decided_by": "пользователь, 2026-08-02",
            "purpose": ("машиночитаемый список изменений состава регионов, чтобы по нему "
                        "пересчитать население, ресурсы и остальные слои"),
            "rules": {
                "R1": "одна периферийная политическая единица 1946 года = один регион",
                "R2": "театр режется по источнику, а не по нашей нарезке",
                "R3": "островной огрызок административной единицы возвращается в неё",
                "R4": "регион не охватывает разные острова",
                "R5": "имя описывает то, что регион покрывает целиком",
                "R6": "всё, чего нет в этой записи, остаётся как есть",
                "R7": ("город-регион вливается в свою область; столица остаётся регионом. "
                       "Города не теряются: они станут точками на карте. Китай и Корея "
                       "под правило НЕ попадают — их собирает build_china_1946_v2.py"),
            },
            "sources": {
                "islands_index": f"scripts/map/out/{INDEX}",
                "scenario": str(SCENARIO.relative_to(REPO_ROOT)),
            },
            "counts": {
                "operations": len(operations),
                "merges": merged_out,
                "regions_consumed_by_merges": merged_in,
                "regions_produced_by_merges": merged_out,
                "net_change_from_merges": merged_out - merged_in,
                "splits": sum(1 for o in operations if o["op"] == "split"),
                "resplits": sum(1 for o in operations if o["op"] == "resplit_from_source"),
                "renames": sum(1 for o in operations if o["op"] == "rename"),
                "resolved_questions": len(RESOLVED_QUESTIONS),
                "open_questions": len(OPEN_QUESTIONS),
                # главное число для каскада: слияния уменьшают карту, пере-нарезка
                # Филиппин увеличивает её сильнее — суммарно регионов становится БОЛЬШЕ
                "region_count_now": len(core_list),
                "region_count_delta_merges": merged_out - merged_in,
                "region_count_delta_splits": split_delta,
                "region_count_delta_resplits": resplit_delta,
                "region_count_projected": projected,
            },
            "downstream": ("при слиянии население складывается, а доли групп усредняются "
                           "ВЗВЕШЕННО по населению; deposits/extraction складываются; "
                           "позиционные файлы (ownership_1946.json, names_ru.json, "
                           "config/occupation_overlay.json) требуют build/remap_region_ids.py"),
        },
        "operations": operations,
        "kept_capitals": [{"region_id": g, "name": n, "why": w} for g, n, w in KEPT_CAPITALS],
        "city_like_open": [{"region_id": g, "name": n, "why": w} for g, n, w in CITY_LIKE_OPEN],
        "resolved_questions": RESOLVED_QUESTIONS,
        "open_questions": OPEN_QUESTIONS,
    }

    if problems:
        print("РАСХОЖДЕНИЕ С ДАННЫМИ — запись не сохранена:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        raise SystemExit(1)

    with open(out(OUT_NAME), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)

    c = doc["_meta"]["counts"]
    print(f"операций: {c['operations']}  (слияний {c['merges']}, разделов {c['splits']}, "
          f"пере-нарезок {c['resplits']})")
    print(f"слияния: {c['regions_consumed_by_merges']} регионов -> {c['regions_produced_by_merges']}"
          f"  (чистое изменение {c['net_change_from_merges']})")
    print(f"открытых вопросов: {c['open_questions']}")
    print(f"регионов: {c['region_count_now']} -> {c['region_count_projected']}  "
          f"(слияния {c['region_count_delta_merges']:+}, разделы {c['region_count_delta_splits']:+}, "
          f"пере-нарезка {c['region_count_delta_resplits']:+})")
    print()
    for o in operations:
        if o["op"] == "merge":
            print(f"  {o['id']:>18} R{o['rule'][1]}  {o['member_count']:2} -> 1  "
                  f"{o['area_km2']:>9,.0f} км² {o['population']:>10,} чел  -> {o['target']['name_en']}")
        elif o["op"] == "split":
            print(f"  {o['id']:>18} R{o['rule'][1]}  1 -> {len(o['into'])}  "
                  f"{o['source']['area_km2']:>9,.0f} км² {o['source']['population']:>10,} чел  "
                  f"{o['source']['name_en']} -> {', '.join(x['name_en'] for x in o['into'])}")
        elif o["op"] == "rename":
            print(f"  {o['id']:>18} R{o['rule'][1]}  переименование          "
                  f"{o['source']['area_km2']:>9,.0f} км² {o['source']['population']:>10,} чел  "
                  f"{o['source']['name_en']} -> {o['target']['name_en']}")
        else:
            print(f"  {o['id']:>18} R{o['rule'][1]}  {o['replaces_count']} -> "
                  f"{o['expect_target_regions']}  {o['replaces_area_km2']:>9,.0f} км² "
                  f"{o['replaces_population']:>10,} чел  по ключу {o['source_key']}")
    print(f"\nзаписано: out/{OUT_NAME}")

    if args.strict and OPEN_QUESTIONS:
        print(f"\n--strict: остаются {len(OPEN_QUESTIONS)} открытых вопросов", file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
