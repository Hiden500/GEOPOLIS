import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWindows } from "../useWindows";

describe("useWindows", () => {
  it("стартует без окон", () => {
    const { result } = renderHook(() => useWindows());
    expect(result.current.windows).toEqual([]);
  });

  describe("windowId / dedup", () => {
    it("country/region получают id с идентификатором, панели — по типу", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "country", countryId: "USA" }));
      act(() => result.current.openOrFocus({ type: "region", regionId: 7 }));
      act(() => result.current.openOrFocus({ type: "budget" }));
      expect(result.current.windows.map(w => w.id)).toEqual(["country:USA", "region:7", "budget"]);
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
      act(() => result.current.openOrFocus({ type: "budget" }));
      act(() => result.current.openOrFocus({ type: "research" }));
      const [budget, research] = result.current.windows;
      expect(research!.zIndex).toBeGreaterThan(budget!.zIndex);
    });

    it("focus поднимает указанное окно поверх остальных", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "budget" }));
      act(() => result.current.openOrFocus({ type: "research" }));
      act(() => result.current.focus("budget"));
      const budget = result.current.windows.find(w => w.id === "budget")!;
      const research = result.current.windows.find(w => w.id === "research")!;
      expect(budget.zIndex).toBeGreaterThan(research.zIndex);
    });
  });

  describe("toggle", () => {
    it("открывает закрытое окно", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.toggle({ type: "actions" }));
      expect(result.current.isOpen({ type: "actions" })).toBe(true);
    });

    it("закрывает уже открытое окно", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.toggle({ type: "actions" }));
      act(() => result.current.toggle({ type: "actions" }));
      expect(result.current.isOpen({ type: "actions" })).toBe(false);
      expect(result.current.windows).toHaveLength(0);
    });
  });

  describe("close", () => {
    it("удаляет окно по id, остальные не трогает", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "budget" }));
      act(() => result.current.openOrFocus({ type: "research" }));
      act(() => result.current.close("budget"));
      expect(result.current.windows.map(w => w.id)).toEqual(["research"]);
    });
  });

  describe("move / resize", () => {
    it("move меняет позицию только указанного окна", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "budget" }));
      act(() => result.current.openOrFocus({ type: "research" }));
      act(() => result.current.move("budget", { x: 500, y: 250 }));
      expect(result.current.windows.find(w => w.id === "budget")!.position).toEqual({ x: 500, y: 250 });
      // research не трогаем
      const research = result.current.windows.find(w => w.id === "research")!;
      expect(research.position).not.toEqual({ x: 500, y: 250 });
    });

    it("resize задаёт размер только указанного окна", () => {
      const { result } = renderHook(() => useWindows());
      act(() => result.current.openOrFocus({ type: "budget" }));
      act(() => result.current.resize("budget", { width: 640, height: 480 }));
      expect(result.current.windows.find(w => w.id === "budget")!.size).toEqual({ width: 640, height: 480 });
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
      act(() => result.current.openOrFocus({ type: "budget" }));
      const budget = result.current.windows[0]!;
      expect(budget.position.x).toBe(window.innerWidth - 360);
      expect(budget.position.y).toBe(100);
    });
  });

  describe("isOpen", () => {
    it("отражает текущее состояние", () => {
      const { result } = renderHook(() => useWindows());
      expect(result.current.isOpen({ type: "budget" })).toBe(false);
      act(() => result.current.openOrFocus({ type: "budget" }));
      expect(result.current.isOpen({ type: "budget" })).toBe(true);
    });
  });
});
