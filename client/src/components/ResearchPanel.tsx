import { type Country } from "@shared/types/Country";
import { getDomainTier } from "@shared/utils/technology";

interface Props {
  country: Country;
}

/**
 * Технологии (docs/DECISIONS.md, 2026-07-06) — без каталога именных
 * технологий и без кнопки "начать исследование". Тир домена растёт от доли
 * researchSpending, направленной через "Намерение" (свободный текст →
 * LLM 'research_shift'), не через выбор из списка. Панель — только
 * отображение текущего состояния.
 */
export function ResearchPanel({ country }: Props) {
  const domains = Object.entries(country.technology.domains).sort(
    ([, a], [, b]) => b - a
  );
  const allocation = country.technology.researchAllocation ?? {};

  return (
    <div className="research-panel">
      <h2>Технологии</h2>
      <p className="panel-hint">
        Фокус исследований меняется через "Намерение" — опишите, на что
        направить усилия, и это применится в следующем цикле LLM.
      </p>

      <section className="panel-section">
        <h3>Домены</h3>
        {domains.length === 0 ? (
          <p>Нет доменов технологий для этой эры</p>
        ) : (
          <ul className="project-list">
            {domains.map(([domain, progress]) => {
              const tier = getDomainTier(progress);
              const share = allocation[domain];
              return (
                <li key={domain} className="project-item">
                  <div className="project-header">
                    <span className="project-name">{domain}</span>
                    <span>Тир {tier}</span>
                  </div>
                  {share !== undefined && (
                    <div className="project-details">
                      <span>Фокус: {Math.round(share * 100)}%</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
