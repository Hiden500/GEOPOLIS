import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";

interface Props {
  game: GameState;
  onSelectCountry: (countryId: string) => void;
}

export function WorldRankingPanel({ game, onSelectCountry }: Props) {
  const { t } = useTranslation("worldRankingPanel");
  return (
    <section className="panel-section">
      <h3>{t("title")}</h3>
      <table className="world-table">
        <thead>
          <tr>
            <th>{t("columns.country")}</th>
            <th>{t("columns.population")}</th>
            <th>{t("columns.gdp")}</th>
            <th>{t("columns.treasury")}</th>
          </tr>
        </thead>
        <tbody>
          {game.countries.map(country => (
            <tr
              key={country.id}
              className={`world-table-row ${country.id === game.playerCountryId ? "player-row" : ""}`}
              onClick={() => onSelectCountry(country.id)}
            >
              <td>
                <span className="country-color" style={{ backgroundColor: country.color }} />
                {country.shortName}
              </td>
              <td>{(country.population / 1_000_000).toFixed(1)}M</td>
              <td>{Math.round(country.economy.gdp / 1000).toLocaleString("ru-RU")}K</td>
              <td className={country.economy.treasury >= 0 ? "positive" : "negative"}>
                {Math.round(country.economy.treasury).toLocaleString("ru-RU")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
