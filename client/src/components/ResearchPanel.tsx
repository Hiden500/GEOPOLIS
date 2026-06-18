import { useState } from "react";
import { type Country } from "@shared/types/Country";

interface Props {
  country: Country;
  onStartResearch: (projectId: string) => void;
  onStopResearch: (projectId: string) => void;
}

export function ResearchPanel({ country, onStartResearch, onStopResearch }: Props) {
  const [selectedProject, setSelectedProject] = useState<string>("");

  const activeProjects = country.technology.projects.filter(p => !p.completed);
  const completedProjects = country.technology.projects.filter(p => p.completed);

  const handleStartResearch = () => {
    if (selectedProject) {
      onStartResearch(selectedProject);
      setSelectedProject("");
    }
  };

  return (
    <div className="research-panel">
      <h2>Исследования</h2>

      <section className="panel-section">
        <h3>Активные проекты</h3>
        {activeProjects.length === 0 ? (
          <p>Нет активных исследований</p>
        ) : (
          <ul className="project-list">
            {activeProjects.map((project) => (
              <li key={project.id} className="project-item">
                <div className="project-header">
                  <span className="project-name">{project.name}</span>
                  <button
                    onClick={() => onStopResearch(project.id)}
                    className="small"
                  >
                    Остановить
                  </button>
                </div>
                <div className="project-progress">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(project.progress / project.requiredProgress) * 100}%`
                      }}
                    />
                  </div>
                  <span className="progress-text">
                    {Math.round(project.progress)} / {project.requiredProgress}
                  </span>
                </div>
                <div className="project-details">
                  <span>Домен: {project.domain}</span>
                  <span>
                    Прогресс/месяц: {Math.round(project.progressPerMonth)}
                  </span>
                  <span>Стоимость: {Math.round(project.cost).toLocaleString("ru-RU")}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {completedProjects.length > 0 && (
        <section className="panel-section">
          <h3>Завершённые исследования</h3>
          <ul className="project-list">
            {completedProjects.map((project) => (
              <li key={project.id} className="project-item completed">
                <span className="project-name">{project.name}</span>
                <span className="project-status">✓ Завершено</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel-section">
        <h3>Начать новое исследование</h3>
        <div className="research-form">
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          >
            <option value="">Выберите технологию...</option>
            <option value="industry_tech_1">Промышленность I</option>
            <option value="agriculture_tech_1">Сельское хозяйство I</option>
            <option value="electronics_tech_1">Электроника I</option>
            <option value="computing_tech_1">Вычислительная техника I</option>
            <option value="nuclear_tech_1">Ядерная энергетика I</option>
            <option value="aerospace_tech_1">Аэрокосмическая техника I</option>
            <option value="biotechnology_tech_1">Биотехнологии I</option>
            <option value="ai_tech_1">Искусственный интеллект I</option>
          </select>
          <button
            onClick={handleStartResearch}
            disabled={!selectedProject}
            className="primary"
          >
            Начать исследование
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h3>Исследованные технологии</h3>
        <ul className="tech-list">
          {country.researchedTechnologyIds.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
