import { type GameState } from "@shared/types/GameState";
import { type WindowKind } from "../hooks/useWindows";

interface Props {
  target: { type: "country"; countryId: string } | { type: "region"; regionId: number };
  game: GameState;
  onSelectCountry: (countryId: string) => void;
}

export function getInspectorTitle(kind: WindowKind, game: GameState): string {
  if (kind.type === "country") {
    return game.countries.find(c => c.id === kind.countryId)?.name ?? "Страна";
  }
  if (kind.type === "region") {
    return game.regions.find(r => r.id === kind.regionId)?.name ?? "Регион";
  }
  return "";
}

function CountryInspector({ countryId, game, onSelectCountry }: { countryId: string; game: GameState; onSelectCountry: (id: string) => void }) {
  const country = game.countries.find(c => c.id === countryId);
  if (!country) return <p>Страна не найдена</p>;

  const activeProjects = country.technology.projects.filter(p => !p.completed);
  const relationEntries = Object.entries(country.diplomacy.relations)
    .map(([id, value]) => ({ id, value, other: game.countries.find(c => c.id === id) }))
    .filter(entry => entry.other)
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <p className="inspector-subtitle">
        <span className="country-color-dot" style={{ backgroundColor: country.color }} />
        {[country.politics.ideology, country.politics.governmentType].filter(Boolean).join(" · ")}
        {country.id === game.playerCountryId && <span className="inspector-tag">вы</span>}
      </p>

      <dl className="stat-list">
        <div>
          <dt>ВВП</dt>
          <dd>{(country.economy.gdp / 1e12).toFixed(2)}T</dd>
        </div>
        <div>
          <dt>Население</dt>
          <dd>{(country.population / 1e6).toFixed(1)}M</dd>
        </div>
        <div>
          <dt>Казна</dt>
          <dd>{Math.round(country.economy.treasury).toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>Бюджет</dt>
          <dd className={country.economy.budgetBalance >= 0 ? "positive" : "negative"}>
            {Math.round(country.economy.budgetBalance).toLocaleString("ru-RU")}
          </dd>
        </div>
        <div>
          <dt>Стабильность</dt>
          <dd>{Math.round(country.politics.stability)}</dd>
        </div>
        <div>
          <dt>Легитимность</dt>
          <dd>{Math.round(country.politics.legitimacy)}%</dd>
        </div>
      </dl>

      {activeProjects.length > 0 && (
        <section className="panel-section">
          <h4>Активные проекты</h4>
          <p>{activeProjects.length}</p>
        </section>
      )}

      {relationEntries.length > 0 && (
        <section className="panel-section">
          <h4>Дипломатические отношения</h4>
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
  const region = game.regions.find(r => r.id === regionId);
  if (!region) return <p>Регион не найден</p>;

  const owner = game.countries.find(c => c.id === region.ownerCountryId);
  const resourceEntries = Object.entries(region.resourceProduction);

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
          <dt>Население</dt>
          <dd>{region.population.toLocaleString("ru-RU")}</dd>
        </div>
        <div>
          <dt>Площадь</dt>
          <dd>{region.area} км²</dd>
        </div>
        <div>
          <dt>Урбанизация</dt>
          <dd>{region.urbanization}%</dd>
        </div>
        <div>
          <dt>Инфраструктура</dt>
          <dd>{region.infrastructure}/100</dd>
        </div>
        <div>
          <dt>Стабильность</dt>
          <dd>{region.stability}/100</dd>
        </div>
        <div>
          <dt>Развитие</dt>
          <dd>{region.development}/100</dd>
        </div>
      </dl>

      {resourceEntries.length > 0 && (
        <section className="panel-section">
          <h4>Добыча ресурсов (в месяц)</h4>
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
