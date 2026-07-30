import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ShapedBar.module.css";

/**
 * Панель со СТУПЕНЧАТЫМ силуэтом и ВЫРЕЗАМИ.
 *
 * Форма: левая колонка (ФЛАГ) во всю высоту; справа две полосы — верхняя
 * шире (ПРИБОРОВ больше), нижняя уже (КОРЕШКОВ меньше), и между ними
 * S-образное сопряжение из выпуклой и вогнутой дуг. Под левой колонкой
 * висит выступ (РАНГ), соединённый вогнутыми вырезами.
 *
 * Почему SVG, а не CSS. Вогнутый угол в CSS делается маской или
 * box-shadow-трюком, и оба дают залитую форму БЕЗ контура: рамка не умеет
 * идти по маске. Волосяная линия здесь — язык формы всей системы, и её
 * разрыв на самом заметном изгибе выглядел бы поломкой. Один путь решает и
 * заливку, и обводку сразу.
 *
 * Геометрия считается из ИЗМЕРЕННЫХ размеров: ширина полос зависит от числа
 * элементов, локали и масштаба. Захардкоженные координаты разъехались бы на
 * первом же переводе.
 */
export interface ShapedBarProps {
  /** Колонка во всю высоту слева. */
  left?: ReactNode;
  /** Верхняя полоса — обычно более широкая. */
  top: ReactNode;
  /** Нижняя полоса. Уже верхней — отсюда ступенька. */
  bottom?: ReactNode;
  /** Выступ, висящий под нижним краем. */
  tab?: ReactNode;
  /** Отступ выступа от левого края панели, в пикселях. */
  tabOffset?: number;
  /** Полукруглый низ выступа вместо скругления по радиусу панели. */
  tabRound?: boolean;
  /**
   * Тонировать нижнюю полосу. Её левый край становится ЗЕРКАЛОМ правой
   * ступеньки: S-кривая от нижней кромки вверх к границе полос, сразу за
   * левой колонкой. Получается «слот», врезанный в панель между ФЛАГОМ и
   * ступенькой, — граница читается формой, а не разделительной линией.
   */
  bandTint?: boolean;
  /**
   * Горизонтальный размах S-сопряжения, в пикселях. Это ЕДИНСТВЕННОЕ число,
   * управляющее плавностью перехода: чем больше, тем положе кривая при той же
   * высоте полосы. Крутит его пользователь — в МЕНЮ макета есть ползунок.
   */
  bandSlant?: number;
  className?: string;
}

interface Box {
  leftW: number;
  topW: number;
  topH: number;
  botW: number;
  gridH: number;
  tabW: number;
  tabH: number;
}

const EMPTY: Box = { leftW: 0, topW: 0, topH: 0, botW: 0, gridH: 0, tabW: 0, tabH: 0 };

