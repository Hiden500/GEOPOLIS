import { type ReactNode, type SVGProps } from "react";

/**
 * Иконки HUD — контуры взяты дословно из утверждённого эталона
 * (docs/plans/assets/geopolis-1946-hud.html) для визуального соответствия.
 * Размер/цвет — через CSS у вызывающего элемента (width/height/color).
 */
type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps, children: ReactNode) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true" {...props}>
      {children}
    </svg>
  );
}

export const IconGdp = (p: IconProps) => base(p, <path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-7" />);
export const IconTreasury = (p: IconProps) => base(p, <><circle cx="12" cy="12" r="8" /><path d="M9 12h6M12 9v6" /></>);
export const IconPopulation = (p: IconProps) =>
  base(p, <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 6a3 3 0 010 6" /></>);
export const IconMilitary = (p: IconProps) => base(p, <path d="M3 21l9-9m0 0l3-3 3 3-3 3zM6 6l4 4M4 8l3-3" />);
export const IconStability = (p: IconProps) => base(p, <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />);
export const IconLegitimacy = (p: IconProps) => base(p, <path d="M12 2l3 6 6 .5-4.5 4 1.5 6-6-3.5M12 2l-3 6-6 .5 4.5 4-1.5 6 6-3.5" />);

export const IconEconomy = IconGdp;
export const IconIndustry = (p: IconProps) => base(p, <path d="M3 20h18M5 20v-8l4 3v-3l4 3V7l6 4v9" />);
export const IconTechnology = (p: IconProps) =>
  base(p, <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></>);
export const IconPopulationTab = (p: IconProps) =>
  base(p, <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 6a3 3 0 010 6M21 20c0-2.5-1.3-4.2-3-5" /></>);
export const IconPolitics = IconStability;
export const IconDiplomacy = (p: IconProps) => base(p, <path d="M12 3v18M5 7l7-4 7 4M5 7v8c0 2 3 3 7 3s7-1 7-3V7" />);
export const IconIntelligence = (p: IconProps) =>
  base(p, <><circle cx="12" cy="12" r="3" /><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /></>);
export const IconRankings = (p: IconProps) => base(p, <path d="M6 20V10M12 20V4M18 20v-7" />);
export const IconChronicle = (p: IconProps) => base(p, <path d="M6 4h11l3 3v13H6zM9 4v16M13 9h4M13 13h4" />);

export const IconSearch = (p: IconProps) => base(p, <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>);
export const IconLedgers = IconRankings;
export const IconBell = (p: IconProps) =>
  base(p, <><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></>);
export const IconSettings = IconTechnology;
export const IconHelp = (p: IconProps) =>
  base(p, <><circle cx="12" cy="12" r="9" /><path d="M9.7 9a2.5 2.5 0 014.8.9c0 2.1-2.5 2.2-2.5 4.1M12 18h.01" /></>);
export const IconMenu = (p: IconProps) => base(p, <path d="M4 6h16M4 12h16M4 18h16" />);
export const IconClose = (p: IconProps) => base(p, <path d="M6 6l12 12M18 6L6 18" />);

export const IconModePol = (p: IconProps) => base(p, <path d="M4 5h16v14H4zM4 10h16M10 5v14" />);
export const IconModeEco = (p: IconProps) => base(p, <path d="M4 19L9 12l4 3 7-9" />);
export const IconModeRes = (p: IconProps) => base(p, <path d="M12 3l8 5v8l-8 5-8-5V8z" />);
export const IconModePop = (p: IconProps) => base(p, <><circle cx="12" cy="8" r="3" /><path d="M5 20c0-4 3-7 7-7s7 3 7 7" /></>);
export const IconModeSta = IconStability;
export const IconModeDip = IconDiplomacy;
export const IconModeMil = (p: IconProps) => base(p, <><rect x="4" y="7" width="16" height="10" /><path d="M4 7l16 10M20 7L4 17" /></>);
export const IconModeInf = (p: IconProps) => base(p, <path d="M3 12h18M6 12V7h12v5M9 12v5M15 12v5" />);
export const IconOrders = (p: IconProps) => base(p, <><path d="M4 6h11M4 12h16M4 18h8" /><path d="M17 5l3 3-6 6-3 .5.5-3z" /></>);
