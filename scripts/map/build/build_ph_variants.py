"""
build_ph_variants.py — два варианта нарезки Филиппин, geojson для сравнения глазами.

Зачем. Сопоставление «современная провинция → 1946» (`out/ph_provinces_1946.json`)
допускает две разные политики, и выбор между ними — продуктовое решение
пользователя, а не следствие дат. Скрипт строит оба варианта из одного
источника, чтобы разницу можно было увидеть, а не воображать.

  A. ПОЛНЫЙ ОТКАТ К 1946 — сливается всё, что создано после снимка.
     Максимальная историчность на дату, минимум регионов.

  B. РЕКОМЕНДУЕМЫЙ — сливается только то, где раздел был административным;
     юг остаётся современным. Причина — `docs/HISTORICAL_ACCURACY.md`
     («Границы регионов», 2026-07-19): приоритет у совместимости с
     конфликтами, которые произойдут ПОЗЖЕ, а не у архивной точности.
     Ланао разделён в 1959 по христианско-мусульманской границе, Котабато и
     Сулу — в 1973 во время войны с МНФО: это линии моро-конфликта, и откат
     к 1946 стёр бы их.

Оба варианта строятся из `game_map.json` — первичного источника геометрии.
Скрипт НИЧЕГО НЕ МЕНЯЕТ в живой карте.

Проверки, которые скрипт делает сам:
  - суммарная геодезическая площадь у обоих вариантов и у исходной нарезки
    по 81 провинции обязана совпасть: слияние не создаёт и не теряет сушу;
  - каждая целевая провинция варианта A обязана встретиться в справочнике;
  - вариант B обязан быть строго между 81 и вариантом A по числу регионов.

Запуск:
    python scripts/map/build/build_ph_variants.py

Выход:
    out/ph_variant_a_1946.geojson         — полный откат
    out/ph_variant_b_recommended.geojson  — рекомендуемый
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

from paths import game_map, out

try:
    from shapely.geometry import shape, mapping
    from shapely.ops import unary_union
    from pyproj import Geod
except ImportError:  # pragma: no cover - зависимость пайплайна
    print("Нужны shapely и pyproj: pip install shapely pyproj", file=sys.stderr)
    raise

GEOD = Geod(ellps="WGS84")
REF = "ph_provinces_1946.json"
OUT_A = "ph_variant_a_1946.geojson"
OUT_B = "ph_variant_b_recommended.geojson"
OUT_C = "ph_variant_c_final.geojson"
AREA_TOL_KM2 = 1.0

# Вариант C — ВЫБОР ПОЛЬЗОВАТЕЛЯ (2026-08-02): вариант A плюс укрупнение
# провинций 1946 в исторические области. Ключи слева — имена провинций 1946
# из варианта A, а не современные.
PH_FINAL_GROUPS = [
    ("Panay", "Панай", ["Iloilo", "Capiz", "Antique", "Romblon"],
     "остров Панай; Ромблон в 1946 был административно слит с Каписом"),
    ("Negros", "Негрос", ["Negros Occidental", "Negros Oriental"], "остров Негрос целиком"),
    ("Mindoro", "Миндоро", ["Mindoro", "Marinduque"], "Миндоро с Мариндуке"),
    ("Ilocos", "Илокос", ["Ilocos Norte", "Abra", "Ilocos Sur", "La Union"], "область Илокос"),
    ("Cagayan Valley", "Долина Кагаян", ["Batanes", "Cagayan", "Isabela"],
     "долина Кагаян с островами Батанес"),
    ("Southern Bicol", "Южный Бикол", ["Catanduanes", "Albay", "Sorsogon"],
     "юг полуострова Бикол с Катандуанесом"),
    ("Central Visayas", "Центральные Висайи", ["Bohol", "Cebu"], "Себу с Бохолем"),
    ("Camarines", "Камаринес", ["Camarines Norte", "Camarines Sur"],
     "до 1920 это была одна провинция Ambos Camarines"),
    ("Southern Tagalog", "Южный Тагалог", ["Batangas", "Laguna", "Cavite"],
     "тагальское ядро южнее Манилы"),
    ("Central Luzon", "Центральный Лусон", ["Bulacan", "Nueva Ecija"],
     "восточная часть центральной равнины; ядро восстания Хуков 1946-1954"),
    ("Western Luzon", "Западный Лусон", ["Zambales", "Bataan", "Pampanga", "Tarlac", "Pangasinan"],
     "западная часть равнины, Батаан и залив Лингайен; Пампанга и Тарлак — тоже "
     "территория Хуков, то есть восстание оказывается разрезанным между двумя регионами"),
]

# Переименования внутри Филиппин: провинция 1946 -> имя в варианте C.
PH_FINAL_RENAMES = {
    "Rizal": ("Manila", "Манила",
              "в варианте A Рисаль вобрал столичный регион; регион со столицей "
              "называется по столице"),
}

# Русские имена провинций 1946, которые в вариант C вошли без слияния.
# Без них итоговый файл мира имел бы 17 регионов с пустым `name_ru`.
PH_RU_NAMES = {
    "Cotabato": "Котабато", "Davao": "Давао", "Zamboanga": "Замбоанга",
    "Mountain Province": "Горная провинция", "Palawan": "Палаван", "Samar": "Самар",
    "Tayabas": "Таябас", "Agusan": "Агусан", "Bukidnon": "Букиднон", "Leyte": "Лейте",
    "Surigao": "Суригао", "Nueva Vizcaya": "Нуэва-Виская", "Lanao": "Ланао",
    "Misamis Oriental": "Восточный Мисамис", "Masbate": "Масбате", "Sulu": "Сулу",
    "Misamis Occidental": "Западный Мисамис",
}

# Имена, требующие подтверждения: географически защитимы, но альтернатива не хуже.
PH_NAME_NEEDS_DECISION = {
    "Southern Bicol": "альтернатива — «Albay»",
    "Central Visayas": "альтернатива — «Cebu»",
    "Southern Tagalog": "альтернатива — «Batangas»",
    "Central Luzon": "альтернатива — «Nueva Ecija»; спорно, что Хуки разделены с Западным Лусоном",
    "Western Luzon": "альтернатива — «Pampanga»",
}

# Вариант B сливает только эти провинции-родители: их разделы были
# административными и ничего значимого не стирают. Всё остальное, что создано
# после 1946, в варианте B остаётся современным.
ADMIN_ONLY_PARENTS = {
    "Mindoro", "Nueva Vizcaya", "Capiz", "Iloilo", "Davao", "Agusan",
    "Surigao", "Mountain Province", "Misamis Oriental", "Zamboanga",
    "Negros Oriental",
}

# Почему остальные родители в вариант B не попали — печатается в отчёт и
# кладётся в свойства, чтобы решение было видно на карте, а не только здесь.
KEPT_MODERN_REASON = {
    "Cotabato": "линия моро-конфликта: Магинданао и Султан-Кударат созданы 1973 во время войны",
    "Lanao": "линия моро-конфликта: раздел 1959 по христианско-мусульманской границе",
    "Sulu": "линия моро-конфликта: Басилан и Тави-Тави 1973",
    "Samar": "восточное побережье — точка высадки Лейте-Самар 1944",
    "Leyte": "Билиран — отдельный остров, Южный Лейте примыкает к высадке 1944",
    "Tayabas": "Аврора — тихоокеанское побережье Лусона, полезно для десантных сценариев",
    "Rizal": "город Манила в 1946 административно вне провинции; слияние её растворяет",
}


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def true_area_km2(geom):
    parts = list(getattr(geom, "geoms", [geom]))
    return sum(abs(GEOD.geometry_area_perimeter(p)[0]) for p in parts) / 1e6


def build(groups, label, note_for):
    """Собирает фичи по словарю {целевое имя: [(современное имя, геометрия)]}."""
    feats = []
    for target in sorted(groups, key=lambda t: -sum(true_area_km2(g) for _, g in groups[t])):
        members = groups[target]
        merged = unary_union([g for _, g in members])
        names = sorted(n for n, _ in members)
        feats.append({
            "type": "Feature",
            "properties": {
                "variant": label,
                "name": target,
                "member_count": len(members),
                "members": names,
                "changed": len(members) > 1 or names != [target],
                "area_km2": round(true_area_km2(merged), 1),
                "polygons": len(list(getattr(merged, "geoms", [merged]))),
                "note": note_for(target, members),
            },
            "geometry": mapping(merged),
        })
    return feats


def main():
    ref_path = Path(out(REF))
    if not ref_path.is_file():
        raise SystemExit(f"нет {ref_path}: сначала запусти build_ph_1946_provinces.py")
    ref = load_json(ref_path)
    to_1946 = {e["modern"]: e["province_1946"] for e in ref["entries"]}
    created = {e["modern"] for e in ref["entries"] if e["status"] == "created_after_1946"}

    src = load_json(Path(game_map()))
    src_feats = src["features"] if isinstance(src, dict) else src
    by_sub = defaultdict(list)
    for f in src_feats:
        p = f["properties"]
        if p.get("iso_a2") == "PH":
            by_sub[p["region_sub"]].append(shape(f["geometry"]))
    modern = {k: unary_union(v) for k, v in by_sub.items()}

    missing = [k for k in modern if k not in to_1946]
    if missing:
        raise SystemExit(f"в справочнике нет провинций: {missing}")

    base_area = round(sum(true_area_km2(g) for g in modern.values()), 1)

    # A: всё к 1946
    groups_a = defaultdict(list)
    for name, geom in modern.items():
        groups_a[to_1946[name]].append((name, geom))

    # B: только административные разделы; остальное остаётся современным
    groups_b = defaultdict(list)
    for name, geom in modern.items():
        parent = to_1946[name]
        target = parent if (name in created and parent in ADMIN_ONLY_PARENTS) else name
        # родитель, сам присутствующий среди современных (Mountain Province,
        # Negros Oriental, Capiz, Iloilo, Nueva Vizcaya, Misamis Oriental),
        # обязан слиться со своими детьми, а не остаться отдельно
        if name not in created and name in ADMIN_ONLY_PARENTS:
            target = name
        groups_b[target].append((name, geom))

    def note_a(target, members):
        return KEPT_MODERN_REASON.get(target, "административный раздел" if len(members) > 1 else None)

    def note_b(target, members):
        if len(members) > 1:
            return "слито: раздел был административным"
        r = KEPT_MODERN_REASON.get(to_1946.get(target, ""))
        return f"оставлено современным — {r}" if r and target in created else None

    # C: вариант A, укрупнённый до исторических областей
    to_final = {}
    ru_of = {}
    note_of = {}
    for en_name, ru_name, members_1946, note in PH_FINAL_GROUPS:
        for m in members_1946:
            to_final[m] = en_name
        ru_of[en_name] = ru_name
        note_of[en_name] = note
    unknown = [m for m in to_final if m not in groups_a]
    if unknown:
        raise SystemExit(f"вариант C ссылается на провинции, которых нет в A: {sorted(unknown)}")

    groups_c = defaultdict(list)
    for prov_1946, members in groups_a.items():
        target = to_final.get(prov_1946, prov_1946)
        if target in PH_FINAL_RENAMES:
            target = PH_FINAL_RENAMES[target][0]
        groups_c[target].extend(members)

    def note_c(target, members):
        if target in note_of:
            return note_of[target]
        for src, (new, _ru, why) in PH_FINAL_RENAMES.items():
            if new == target:
                return why
        return note_a(target, members)

    feats_a = build(groups_a, "A_1946_full", note_a)
    feats_b = build(groups_b, "B_recommended", note_b)
    feats_c = build(groups_c, "C_final", note_c)
    for f in feats_c:
        n = f["properties"]["name"]
        f["properties"]["name_ru"] = ru_of.get(n) or PH_RU_NAMES.get(n, "")
        for src, (new, ru, _why) in PH_FINAL_RENAMES.items():
            if new == n:
                f["properties"]["name_ru"] = ru
        if n in PH_NAME_NEEDS_DECISION:
            f["properties"]["needs_decision"] = PH_NAME_NEEDS_DECISION[n]
    # ни один регион не уходит без русского имени: пустое имя в итоговом файле
    # мира — дефект, который мы же и лечим
    no_ru = [f["properties"]["name"] for f in feats_c if not f["properties"]["name_ru"]]
    if no_ru:
        raise SystemExit(f"вариант C: нет русских имён для {no_ru}")

    area_a = round(sum(f["properties"]["area_km2"] for f in feats_a), 1)
    area_b = round(sum(f["properties"]["area_km2"] for f in feats_b), 1)
    area_c = round(sum(f["properties"]["area_km2"] for f in feats_c), 1)
    problems = []
    for label, area in (("A", area_a), ("B", area_b), ("C", area_c)):
        if abs(area - base_area) > AREA_TOL_KM2:
            problems.append(f"вариант {label}: площадь {area:,.1f} против исходных {base_area:,.1f}")
    if not (len(feats_a) < len(feats_b) < len(modern)):
        problems.append(f"вариант B должен быть строго между A и исходной нарезкой: "
                        f"{len(feats_a)} / {len(feats_b)} / {len(modern)}")
    if len(feats_c) >= len(feats_a):
        problems.append(f"вариант C должен быть КРУПНЕЕ A: {len(feats_c)} против {len(feats_a)}")
    # каждая из 81 современной провинции обязана попасть ровно в один регион C
    seen_c = [m for f in feats_c for m in f["properties"]["members"]]
    if sorted(seen_c) != sorted(modern):
        problems.append(f"вариант C покрывает {len(seen_c)} провинций из {len(modern)}")
    if problems:
        print("ОШИБКИ — файлы не сохранены:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        raise SystemExit(1)

    for name, feats, label, desc in (
        (OUT_A, feats_a, "A_1946_full", "полный откат к провинциям 1946 года"),
        (OUT_B, feats_b, "B_recommended", "слиты только административные разделы; юг современный"),
        (OUT_C, feats_c, "C_final", "ВЫБОР ПОЛЬЗОВАТЕЛЯ: вариант A, укрупнённый до исторических областей"),
    ):
        doc = {
            "type": "FeatureCollection",
            "_meta": {
                "generated_by": "scripts/map/build/build_ph_variants.py",
                "variant": label,
                "description": desc,
                "status": "ВАРИАНТ ДЛЯ СРАВНЕНИЯ. Живая карта не изменена.",
                "source": "game_map.json из хранилища источников (iso_a2 == PH), ключ region_sub",
                "reference": f"scripts/map/out/{REF}",
                "counts": {
                    "modern_provinces": len(modern),
                    "regions": len(feats),
                    "delta_vs_modern": len(feats) - len(modern),
                    "area_km2": round(sum(f["properties"]["area_km2"] for f in feats), 1),
                },
            },
            "features": feats,
        }
        with open(out(name), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False)

    print(f"исходная нарезка по region_sub: {len(modern)} провинций, {base_area:,.1f} км²")
    print(f"A  полный откат к 1946:  {len(feats_a):3} регионов ({len(feats_a)-len(modern):+})  {area_a:,.1f} км²")
    print(f"B  рекомендуемый:        {len(feats_b):3} регионов ({len(feats_b)-len(modern):+})  {area_b:,.1f} км²")
    print(f"C  выбранный:            {len(feats_c):3} регионов ({len(feats_c)-len(modern):+})  {area_c:,.1f} км²")
    print(f"разница между A и B: {len(feats_b)-len(feats_a)} регионов\n")
    print("ВАРИАНТ C — итоговые регионы:")
    for f in feats_c:
        p = f["properties"]
        nd = "  ⚠ имя требует решения" if p.get("needs_decision") else ""
        src = f" <- {', '.join(p['members'])}" if p["member_count"] > 1 else ""
        print(f"  {p['name']:20} {p.get('name_ru',''):22} {p['area_km2']:>9,.0f} км²{src}{nd}")
    print()

    print("ЧТО СЛИВАЕТСЯ В ОБОИХ ВАРИАНТАХ:")
    for f in feats_b:
        p = f["properties"]
        if p["member_count"] > 1:
            print(f"  {p['name']:20} <- {p['member_count']}: {', '.join(p['members'])}")
    print("\nЧТО СЛИВАЕТСЯ ТОЛЬКО В A (в B остаётся раздельным):")
    # сравнивать надо СОСТАВ, а не имя: Cotabato, Sulu, Samar, Leyte, Rizal есть
    # в обоих вариантах, но в B они несут только себя, а в A — ещё и своих детей
    b_of_member = {}
    for f in feats_b:
        for m in f["properties"]["members"]:
            b_of_member[m] = f["properties"]["name"]
    only_a = 0
    for f in feats_a:
        p = f["properties"]
        if p["member_count"] < 2:
            continue
        if len({b_of_member[m] for m in p["members"]}) < 2:
            continue  # в B те же участники уже вместе — слияние общее, не A-only
        only_a += 1
        reason = KEPT_MODERN_REASON.get(p["name"], "")
        print(f"  {p['name']:20} <- {p['member_count']}: {', '.join(p['members'])}")
        if reason:
            print(f"  {'':20}    причина сохранить: {reason}")
    print(f"\n  групп только в A: {only_a}")
    print(f"\nзаписано: out/{OUT_A}, out/{OUT_B}")


if __name__ == "__main__":
    main()
