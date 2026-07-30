/**
 * Дизайн-система интерфейса. Экран собирается ИЗ неё — новый паттерн
 * заводится здесь, а не в отдельном компоненте «под этот случай».
 *
 * Игровое слово «примитив» в проекте занято алфавитом воздействия
 * (docs/PRIMITIVES.md), поэтому UI-атомы живут в `ui/`, а не в `primitives/`.
 */
export { Panel } from "./Panel/Panel";
export type { PanelProps, PanelDensity } from "./Panel/Panel";

export { Button } from "./Button/Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button/Button";

export { Stat } from "./Stat/Stat";
export type { StatProps, DeltaTone, ThresholdState } from "./Stat/Stat";

export { EventItem } from "./EventItem/EventItem";
export type { EventItemProps, Factuality } from "./EventItem/EventItem";

export { TechScale } from "./TechScale/TechScale";
export type { TechScaleProps } from "./TechScale/TechScale";

export { OrderCard } from "./OrderCard/OrderCard";
export type { OrderCardProps } from "./OrderCard/OrderCard";

export { ShapedBar } from "./ShapedBar/ShapedBar";
export type { ShapedBarProps } from "./ShapedBar/ShapedBar";

export { Coords } from "./Coords/Coords";
export type { CoordsProps, CoordsPoint } from "./Coords/Coords";

export { Tooltip } from "./Tooltip/Tooltip";
export type { TooltipProps } from "./Tooltip/Tooltip";

export { Tag } from "./Tag/Tag";
export type { TagProps, TagKind } from "./Tag/Tag";

export { ResourceBar } from "./ResourceBar/ResourceBar";
export type { ResourceBarProps, ResourceItem } from "./ResourceBar/ResourceBar";

export { cx } from "./cx";
export * from "./icons";
