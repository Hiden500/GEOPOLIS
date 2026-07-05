import { type Event } from "@shared/types/Event";
import { type Country } from "@shared/types/Country";

interface Props {
  events: Event[];
  countries: Country[];
  onSelectCountry: (countryId: string) => void;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function EventTimelinePanel({ events, countries, onSelectCountry }: Props) {
  const countryById = new Map(countries.map(c => [c.id, c]));
  const reversedEvents = [...events].reverse();

  return (
    <div className="timeline-panel">
      <h2>Хроника</h2>

      {reversedEvents.length === 0 ? (
        <p>Событий пока нет</p>
      ) : (
        <ul className="timeline-list">
          {reversedEvents.map(event => (
            <li key={event.id} className="timeline-card">
              <div className="timeline-date">{formatDate(event.date)}</div>

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
                        {country?.shortName ?? countryId}
                      </button>
                    );
                  })}
                </div>
              )}

              <h3 className="timeline-title">{event.title}</h3>

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
