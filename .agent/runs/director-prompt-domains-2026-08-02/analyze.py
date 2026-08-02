"""Сводка по прогонам runCampaignWithLLM: метрики, которые решают спор о правке промта.

Меряет ПАРУ величин, а не одну: доля отказов без охвата и активности
оптимизируется моделью, которая просто ничего не предлагает.

Запуск:  python analyze.py <путь> [<путь> ...]
где <путь> — либо каталог прогона (ищется `llm.jsonl` внутри), либо сам
`*.llm.jsonl`: прогоны лежат обоими способами, и скрипт не должен зависеть от
того, как их разложили.
"""
import json
import os
import sys
import collections
import statistics


def load(path):
    target = path if os.path.isfile(path) else os.path.join(path, "llm.jsonl")
    with open(target, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def metrics(rows):
    applied = collections.Counter()
    rejected = collections.Counter()
    countries = collections.Counter()
    regions = collections.Counter()
    paragraphs, lengths = [], []
    empty_turns = 0
    lost_turns = 0

    for r in rows:
        receipt = r.get("receipt") or {}
        for a in receipt.get("actions", {}).get("applied", []):
            applied["action:" + str(a.get("type"))] += 1
        for p in receipt.get("primitives", {}).get("applied", []):
            applied["prim:" + str(p.get("verb"))] += 1
        for a in receipt.get("actions", {}).get("rejected", []):
            rejected[f"action:{a.get('type')} / {str(a.get('reason'))[:50]}"] += 1
        for p in receipt.get("primitives", {}).get("rejected", []):
            code = (p.get("rejection") or {}).get("code")
            rejected[f"prim:{p.get('verb')} / {code}"] += 1
        for c in receipt.get("countries", []):
            countries[c] += 1
        for g in receipt.get("regions", []):
            regions[g] += 1

        text = r.get("descriptions") or ""
        lengths.append(len(text))
        paragraphs.append(len([p for p in text.split("\n") if p.strip()]))
        if (r.get("applied") or 0) == 0:
            empty_turns += 1
        if not r.get("narrativeCanonized"):
            lost_turns += 1

    napp = sum(applied.values())
    nrej = sum(rejected.values())
    return {
        "turns": len(rows),
        "applied": napp,
        "rejected": nrej,
        "reject_share": nrej / (napp + nrej) if napp + nrej else 0.0,
        "per_turn": napp / len(rows) if rows else 0.0,
        "countries": len(countries),
        "regions": len(regions),
        "empty_turns": empty_turns,
        "lost_turns": lost_turns,
        "paragraphs_median": statistics.median(paragraphs) if paragraphs else 0,
        "three_plus": sum(1 for p in paragraphs if p >= 3),
        "narrative_median": statistics.median(lengths) if lengths else 0,
        "applied_kinds": applied,
        "rejected_kinds": rejected,
        "top_countries": countries,
    }


def main():
    paths = sys.argv[1:]
    if not paths:
        print(__doc__)
        return
    all_metrics = [metrics(load(p)) for p in paths]

    keys = [
        ("turns", "ходов"),
        ("applied", "применено"),
        ("rejected", "отклонено"),
        ("per_turn", "применено на ход"),
        ("reject_share", "доля отказов"),
        ("countries", "разных стран"),
        ("regions", "разных регионов"),
        ("empty_turns", "ходов без действий"),
        ("lost_turns", "ходов без события"),
        ("paragraphs_median", "абзацев (медиана)"),
        ("three_plus", "ходов с 3+ абзацами"),
        ("narrative_median", "знаков нарратива (медиана)"),
    ]
    head = " | ".join(f"прогон {i + 1}" for i in range(len(all_metrics)))
    print(f"{'метрика':30} | {head} | среднее")
    for key, label in keys:
        values = [m[key] for m in all_metrics]
        cells = " | ".join(f"{v:8.2f}" if isinstance(v, float) else f"{v:8}" for v in values)
        avg = sum(values) / len(values)
        print(f"{label:30} | {cells} | {avg:.2f}")

    merged_applied = collections.Counter()
    merged_rejected = collections.Counter()
    merged_countries = collections.Counter()
    for m in all_metrics:
        merged_applied += m["applied_kinds"]
        merged_rejected += m["rejected_kinds"]
        merged_countries += m["top_countries"]

    print("\nприменено по типам (все прогоны):")
    for k, v in merged_applied.most_common():
        print(f"  {k:38} {v}")
    print("\nотклонено (все прогоны):")
    for k, v in merged_rejected.most_common():
        print(f"  {k:38} {v}")
    print(f"\nстраны, затронутые хоть раз ({len(merged_countries)}):")
    print("  " + ", ".join(f"{k}:{v}" for k, v in merged_countries.most_common(25)))


if __name__ == "__main__":
    main()
