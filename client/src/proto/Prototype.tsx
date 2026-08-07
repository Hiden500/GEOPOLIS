import { useMemo, useState } from "react";
import { Screen } from "../game/Screen";
import type { ScreenEvent, ScreenModel } from "../game/model";
import { HexMap } from "./HexMap";
import {
  BUDGET,
  COUNTRIES,
  DOMAINS,
  GOALS,
  INITIAL_EVENTS,
  IRREVERSIBLE_WORDS,
  MAP_MODES,
  MONTHS,
  MONTHS_NOMINATIVE,
  PROJECTS,
  RED_LINES,
  REGIONS,
  RESOURCES,
  TECH_SLOTS,
} from "./data";

/**
 * ПЕСОЧНИЦА — тот же самый экран игры на шаблонных данных и без сервера.
 *
 * Отдельного макета больше нет: `Screen` здесь ровно тот, что показывает
 * настоящая партия. Разница только в двух вещах, и обе видны в этом файле —
 * модель собирается из выдуманных чисел, а вместо MapLibre подставлена
 * гекс-сетка. Всё остальное — та же рама, те же панели, то же поведение.
 *
 * Зачем сохранена: правку формы интерфейса можно посмотреть, не поднимая
 * сервер и не начиная партию, а на выдуманных числах видно то, что на живых
 * теряется, — длинные названия, пустые разделы, отказы.
 */
export function Prototype() {
  const [monthIndex, setMonthIndex] = useState(2);
  const [events, setEvents] = useState<ScreenEvent[]>(INITIAL_EVENTS);
  const [turnCount, setTurnCount] = useState(0);
  const [mapMode, setMapMode] = useState<string>("powers");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  const model = useMemo<ScreenModel>(
    () => ({
      playerId: "SUN",
      playerRank: 2,
      countries: COUNTRIES,
      regions: REGIONS,
      events,
      monthIndex,
      year: 1946,
      monthsNominative: MONTHS_NOMINATIVE,
      monthsGenitive: MONTHS,
      stats: [
        { key: "gdp", label: "ВВП", value: "1,46T", delta: { text: "+3,2%", tone: "good" } },
        { key: "balance", label: "Баланс", value: "+12,4B", delta: { text: "+1,8B", tone: "good" } },
        { key: "debt", label: "Долг к ВВП", value: "0,94", delta: { text: "+0,03", tone: "bad" }, threshold: "near" },
        { key: "pop", label: "Население", value: "170,5M", delta: { text: "+0,6M", tone: "good" } },
        { key: "stab", label: "Стабильность", value: "71", delta: { text: "−1", tone: "bad" } },
        { key: "legit", label: "Легитимность", value: "83", delta: { text: "+2", tone: "good" } },
      ],
      mapModes: MAP_MODES.map((mode) => ({ id: mode.id, name: mode.name })),
      resources: RESOURCES,
      techSlots: TECH_SLOTS,
      domains: DOMAINS,
      projects: PROJECTS,
      budget: BUDGET,
      goals: GOALS,
      redLines: RED_LINES,
      economyStats: [
        { label: "ВВП", value: "1,46T", delta: { text: "+3,2%", tone: "good" } },
        { label: "Баланс", value: "+12,4B", delta: { text: "+1,8B", tone: "good" } },
        { label: "Долг к ВВП", value: "0,94", delta: { text: "+0,03", tone: "bad" }, threshold: "near" },
        { label: "Инфляция", value: "6,1%", delta: { text: "+0,4", tone: "bad" } },
      ],
      politicsStats: [
        { label: "Стабильность", value: "71", delta: { text: "−1", tone: "bad" } },
        { label: "Легитимность", value: "83", delta: { text: "+2", tone: "good" } },
        { label: "Коррупция", value: "34", delta: { text: "0", tone: "neutral" } },
        { label: "Поддержка", value: "66", delta: { text: "−3", tone: "bad" } },
      ],
      ideology: {
        point: { x: -0.82, y: -0.91, label: "СССР" },
        rival: { x: 0.74, y: 0.68, label: "США" },
        xFrom: "лево",
        xTo: "право",
        yFrom: "авторитаризм",
        yTo: "демократия",
        zones: ["соц-демократия", "либеральная демократия", "консерватизм", "коммунизм"],
      },
      advisor: {
        assessment:
          "Разрыв по промышленному выпуску не сокращается третий год. Бюджет обороны в 34% удерживает паритет, но съедает то, что должно было стать станками.",
        guess:
          "Если доля обороны упадёт до 28%, разрыв начнёт сокращаться к 1949 году — ценой риска на западной границе.",
      },
      nuclear: {
        warheads: "0",
        note: "Носителей нет. Программа РДС даст первый заряд не раньше 1949 года.",
      },
      campaign: null,
      ordersPerTurn: 10,
      isIrreversible: (text) =>
        IRREVERSIBLE_WORDS.some((word) => text.toLowerCase().includes(word)),
    }),
    [events, monthIndex],
  );

  /**
   * Ход песочницы: тот же контракт, что у настоящего хода, — приказы уходят
   * пачкой, ответ приходит событиями. Каждый третий приказ отклоняется
   * НАМЕРЕННО: отказ — такая же часть правды, как исполнение, и его форму
   * надо видеть.
   */
  const advance = (texts: string[]) =>
    new Promise<void>((resolve) => {
      window.setTimeout(() => {
        const nextMonth = (monthIndex + 1) % 12;
        const day = 4 + ((turnCount * 7) % 20);
        const produced: ScreenEvent[] = texts.map((text, index) => {
          const rejected = index > 0 && index % 3 === 2;
          return {
            id: `e${turnCount}-${index}`,
            date: `${day + index} ${MONTHS[nextMonth]}`,
            title: rejected ? "Приказ не выполнен" : "Распоряжение исполнено",
            body: rejected
              ? "Регион не под вашим контролем — распоряжение отклонено до применения."
              : "Наркоматы приступили к исполнению. Изменения отразятся в следующей сводке.",
            factuality: rejected ? "partial" : "confirmed",
            order: text,
          };
        });

        const worldIndex = turnCount % 4;
        const worldCountry = (["GBR", "TUR", "FRA", "USA"] as const)[worldIndex];
        produced.push({
          id: `w${turnCount}`,
          date: `${day + 12} ${MONTHS[nextMonth]}`,
          title: ["Нота из Лондона", "Переговоры в Анкаре", "Забастовки в Лионе", "Испытания в Неваде"][worldIndex],
          body: "Мир продолжает двигаться сам: державы преследуют свои цели, не спрашивая вашего согласия.",
          tags: [{ id: worldCountry, label: COUNTRIES[worldCountry].short, kind: "country" }],
        });

        setEvents(produced);
        setMonthIndex(nextMonth);
        setTurnCount((prev) => prev + 1);
        resolve();
      }, 650);
    });

  return (
    <Screen
      model={model}
      onAdvance={advance}
      mapMode={mapMode}
      onMapMode={setMapMode}
      selectedRegionId={selectedRegionId}
      onSelectRegion={setSelectedRegionId}
      mapSlot={
        <HexMap
          mode={mapMode}
          selectedRegionId={selectedRegionId}
          selectedCountryId={null}
          onSelectRegion={setSelectedRegionId}
          onSelectCountry={() => undefined}
        />
      }
    />
  );
}
