import { useEffect } from "react";
import styles from "./ShapeGallery.module.css";

/**
 * Выбор силуэта ШАПКИ. Открывается через ?showcase=shapes.
 *
 * Существует затем, чтобы прекратить угадывание словами: ASCII не умеет
 * рисовать кривые, а описания расходились уже трижды. Здесь шесть силуэтов
 * нарисованы рядом, включая оба неверных прочтения, — достаточно назвать
 * номер.
 *
 * Геометрия здесь ЗАФИКСИРОВАНА числами, а не измерена: это выбор формы, а не
 * рабочая панель. Победивший вариант переносится в ShapedBar, где размеры
 * снова считаются от содержимого.
 */

const W = 620; // ширина панели: ФЛАГ + ПРИБОРЫ
const NARROW = 470; // ширина нижней части, если силуэт ступенчатый
const FLAG_W = 112;
const H1 = 68; // высота полосы ПРИБОРОВ
const H2 = 46; // высота полосы КОРЕШКОВ
const H = H1 + H2;
const R = 14; // радиус панели
const N = 14; // радиус выреза (вогнутая дуга)

/** Ступенчатый контур: широкий верх, узкий низ, S-сопряжение справа. */
function stepped(w1: number, w2: number): string {
  return [
    "M 0 0",
    `L ${w1} 0`,
    `L ${w1} ${H1 - R}`,
    `A ${R} ${R} 0 0 1 ${w1 - R} ${H1}`,
    `L ${w2 + N} ${H1}`,
    `A ${N} ${N} 0 0 0 ${w2} ${H1 + N}`,
    `L ${w2} ${H - R}`,
    `A ${R} ${R} 0 0 1 ${w2 - R} ${H}`,
    `L ${R} ${H}`,
    `A ${R} ${R} 0 0 1 0 ${H - R}`,
    "Z",
  ].join(" ");
}

/** Ровный контур без ступеньки. */
function flat(w: number, h: number): string {
  return [
    "M 0 0",
    `L ${w} 0`,
    `L ${w} ${h - R}`,
    `A ${R} ${R} 0 0 1 ${w - R} ${h}`,
    `L ${R} ${h}`,
    `A ${R} ${R} 0 0 1 0 ${h - R}`,
    "Z",
  ].join(" ");
}

/**
 * Контур с нижней полосой, ВСТАВЛЕННОЙ с двух сторон: полоса КОРЕШКОВ
 * отступает и слева, и справа, соединяясь с панелью вогнутыми дугами.
 */
function inset(w: number, left: number, right: number): string {
  return [
    "M 0 0",
    `L ${w} 0`,
    `L ${w} ${H1 - R}`,
    `A ${R} ${R} 0 0 1 ${w - R} ${H1}`,
    `L ${right + N} ${H1}`,
    `A ${N} ${N} 0 0 0 ${right} ${H1 + N}`,
    `L ${right} ${H - R}`,
    `A ${R} ${R} 0 0 1 ${right - R} ${H}`,
    `L ${left + R} ${H}`,
    `A ${R} ${R} 0 0 1 ${left} ${H - R}`,
    `L ${left} ${H1 + N}`,
    `A ${N} ${N} 0 0 0 ${left - N} ${H1}`,
    `L ${R} ${H1}`,
    `A ${R} ${R} 0 0 1 0 ${H1 - R}`,
    "Z",
  ].join(" ");
}

/**
 * Тонированная область со СКОШЕННЫМИ концами — «жёлоб», у которого верхняя
 * граница переходит в боковую S-кривой, как на наброске пользователя.
 */
function groove(x: number, y: number, w: number, h: number): string {
  const s = 18; // вылет скоса
  return [
    `M ${x + s} ${y}`,
    `L ${x + w - s} ${y}`,
    `C ${x + w - s / 2} ${y}, ${x + w - s / 2} ${y + h}, ${x + w} ${y + h}`,
    `L ${x} ${y + h}`,
    `C ${x + s / 2} ${y + h}, ${x + s / 2} ${y}, ${x + s} ${y}`,
    "Z",
  ].join(" ");
}

