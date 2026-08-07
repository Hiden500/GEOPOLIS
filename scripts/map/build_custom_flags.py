"""
build_custom_flags.py — рисует флаги сущностей, у которых флага не было.

Двенадцать записей секции `custom` в config/flags_1946.json — зоны оккупации
Германии, Австрии и Кореи, советская администрация Маньчжурии и Договорный
Оман. Своих флагов у них в 1946 году не существовало: администрация поднимала
флаг державы, а Договорный берег был россыпью шейхств без общего символа.

ПОЧЕМУ КОДОМ, А НЕ ГЕНЕРАТИВНОЙ МОДЕЛЬЮ. Флаг — точная геометрия, а не
картинка «в стиле»: у модели уплывают пропорции, звезда выходит контурной
вместо сплошной, а ряд звёзд вываливается за кантон (проверено на прогонах).
Генерация остаётся за растровыми задачами — портретами, текстурами,
иллюстрациями (server/scripts/generateAsset.ts).

СИСТЕМА. Поле говорит, ЧЬЯ это земля, кантон в верхнем углу у древка — КТО ею
управляет. Одно правило на все зоны, поэтому четыре зоны Германии различаются
в HUD с одного взгляда, оставаясь узнаваемо немецкими. Исключение одно:
у Договорного Омана нет ни оккупанта, ни единого флага — там своя схема, общая
для флагов шейхств Залива.

КАНТОН БЕРЁТСЯ ИЗ НАСТОЯЩЕГО ФЛАГА ДЕРЖАВЫ
-------------------------------------------
Полотнище флага-донора (client/public/flags/SUN.svg и т.д.) вкладывается в
прямоугольник кантона как есть. Ничего не перерисовывается вручную: серп с
молотом, Union Jack и звёздное поле приходят из файлов набора, которые уже
проверены и нормализованы. Побочная выгода — правка флага державы сама
доезжает до всех зон, где он стоит кантоном.

ГЕОМЕТРИЯ КАНТОНА — ПРАВИЛО И ЧЕМ ОНО ПОДТВЕРЖДЕНО
---------------------------------------------------
Замер по набору (canvas, доля от полотнища) и официальные спецификации:

  Canadian Red Ensign   1:2     кантон 0.500 × 0.500 → 25,0% площади
  флаг США              1:1.9   union 0.400 × 0.538  → 21,5% площади (7 из 13 полос)
  флаг Либерии          10:19   union            5 из 11 полос
  флаг Малайзии         1:2     union            8 из 14 полос
  британские энсины     1:2     Union Jack — «одна четверть поля» по спецификации

Отсюда три правила, и все три работают на любой пропорции флага:

1. **Кантон сохраняет пропорцию своего флага-донора, а не подгоняется под
   квадрат.** У Red Ensign кантон 0,5×0,5 от флага 1:2 — то есть по абсолюту
   H в ширину и H/2 в высоту, ровно 2:1, пропорция самого Union Jack.
2. **Площадь не больше четверти флага** — общая вексиллологическая норма,
   и замеры её подтверждают (25,0% и 21,5%).
3. **На полосатом поле нижний край кантона ложится на границу полосы**, а не
   режет её посередине: 7 полос из 13 у США, 5 из 11 у Либерии, 8 из 14 у
   Малайзии. Сколько именно полос — определяет правило 2: берём самую нижнюю
   границу, при которой кантон ещё укладывается в четверть площади.

Как это ложится на наши поля при боксе 300×200 и доноре 1:2:

  Германия, 5 полос по 40 → границы 40/80/120/160.
      120 дало бы 240×120 = 48% площади — отпадает; берём 80.
      Кантон 160×80 = 21,3% и накрывает ДВЕ полосы.
  Австрия, 3 полосы по 66,7 → границы 66,7/133,3.
      133,3 дало бы 59% — отпадает; берём 66,7.
      Кантон 133×67 = 14,8% и накрывает ОДНУ полосу.
  Корея, поле сплошное → полос нет, берём половину высоты и ужимаем до
      четверти площади: 173×87.

Запуск (после fetch_flags.py — кантоны берутся из скачанных флагов):
    python scripts/map/build_custom_flags.py
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / "scripts" / "map" / "config" / "flags_1946.json"
FLAGS_DIR = REPO_ROOT / "client" / "public" / "flags"

W, H = 300, 200

# Потолок площади кантона — та самая «четверть флага».
MAX_CANTON_AREA = 0.25

WHITE = "#ffffff"
BLUE_C, RED_C = "#0033a0", "#c8102e"          # сигнальный флаг C
AUSTRIA_RED = "#ed2939"
KOREA_RED, KOREA_BLUE = "#cd2e3a", "#0047a0"
CHINA_RED, CHINA_BLUE = "#de2910", "#000095"
GULF_RED = "#ce1126"

OUTER_SVG = re.compile(r"^<svg[^>]*>(?P<inner>.*)</svg>\s*$", re.S)
FRAME_ATTR = re.compile(r'\s(x|y|width|height)="[^"]*"', re.I)
INNER_SIZE = re.compile(r'\b(width|height)="([\d.]+)"', re.I)


def donor_panel(code: str) -> tuple[str, float]:
    """Полотнище флага державы из набора: разметка-заготовка и его пропорция.

    Файлы набора устроены как «бокс 300×200, внутри вложенный <svg> с самим
    полотнищем». Берём этот вложенный тег целиком — вместе с его viewBox и
    preserveAspectRatio, — и остаётся только переставить ему координаты.
    """
    source = FLAGS_DIR / f"{code}.svg"
    if not source.exists():
        raise SystemExit(
            f"нет файла флага-донора {source.relative_to(REPO_ROOT)} — "
            f"сначала прогони scripts/map/fetch_flags.py")
    with source.open(encoding="utf-8", newline="") as fh:
        text = fh.read()
    match = OUTER_SVG.match(text)
    if not match:
        raise SystemExit(f"{code}: неожиданная структура файла набора")
    inner = match.group("inner").strip()

    head_end = inner.index(">")
    sizes = {k.lower(): float(v) for k, v in INNER_SIZE.findall(inner[:head_end])}
    if "width" not in sizes or "height" not in sizes or sizes["height"] <= 0:
        raise SystemExit(f"{code}: у полотнища нет размеров")
    return inner, sizes["width"] / sizes["height"]


def place(panel: str, x: float, y: float, width: float, height: float) -> str:
    """Ставит полотнище донора в заданный прямоугольник."""
    head_end = panel.index(">")
    head = FRAME_ATTR.sub("", panel[:head_end])
    head += (f' x="{x:.3f}" y="{y:.3f}" '
             f'width="{width:.3f}" height="{height:.3f}"')
    return head + panel[head_end:]


def canton_box(ratio: float, stripe_edges: list[float] | None) -> tuple[float, float]:
    """Размер кантона по правилам, выведенным из замеров (см. докстринг модуля).

    ratio — пропорция флага-донора; кантон её сохраняет.
    stripe_edges — границы полос поля сверху вниз; на сплошном поле None.
    """
    limit = MAX_CANTON_AREA * W * H
    if stripe_edges:
        # Самая нижняя граница полосы, при которой кантон ещё в пределах нормы.
        fitting = [edge for edge in stripe_edges if edge * ratio * edge <= limit]
        height = max(fitting) if fitting else min(stripe_edges)
    else:
        height = H / 2
    width = height * ratio
    if width * height > limit:
        scale = math.sqrt(limit / (width * height))
        width, height = width * scale, height * scale
    return width, height


def with_canton(field: str, occupier: str, stripe_edges: list[float] | None,
                defs: str = "") -> str:
    panel, ratio = donor_panel(occupier)
    width, height = canton_box(ratio, stripe_edges)
    canton = place(panel, 0, 0, width, height)
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    return f"{head}{defs}{field}{canton}</svg>\n"


def plain(field: str) -> str:
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    return f"{head}{field}</svg>\n"


# --- поля -------------------------------------------------------------------

# Полотнище немецкого торгового вымпела: сигнальный флаг C с раздвоенным
# концом. Единственный флаг, законно поднимавшийся немецкими судами в
# 1946–1949 годах, и потому единственная историческая опора для зон Германии.
GERMANY_STRIPES = (BLUE_C, WHITE, RED_C, WHITE, BLUE_C)
GERMANY_EDGES = [40, 80, 120, 160]
PENNANT_ID = "geopolis-pennant"
PENNANT_DEFS = (f'<defs><clipPath id="{PENNANT_ID}">'
                f'<polygon points="0,0 {W},0 {W - 50},{H / 2} {W},{H} 0,{H}"/>'
                f"</clipPath></defs>")


def field_germany() -> str:
    stripes = "".join(
        f'<rect y="{index * 40}" width="{W}" height="40" fill="{colour}"/>'
        for index, colour in enumerate(GERMANY_STRIPES))
    return f'<g clip-path="url(#{PENNANT_ID})">{stripes}</g>'


AUSTRIA_EDGES = [H / 3, 2 * H / 3]


def field_austria() -> str:
    band = H / 3
    return (f'<rect width="{W}" height="{band:.2f}" fill="{AUSTRIA_RED}"/>'
            f'<rect y="{band:.2f}" width="{W}" height="{band:.2f}" fill="{WHITE}"/>'
            f'<rect y="{2 * band:.2f}" width="{W}" height="{band:.2f}" fill="{AUSTRIA_RED}"/>')


def field_korea() -> str:
    """Тхэгык без триграмм.

    В 1946 году флаг Кореи ещё не был стандартизован, а восемь штриховых групп
    в блоке 88 px сливаются в грязь. Круг узнаваем и без них. Смещён к вольной
    стороне, чтобы не спорить с кантоном.
    """
    return (
        f'<rect width="{W}" height="{H}" fill="{WHITE}"/>'
        f'<path d="M145,110 a45,45 0 0,1 90,0 a22.5,22.5 0 0,1 -45,0 '
        f'a22.5,22.5 0 0,0 -45,0" fill="{KOREA_RED}"/>'
        f'<path d="M145,110 a45,45 0 0,0 90,0 a22.5,22.5 0 0,0 -45,0 '
        f'a22.5,22.5 0 0,1 -45,0" fill="{KOREA_BLUE}"/>'
    )


def field_manchuria() -> str:
    """Красное поле с белым солнцем Китайской Республики.

    Солнце сдвинуто к вольной стороне и вниз — под кантоном ему места нет,
    а перекрывать государственный символ чужим флагом значит сказать не то,
    что задумано.
    """
    cx, cy, inner, outer, rays = 205.0, 125.0, 20.0, 44.0, 12
    points = []
    for index in range(rays * 2):
        angle = math.radians(-90 + index * (360 / (rays * 2)))
        r = outer if index % 2 == 0 else inner
        points.append(f"{cx + r * math.cos(angle):.2f},{cy + r * math.sin(angle):.2f}")
    return (f'<rect width="{W}" height="{H}" fill="{CHINA_RED}"/>'
            f'<circle cx="{cx}" cy="{cy}" r="52" fill="{CHINA_BLUE}"/>'
            f'<polygon points="{" ".join(points)}" fill="{WHITE}"/>')


def field_trucial() -> str:
    """Красное поле с белой полосой у древка — общая схема флагов шейхств Залива."""
    return (f'<rect width="{W}" height="{H}" fill="{GULF_RED}"/>'
            f'<rect width="75" height="{H}" fill="{WHITE}"/>')


BUILDERS = {
    "QGA": lambda: with_canton(field_germany(), "USA", GERMANY_EDGES, PENNANT_DEFS),
    "QGB": lambda: with_canton(field_germany(), "GBR", GERMANY_EDGES, PENNANT_DEFS),
    "QGF": lambda: with_canton(field_germany(), "FRA", GERMANY_EDGES, PENNANT_DEFS),
    "QGS": lambda: with_canton(field_germany(), "SUN", GERMANY_EDGES, PENNANT_DEFS),
    "QOA": lambda: with_canton(field_austria(), "USA", AUSTRIA_EDGES),
    "QOB": lambda: with_canton(field_austria(), "GBR", AUSTRIA_EDGES),
    "QOF": lambda: with_canton(field_austria(), "FRA", AUSTRIA_EDGES),
    "QOS": lambda: with_canton(field_austria(), "SUN", AUSTRIA_EDGES),
    "QKA": lambda: with_canton(field_korea(), "USA", None),
    "QKS": lambda: with_canton(field_korea(), "SUN", None),
    "QMS": lambda: with_canton(field_manchuria(), "SUN", None),
    "ARE": lambda: plain(field_trucial()),
}


def main() -> int:
    with CONFIG.open(encoding="utf-8") as fh:
        custom = json.load(fh)["custom"]

    missing = sorted(set(custom) - set(BUILDERS))
    extra = sorted(set(BUILDERS) - set(custom))
    if missing or extra:
        print("Расхождение с конфигом:")
        if missing:
            print("  нет рисунка для:", missing)
        if extra:
            print("  рисунок без записи в custom:", extra)
        return 1

    FLAGS_DIR.mkdir(parents=True, exist_ok=True)
    written = 0
    for code in sorted(BUILDERS):
        svg = BUILDERS[code]()
        target = FLAGS_DIR / f"{code}.svg"
        current = None
        if target.exists():
            with target.open(encoding="utf-8", newline="") as fh:
                current = fh.read()
        if current != svg:
            with target.open("w", encoding="utf-8", newline="") as fh:
                fh.write(svg)
            written += 1

    print("Флаги сущностей без исторического флага")
    print(f"  нарисовано:  {len(BUILDERS)} (записано {written})")
    for label, edges, donor in (("Германия", GERMANY_EDGES, "SUN"),
                                ("Австрия", AUSTRIA_EDGES, "SUN"),
                                ("сплошное поле", None, "SUN")):
        _, ratio = donor_panel(donor)
        width, height = canton_box(ratio, edges)
        share = width * height / (W * H)
        stripes = "" if not edges else f", полос под кантоном: {edges.index(height) + 1}"
        print(f"  кантон {label:14s} {width:6.1f}×{height:5.1f} "
              f"= {share * 100:4.1f}% площади{stripes}")
    print(f"  каталог:     {FLAGS_DIR.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
