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
AREA_TOL_KM2 = 1.0

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

    feats_a = build(groups_a, "A_1946_full", note_a)
    feats_b = build(groups_b, "B_recommended", note_b)

    area_a = round(sum(f["properties"]["area_km2"] for f in feats_a), 1)
    area_b = round(sum(f["properties"]["area_km2"] for f in feats_b), 1)
    problems = []
    if abs(area_a - base_area) > AREA_TOL_KM2:
        problems.append(f"вариант A: площадь {area_a:,.1f} против исходных {base_area:,.1f}")
    if abs(area_b - base_area) > AREA_TOL_KM2:
        problems.append(f"вариант B: площадь {area_b:,.1f} против исходных {base_area:,.1f}")
    if not (len(feats_a) < len(feats_b) < len(modern)):
        problems.append(f"вариант B должен быть строго между A и исходной нарезкой: "
                        f"{len(feats_a)} / {len(feats_b)} / {len(modern)}")
    if problems:
        print("ОШИБКИ — файлы не сохранены:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        raise SystemExit(1)

    for name, feats, label, desc in (
        (OUT_A, feats_a, "A_1946_full", "полный откат к провинциям 1946 года"),
        (OUT_B, feats_b, "B_recommended", "слиты только административные разделы; юг современный"),
    ):
        doc = {
            "type": "FeatureCollection",
            "_meta": {
                "generated_by": "scripts/map/build/build_ph_variants.py",
                "variant": label,
                "description": desc,
                "status": "ВАРИАНТ ДЛЯ СРАВНЕНИЯ. Живая карта не изменена.",
                "source": "client/src/assets/game_map.json (iso_a2 == PH), ключ region_sub",
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
    print(f"разница между A и B: {len(feats_b)-len(feats_a)} регионов\n")

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
