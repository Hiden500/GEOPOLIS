import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./ShapedBar.module.css";

/**
 * Панель с ВЫРЕЗОМ — тем самым сопряжением, которым верхняя панель
 * соединяется с вынесенным наружу элементом (рейтинг державы).
 *
 * Почему SVG, а не CSS. Вогнутый угол в CSS делается маской или
 * box-shadow-трюком, и оба дают залитую форму БЕЗ контура: рамка не умеет
 * идти по маске. Волосяная линия здесь — язык формы всей системы, и её
 * разрыв на самом заметном изгибе выглядел бы поломкой, а не стилем.
 * Один путь решает и заливку, и обводку сразу.
 *
 * Форма считается из ИЗМЕРЕННЫХ размеров: ширина панели зависит от числа
 * показателей и локали, положение выступа — от вёрстки. Захардкоженные
 * координаты разъехались бы на первом же переводе.
 */
export interface ShapedBarProps {
  /** Содержимое панели. */
  children: ReactNode;
  /** Содержимое выступа, висящего под нижним краем. */
  tab: ReactNode;
  /** Отступ выступа от левого края панели, в пикселях. */
  tabOffset?: number;
  className?: string;
}

export function ShapedBar({ children, tab, tabOffset = 24, className }: ShapedBarProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0, tabWidth: 0, tabHeight: 0 });

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const tabNode = tabRef.current;
    if (body === null || tabNode === null) return;

    const measure = () => {
      setBox({
        width: body.offsetWidth,
        height: body.offsetHeight,
        tabWidth: tabNode.offsetWidth,
        tabHeight: tabNode.offsetHeight,
      });
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(body);
    observer.observe(tabNode);
    return () => observer.disconnect();
  }, []);

  const { width: w, height: h, tabWidth: tw, tabHeight: th } = box;
  const root = typeof window === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize);
  const radius = root; // --radius-panel = 1rem
  const notch = root; // --notch = 1rem

  const t1 = tabOffset;
  const t2 = tabOffset + tw;
  const ready = w > 0 && h > 0 && tw > 0;

  // Обход по часовой стрелке от левого верхнего угла. Панель прижата к
  // левому и верхнему краю экрана, поэтому там углы прямые.
  const path = ready
    ? [
        `M 0 0`,
        `L ${w} 0`,
        `L ${w} ${h - radius}`,
        `A ${radius} ${radius} 0 0 1 ${w - radius} ${h}`,
        `L ${t2 + notch} ${h}`,
        `A ${notch} ${notch} 0 0 0 ${t2} ${h + notch}`,
        `L ${t2} ${h + th - radius}`,
        `A ${radius} ${radius} 0 0 1 ${t2 - radius} ${h + th}`,
        `L ${t1 + radius} ${h + th}`,
        `A ${radius} ${radius} 0 0 1 ${t1} ${h + th - radius}`,
        `L ${t1} ${h + notch}`,
        `A ${notch} ${notch} 0 0 0 ${t1 - notch} ${h}`,
        `L 0 ${h}`,
        `Z`,
      ].join(" ")
    : "";

  return (
    <div className={className} style={{ position: "relative", width: "max-content" }}>
      {ready && (
        <svg
          className={styles.shape}
          width={w}
          height={h + th}
          viewBox={`0 0 ${w} ${h + th}`}
          aria-hidden="true"
        >
          <path d={path} className={styles.path} />
        </svg>
      )}

      <div ref={bodyRef} className={styles.body}>
        {children}
      </div>

      <div ref={tabRef} className={styles.tab} style={{ left: tabOffset }}>
        {tab}
      </div>
    </div>
  );
}
