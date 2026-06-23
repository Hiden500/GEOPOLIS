import { useCallback, useState } from "react";

export type WindowKind =
  | { type: "country"; countryId: string }
  | { type: "region"; regionId: number }
  | { type: "budget" }
  | { type: "research" }
  | { type: "actions" }
  | { type: "ranking" }
  | { type: "territories" };

export interface WindowInstance {
  id: string;
  kind: WindowKind;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  zIndex: number;
}

function windowId(kind: WindowKind): string {
  switch (kind.type) {
    case "country":
      return `country:${kind.countryId}`;
    case "region":
      return `region:${kind.regionId}`;
    default:
      return kind.type;
  }
}

const LEFT_SIDE: WindowKind["type"][] = ["country", "region"];

export function useWindows() {
  const [windows, setWindows] = useState<WindowInstance[]>([]);

  const nextZIndex = useCallback(
    (current: WindowInstance[]) => current.reduce((max, w) => Math.max(max, w.zIndex), 0) + 1,
    []
  );

  const openOrFocus = useCallback((kind: WindowKind) => {
    const id = windowId(kind);
    setWindows(prev => {
      const existing = prev.find(w => w.id === id);
      if (existing) {
        const z = nextZIndex(prev);
        return prev.map(w => (w.id === id ? { ...w, zIndex: z } : w));
      }
      const sameSideCount = prev.filter(w => LEFT_SIDE.includes(kind.type) === LEFT_SIDE.includes(w.kind.type)).length;
      const baseX = LEFT_SIDE.includes(kind.type) ? 16 : window.innerWidth - 360;
      const position = { x: baseX + sameSideCount * 24, y: 100 + sameSideCount * 24 };
      return [...prev, { id, kind, position, zIndex: nextZIndex(prev) }];
    });
  }, [nextZIndex]);

  const toggle = useCallback((kind: WindowKind) => {
    const id = windowId(kind);
    setWindows(prev => {
      if (prev.some(w => w.id === id)) {
        return prev.filter(w => w.id !== id);
      }
      const sameSideCount = prev.filter(w => LEFT_SIDE.includes(kind.type) === LEFT_SIDE.includes(w.kind.type)).length;
      const baseX = LEFT_SIDE.includes(kind.type) ? 16 : window.innerWidth - 360;
      const position = { x: baseX + sameSideCount * 24, y: 100 + sameSideCount * 24 };
      return [...prev, { id, kind, position, zIndex: nextZIndex(prev) }];
    });
  }, [nextZIndex]);

  const close = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const focus = useCallback((id: string) => {
    setWindows(prev => {
      const z = nextZIndex(prev);
      return prev.map(w => (w.id === id ? { ...w, zIndex: z } : w));
    });
  }, [nextZIndex]);

  const move = useCallback((id: string, position: { x: number; y: number }) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, position } : w)));
  }, []);

  const resize = useCallback((id: string, size: { width: number; height: number }) => {
    setWindows(prev => prev.map(w => (w.id === id ? { ...w, size } : w)));
  }, []);

  const isOpen = useCallback((kind: WindowKind) => windows.some(w => w.id === windowId(kind)), [windows]);

  return { windows, openOrFocus, toggle, close, focus, move, resize, isOpen };
}
