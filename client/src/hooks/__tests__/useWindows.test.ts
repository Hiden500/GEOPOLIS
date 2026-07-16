import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWindows } from "../useWindows";

describe("useWindows", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("стартует без окон", () => {
    const { result } = renderHook(() => useWindows());
    expect(result.current.windows).toEqual([]);
  });

  describe("windowId / dedup", () => {
    it("country/region получают id с идентификатором, панели — по типу", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "region", regionId: 7 }));
      act(() => result.current.openOrFocus({ type: "llm" }));
      expect(result.current.windows.map(w => w.id)).toEqual(["country:USA", "region:7", "llm"]);
    });

    it("openOrFocus той же сущности не плодит дубль, а поднимает zIndex существующего", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      const firstZ = result.current.windows[0]!.zIndex;
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      expect(result.current.windows).toHaveLength(1);
      expect(result.current.windows[0]!.zIndex).toBeGreaterThan(firstZ);
    });

    it("разные страны — это разные окна", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "country", countryId: "USSR" }));
      expect(result.current.windows).toHaveLength(2);
    });
  });

  describe("zIndex", () => {
    it("каждое новое окно получает zIndex выше предыдущего", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "llm" }));
      const [country, llm] = result.current.windows;
      expect(llm!.zIndex).toBeGreaterThan(country!.zIndex);
    });

    it("focus поднимает указанное окно поверх остальных", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "llm" }));
      act(() => result.current.focus("country:USA"));
      const country = result.current.windows.find(w => w.id === "country:USA")!;
      const llm = result.current.windows.find(w => w.id === "llm")!;
      expect(country.zIndex).toBeGreaterThan(llm.zIndex);
    });
  });

  describe("toggle", () => {
    it("открывает закрытое окно", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.toggle({ type: "llm" }));
      expect(result.current.isOpen({ type: "llm" })).toBe(true);
    });

    it("закрывает уже открытое окно", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.toggle({ type: "llm" }));
      act(() => result.current.toggle({ type: "llm" }));
      expect(result.current.isOpen({ type: "llm" })).toBe(false);
      expect(result.current.windows).toHaveLength(0);
    });
  });

  describe("close", () => {
    it("удаляет окно по id, остальные не трогает", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "llm" }));
      act(() => result.current.close("country:USA"));
      expect(result.current.windows.map(w => w.id)).toEqual(["llm"]);
    });
  });

  describe("move / resize", () => {
    it("move меняет позицию только указанного окна", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "llm" }));
      act(() => result.current.move("country:USA", { x: 500, y: 250 }));
      expect(result.current.windows.find(w => w.id === "country:USA")!.position).toEqual({ x: 500, y: 250 });
      // llm не трогаем
      const llm = result.current.windows.find(w => w.id === "llm")!;
      expect(llm.position).not.toEqual({ x: 500, y: 250 });
    });

    it("resize задаёт размер только указанного окна", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "llm" }));
      act(() => result.current.resize("llm", { width: 640, height: 480 }));
      expect(result.current.windows.find(w => w.id === "llm")!.size).toEqual({ width: 640, height: 480 });
    });
  });

  describe("каскад позиций", () => {
    it("второе окно той же стороны смещается на 24px по x и y", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "region", regionId: 3 }));
      const [first, second] = result.current.windows;
      // левая сторона (country/region): baseX = 16
      expect(first!.position).toEqual({ x: 16, y: 100 });
      expect(second!.position).toEqual({ x: 16 + 24, y: 100 + 24 });
    });

    it("правосторонние панели позиционируются от правого края окна", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "llm" }));
      const llm = result.current.windows[0]!;
      expect(llm.position.x).toBe(window.innerWidth - 440 - 16);
      expect(llm.position.y).toBe(100);
    });
  });

  describe("viewport safety", () => {
    it("нормализует сохранённые offscreen position/size при открытии", () => {
      localStorage.setItem("geopolis_window_settings", JSON.stringify({
        llm: { position: { x: 50_000, y: 50_000 }, size: { width: 50_000, height: 50_000 } },
      }));
      const { result } = renderHook(() => useWindows());

      act(() => result.current.openOrFocus({ type: "llm" }));

      const llm = result.current.windows[0]!;
      expect(llm.position.x).toBeLessThanOrEqual(window.innerWidth - 48);
      expect(llm.position.y).toBeLessThanOrEqual(window.innerHeight - 36);
      expect(llm.size!.width).toBe(window.innerWidth - 32);
      expect(llm.size!.height).toBe(window.innerHeight - 32);
    });

    it("resetLayout очищает сохранение и возвращает открытые окна к defaults", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.move("country:USA", { x: 777, y: 555 }));
      act(() => result.current.resize("country:USA", { width: 600, height: 500 }));

      act(() => result.current.resetLayout());

      expect(localStorage.getItem("geopolis_window_settings")).toBeNull();
      expect(result.current.windows[0]!.position).toEqual({ x: 16, y: 100 });
      expect(result.current.windows[0]!.size).toBeUndefined();
    });
  });

  describe("isOpen", () => {
    it("отражает текущее состояние", () => {
      const { result } = renderHook(() => useWindows());
      expect(result.current.isOpen({ type: "llm" })).toBe(false);
      act(() => result.current.openOrFocus({ type: "llm" }));
      expect(result.current.isOpen({ type: "llm" })).toBe(true);
    });
  });

  describe("настройки по экземпляру (не по категории)", () => {
    it("две страны не схлопывают позицию/размер друг друга (список «не возвращать» §2, находка №3)", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "country", countryId: "USSR" }));
      act(() => result.current.move("country:USA", { x: 111, y: 222 }));
      act(() => result.current.resize("country:USA", { width: 500, height: 400 }));
      act(() => result.current.move("country:USSR", { x: 333, y: 444 }));

      // Пересоздаём хук — читает сохранённые в localStorage настройки заново.
      const { result: reloaded } = renderHook(() => useWindows());
      act(() => reloaded.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => reloaded.current.openOrFocus({ type: "country", countryId: "USSR" }));

      const usa = reloaded.current.windows.find(w => w.id === "country:USA")!;
      const ussr = reloaded.current.windows.find(w => w.id === "country:USSR")!;
      expect(usa.position).toEqual({ x: 111, y: 222 });
      expect(usa.size).toEqual({ width: 500, height: 400 });
      expect(ussr.position).toEqual({ x: 333, y: 444 });
      expect(ussr.size).toBeUndefined();
    });
  });
});
