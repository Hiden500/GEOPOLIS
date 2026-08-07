import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { MapView } from "../map/MapView";
import { MAP_MODE_ORDER, computeMapModeColors, type MapMode } from "../hud/mapModeColors";
import { usePrimitiveOutcomeText } from "../components/primitiveOutcomeText";
import {
  chooseSuccessor,
  getGameState,
  nextTurn,
  runAutoLlmCycle,
  savePlayerIntent,
  translatePlayerOrder,
  updateBudget,
  type BudgetUpdate,
} from "../api/gameApi";
import { Screen } from "./Screen";
import { buildScreenModel } from "./adapter";
import type { ScreenActions, ScreenCampaign } from "./model";
import styles from "./GameShell.module.css";

/**
 * ОБОЛОЧКА ПАРТИИ — настоящее состояние в том же экране, что и песочница.
 *
 * Здесь и только здесь сходятся три вещи, которых экран не знает: состояние
 * партии, настоящая карта MapLibre и сетевые вызовы. Разделение держится на
 * одном правиле — экран не должен уметь ходить в сеть, иначе его нельзя будет
 * открыть без сервера, а именно это и делает песочницу полезной.
 */
export function GameShell({
  game,
  onGameUpdate,
}: {
  game: GameState;
  onGameUpdate: (game: GameState) => void;
}) {
  const { t, i18n } = useTranslation("screen");
  const locale = i18n.language as Locale;
  const renderLine = usePrimitiveOutcomeText();

  const [mapMode, setMapMode] = useState<MapMode>("pol");
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mapModes = useMemo(
    () => MAP_MODE_ORDER.map((mode) => ({ id: mode, name: t(`mapModes.${mode}`) })),
    [t],
  );

  const monthsNominative = useMemo(
    () => (t("monthsNominative", { returnObjects: true }) as string[]) ?? [],
    [t],
  );
  const monthsGenitive = useMemo(
    () => (t("monthsGenitive", { returnObjects: true }) as string[]) ?? [],
    [t],
  );

  /*
   * Необратимость определяет ДВИЖОК, а не интерфейс. Полного ответа на «этот
   * приказ необратим?» до перевода в примитивы нет, поэтому здесь честный
   * консервативный фильтр по глаголам, которые движок относит к необратимым, —
   * а не вторая копия правил игры в клиенте.
   */
  const isIrreversible = useCallback(
    (text: string) => {
      const words = t("irreversibleWords", { returnObjects: true }) as string[];
      const lower = text.toLowerCase();
      return Array.isArray(words) && words.some((word) => lower.includes(word));
    },
    [t],
  );

  /*
   * Развилка кампании собирается здесь, а не в адаптере: её текст живёт в
   * словаре интерфейса, а адаптер про словарь ничего не знает. Причина
   * поражения приходит структурным кодом — клиент подставляет свой текст, а не
   * печатает английскую строку сервера.
   */
  const campaign = useMemo<ScreenCampaign | null>(() => {
    const state = game.campaign;
    if (state.status === "active") return null;

    if (state.status === "defeated") {
      const reason =
        state.reason.code === "absorbed"
          ? t("campaign.absorbed", { country: getText(state.reason.by, locale) })
          : t("campaign.dissolved");
      return {
        kind: "defeated",
        title: t("campaign.defeatTitle"),
        lead: `${reason} ${t("campaign.since", { date: state.since })}`,
        successors: [],
      };
    }

    return {
      kind: "succession",
      title: t("campaign.successionTitle"),
      lead: t("campaign.successionLead", {
        predecessor: getText(state.predecessor, locale),
        date: state.since,
      }),
      successors: state.successorCountryIds
        .map((id) => game.countries.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map((country) => ({
          id: country.id,
          label: t("campaign.successor", {
            country: getText(country.name, locale),
            regions: game.regions.filter((r) => r.ownerCountryId === country.id).length,
          }),
        })),
    };
  }, [game, locale, t]);

  /*
   * Имена доменов уже переведены в старом словаре `researchPanel` — берём их
   * оттуда, а не заводим второй список: два словаря на одни и те же домены
   * разойдутся при первом добавлении эры.
   */
  const { t: tResearch } = useTranslation("researchPanel");
  const domainName = useCallback(
    (id: string) => tResearch(`domains.${id}`, { defaultValue: id }),
    [tResearch],
  );

  const model = useMemo(
    () =>
      buildScreenModel({
        game,
        locale,
        renderLine,
        mapModes,
        isIrreversible,
        monthsNominative,
        monthsGenitive,
        ordersPerTurn: 10,
        domainName,
        campaign,
      }),
    [game, locale, renderLine, mapModes, isIrreversible, monthsNominative, monthsGenitive, domainName, campaign],
  );

  const regionModeColors = useMemo(
    () => computeMapModeColors(mapMode, game.regions, game.countries, game.playerCountryId),
    [mapMode, game.regions, game.countries, game.playerCountryId],
  );

  /**
   * Действия экрана. Каждое перечитывает состояние после себя: мир изменился,
   * и интерфейс обязан догнать — иначе игрок правит доли на устаревшем снимке.
   */
  const actions = useMemo<ScreenActions>(
    () => ({
      saveBudget: async (shares) => {
        const payload: BudgetUpdate = {
          military: shares.military ?? 0,
          research: shares.research ?? 0,
          education: shares.education ?? 0,
          infrastructure: shares.infrastructure ?? 0,
          welfare: shares.welfare ?? 0,
        };
        await updateBudget(payload);
        onGameUpdate(await getGameState());
      },
      chooseSuccessor: async (countryId) => {
        await chooseSuccessor(countryId);
        onGameUpdate(await getGameState());
      },
      recognizeOrder: async (text, regionId) => {
        const translation = await translatePlayerOrder(
          text,
          regionId === null ? undefined : Number(regionId),
        );
        return {
          primitives: translation.primitives,
          // Игрок видит, КАК его поняли, — но не что изменится: величин до
          // применения не существует (docs/PRIMITIVES.md §1).
          recognized: translation.preview.map((record) => renderLine(record.headline)),
        };
      },
    }),
    [onGameUpdate, renderLine],
  );

  /**
   * Ход — ВЕСЬ цикл за одно нажатие: намерение уходит на сервер, режиссёр
   * отвечает, движок считает тик. Шагов три, а не один: сервер не даёт тик,
   * пока нет ответа режиссёра. Заставлять игрока нажимать их по очереди значит
   * показывать устройство машины вместо хода.
   *
   * Приказы уходят одним намерением и разом — это правило игры, а не удобство
   * реализации (docs/PRIMITIVES.md §1).
   */
  const advance = useCallback(
    async (orders: string[]) => {
      setError(null);
      try {
        if (orders.length > 0) await savePlayerIntent(orders.join("\n"));
        await runAutoLlmCycle();
        onGameUpdate(await nextTurn());
      } catch (err) {
        // Текст сервера полезнее общей фразы: «не задан ключ» и «сервер не
        // отвечает» требуют разных действий, и подменять их одним словом
        // значит отправить игрока чинить не то.
        const reason = err instanceof Error ? err.message : "";
        console.error(err);
        setError(reason === "" ? t("turnFailed") : `${t("turnFailed")} ${reason}`);
      }
    },
    [onGameUpdate, t],
  );

  return (
    <>
      <Screen
        model={model}
        actions={actions}
        mapMode={mapMode}
        onMapMode={(mode) => setMapMode(mode as MapMode)}
        selectedRegionId={selectedRegionId}
        onSelectRegion={setSelectedRegionId}
        onAdvance={advance}
        mapSlot={
          <MapView
            regions={game.regions}
            countries={game.countries}
            mapFeatures={game.mapFeatures}
            regionModeColors={regionModeColors}
            selectedRegionId={selectedRegionId === null ? null : Number(selectedRegionId)}
            onRegionClick={(regionId) => setSelectedRegionId(String(regionId))}
          />
        }
      />
      {error !== null && (
        <div role="alert" className={styles.error} onClick={() => setError(null)}>
          {error}
        </div>
      )}
    </>
  );
}
