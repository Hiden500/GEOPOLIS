import { useCallback, useEffect, useState } from "react";

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
const WINDOW_GUTTER = 16;
const MIN_WINDOW_WIDTH = 340;
const MIN_WINDOW_HEIGHT = 180;
const DEFAULT_WINDOW_WIDTH = 440;

interface WindowSetting {
  position: { x: number; y: number };
  size?: { width: number; height: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeSetting(setting: WindowSetting): WindowSetting {
  const viewportWidth = Math.max(window.innerWidth, MIN_WINDOW_WIDTH + WINDOW_GUTTER * 2);
  const viewportHeight = Math.max(window.innerHeight, MIN_WINDOW_HEIGHT + WINDOW_GUTTER * 2);
  const size = setting.size
    ? {
        width: clamp(setting.size.width, MIN_WINDOW_WIDTH, viewportWidth - WINDOW_GUTTER * 2),
        height: clamp(setting.size.height, MIN_WINDOW_HEIGHT, viewportHeight - WINDOW_GUTTER * 2),
      }
    : undefined;
  const width = size?.width ?? DEFAULT_WINDOW_WIDTH;
  const height = size?.height ?? MIN_WINDOW_HEIGHT;
  return {
    position: {
      x: clamp(setting.position.x, 0, Math.max(0, viewportWidth - width)),
      y: clamp(setting.position.y, 0, Math.max(0, viewportHeight - height)),
    },
    ...(size ? { size } : {}),
  };
}

function defaultPosition(kind: WindowKind, sameSideCount: number): { x: number; y: number } {
  const baseX = LEFT_SIDE.includes(kind.type) ? WINDOW_GUTTER : window.innerWidth - DEFAULT_WINDOW_WIDTH - WINDOW_GUTTER;
  return normalizeSetting({
    position: { x: baseX + sameSideCount * 24, y: 100 + sameSideCount * 24 },
  }).position;
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
        position = defaultPosition(kind, sameSideCount);
      }

      const normalized = normalizeSetting({ position, ...(saved?.size ? { size: saved.size } : {}) });

      return [...prev, { id, kind, position: normalized.position, size: normalized.size, zIndex: nextZIndex(prev) }];
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
        position = defaultPosition(kind, sameSideCount);
      }

      const normalized = normalizeSetting({ position, ...(saved?.size ? { size: saved.size } : {}) });

      return [...prev, { id, kind, position: normalized.position, size: normalized.size, zIndex: nextZIndex(prev) }];
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

  const resetLayout = useCallback(() => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch {
      // Storage может быть недоступен; in-memory layout всё равно сбрасываем.
    }
    setWindows(prev => {
      let leftCount = 0;
      let rightCount = 0;
      return prev.map(instance => {
        const isLeft = LEFT_SIDE.includes(instance.kind.type);
        const sameSideCount = isLeft ? leftCount++ : rightCount++;
        return { ...instance, position: defaultPosition(instance.kind, sameSideCount), size: undefined };
      });
    });
  }, []);

  useEffect(() => {
    const handleViewportResize = () => {
      setWindows(prev => prev.map(instance => {
        const normalized = normalizeSetting({
          position: instance.position,
          ...(instance.size ? { size: instance.size } : {}),
        });
        return { ...instance, position: normalized.position, size: normalized.size };
      }));
    };
    window.addEventListener("resize", handleViewportResize);
    return () => window.removeEventListener("resize", handleViewportResize);
  }, []);

  const isOpen = useCallback((kind: WindowKind) => windows.some(w => w.id === windowId(kind)), [windows]);

  return { windows, openOrFocus, toggle, close, focus, move, resize, resetLayout, isOpen };
}