function Contents() {
  const iconsFrom = FLAG_W + 18;
  return (
    <>
      {/* ФЛАГ */}
      <rect className={styles.chip} x={12} y={12} width={84} height={56} rx={3} />
      {/* ПРИБОРЫ — четыре пары «иконка + число» */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(${FLAG_W + 24 + i * 108}, 26)`}>
          <rect className={styles.icon} x={0} y={0} width={16} height={16} rx={3} />
          <text className={styles.labelBright} x={24} y={13} fontSize={16} fontWeight={600}>
            1,46T
          </text>
        </g>
      ))}
      {/* КОРЕШКИ — шесть иконок */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect
          key={i}
          className={styles.icon}
          x={iconsFrom + 14 + i * 34}
          y={H1 + 14}
          width={18}
          height={18}
          rx={4}
        />
      ))}
      {/* РАНГ */}
      <circle className={styles.rank} cx={26} cy={H + 6} r={13} />
      <text className={styles.labelBright} x={26} y={H + 11} fontSize={13} fontWeight={600} textAnchor="middle">
        2
      </text>
    </>
  );
}

interface Variant {
  name: string;
  note: string;
  render: () => React.ReactNode;
}

const VARIANTS: Variant[] = [
  {
    name: "Как сейчас",
    note: "Ступенька справа, полоса КОРЕШКОВ ничем не выделена. То, что стоит в макете прямо сейчас.",
    render: () => (
      <>
        <path className={styles.outline} d={stepped(W, NARROW)} />
        <line className={styles.divider} x1={FLAG_W} y1={0} x2={FLAG_W} y2={H} />
      </>
    ),
  },
  {
    name: "Жёлоб со скошенными концами",
    note: "Силуэт как сейчас, но область КОРЕШКОВ утоплена: темнее панели, концы уходят S-кривой, слева отступает от края — ФЛАГ остаётся на общем фоне. Так я понял набросок в последний раз.",
    render: () => (
      <>
        <path className={styles.outline} d={stepped(W, NARROW)} />
        <path className={styles.grooveDark} d={groove(FLAG_W + 6, H1, NARROW - FLAG_W - 26, H2)} />
        <path className={styles.grooveEdge} d={groove(FLAG_W + 6, H1, NARROW - FLAG_W - 26, H2)} />
        <line className={styles.divider} x1={FLAG_W} y1={0} x2={FLAG_W} y2={H1} />
      </>
    ),
  },
  {
    name: "Полка вместо жёлоба",
    note: "То же самое, но область КОРЕШКОВ светлее панели: не углубление, а приподнятая полка.",
    render: () => (
      <>
        <path className={styles.outline} d={stepped(W, NARROW)} />
        <path className={styles.grooveLight} d={groove(FLAG_W + 6, H1, NARROW - FLAG_W - 26, H2)} />
        <path className={styles.grooveEdge} d={groove(FLAG_W + 6, H1, NARROW - FLAG_W - 26, H2)} />
        <line className={styles.divider} x1={FLAG_W} y1={0} x2={FLAG_W} y2={H1} />
      </>
    ),
  },
  {
    name: "Полоса вставлена в панель с двух сторон",
    note: "Контур сам сужается снизу и слева, и справа: полоса КОРЕШКОВ вставлена внутрь панели вогнутыми дугами. Так я понял набросок в первый раз.",
    render: () => (
      <>
        <path className={styles.outline} d={inset(W, FLAG_W - 6, NARROW)} />
        <line className={styles.divider} x1={FLAG_W} y1={0} x2={FLAG_W} y2={H1} />
      </>
    ),
  },
  {
    name: "Без ступеньки, отличается только тон",
    note: "Контур ровный прямоугольник во всю ширину; КОРЕШКИ отделены исключительно заливкой и S-границей. Самый спокойный вариант.",
    render: () => (
      <>
        <path className={styles.outline} d={flat(W, H)} />
        <path className={styles.grooveDark} d={groove(FLAG_W + 6, H1, W - FLAG_W - 26, H2)} />
        <path className={styles.grooveEdge} d={groove(FLAG_W + 6, H1, W - FLAG_W - 26, H2)} />
        <line className={styles.divider} x1={FLAG_W} y1={0} x2={FLAG_W} y2={H1} />
      </>
    ),
  },
  {
    name: "ФЛАГ отдельной капсулой",
    note: "ФЛАГ вынесен в свою форму, панель с ПРИБОРАМИ и КОРЕШКАМИ примыкает справа. РАНГ висит под капсулой флага.",
    render: () => (
      <>
        <path className={styles.outline} d={flat(FLAG_W - 8, H)} transform="translate(0,0)" />
        <g transform={`translate(${FLAG_W + 6}, 0)`}>
          <path className={styles.outline} d={stepped(W - FLAG_W - 6, NARROW - FLAG_W - 6)} />
          <path
            className={styles.grooveDark}
            d={groove(10, H1, NARROW - FLAG_W - 40, H2)}
          />
        </g>
      </>
    ),
  },
];

export function ShapeGallery() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const palette = params.get("palette");
    if (palette !== null) document.documentElement.dataset.palette = palette;
  }, []);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Силуэт ШАПКИ — выбор</h1>
      <p className={styles.sub}>
        Шесть вариантов рядом, включая оба моих неверных прочтения (4 — первое, 2 — второе). Назови
        номер; можно комбинировать: «контур из 4, тон из 3». Содержимое здесь условное — важна форма.
      </p>

      <div className={styles.list}>
        {VARIANTS.map((variant, index) => (
          <section key={variant.name} className={styles.item}>
            <div className={styles.title}>
              <span className={styles.num}>{index + 1}</span>
              <span className={styles.name}>{variant.name}</span>
            </div>
            <p className={styles.note}>{variant.note}</p>
            <div className={styles.stage}>
              <svg
                className={styles.shape}
                width={W + 40}
                height={H + 40}
                viewBox={`-10 -6 ${W + 40} ${H + 40}`}
                role="img"
                aria-label={variant.name}
              >
                {variant.render()}
                <Contents />
              </svg>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
