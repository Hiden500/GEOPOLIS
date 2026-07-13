import { IconModePol, IconModeEco, IconModeRes, IconModePop, IconModeSta, IconModeDip, IconModeMil, IconModeInf } from "./icons";
import { type MapMode } from "./mapModeColors";

/** Отдельный файл от icons.tsx (не .tsx) — см. bookIcons.ts. */
export const MODE_ICONS: Record<MapMode, typeof IconModePol> = {
  pol: IconModePol,
  eco: IconModeEco,
  res: IconModeRes,
  pop: IconModePop,
  sta: IconModeSta,
  dip: IconModeDip,
  mil: IconModeMil,
  inf: IconModeInf,
};
