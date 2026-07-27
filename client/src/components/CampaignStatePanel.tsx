import { useState } from "react";
import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { chooseSuccessor } from "../api/gameApi";

/**
 * Состояние кампании (docs/CONCEPT.md §6, §7.1) — развилка преемника и конец
 * партии.
 *
 * ФУНКЦИОНАЛЬНЫЙ МИНИМУМ, и это названо решением, а не недоделкой: визуальный
 * дизайн интерфейса ведёт пользователь отдельно, а `client/src/map/**` —
 * замороженный домен. Здесь ровно то, без чего механика недостижима: увидеть,
 * что государство распалось, выбрать осколок и увидеть, что партия окончена.
 *
 * Панель НЕ решает за игрока и не закрывается сама: §7.1 делает выбор осколка
 * подтверждением необратимого действия (§7.2), а подтверждение с таймаутом
 * подтверждением не является.
 */
export function CampaignStatePanel({
  game,
  onChosen,
}: {
  game: GameState;
  onChosen: () => void;
}) {
  const { t, i18n } = useTranslation("campaign");
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const campaign = game.campaign;
  if (campaign.status === "active") return null;

  const locale = i18n.language as Locale;

  if (campaign.status === "defeated") {
    // Причина — структурный код: клиент подставляет свой текст, а не печатает
    // английскую строку сервера (тот же контракт, что у отказов примитивов).
    const reason =
      campaign.reason.code === "absorbed"
        ? t("defeat.absorbed", { country: getText(campaign.reason.by, locale) })
        : t("defeat.dissolvedWithoutSuccessor");

    return (
      <section role="alert" aria-label={t("defeat.title")}>
        <h2>{t("defeat.title")}</h2>
        <p>{reason}</p>
        <p>{t("defeat.since", { date: campaign.since })}</p>
      </section>
    );
  }

  const successors = campaign.successorCountryIds
    .map(id => game.countries.find(c => c.id === id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  async function choose(countryId: string): Promise<void> {
    setPending(countryId);
    setError(undefined);
    try {
      await chooseSuccessor(countryId);
      onChosen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(undefined);
    }
  }

  return (
    <section role="dialog" aria-label={t("succession.title")}>
      <h2>{t("succession.title")}</h2>
      <p>
        {t("succession.lead", {
          predecessor: getText(campaign.predecessor, locale),
          date: campaign.since,
        })}
      </p>
      <ul>
        {successors.map(country => (
          <li key={country.id}>
            <button
              type="button"
              disabled={pending !== undefined}
              onClick={() => void choose(country.id)}
            >
              {t("succession.choose", {
                country: getText(country.name, locale),
                regions: game.regions.filter(r => r.ownerCountryId === country.id).length,
              })}
            </button>
          </li>
        ))}
      </ul>
      {error !== undefined && <p role="status">{t("succession.failed", { error })}</p>}
    </section>
  );
}
