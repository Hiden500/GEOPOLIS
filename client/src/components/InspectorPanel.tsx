import { useTranslation } from "react-i18next";
import { type GameState } from "@shared/types/GameState";
import { getDomainTier } from "@shared/utils/technology";

interface Props {
  target: { type: "country"; countryId: string } | { type: "region"; regionId: number };
  game: GameState;
  onSelectCountry: (countryId: string) => void;
}

function CountryInspector({ countryId, game, onSelectCountry }: { countryId: string; game: GameState; onSelectCountry: (id: string) => void }) {
  const { t } = useTranslation("inspectorPanel");
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return <p>{t("country.notFound")}</p>;

  const domainsWithProgress = Object.entries(country.technology.domains).filter(
    ([, progress]) => getDomainTier(progress) > 0
  );
  const relationEntries = Object.entries(country.diplomacy.relations)
    .map(([id, value]) => ({ id, value, other: game.countries.find(c => c.id === id) }))
    .filter(entry => entry.other)
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <p className="inspector-subtitle">
        <span className="country-color-dot" style={{ backgroundColor: country.color }} />
        {[country.politics.ideology, country.politics.governmentType].filter(Boolean).join(" · ")}
        {country.id === game.playerCountryId && <span className="inspector-tag">{t("country.youTag")}</span>}
      </p>

      <dl className="stat-list">
        <div>
          <dt>{t("country.stats.gdp")}</dt>
          <dd>{(country.economy.gdp / 1e12).toFixed(2)}T</dd>
        </div>
        <div>
          <dt>{t("country.stats.population")}</dt>
          <dd>{(country.population / 1e6).toFixed(1)}M</dd>
        </div>
        <div>
          <dt>{t("country.stats.treasury")}</dt>
          <dd>{Math.round(country.economy.treasury).toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>{t("country.stats.budget")}</dt>
          <dd className={country.economy.budgetBalance >= 0 ? "positive" : "negative"}>
            {Math.round(country.economy.budgetBalance).toLocaleString("ru-RU")}
          </dd>
        </div>
        <div>
          <dt>{t("country.stats.stability")}</dt>
          <dd>{Math.round(country.politics.stability)}</dd>
        </div>
        <div>
          <dt>{t("country.stats.legitimacy")}</dt>
          <dd>{Math.round(country.politics.legitimacy)}%</dd>
        </div>
      </dl>

      {domainsWithProgress.length > 0 && (
        <section className="panel-section">
          <h4>{t("country.domainsMastered")}</h4>
          <p>{domainsWithProgress.length}</p>
        </section>
      )}

      {relationEntries.length > 0 && (
        <section className="panel-section">
          <h4>{t("country.diplomaticRelations")}</h4>
          <ul className="relation-list">
            {relationEntries.map(({ id, value, other }) => (
              <li key={id} className="relation-list-item">
                <button className="relation-country" onClick={() => onSelectCountry(id)}>
                  <span className="country-color-dot" style={{ backgroundColor: other!.color }} />
                  {other!.shortName}
                </button>
                <span className={value >= 0 ? "positive" : "negative"}>{Math.round(value)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function RegionInspector({ regionId, game, onSelectCountry }: { regionId: number; game: GameState; onSelectCountry: (id: string) => void }) {
  const { t } = useTranslation("inspectorPanel");
  const region = game.regions.find(r => r.id === regionId);
  if (!region) return <p>{t("region.notFound")}</p>;

  const owner = game.countries.find(c => c.id === region.ownerCountryId);
  const resourceEntries = Object.entries(region.deposits);

  return (
    <>
      {owner && (
        <p className="inspector-subtitle">
          <span className="country-color-dot" style={{ backgroundColor: owner.color }} />
          <button className="relation-country" onClick={() => onSelectCountry(owner.id)}>
            {owner.name}
          </button>
        </p>
      )}

      <dl className="stat-list">
        <div>
          <dt>{t("region.stats.population")}</dt>
          <dd>{(region.population ?? 0).toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>{t("region.stats.area")}</dt>
          <dd>{t("region.areaValue", { area: region.area })}</dd>
        </div>
        <div>
          <dt>{t("region.stats.urbanization")}</dt>
          <dd>{region.urbanization}%</dd>
        </div>
        <div>
          <dt>{t("region.stats.infrastructure")}</dt>
          <dd>{region.infrastructure}/100</dd>
        </div>
        <div>
          <dt>{t("region.stats.stability")}</dt>
          <dd>{region.stability}/100</dd>
        </div>
        <div>
          <dt>{t("region.stats.development")}</dt>
          <dd>{region.development}/100</dd>
        </div>
      </dl>

      {resourceEntries.length > 0 && (
        <section className="panel-section">
          <h4>{t("region.resourceProduction")}</h4>
          <ul className="resource-list">
            {resourceEntries.map(([resource, amount]) => (
              <li key={resource}>
                <span>{resource}</span>
                <span>{amount}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function InspectorPanel({ target, game, onSelectCountry }: Props) {
  return target.type === "country" ? (
    <CountryInspector countryId={target.countryId} game={game} onSelectCountry={onSelectCountry} />
  ) : (
    <RegionInspector regionId={target.regionId} game={game} onSelectCountry={onSelectCountry} />
  );
}
