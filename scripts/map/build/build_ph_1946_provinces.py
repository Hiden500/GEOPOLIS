"""
build_ph_1946_provinces.py — сопоставление современных провинций Филиппин с 1946 годом.

Зачем. Нарезка по `region_sub` даёт 81 современную провинцию, а на дату снимка
`1946-01-01` их было около полусотни: почти треть создана позже, в 1950-2013
годах. Скрипт сводит «современная → 1946» с источником на каждую запись, чтобы
решение о слиянии принималось по проверяемым датам, а не по памяти.

СКРИПТ НИЧЕГО НЕ МЕНЯЕТ. Это справочник и вход для будущего решения.

ВАЖНО, ЧТО ЭТО НЕ РЕКОМЕНДАЦИЯ «ОТКАТИТЬ ВСЁ К 1946».
`docs/HISTORICAL_ACCURACY.md` (раздел «Границы регионов», 2026-07-19) прямо
ставит приоритетом не архивную точность на дату снимка, а совместимость с
конфликтами, которые произойдут ПОЗЖЕ. Для Филиппин это решающе: разделы
Ланао (1959), Котабато (1973) и Сулу (1973) прошли ровно по линии
моро-конфликта, и слияние обратно стёрло бы его географию. Поэтому у каждой
записи есть поле `erases` — что именно исчезнет при слиянии, — и оно, а не
дата, должно решать.

Источники (сверено 2026-08-02, оба публичные):
  S1 statoids.com/uph.html — журнал изменений с родительской провинцией;
  S2 en.wikipedia.org/wiki/Provinces_of_the_Philippines — таблица учреждения.
Где источники расходятся в годе, это записано в `year_note`; на вывод
«создана после 1946» расхождение не влияет ни в одном случае.

Уверенность (по docs/HISTORICAL_ACCURACY.md):
  high   — оба источника согласны и по году, и по родителю;
  medium — источники расходятся в годе либо родителя даёт только один.

Запуск:
    python scripts/map/build/build_ph_1946_provinces.py

Выход: `out/ph_provinces_1946.json` плюс таблица в stdout.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

from paths import game_map, out

OUT_NAME = "ph_provinces_1946.json"

S1 = "statoids.com/uph.html"
S2 = "en.wikipedia.org/wiki/Provinces_of_the_Philippines"

# Провинции, созданные ПОСЛЕ 1946: современная -> родитель на 1946.
# (region_sub, родитель 1946, год создания, уверенность, примечание к году, что стирает слияние)
CREATED_AFTER_1946 = [
    ("Mindoro Occidental", "Mindoro", 1950, "high", None,
     "ничего значимого: раздел острова Миндоро административный"),
    ("Mindoro Oriental", "Mindoro", 1950, "high", None,
     "ничего значимого: раздел острова Миндоро административный"),
    ("Quirino", "Nueva Vizcaya", 1971, "medium", "S1 1971 (полноценная провинция), S2 1966 (субпровинция)",
     "ничего значимого"),
    # родитель назван именем НА ДАТУ СНИМКА: Quezon в 1946 ещё Tayabas, иначе
    # «Quezon» и «Tayabas» считались бы двумя разными провинциями 1946
    ("Aurora", "Tayabas", 1979, "high", None,
     "тихоокеанское побережье Лусона; для десантных сценариев может пригодиться отдельно"),
    ("Eastern Samar", "Samar", 1965, "high", None,
     "восточное побережье Самара — точка высадки Лейте-Самар 1944"),
    ("Northern Samar", "Samar", 1965, "high", None, "ничего значимого"),
    ("Southern Leyte", "Leyte", 1959, "high", None, "ничего значимого"),
    ("Biliran", "Leyte", 1992, "high", None, "отдельный остров теряет самостоятельность"),
    ("Aklan", "Capiz", 1956, "high", None, "ничего значимого"),
    ("Guimaras", "Iloilo", 1992, "high", None, "отдельный остров теряет самостоятельность"),
    ("Davao del Norte", "Davao", 1967, "high", None, "ничего значимого: раздел административный"),
    ("Davao del Sur", "Davao", 1967, "high", "S2 датирует 1904 — это дата материнского Davao",
     "ничего значимого: раздел административный"),
    ("Davao Oriental", "Davao", 1967, "high", None, "ничего значимого: раздел административный"),
    ("Compostela Valley", "Davao", 1998, "high", None, "ничего значимого: раздел административный"),
    ("Agusan del Norte", "Agusan", 1967, "medium", "S1 1967 (закон), S2 1970 (вступление в силу)",
     "ничего значимого"),
    ("Agusan del Sur", "Agusan", 1967, "medium", "S1 1967 (закон), S2 1970 (вступление в силу)",
     "ничего значимого"),
    ("Surigao del Norte", "Surigao", 1960, "high", "S2 датирует 1901 — это дата материнского Surigao",
     "ничего значимого"),
    ("Surigao del Sur", "Surigao", 1960, "high", None, "ничего значимого"),
    ("South Cotabato", "Cotabato", 1966, "high", None,
     "ЛИНИЯ КОНФЛИКТА: раздел Котабато шёл по христианско-мусульманскому расселению"),
    ("Sultan Kudarat", "Cotabato", 1973, "high", None,
     "ЛИНИЯ КОНФЛИКТА: создана во время войны с МНФО"),
    ("Maguindanao", "Cotabato", 1973, "high", "S2 датирует 1802 — это дата исторической области",
     "ЛИНИЯ КОНФЛИКТА: ядро моро-автономии, создана во время войны с МНФО"),
    ("Sarangani", "Cotabato", 1992, "high", "выделена из South Cotabato, тот — из Cotabato",
     "ЛИНИЯ КОНФЛИКТА (опосредованно, через South Cotabato)"),
    ("Benguet", "Mountain Province", 1966, "high", "S2 датирует 1536 — это не дата провинции",
     "горный кордильерский узел; отдельно полезен рельефом, не конфликтом"),
    ("Ifugao", "Mountain Province", 1966, "high", None, "ничего значимого"),
    ("Kalinga", "Mountain Province", 1966, "medium", "1966 как Kalinga-Apayao, разделена 1995",
     "ничего значимого"),
    ("Apayao", "Mountain Province", 1966, "medium", "1966 как Kalinga-Apayao, разделена 1995",
     "ничего значимого"),
    ("Lanao del Norte", "Lanao", 1959, "high", None,
     "ЛИНИЯ КОНФЛИКТА: раздел Ланао 1959 прошёл по христианско-мусульманской границе"),
    ("Lanao del Sur", "Lanao", 1959, "high", "S2 датирует 1914 — это дата материнского Lanao",
     "ЛИНИЯ КОНФЛИКТА: ядро моро-конфликта"),
    ("Camiguin", "Misamis Oriental", 1966, "high", None, "отдельный остров теряет самостоятельность"),
    ("Zamboanga del Norte", "Zamboanga", 1952, "high", None, "ничего значимого"),
    ("Zamboanga del Sur", "Zamboanga", 1952, "high", "S2 датирует 1914 — это дата материнской Zamboanga",
     "ничего значимого"),
    ("Zamboanga Sibugay", "Zamboanga", 2001, "high", "выделена из Zamboanga del Sur",
     "ничего значимого"),
    ("Siquijor", "Negros Oriental", 1971, "medium", "S1 1972 (референдум), S2 1971 (закон)",
     "отдельный остров теряет самостоятельность"),
    ("Basilan", "Sulu", 1973, "medium", "родителя даёт только S2; до 1973 — город-хартия",
     "ЛИНИЯ КОНФЛИКТА: моро-архипелаг"),
    ("Tawi-Tawi", "Sulu", 1973, "high", None, "ЛИНИЯ КОНФЛИКТА: моро-архипелаг"),
    ("National Capital Region", "Rizal", 1975, "medium",
     "Метро-Манила образована 1975; в 1946 муниципалитеты входили в Rizal, а Манила была "
     "городом-хартией вне провинции",
     "ГОРОД МАНИЛА: в 1946 административно отдельна от провинции, слияние с Rizal её растворяет"),
    ("Pateros", "Rizal", 1975, "medium", "единственный муниципалитет Метро-Манилы",
     "ничего значимого"),
]

# Провинции, существовавшие на 1946-01-01 — остаются как есть.
EXISTED_1946 = [
    "Palawan", "Romblon", "Marinduque", "Isabela", "Cagayan", "Nueva Vizcaya", "Batanes",
    "Nueva Ecija", "Zambales", "Tarlac", "Bulacan", "Pampanga", "Bataan",
    "Leyte", "Samar", "Negros Occidental", "Iloilo", "Capiz", "Antique",
    "Bukidnon", "Misamis Oriental", "Misamis Occidental",
    "Camarines Sur", "Masbate", "Albay", "Camarines Norte", "Sorsogon", "Catanduanes",
    "Quezon", "Batangas", "Laguna", "Cavite", "Rizal",
    "Negros Oriental", "Cebu", "Bohol",
    "Pangasinan", "Ilocos Norte", "Ilocos Sur", "La Union",
    "Abra", "Mountain Province", "Sulu", "Cotabato", "Davao", "Agusan", "Surigao",
    "Lanao", "Zamboanga", "Mindoro",
]

# Провинции 1946, которых НЕТ среди современных имён: они существуют только как
# родители. Нужны, чтобы отчёт не выглядел так, будто их пропустили.
PARENTS_ONLY = {"Mindoro", "Davao", "Agusan", "Surigao", "Cotabato", "Lanao", "Zamboanga"}

# Имя на дату снимка, если оно отличается от современного.
NAME_1946 = {
    "Quezon": ("Tayabas", "переименована в Quezon в сентябре 1946 после смерти Мануэля Кесона; "
                          "на 1946-01-01 ещё Tayabas"),
}


def main():
    src = json.loads(Path(game_map()).read_text(encoding="utf-8"))
    feats = src["features"] if isinstance(src, dict) else src
    present = sorted({f["properties"]["region_sub"] for f in feats
                      if f["properties"].get("iso_a2") == "PH"})

    created = {r[0]: r for r in CREATED_AFTER_1946}
    kept = set(EXISTED_1946)

    # самопроверка покрытия: каждое значение region_sub обязано быть описано
    described = set(created) | kept
    missing = [k for k in present if k not in described]
    extra = sorted(described - set(present) - PARENTS_ONLY)
    if missing or extra:
        print("ТАБЛИЦА НЕ ПОКРЫВАЕТ ИСТОЧНИК — файл не сохранён:", file=sys.stderr)
        for k in missing:
            print(f"  не описано: {k!r}", file=sys.stderr)
        for k in extra:
            print(f"  описано, но в источнике нет: {k!r}", file=sys.stderr)
        raise SystemExit(1)

    groups = defaultdict(list)
    for name in present:
        if name in created:
            groups[created[name][1]].append(name)

    entries = []
    for name in present:
        if name in created:
            _, parent, year, conf, note, erases = created[name]
            entries.append({
                "modern": name, "status": "created_after_1946", "province_1946": parent,
                "created": year, "confidence": conf, "year_note": note, "erases": erases,
                "sources": [S1, S2],
            })
        else:
            n46, note = NAME_1946.get(name, (name, None))
            entries.append({
                "modern": name, "status": "existed_1946", "province_1946": n46,
                "created": None, "confidence": "high", "year_note": note, "erases": None,
                "sources": [S1, S2],
            })

    n_after = sum(1 for e in entries if e["status"] == "created_after_1946")
    provinces_1946 = sorted({e["province_1946"] for e in entries})
    conflict = [e for e in entries if e["erases"] and "ЛИНИЯ КОНФЛИКТА" in e["erases"]]

    doc = {
        "_meta": {
            "generated_by": "scripts/map/build/build_ph_1946_provinces.py",
            "status": "СПРАВОЧНИК. Ничего не применяется.",
            "checked": "2026-08-02",
            "sources": {"S1": S1, "S2": S2},
            "caveat": ("docs/HISTORICAL_ACCURACY.md ставит приоритетом совместимость с будущими "
                       "конфликтами, а не архивную точность на дату снимка. Поле `erases` важнее "
                       "поля `created`."),
            "counts": {
                "modern_provinces": len(present),
                "created_after_1946": n_after,
                "existed_1946": len(present) - n_after,
                "provinces_1946_after_mapping": len(provinces_1946),
                "entries_erasing_conflict_line": len(conflict),
            },
        },
        "provinces_1946": provinces_1946,
        "entries": entries,
    }
    with open(out(OUT_NAME), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)

    c = doc["_meta"]["counts"]
    print(f"современных провинций: {c['modern_provinces']}")
    print(f"  создано после 1946: {c['created_after_1946']}")
    print(f"  существовало в 1946: {c['existed_1946']}")
    print(f"провинций 1946 после сопоставления: {c['provinces_1946_after_mapping']}")
    print(f"записей, чьё слияние стирает линию конфликта: {c['entries_erasing_conflict_line']}")
    print()
    print("СЛИЯНИЯ ПО ДАТАМ (современные -> провинция 1946):")
    for parent in sorted(groups, key=lambda p: -len(groups[p])):
        kids = groups[parent]
        flag = " ⚠ ЛИНИЯ КОНФЛИКТА" if any(
            created[k][5] and "ЛИНИЯ КОНФЛИКТА" in created[k][5] for k in kids) else ""
        print(f"  {parent:24} <- {len(kids)}: {', '.join(kids)}{flag}")
    print()
    print("ПЕРЕИМЕНОВАНИЯ НА ДАТУ СНИМКА:")
    for m, (n46, note) in NAME_1946.items():
        print(f"  {m} -> {n46}  ({note})")
    print(f"\nзаписано: out/{OUT_NAME}")


if __name__ == "__main__":
    main()
