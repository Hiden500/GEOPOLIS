import { useTranslation } from "react-i18next";
import { type Event } from "@shared/types/Event";
import { type Country } from "@shared/types/Country";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";

interface Props {
  events: Event[];
  countries: Country[];
  onSelectCountry: (countryId: string) => void;
}

function formatDate(isoDate: string, locale: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

export function EventTimelinePanel({ events, countries, onSelectCountry }: Props) {
  const { t, i18n } = useTranslation("eventTimelinePanel");
  const countryById = new Map(countries.map(c => [c.id, c]));
  const reversedEvents = [...events].reverse();

  return (
    <div className="timeline-panel">
      {reversedEvents.length === 0 ? (
        <p>{t("noEvents")}</p>
      ) : (
        <ul className="timeline-list">
          {reversedEvents.map(event => (
            <li key={event.id} className="timeline-card">
              <div className="timeline-date">{formatDate(event.date, i18n.language)}</div>

              {event.countries.length > 0 && (
                <div className="timeline-tags">
                  {event.countries.map(countryId => {
                    const country = countryById.get(countryId);
                    return (
                      <button
                        key={countryId}
                        className="timeline-tag"
                        style={country ? { borderColor: country.color } : undefined}
                        onClick={() => onSelectCountry(countryId)}
                      >
                        {country ? getText(country.shortName, i18n.language as Locale) : countryId}
                      </button>
                    );
                  })}
                </div>
              )}

              <h3 className="timeline-title">{event.title}</h3>

              {/*
                Пометка «это заявление режиссёра, а не установленный факт»
                (решение пользователя 2026-07-27, docs/PRIMITIVES.md §3).
                Текст события пишется ДО применения и вправе описывать то, что
                движок отклонил, — без пометки игрок отличить это от настоящего
                события не может ничем.

                Помечается только НЕподтверждённое: у подтверждённого события
                метка была бы шумом на каждой карточке. Отсутствие пометки —
                утверждение, а не молчание: значит, всё предложенное движку
                применилось.
              */}
              {event.factuality !== "confirmed" && (
                <p className="timeline-factuality" role="note">
                  {t(`factuality.${event.factuality}`)}
                </p>
              )}

              {event.description.split(/\n{2,}/).map((paragraph, i) => (
                <p key={i} className="timeline-paragraph">{paragraph.trim()}</p>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
