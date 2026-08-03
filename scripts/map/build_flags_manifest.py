"""
build_flags_manifest.py — собирает манифест флагов сценария 1946.

Что это. Флаг в проекте — не картинка «страна X», а картинка «страна X НА
1946 год». Готовых наборов под эту задачу не существует: пакеты вида
flag-icons/country-flags дают СОВРЕМЕННЫЕ флаги по ISO 3166-1 и врут почти на
всех ключевых игроках старта (Италия до 19.06.1946 — с гербом Савойи, Испания
франкистская, Венгрия, Румыния, Египет-королевство, Канада Red Ensign), а по
коду CHN отдают флаг КНР, тогда как CHN в сценарии — Китайская Республика.

Поэтому источник истины здесь — КУРИРУЕМЫЙ конфиг config/flags_1946.json, а не
автоподбор. Скрипт его не заполняет: он проверяет полноту против фактического
состава сценария и обогащает метаданными Wikimedia Commons (лицензия, автор,
размеры, пропорция, URL). Автоподбор проверялся и отвергнут — обоснование в
_meta конфига.

Выход: out/flags_1946.json — на каждый код страны либо запись файла с
лицензией и атрибуцией, либо запись «нужен кастомный дизайн» с причиной.

Запуск:
    python scripts/map/build_flags_manifest.py            # с обращением к Commons
    python scripts/map/build_flags_manifest.py --offline  # только проверка полноты

Офлайн-режим не ходит в сеть и потому не знает лицензий: он проверяет ТОЛЬКО
согласованность конфига с составом сценария. Отличать эти два режима в отчёте
обязательно — «проверено формально» и «проверено с лицензиями» не одно и то же.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / "scripts" / "map" / "config" / "flags_1946.json"
COUNTRIES = REPO_ROOT / "server" / "data" / "scenarios" / "1946" / "countries.json"
OUT = REPO_ROOT / "scripts" / "map" / "out" / "flags_1946.json"

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Commons просит осмысленный User-Agent с контактом; анонимные запросы режутся.
USER_AGENT = "GeopolisFlagManifest/1.0 (https://github.com/hiden500; yurewa601@gmail.com)"
BATCH = 40

# Лицензии, не требующие атрибуции при использовании в игре. Всё остальное
# (CC BY-SA, OGL) попадает в отдельный список манифеста: файл использовать
# можно, но он тянет за собой обязательство — молча смешивать их нельзя.
ATTRIBUTION_FREE = ("public domain", "pd", "cc0")


def load_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def scenario_codes() -> list[str]:
    """Фактический состав сценария — единственный источник списка кодов.

    Ни число стран, ни их перечень здесь не хардкодятся: состав меняется
    пайплайном, и манифест обязан следовать за ним, а не за снимком.
    """
    return sorted(c["id"] for c in load_json(COUNTRIES))


def commons_metadata(files: list[str]) -> dict[str, dict]:
    """Метаданные файлов Commons: лицензия, автор, размеры, прямой URL."""
    meta: dict[str, dict] = {}
    for start in range(0, len(files), BATCH):
        chunk = files[start:start + BATCH]
        params = {
            "action": "query",
            "format": "json",
            "prop": "imageinfo",
            "iiprop": "extmetadata|size|url",
            "titles": "|".join("File:" + f for f in chunk),
        }
        url = COMMONS_API + "?" + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        for attempt in range(3):
            try:
                payload = json.load(urllib.request.urlopen(request, timeout=90))
                break
            except Exception as exc:  # сеть/лимиты — повтор, затем отказ
                if attempt == 2:
                    raise SystemExit(f"Commons API недоступен: {exc}")
                time.sleep(5 * (attempt + 1))
        for page in payload["query"]["pages"].values():
            title = page["title"][len("File:"):]
            info = page.get("imageinfo")
            if not info:
                meta[title] = {"missing": True}
                continue
            extra = info[0].get("extmetadata", {})
            width, height = info[0]["width"], info[0]["height"]
            meta[title] = {
                "license": extra.get("LicenseShortName", {}).get("value", "?"),
                "author": strip_markup(extra.get("Artist", {}).get("value", "")),
                "bytes": info[0]["size"],
                "width": width,
                "height": height,
                "ratio": round(width / height, 4) if height else None,
                "url": info[0]["url"],
                "descriptionUrl": info[0].get("descriptionurl", ""),
            }
    return meta


def strip_markup(value: str) -> str:
    """Поле Artist приходит куском HTML — в манифесте нужен текст."""
    out, depth = [], 0
    for ch in value:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return " ".join("".join(out).split())


def needs_attribution(license_name: str) -> bool:
    low = license_name.lower()
    return not any(token in low for token in ATTRIBUTION_FREE)


def build(offline: bool) -> int:
    config = load_json(CONFIG)
    flags: dict[str, dict] = config["flags"]
    custom: dict[str, dict] = config["custom"]
    codes = scenario_codes()

    known = set(flags) | set(custom)
    missing = [c for c in codes if c not in known]
    orphans = sorted(known - set(codes))
    both = sorted(set(flags) & set(custom))

    problems = []
    if missing:
        problems.append(f"без записи в конфиге: {len(missing)} — {missing}")
    if orphans:
        problems.append(f"есть в конфиге, но нет в сценарии: {orphans}")
    if both:
        problems.append(f"одновременно в flags и custom: {both}")
    for code, entry in flags.items():
        if not entry.get("source"):
            problems.append(f"{code}: запись без source")
        if entry.get("confidence") not in ("high", "medium", "low"):
            problems.append(f"{code}: confidence={entry.get('confidence')!r}")
    for code, entry in custom.items():
        if not entry.get("reason"):
            problems.append(f"{code}: custom без reason")

    meta: dict[str, dict] = {}
    if not offline:
        # basis у custom-записей проверяется наравне с обычными файлами: это
        # историческая основа для дизайна, и ссылка в пустоту здесь так же
        # бесполезна, как битый файл флага.
        wanted = {e["file"] for e in flags.values()}
        wanted |= {e["basis"] for e in custom.values() if e.get("basis")}
        meta = commons_metadata(sorted(wanted))
        for code, entry in flags.items():
            if meta.get(entry["file"], {}).get("missing"):
                problems.append(f"{code}: файла нет на Commons — {entry['file']}")
        for code, entry in custom.items():
            basis = entry.get("basis")
            if basis and meta.get(basis, {}).get("missing"):
                problems.append(f"{code}: basis не существует на Commons — {basis}")

    manifest = {
        "_meta": {
            "generatedBy": "scripts/map/build_flags_manifest.py",
            "scenario": "1946",
            "codesInScenario": len(codes),
            "withFile": len(flags),
            "needCustomArt": len(custom),
            "metadataResolved": not offline,
            "reference": config["_meta"]["reference"],
            "note": config["_meta"]["purpose"],
        },
        "flags": {},
        "custom": custom,
    }

    attribution: list[dict] = []
    for code in codes:
        if code in custom:
            continue
        entry = flags[code]
        record = {
            "file": entry["file"],
            "confidence": entry["confidence"],
            "source": entry["source"],
        }
        if entry.get("why"):
            record["why"] = entry["why"]
        info = meta.get(entry["file"])
        if info and not info.get("missing"):
            record.update({
                "license": info["license"],
                "author": info["author"],
                "ratio": info["ratio"],
                "bytes": info["bytes"],
                "url": info["url"],
                "descriptionUrl": info["descriptionUrl"],
            })
            if needs_attribution(info["license"]):
                attribution.append({
                    "code": code,
                    "file": entry["file"],
                    "license": info["license"],
                    "author": info["author"],
                })
        manifest["flags"][code] = record

    if not offline:
        manifest["_meta"]["requiresAttribution"] = len(attribution)
        manifest["attribution"] = attribution

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    mode = "формальная проверка (без сети)" if offline else "с метаданными Commons"
    print(f"Манифест флагов 1946 — {mode}")
    print(f"  стран в сценарии:      {len(codes)}")
    print(f"  с готовым файлом:      {len(flags)}")
    print(f"  требуют кастома:       {len(custom)}")
    if not offline:
        heavy = [(c, meta[e['file']]['bytes']) for c, e in flags.items()
                 if meta.get(e["file"], {}).get("bytes", 0) > 100_000]
        ratios = {meta[e["file"]]["ratio"] for e in flags.values()
                  if meta.get(e["file"], {}).get("ratio")}
        print(f"  требуют атрибуции:     {len(attribution)}")
        print(f"  тяжелее 100 KB:        {len(heavy)} (упрощать герб для HUD)")
        print(f"  различных пропорций:   {len(ratios)} (нормализовать при импорте)")
    print(f"  записан:               {OUT.relative_to(REPO_ROOT)}")

    if problems:
        print("\nОШИБКИ:")
        for line in problems:
            print("  -", line)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true",
                        help="не обращаться к Commons: только проверка полноты конфига")
    args = parser.parse_args()
    return build(args.offline)


if __name__ == "__main__":
    sys.exit(main())