export function ShapedBar({
  left,
  top,
  bottom,
  tab,
  tabOffset = 16,
  tabRound = false,
  bandTint = false,
  bandSlant = 28,
  className,
}: ShapedBarProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>(EMPTY);

  useLayoutEffect(() => {
    const measure = () => {
      setBox({
        leftW: leftRef.current?.offsetWidth ?? 0,
        topW: topRef.current?.offsetWidth ?? 0,
        topH: topRef.current?.offsetHeight ?? 0,
        botW: botRef.current?.offsetWidth ?? 0,
        /*
         * Полная высота берётся у СЕТКИ, а не суммой полос. Панель может быть
         * растянута снаружи (выравнивание по соседней), и тогда сумма
         * измеренных полос отстаёт от факта: силуэт рисовался короче панели, и
         * низ выступа обрезался.
         */
        gridH: gridRef.current?.offsetHeight ?? 0,
        tabW: tabRef.current?.offsetWidth ?? 0,
        tabH: tabRef.current?.offsetHeight ?? 0,
      });
    };
    measure();

    const observer = new ResizeObserver(measure);
    for (const node of [gridRef.current, leftRef.current, topRef.current, botRef.current, tabRef.current]) {
      if (node !== null) observer.observe(node);
    }
    // Медиазапрос меняет содержимое полос, не трогая наблюдаемые узлы сразу.
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const unit =
    typeof window === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize);
  const r = unit; // --radius-panel = 1rem
  const n = unit; // --notch = 1rem

  const w1 = box.leftW + box.topW;
  const w2 = box.leftW + box.botW;
  const h1 = box.topH;
  const h = box.gridH;
  const tabH = box.tabH;
  const t1 = tabOffset;
  const t2 = tabOffset + box.tabW;
  const tr = tabRound ? tabH / 2 : r;

  const ready = w1 > 0 && h > 0;
  /*
   * Сопряжение — ОДНА кубическая кривая во всю высоту нижней полосы, а не
   * пара коротких дуг в углу. Пара дуг даёт перелом на стыке и читается как
   * «уголок»; сплошная S идёт от кромки до кромки и потому плавная. Наклон у
   * обоих концов полосы ОДИНАКОВЫЙ, а не зеркальный: верх правее низа с обеих
   * сторон.
   */
  const slant = bandSlant;
  /** Сверху вниз: из (x, yTop) в (x − slant, yBottom). */
  const sDown = (x: number, yTop: number, yBottom: number) =>
    `C ${x - slant / 2} ${yTop}, ${x - slant / 2} ${yBottom}, ${x - slant} ${yBottom}`;
  /** Снизу вверх: из (x, yBottom) в (x + slant, yTop). Тот же наклон, не зеркало. */
  const sUp = (x: number, yBottom: number, yTop: number) =>
    `C ${x + slant / 2} ${yBottom}, ${x + slant / 2} ${yTop}, ${x + slant} ${yTop}`;

  // Ступенька рисуется, только если сужение вмещает размах кривой; иначе
  // правый край идёт ровно по узкой полосе — «почти ступенька» читалась бы
  // как брак.
  const stepped = bottom !== undefined && w1 - w2 >= slant;
  const rightW = stepped ? w1 : Math.min(w1, w2 > 0 ? w2 : w1);

  const parts: string[] = ["M 0 0"];
  if (stepped) {
    parts.push(
      `L ${w1} 0`,
      `L ${w1} ${h1 - r}`,
      `A ${r} ${r} 0 0 1 ${w1 - r} ${h1}`,
      `L ${w2 + slant} ${h1}`,
      sDown(w2 + slant, h1, h),
    );
  } else {
    parts.push(`L ${rightW} 0`, `L ${rightW} ${h - r}`, `A ${r} ${r} 0 0 1 ${rightW - r} ${h}`);
  }

  if (tab !== undefined && box.tabW > 0) {
    parts.push(
      `L ${t2 + n} ${h}`,
      `A ${n} ${n} 0 0 0 ${t2} ${h + n}`,
      `L ${t2} ${h + tabH - tr}`,
      `A ${tr} ${tr} 0 0 1 ${t2 - tr} ${h + tabH}`,
    );
    if (t1 === 0) {
      // Выступ прижат к левому краю: вырез слева не нужен — выступ там просто
      // продолжает левую границу панели.
      parts.push(`L 0 ${h + tabH}`);
    } else {
      parts.push(
        `L ${t1 + tr} ${h + tabH}`,
        `A ${tr} ${tr} 0 0 1 ${t1} ${h + tabH - tr}`,
        `L ${t1} ${h + n}`,
        `A ${n} ${n} 0 0 0 ${t1 - n} ${h}`,
      );
    }
  }

  if (!(tab !== undefined && box.tabW > 0 && t1 === 0)) parts.push("L 0 " + h);
  parts.push("Z");
  const path = parts.join(" ");
  const totalH = h + (tab !== undefined ? tabH : 0);

  /*
   * Тонированная полоса. Заливка и обводка — РАЗНЫЕ пути: справа и снизу
   * граница полосы совпадает с контуром самой панели, и обводить её второй
   * раз значило бы удвоить линию. Обводится только то, чего в контуре нет:
   * верхняя кромка и левое S-сопряжение.
   */
  const L = box.leftW;
  const bandReady = bandTint && stepped && ready && L > 0 && w2 - L > 2 * slant;

  const bandFill = bandReady
    ? [
        `M ${L + slant} ${h1}`,
        `L ${w2 + slant} ${h1}`,
        sDown(w2 + slant, h1, h),
        `L ${L} ${h}`,
        sUp(L, h, h1),
        "Z",
      ].join(" ")
    : "";

  // Обводится только то, чего нет в контуре панели: верхняя кромка и левое
  // сопряжение. Справа и снизу граница полосы совпадает с контуром, и вторая
  // линия там дала бы удвоение.
  const bandEdge = bandReady
    ? [`M ${L} ${h}`, sUp(L, h, h1), `L ${w2 + slant} ${h1}`].join(" ")
    : "";

  return (
    <div className={className} style={{ position: "relative", width: "max-content" }}>
      {ready && (
        <svg
          className={styles.shape}
          width={stepped ? w1 : rightW}
          height={totalH}
          viewBox={`0 0 ${stepped ? w1 : rightW} ${totalH}`}
          aria-hidden="true"
        >
          <path d={path} className={styles.path} />
          {bandReady && (
            <>
              <path d={bandFill} className={styles.band} />
              <path d={bandEdge} className={styles.bandEdge} />
            </>
          )}
        </svg>
      )}

      <div ref={gridRef} className={styles.grid}>
        {left !== undefined && (
          <div ref={leftRef} className={styles.left}>
            {left}
          </div>
        )}
        <div className={styles.bands}>
          <div ref={topRef} className={styles.band}>
            {top}
          </div>
          {bottom !== undefined && (
            <div ref={botRef} className={styles.band}>
              {bottom}
            </div>
          )}
        </div>
      </div>

      {tab !== undefined && (
        <div ref={tabRef} className={styles.tab} style={{ left: tabOffset }}>
          {tab}
        </div>
      )}
    </div>
  );
}
