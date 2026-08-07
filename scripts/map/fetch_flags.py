"""
fetch_flags.py — скачивает флаги 1946 по манифесту и нормализует их под HUD.

Вход: out/flags_1946.json (собирается build_flags_manifest.py).
Выход: client/public/flags/<КОД>.svg + client/public/flags/index.json.

Файл кладётся под КОДОМ СТРАНЫ, а не под именем с Commons: интерфейсу нужен
предсказуемый путь `/flags/ITA.svg`, а не «Flag of Italy (1861–1946).svg» с
пробелами, скобками и en-dash в URL. Один и тот же флаг может обслуживать
несколько кодов (французский триколор — десять) — тогда он просто копируется:
дубль в 1–2 КБ дешевле косвенности через таблицу ссылок.

НОРМАЛИЗАЦИЯ — что именно делается и почему не иначе
----------------------------------------------------
В наборе 26 разных пропорций: 3:2 у 54 флагов, 1:2 у 48, остальные — от 5:4 до
19:10. Интерфейсу нужна предсказуемая форма блока, поэтому каждый файл
получает ОДИН внешний бокс 300×200 (3:2 — самая частая форма в наборе).

Полотнище внутри бокса НЕ растягивается и НЕ обрезается:

- Растянуть — значит подделать флаг. Советский и британский флаги — 1:2 по
  своему статуту; в 3:2 они выглядят сплющенными, и это видит любой, кто их
  знает.
- Обрезать по центру — казалось бы, безопасно (полосы и центральные гербы
  переживут), но в наборе около двадцати пяти британских колониальных энсинов,
  у которых бэдж стоит в центре ПРАВОЙ половины. Обрезка 1:2 → 3:2 срезает по
  12,5% с каждого края и разрушает ровно ту деталь, которая отличает Кению от
  Нигерии, а Аден от Танганьики. Именно эти флаги в наборе и различаются
  только бэджем.

Поэтому оригинал вкладывается как есть с `preserveAspectRatio="xMidYMid meet"`:
он вписывается в бокс целиком, по центру, лишнее место остаётся прозрачным.
Флаг 1:2 займёт всю ширину и три четверти высоты — это его настоящая форма, а
не дефект. Истинная пропорция каждого флага сохраняется в index.json: вёрстке,
которая захочет выравнивать флаги по высоте (как на флагштоке) вместо общего
бокса, не придётся разбирать SVG.

БЕЗОПАСНОСТЬ. SVG — исполняемый формат: он умеет нести скрипты и тянуть внешние
ресурсы. Файлы приходят с сайта, который редактирует кто угодно, поэтому каждый
проверяется на script/обработчики событий/foreignObject/внешние ссылки, и
подозрительный НЕ сохраняется, а называется в отчёте.

Запуск:
    python scripts/map/fetch_flags.py            # скачать недостающие
    python scripts/map/fetch_flags.py --force    # перекачать всё заново
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ElementTree
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST = REPO_ROOT / "scripts" / "map" / "out" / "flags_1946.json"
CONFIG = REPO_ROOT / "scripts" / "map" / "config" / "flags_1946.json"
FLAGS_DIR = REPO_ROOT / "client" / "public" / "flags"
INDEX = FLAGS_DIR / "index.json"

USER_AGENT = "GeopolisFlagFetch/1.0 (https://github.com/hiden500; yurewa601@gmail.com)"

# Целевой бокс. 3:2 — самая частая форма в наборе, поэтому большинству флагов
# он подходит без полей вовсе.
BOX_W, BOX_H = 300, 200

# Пустая самозакрывающаяся заглушка `<foreignObject ... />` — след экспорта из
# Adobe Illustrator, она встречается в файлах Commons массово (у канадского Red
# Ensign — именно она). Исполнить такой элемент нечего: тела у него нет. Она
# удаляется ПЕРЕД проверкой, и потому foreignObject С ТЕЛОМ — где чужая разметка
# как раз и живёт — по-прежнему приводит к отказу. Это сужение проверки до
# осмысленной границы, а не её ослабление; обе половины закреплены тестами
# в test_flags_manifest.py.
EMPTY_FOREIGN_OBJECT = re.compile(r"<\s*foreignObject\b[^>]*/\s*>", re.I)

# Признаки активного содержимого. `href` со схемой http(s) — внешняя загрузка;
# локальные `#id`-ссылки (градиенты, символы) законны и не ловятся.
DANGEROUS = (
    re.compile(r"<\s*script", re.I),
    re.compile(r"<\s*foreignObject", re.I),
    re.compile(r"\bon[a-z]+\s*=", re.I),
    re.compile(r"(?:xlink:)?href\s*=\s*[\"']\s*https?:", re.I),
    re.compile(r"<\s*image[^>]+https?:", re.I),
)

ROOT_SVG = re.compile(r"<svg\b(?P<attrs>[^>]*)>(?P<body>.*)</svg\s*>", re.S | re.I)
VIEWBOX = re.compile(r"viewBox\s*=\s*[\"']([^\"']+)[\"']", re.I)
# Размер может быть записан как `1e3`, `750.5`, `1200px`, `210mm`. Проценты
# намеренно не поддержаны: доля от неизвестного контейнера пропорции не задаёт.
DIMENSION = re.compile(
    r"\b(width|height)\s*=\s*[\"']\s*([\d.]+(?:[eE][-+]?\d+)?)\s*(?:px|pt|pc|mm|cm|in)?\s*[\"']", re.I)

# Любой атрибут корневого тега.
ATTRIBUTE = re.compile(r"([\w:.-]+)\s*=\s*([\"'])((?:(?!\2).)*)\2", re.S)

# Атрибуты корня, которые задают КАДР, а не вид: их назначает обёртка, и
# переносить их внутрь нельзя. Всё остальное — включая презентационные `fill`,
# `stroke`, `color`, которые наследуются фигурами внутри, — обязано переехать
# во вложенный тег. На этом первый прогон потерял цвет флага Гондураса: заливка
# была объявлена один раз на корне (`fill="#0d3b99"`), и флаг стал чёрно-белым,
# оставаясь при этом валидным SVG. Ни XML-разбор, ни размер файла такого не
# видят — только глаз или сравнение картинки.
FRAME_ATTRIBUTES = {"width", "height", "viewbox", "x", "y", "xmlns"}

# Пространства имён (`sodipodi:`, `inkscape:`, `rdf:`, `dc:`) объявляются в
# корневом теге, а используются в теле. Отбросив корень, документ ломают:
# префикс становится несвязанным, и браузер молча показывает пустоту. Так
# первый прогон потерял 26 флагов из 145 — файлы записались, вес был
# правдоподобным, и увидел это только рендер в браузере. Отсюда правило ниже:
# переносится ВЕСЬ корень, кроме кадрирующих атрибутов.


def load_manifest() -> dict:
    with MANIFEST.open(encoding="utf-8") as fh:
        return json.load(fh)


def download(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception as exc:
            if attempt == 2:
                raise RuntimeError(f"не скачался {url}: {exc}") from exc
            time.sleep(4 * (attempt + 1))
    raise RuntimeError("недостижимо")


def sanitize(svg: str) -> str:
    """Убирает пустые заглушки Illustrator — см. EMPTY_FOREIGN_OBJECT."""
    return EMPTY_FOREIGN_OBJECT.sub("", svg)


def unsafe_reason(svg: str) -> str | None:
    for pattern in DANGEROUS:
        found = pattern.search(svg)
        if found:
            return found.group(0)[:60]
    return None


def normalize(svg: str, expected_ratio: float | None = None) -> tuple[str, float]:
    """Кладёт оригинал в общий бокс 3:2, не искажая полотнище.

    Возвращает нормализованный SVG и ИСТИННУЮ пропорцию оригинала — она нужна
    вёрстке и потому попадает в index.json, а не теряется внутри файла.
    """
    match = ROOT_SVG.search(svg)
    if not match:
        raise ValueError("не найден корневой <svg>")
    attrs, body = match.group("attrs"), match.group("body")

    # ФОРМУ ФЛАГА задаёт КАДР — атрибуты width/height корня, а не viewBox.
    # Это разные вещи, и они расходятся: у венгерского флага кадр 1200×600
    # (2:1), а viewBox 327,6×159,45 (2,05); у лаосского кадр 900×600 (3:2) при
    # viewBox 250×250 (квадрат). Внутри кадра содержимое размещает сам оригинал
    # своим preserveAspectRatio — поэтому его viewBox и preserveAspectRatio
    # передаются вложенному тегу как есть, а вписыванием кадра в общий бокс
    # занимаемся мы.
    box = VIEWBOX.search(attrs)
    view_box = None
    if box:
        numbers = [float(n) for n in re.split(r"[\s,]+", box.group(1).strip())]
        if len(numbers) != 4 or numbers[2] <= 0 or numbers[3] <= 0:
            raise ValueError(f"негодный viewBox: {box.group(1)!r}")
        view_box = " ".join(str(n) for n in numbers)

    dimensions = {k.lower(): float(v) for k, v in DIMENSION.findall(attrs)}
    if "width" in dimensions and "height" in dimensions and dimensions["height"] > 0:
        width, height = dimensions["width"], dimensions["height"]
    elif box:
        width, height = numbers[2], numbers[3]
    else:
        raise ValueError("нет ни viewBox, ни width/height")
    if view_box is None:
        view_box = f"0 0 {width} {height}"

    # Все атрибуты корня, кроме кадрирующих, переезжают во вложенный тег:
    # пространства имён (иначе `sodipodi:`/`rdf:` в теле станут несвязанными) и
    # презентационные значения, которые наследуют фигуры внутри.
    carried = {}
    for match in ATTRIBUTE.finditer(attrs):
        name, quote, value = match.group(1), match.group(2), match.group(3)
        if name.lower() in FRAME_ATTRIBUTES:
            continue
        carried[name] = f"{name}={quote}{value}{quote}"
    carried.setdefault("xmlns:xlink", 'xmlns:xlink="http://www.w3.org/1999/xlink"')
    # preserveAspectRatio оригинала — часть его замысла (у растянутых заготовок
    # это `none`), поэтому кадрирующим не считается и едет внутрь как есть.
    carried.setdefault("preserveAspectRatio", 'preserveAspectRatio="xMidYMid meet"')
    inherited = " ".join(carried[k] for k in sorted(carried))

    # Кадр вписывается в общий бокс по своей пропорции: по ширине, если он
    # длиннее бокса, иначе по высоте. Остаток остаётся прозрачным — полотнище
    # не растягивается и не обрезается.
    ratio = width / height
    if ratio >= BOX_W / BOX_H:
        frame_w, frame_h = float(BOX_W), BOX_W / ratio
    else:
        frame_w, frame_h = BOX_H * ratio, float(BOX_H)
    offset_x, offset_y = (BOX_W - frame_w) / 2, (BOX_H - frame_h) / 2

    inner = (
        f'<svg viewBox="{view_box}" x="{offset_x:.4f}" y="{offset_y:.4f}" '
        f'width="{frame_w:.4f}" height="{frame_h:.4f}" '
        f'xmlns="http://www.w3.org/2000/svg" {inherited}>{body}</svg>'
    )
    out = (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {BOX_W} {BOX_H}" width="{BOX_W}" height="{BOX_H}">{inner}</svg>\n'
    )

    # Результат обязан быть разбираемым XML. Без этой проверки поломка namespace
    # выглядит как успех: файл записан, вес правдоподобен, а флага нет.
    try:
        ElementTree.fromstring(out)
    except ElementTree.ParseError as exc:
        raise ValueError(f"нормализованный SVG не разбирается: {exc}") from exc

    ratio = round(ratio, 4)

    # Пропорцию, вычисленную здесь, сверяем с пропорцией из imageinfo Commons —
    # независимым разбором того же файла. Так ловится ошибка чтения размеров:
    # у флага Коста-Рики width записан как `1e3`, парсер без поддержки
    # экспоненты прочитал «1» и дал пропорцию 0,0017. Файл при этом оставался
    # валидным, вес — нормальным; в наборе он выглядел бы узкой полоской.
    if expected_ratio and abs(ratio - expected_ratio) / expected_ratio > 0.01:
        raise ValueError(
            f"пропорция {ratio} расходится с метаданными Commons {expected_ratio}")

    return out, ratio


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="перекачать уже сохранённые")
    args = parser.parse_args()

    manifest = load_manifest()
    flags = manifest["flags"]
    if not flags or "url" not in next(iter(flags.values())):
        print("В манифесте нет URL — сначала прогони build_flags_manifest.py без --offline.")
        return 1

    FLAGS_DIR.mkdir(parents=True, exist_ok=True)

    # Скачиваем каждый ФАЙЛ один раз, даже если он обслуживает десять кодов.
    cache: dict[str, tuple[str, float]] = {}
    index: dict[str, dict] = {}
    rejected: list[str] = []
    failed: list[str] = []
    written = skipped = 0

    for code, entry in sorted(flags.items()):
        target = FLAGS_DIR / f"{code}.svg"
        source = entry["file"]

        if source not in cache:
            try:
                raw = download(entry["url"])
            except RuntimeError as exc:
                failed.append(f"{code}: {exc}")
                continue
            raw = sanitize(raw)
            reason = unsafe_reason(raw)
            if reason:
                rejected.append(f"{code}: {source} — активное содержимое {reason!r}")
                continue
            try:
                cache[source] = normalize(raw, entry.get("ratio"))
            except ValueError as exc:
                rejected.append(f"{code}: {source} — {exc}")
                continue

        svg, ratio = cache[source]
        # newline="" отключает трансляцию переводов строк. На Windows запись без
        # него превращает \n в \r\n, а у 26 файлов набора внутри тела есть свои
        # \r — цикл «записал → прочитал → сравнил» переставал сходиться, и
        # каждый прогон переписывал эти файлы заново. В git это выглядело бы как
        # изменения там, где ничего не менялось.
        current = None
        if target.exists():
            with target.open(encoding="utf-8", newline="") as fh:
                current = fh.read()
        if args.force or current != svg:
            with target.open("w", encoding="utf-8", newline="") as fh:
                fh.write(svg)
            written += 1
        else:
            skipped += 1

        index[code] = {
            "file": f"{code}.svg",
            "ratio": ratio,
            "license": entry.get("license", "?"),
            "author": entry.get("author", ""),
            "source": entry.get("descriptionUrl", ""),
            "commonsFile": source,
        }

    # Флаги сущностей, у которых исторического флага не было, рисует
    # build_custom_flags.py. Они уже лежат на диске — скачивать нечего, но в
    # индексе набора они обязаны стоять наравне с остальными: интерфейсу важно,
    # что покрыты ВСЕ страны сценария, а не только те, чей флаг существовал.
    with CONFIG.open(encoding="utf-8") as fh:
        custom = json.load(fh)["custom"]
    drawn = []
    for code in sorted(custom):
        if not (FLAGS_DIR / f"{code}.svg").exists():
            drawn.append(code)
            continue
        index[code] = {
            "file": f"{code}.svg",
            "ratio": round(BOX_W / BOX_H, 4),
            "license": "Project asset",
            "author": "Geopolis, scripts/map/build_custom_flags.py",
            "source": "",
            "commonsFile": "",
        }

    payload = {
        "_meta": {
            "generatedBy": "scripts/map/fetch_flags.py",
            "box": f"{BOX_W}x{BOX_H}",
            "note": ("Полотнище вписано в общий бокс без растяжения и обрезки; "
                     "ratio — истинная пропорция флага для вёрстки, выравнивающей по высоте."),
            # Атрибуции требуют только чужие файлы под CC BY-SA и подобным.
            # Собственные ассеты проекта в этот список не попадают — иначе
            # обязательство размывается тем, чего в нём нет.
            "attributionRequired": sorted(
                c for c, v in index.items()
                if v["license"] not in ("Project asset",)
                and "public domain" not in v["license"].lower()
                and "cc0" not in v["license"].lower()
            ),
        },
        "flags": index,
    }
    with INDEX.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    total = sum((FLAGS_DIR / f"{c}.svg").stat().st_size for c in index)
    print("Флаги 1946 — скачивание и нормализация")
    print(f"  кодов в манифесте:     {len(flags)} + {len(custom)} нарисованных")
    print(f"  в наборе:              {len(index)} (скачано {written}, без изменений {skipped})")
    print(f"  уникальных источников: {len(cache)}")
    print(f"  суммарный вес:         {total / 1024 / 1024:.2f} МБ")
    print(f"  требуют атрибуции:     {len(payload['_meta']['attributionRequired'])}")
    print(f"  каталог:               {FLAGS_DIR.relative_to(REPO_ROOT)}")

    if drawn:
        print("\nНЕ НАРИСОВАНЫ (запусти scripts/map/build_custom_flags.py):")
        for code in drawn:
            print("  -", code)
    if rejected:
        print("\nОТКЛОНЕНО (в набор не попало):")
        for line in rejected:
            print("  -", line)
    if failed:
        print("\nНЕ СКАЧАЛОСЬ:")
        for line in failed:
            print("  -", line)
    return 1 if rejected or failed or drawn else 0


if __name__ == "__main__":
    sys.exit(main())
