import { useCallback, useState } from "react";

/**
 * Сужено до сценария "сравнить два объекта рядом" (docs/plans/12_UI_REDESIGN.md
 * §1/§4, Срез 2). budget/research/ranking/territories/timeline переехали в
 * SidePanel (2б), intent — в OrdersBox (2г). llm остаётся здесь: единственный
 * доступ к LLM-циклу — клик по statuspill в шапке, открывает плавающим
 * окном (не выводить на первый план, §2, но и не терять функциональность
 * продвижения хода).
 */
export type WindowKind =
  | { type: "country"; countryId: string }
  | { type: "region"; regionId: number }
  | { type: "llm" };

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
const SETTINGS_KEY = "geopolis_window_settings";

interface WindowSetting {
  position: { x: number; y: number };
  size?: { width: number; height: number };
}

// Ключ по экземпляру (id уже уникален через windowId()), не по категории —
// иначе несколько окон одного типа (две разные страны) схлопывают позицию/
// размер друг друга (список "не возвращать" §2, находка №3).
function loadSavedSettings(): Record<string, WindowSetting> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveWindowSetting(id: string, setting: WindowSetting) {
  try {
    const settings = loadSavedSettings();
    settings[id] = {
      position: setting.position,
      size: setting.size || settings[id]?.size
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error("Failed to save window settings:", e);
  }
}

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

      // Загружаем сохраненные настройки
      const saved = loadSavedSettings()[id];
      const sameSideCount = prev.filter(w => LEFT_SIDE.includes(kind.type) === LEFT_SIDE.includes(w.kind.type)).length;

      let position = saved?.position;
      if (!position) {
        const baseX = LEFT_SIDE.includes(kind.type) ? 16 : window.innerWidth - 360;
        position = { x: baseX + sameSideCount * 24, y: 100 + sameSideCount * 24 };
      }

      const size = saved?.size;

      return [...prev, { id, kind, position, size, zIndex: nextZIndex(prev) }];
    });
  }, [nextZIndex]);

  const toggle = useCallback((kind: WindowKind) => {
    const id = windowId(kind);
    setWindows(prev => {
      if (prev.some(w => w.id === id)) {
        return prev.filter(w => w.id !== id);
      }

      // Загружаем сохраненные настройки
      const saved = loadSavedSettings()[id];
      const sameSideCount = prev.filter(w => LEFT_SIDE.includes(kind.type) === LEFT_SIDE.includes(w.kind.type)).length;

      let position = saved?.position;
      if (!position) {
        const baseX = LEFT_SIDE.includes(kind.type) ? 16 : window.innerWidth - 360;
        position = { x: baseX + sameSideCount * 24, y: 100 + sameSideCount * 24 };
      }

      const size = saved?.size;

      return [...prev, { id, kind, position, size, zIndex: nextZIndex(prev) }];
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
    setWindows(prev => {
      const wInstance = prev.find(w => w.id === id);
      if (wInstance) {
        saveWindowSetting(id, { position, size: wInstance.size });
      }
      return prev.map(w => (w.id === id ? { ...w, position } : w));
    });
  }, []);

  const resize = useCallback((id: string, size: { width: number; height: number }) => {
    setWindows(prev => {
      const wInstance = prev.find(w => w.id === id);
      if (wInstance) {
        saveWindowSetting(id, { position: wInstance.position, size });
      }
      return prev.map(w => (w.id === id ? { ...w, size } : w));
    });
  }, []);

  const isOpen = useCallback((kind: WindowKind) => windows.some(w => w.id === windowId(kind)), [windows]);

  return { windows, openOrFocus, toggle, close, focus, move, resize, isOpen };
}
