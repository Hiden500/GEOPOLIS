import { type Country } from "@shared/types/Country";
import { type WindowKind } from "../hooks/useWindows";

interface Props {
  country: Country;
  currentDate: string;
  eraName: string;
  loading: boolean;
  error: string | null;
  isOpen: (kind: WindowKind) => boolean;
  onBack: () => void;
  onNextTurn: () => void;
  onToggle: (kind: WindowKind) => void;
  onOpenCountry: () => void;
}

function StatPill({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className="stat-pill" onClick={onClick}>
      <span className="stat-pill-label">{label}</span>
      <span className="stat-pill-value">{value}</span>
    </Tag>
  );
}

export function TopStatBar({
  country,
  currentDate,
  eraName,
  loading,
  error,
  isOpen,
  onBack,
  onNextTurn,
  onToggle,
  onOpenCountry,
}: Props) {
  const govLabel = [country.politics.ideology, country.politics.governmentType]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="game-header">
      <div className="header-row">
        <div className="header-left">
          <button className="back-button" onClick={onBack}>
            ← Меню
          </button>
          <span className="game-title">Geopolis</span>
        </div>

        <button className="header-country" onClick={onOpenCountry}>
          <span className="country-color-dot" style={{ backgroundColor: country.color }} />
          <div className="header-country-name">
            <span>{country.name}</span>
            {govLabel && <span className="header-country-gov">{govLabel}</span>}
          </div>
        </button>

        <div className="header-stats">
          <StatPill label="ВВП" value={`${(country.economy.gdp / 1e12).toFixed(2)}T`} onClick={() => onToggle({ type: "budget" })} />
          <StatPill label="Население" value={`${(country.population / 1e6).toFixed(1)}M`} />
          <StatPill label="Армия" value={`${(country.military.manpower / 1e6).toFixed(2)}M`} />
          <StatPill label="Стабильность" value={`${Math.round(country.politics.stability)}`} />
          <StatPill
            label="Технологии"
            value={`${country.researchedTechnologyIds.length}`}
            onClick={() => onToggle({ type: "research" })}
          />
          <StatPill label="Легитимность" value={`${Math.round(country.politics.legitimacy)}%`} />
        </div>

        <span className={`status-stamp ${country.diplomacy.rivals.length > 0 ? "alert" : ""}`}>
          {country.diplomacy.rivals.length > 0 ? `Соперники: ${country.diplomacy.rivals.length}` : "Мир"}
        </span>
      </div>

      <div className="header-row">
        <nav className="header-nav">
          <button className={isOpen({ type: "territories" }) ? "active" : ""} onClick={() => onToggle({ type: "territories" })}>
            Территории
          </button>
          <button className={isOpen({ type: "ranking" }) ? "active" : ""} onClick={() => onToggle({ type: "ranking" })}>
            Мир
          </button>
          <button className={isOpen({ type: "actions" }) ? "active" : ""} onClick={() => onToggle({ type: "actions" })}>
            Действия
          </button>
        </nav>

        <div className="header-right">
          {error && <span className="game-error">{error}</span>}
          <span className="game-date">{currentDate}</span>
          <span className="game-era">{eraName}</span>
          <button className="next-turn-button" onClick={onNextTurn} disabled={loading}>
            {loading ? "Симуляция..." : "Следующий месяц →"}
          </button>
        </div>
      </div>
    </header>
  );
}
