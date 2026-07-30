/**
 * Иконки дизайн-системы. Все рисуются штрихом в 1.5px на сетке 16 —
 * одинаковая «толщина линии» роднит их между собой и с волосяным контуром
 * панелей. Цвет всегда наследуется (`currentColor`), чтобы иконка жила
 * состоянием своего родителя, а не собственным.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 3L5 8l5 5" />
    </Icon>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Icon>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3 3" />
    </Icon>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="7" width="9" height="6" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </Icon>
  );
}

export function IconDrag(props: IconProps) {
  return (
    <Icon {...props} strokeWidth="2">
      <path d="M6 4h.01M6 8h.01M6 12h.01M10 4h.01M10 8h.01M10 12h.01" />
    </Icon>
  );
}

export function IconWarning(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.5L14.5 13.5h-13z" />
      <path d="M8 6.5v3M8 11.5h.01" />
    </Icon>
  );
}

/* ── Показатели державы ──────────────────────────────────────────
 * Пары, стоящие рядом, различаются РИСУНКОМ, а не оттенком: без
 * подписей значок остаётся единственным носителем смысла, и два похожих
 * щита превратили бы «стабильность» и «легитимность» в один ребус.
 */

/** ВВП — восходящие столбцы. */
export function IconOutput(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 13.5h11" />
      <path d="M4.5 11.5v-3M8 11.5v-6M11.5 11.5v-4.5" />
    </Icon>
  );
}

/** Баланс — весы. */
export function IconBalance(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M4 13.5h8" />
      <path d="M2 6h12" />
      <path d="M2 6l-1.2 3h2.4zM14 6l1.2 3h-2.4z" />
    </Icon>
  );
}

/** Население — две фигуры. */
export function IconPeople(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="5.5" r="2.2" />
      <path d="M2.2 13.2c0-2.1 1.7-3.6 3.8-3.6s3.8 1.5 3.8 3.6" />
      <path d="M10.8 4.2a2.2 2.2 0 010 4.2" />
      <path d="M11.4 9.9c1.6.3 2.6 1.6 2.6 3.3" />
    </Icon>
  );
}

/** Стабильность — опора: точка равновесия под перекладиной. */
export function IconStability(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 5.5h12" />
      <path d="M8 5.5l-3.5 5h7z" />
      <path d="M3.5 13.5h9" />
    </Icon>
  );
}

/** Легитимность — печать: круг с внутренней звездой. */
export function IconLegitimacy(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.8l1 2.2 2.3.2-1.8 1.5.6 2.3L8 9.8l-2.1 1.2.6-2.3L4.7 7.2 7 7z" />
    </Icon>
  );
}

/** Долг — гиря: тяжесть, которую несут. */
export function IconDebt(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 4.5a2 2 0 014 0" />
      <path d="M4.2 6.5h7.6l1.2 7H3z" />
    </Icon>
  );
}

/* ── Тома ───────────────────────────────────────────────────────── */

/** Экономика — заводские корпуса. */
export function IconEconomy(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2 13.5V7l3.5 2V7L9 9V5.5l4.5 2.5v5.5z" />
      <path d="M11.5 3.5V6" />
    </Icon>
  );
}

/** Политика — колоннада. */
export function IconPolitics(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.8 6L8 2.5 14.2 6z" />
      <path d="M4 7.5v4M8 7.5v4M12 7.5v4" />
      <path d="M2.5 13.5h11" />
    </Icon>
  );
}

/** Оборона — щит. */
export function IconDefence(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2l5 1.8v4.4c0 3-2.1 5-5 5.8-2.9-.8-5-2.8-5-5.8V3.8z" />
    </Icon>
  );
}

/** Наука — колба. */
export function IconScience(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2.5h4" />
      <path d="M6.8 2.5v3.8L3.4 12a1.4 1.4 0 001.2 2.1h6.8a1.4 1.4 0 001.2-2.1L9.2 6.3V2.5" />
      <path d="M5.2 9.8h5.6" />
    </Icon>
  );
}

/** Дипломатия — два пересечённых круга: отношения. */
export function IconDiplomacy(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="8" r="3.8" />
      <circle cx="10" cy="8" r="3.8" />
    </Icon>
  );
}

/** Цели — мишень. */
export function IconGoals(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.2" />
    </Icon>
  );
}

/** Реестр — разграфка таблицы. */
export function IconLedger(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.2" y="2.8" width="11.6" height="10.4" rx="1.2" />
      <path d="M2.2 6.2h11.6M6.4 6.2v7M2.2 9.8h11.6" />
    </Icon>
  );
}

/* ── Режимы карты ───────────────────────────────────────────────── */

/** Державы — флаг. */
export function IconFlagMode(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 14V2.5" />
      <path d="M4 3.2h8.5l-1.8 2.6 1.8 2.6H4" />
    </Icon>
  );
}

/** Блоки — связанные узлы. */
export function IconBlocs(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="4" cy="4.5" r="1.8" />
      <circle cx="12" cy="5.5" r="1.8" />
      <circle cx="7.5" cy="12" r="1.8" />
      <path d="M5.4 5.6l4.9.7M5.2 6.2l1.6 4.1M11.2 7.1l-2.6 3.6" />
    </Icon>
  );
}

/** Недовольство — пламя. */
export function IconUnrest(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.2c2.4 2.4 4.4 4 4.4 6.6A4.4 4.4 0 018 13.4a4.4 4.4 0 01-4.4-4.6C3.6 6.6 5 5.6 6 3.8c.4 1.2 1 1.8 2 2.4z" />
    </Icon>
  );
}

/** Ресурсы — рудный куб. */
export function IconResources(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.2l5.4 3.1v5.4L8 13.8l-5.4-3.1V5.3z" />
      <path d="M8 8.4l5.4-3.1M8 8.4v5.4M8 8.4L2.6 5.3" />
    </Icon>
  );
}

/** Армии — клинок. */
export function IconArmies(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 1.8l1.8 6.4-1.8 2-1.8-2z" />
      <path d="M5.2 10.4h5.6M8 10.4v3.8" />
    </Icon>
  );
}

/** Рельеф — хребты. */
export function IconTerrain(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 12.5l4-6.5 3 4.5 2-3 4 5z" />
    </Icon>
  );
}

/* ── Служебное ──────────────────────────────────────────────────── */

export function IconSave(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.2 2.8h7.2l2.4 2.4v8H3.2z" />
      <path d="M5.6 2.8v3.6h4.8V2.8M5.6 13.2v-3.4h4.8v3.4" />
    </Icon>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </Icon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3l5 5-5 5" />
    </Icon>
  );
}

export function IconChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 10l4-4 4 4" />
    </Icon>
  );
}
