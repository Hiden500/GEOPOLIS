"""
build_custom_flags.py — рисует флаги сущностей, у которых флага не было.

Двенадцать записей секции `custom` в config/flags_1946.json — зоны оккупации
Германии, Австрии и Кореи, советская администрация Маньчжурии и Договорный
Оман. Своих флагов у них в 1946 году не существовало: администрация поднимала
флаг державы, а Договорный берег был россыпью шейхств без общего символа.

ПОЧЕМУ КОДОМ, А НЕ ГЕНЕРАТИВНОЙ МОДЕЛЬЮ. Флаг — точная геометрия, а не
картинка «в стиле»: у модели уплывают пропорции, звезда выходит контурной
вместо сплошной, а ряд звёзд вываливается за кантон (проверено на живых
прогонах). Здесь каждая координата задана явно, результат воспроизводим и
правится в одном месте. Генерация остаётся для растровых задач — портретов,
текстур, иллюстраций (server/scripts/generateAsset.ts).

СИСТЕМА. Поле говорит, ЧЬЯ это земля, кантон в верхнем левом углу — КТО ею
управляет. Одно правило на все зоны, поэтому четыре зоны Германии различаются
в HUD с одного взгляда, оставаясь при этом узнаваемо немецкими.

Исключений из системы два, и оба обоснованы:
  - Маньчжурия не делится на зоны, различать нечего — там наоборот: поле
    советское, а китайское солнце говорит, чья земля;
  - у Договорного Омана нет ни оккупанта, ни единого флага — своя схема,
    общая для флагов шейхств Залива (красное поле, белая полоса у древка).

Размер 300×200 совпадает с боксом скачанных флагов (fetch_flags.py), поэтому
файлы кладутся в тот же каталог и живут в наборе на равных.

Запуск:
    python scripts/map/build_custom_flags.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG = REPO_ROOT / "scripts" / "map" / "config" / "flags_1946.json"
FLAGS_DIR = REPO_ROOT / "client" / "public" / "flags"

W, H = 300, 200
CANTON_W, CANTON_H = 120, 80

# Цвета взяты из флагов держав и стран, к которым отсылают зоны.
BLUE_C, WHITE, RED_C = "#0033a0", "#ffffff", "#c8102e"      # сигнальный флаг C
AUSTRIA_RED = "#ed2939"
KOREA_RED, KOREA_BLUE = "#cd2e3a", "#0047a0"
SOVIET_RED, GOLD = "#cc0000", "#ffd700"
US_BLUE = "#3c3b6e"
FR_BLUE, FR_RED = "#002395", "#ed2939"
UK_BLUE, UK_RED = "#012169", "#c8102e"
CHINA_RED, CHINA_BLUE = "#de2910", "#000095"
GULF_RED = "#ce1126"


def star(cx: float, cy: float, radius: float, fill: str) -> str:
    """Сплошная пятиконечная звезда одним лучом вверх.

    Внутренний радиус — 0,382 внешнего: это отношение, при котором лучи
    правильной пятиконечной звезды выходят прямыми.
    """
    points = []
    for index in range(10):
        angle = math.radians(-90 + index * 36)
        r = radius if index % 2 == 0 else radius * 0.382
        points.append(f"{cx + r * math.cos(angle):.2f},{cy + r * math.sin(angle):.2f}")
    return f'<polygon points="{" ".join(points)}" fill="{fill}"/>'


def sun(cx: float, cy: float, inner: float, outer: float, rays: int, fill: str) -> str:
    """Солнце с треугольными лучами — «белое солнце» гоминьдановского флага."""
    points = []
    for index in range(rays * 2):
        angle = math.radians(-90 + index * (360 / (rays * 2)))
        r = outer if index % 2 == 0 else inner
        points.append(f"{cx + r * math.cos(angle):.2f},{cy + r * math.sin(angle):.2f}")
    return f'<polygon points="{" ".join(points)}" fill="{fill}"/>'


def canton_soviet() -> str:
    return (f'<rect width="{CANTON_W}" height="{CANTON_H}" fill="{SOVIET_RED}"/>'
            + star(CANTON_W / 2, CANTON_H / 2, 26, GOLD))


def canton_american() -> str:
    """Девять звёзд сеткой 3×3.

    Центры перечислены явно, а не выводятся из «шага сетки»: ровно на этом
    арифметическом шаге нижний ряд уезжал за нижнюю границу кантона.
    """
    stars = "".join(star(x, y, 9, WHITE)
                    for y in (18, 40, 62) for x in (26, 60, 94))
    return f'<rect width="{CANTON_W}" height="{CANTON_H}" fill="{US_BLUE}"/>{stars}'


def canton_french() -> str:
    third = CANTON_W / 3
    return (f'<rect width="{third}" height="{CANTON_H}" fill="{FR_BLUE}"/>'
            f'<rect x="{third}" width="{third}" height="{CANTON_H}" fill="{WHITE}"/>'
            f'<rect x="{2 * third}" width="{third}" height="{CANTON_H}" fill="{FR_RED}"/>')


def canton_british() -> str:
    """Union Jack, вписанный в кантон 3:2.

    Настоящий флаг — 1:2, и в кантоне другой формы он неизбежно шире по
    вертикали: так же поступают все флаги с этим кантоном. Диагонали здесь без
    контрперемены (красные полосы не смещены относительно оси) — на 88 px это
    неразличимо, а геометрия остаётся простой и правится в одну строку.
    """
    diagonals = f"M0,0 L{CANTON_W},{CANTON_H} M{CANTON_W},0 L0,{CANTON_H}"
    cross = f"M{CANTON_W / 2},0 V{CANTON_H} M0,{CANTON_H / 2} H{CANTON_W}"
    return (
        f'<g clip-path="url(#uk)">'
        f'<rect width="{CANTON_W}" height="{CANTON_H}" fill="{UK_BLUE}"/>'
        f'<path d="{diagonals}" stroke="{WHITE}" stroke-width="{CANTON_H / 5:.2f}"/>'
        f'<path d="{diagonals}" stroke="{UK_RED}" stroke-width="{CANTON_H / 15:.2f}"/>'
        f'<path d="{cross}" stroke="{WHITE}" stroke-width="{CANTON_H / 3:.2f}"/>'
        f'<path d="{cross}" stroke="{UK_RED}" stroke-width="{CANTON_H / 5:.2f}"/>'
        f"</g>"
    )


CANTONS = {
    "SUN": canton_soviet,
    "USA": canton_american,
    "FRA": canton_french,
    "GBR": canton_british,
}

# Разделительная линия по краю кантона. Без неё французский кантон растворяется
# в поле: у австрийской зоны его белая полоса продолжает белую полосу поля, а
# красная — красную, и флаг читается как «синяя полоса слева». Линия нужна всем
# кантонам, а не только французскому: разнобой был бы заметнее самой проблемы.
# Толщина 3 при ширине 300 — это ~0,9 px в блоке HUD 88 px, то есть линия
# остаётся видимой там, где решается читаемость.
CANTON_EDGE, CANTON_EDGE_WIDTH = "#1c1a17", 3


def canton_border() -> str:
    inset = CANTON_EDGE_WIDTH / 2
    return (f'<rect x="{inset}" y="{inset}" '
            f'width="{CANTON_W - CANTON_EDGE_WIDTH}" height="{CANTON_H - CANTON_EDGE_WIDTH}" '
            f'fill="none" stroke="{CANTON_EDGE}" stroke-width="{CANTON_EDGE_WIDTH}"/>')

# Полотнище немецкого торгового вымпела: сигнальный флаг C с раздвоенным концом.
# Единственный флаг, законно поднимавшийся немецкими судами в 1946–1949 годах, и
# потому единственная историческая опора для зон Германии.
PENNANT_SHAPE = f"0,0 {W},0 {W - 50},{H / 2} {W},{H} 0,{H}"


def field_germany() -> str:
    stripes = "".join(
        f'<rect y="{index * 40}" width="{W}" height="40" fill="{colour}"/>'
        for index, colour in enumerate((BLUE_C, WHITE, RED_C, WHITE, BLUE_C)))
    return f'<g clip-path="url(#pennant)">{stripes}</g>'


def field_austria() -> str:
    band = H / 3
    return (f'<rect width="{W}" height="{band:.2f}" fill="{AUSTRIA_RED}"/>'
            f'<rect y="{band:.2f}" width="{W}" height="{band:.2f}" fill="{WHITE}"/>'
            f'<rect y="{2 * band:.2f}" width="{W}" height="{band:.2f}" fill="{AUSTRIA_RED}"/>')


def field_korea() -> str:
    """Тхэгык без триграмм.

    В 1946 году флаг Кореи ещё не был стандартизован, а восемь штриховых групп
    в блоке 88 px сливаются в грязь. Круг узнаваем и без них.
    """
    return (
        f'<rect width="{W}" height="{H}" fill="{WHITE}"/>'
        f'<path d="M100,100 a50,50 0 0,1 100,0 a25,25 0 0,1 -50,0 a25,25 0 0,0 -50,0" '
        f'fill="{KOREA_RED}"/>'
        f'<path d="M100,100 a50,50 0 0,0 100,0 a25,25 0 0,0 -50,0 a25,25 0 0,1 -50,0" '
        f'fill="{KOREA_BLUE}"/>'
    )


def build(field: str, canton: str | None, defs: str = "") -> str:
    body = field + (canton + canton_border() if canton else "")
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}">')
    return f"{head}{defs}{body}</svg>\n"


PENNANT_DEFS = f'<defs><clipPath id="pennant"><polygon points="{PENNANT_SHAPE}"/></clipPath></defs>'
UK_DEFS = f'<defs><clipPath id="uk"><rect width="{CANTON_W}" height="{CANTON_H}"/></clipPath></defs>'


def germany(occupier: str) -> str:
    defs = PENNANT_DEFS + (UK_DEFS if occupier == "GBR" else "")
    return build(field_germany(), CANTONS[occupier](), defs)


def austria(occupier: str) -> str:
    defs = UK_DEFS if occupier == "GBR" else ""
    return build(field_austria(), CANTONS[occupier](), defs)


def korea(occupier: str) -> str:
    return build(field_korea(), CANTONS[occupier]())


def manchuria() -> str:
    """Схема перевёрнута: поле советское, солнце — китайское.

    Территория под прямой военной администрацией и на зоны не делится, поэтому
    различать кантоном нечего, а сказать надо обратное: чья это земля.
    """
    field = (f'<rect width="{W}" height="{H}" fill="{CHINA_RED}"/>'
             f'<circle cx="{W / 2}" cy="{H / 2}" r="55" fill="{CHINA_BLUE}"/>'
             + sun(W / 2, H / 2, 22, 48, 12, WHITE))
    return build(field, star(38, 34, 20, GOLD))


def trucial_states() -> str:
    """Красное поле с белой полосой у древка — общая схема флагов шейхств Залива."""
    field = (f'<rect width="{W}" height="{H}" fill="{GULF_RED}"/>'
             f'<rect width="75" height="{H}" fill="{WHITE}"/>')
    return build(field, None)


BUILDERS = {
    "QGA": lambda: germany("USA"), "QGB": lambda: germany("GBR"),
    "QGF": lambda: germany("FRA"), "QGS": lambda: germany("SUN"),
    "QOA": lambda: austria("USA"), "QOB": lambda: austria("GBR"),
    "QOF": lambda: austria("FRA"), "QOS": lambda: austria("SUN"),
    "QKA": lambda: korea("USA"), "QKS": lambda: korea("SUN"),
    "QMS": manchuria,
    "ARE": trucial_states,
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
    print(f"  каталог:     {FLAGS_DIR.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
