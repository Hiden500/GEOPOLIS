import { useTranslation } from "react-i18next";
import { type Event, type ResponseEvent } from "@shared/types/Event";
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

  /**
   * Лента строится ПО ДАТЕ, а не по порядку записи: датированные события месяца
   * приходят вместе с его записью ответа, но происходят позже неё. Сортировка
   * устойчивая — при равных датах порядок остаётся тем, в котором движок писал.
   */
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) =>
      a.event.date === b.event.date ? b.index - a.index : a.event.date < b.event.date ? 1 : -1
    )
    .map(entry => entry.event);

  /**
   * Подтверждённость датированного события — подтверждённость ОТВЕТА, с которым
   * оно пришло: своей квитанции у него нет (`shared/types/Event.ts`). Пометка
   * «заявление режиссёра, а не факт» обязана доезжать и до таких карточек —
   * иначе половина ленты выглядела бы установленной историей, что и есть тот
   * дефект, ради которого пометку вводили (решение 2026-07-27).
   */
  const responseById = new Map<string, ResponseEvent>(
    events.filter((e): e is ResponseEvent => e.kind === "response").map(e => [e.id, e])
  );
  const factualityOf = (event: Event) =>
    event.kind === "response"
      ? event.receipt.factuality
      : responseById.get(event.responseEventId)?.receipt.factuality;

  return (
    <div className="timeline-panel">
      {ordered.length === 0 ? (
        <p>{t("noEvents")}</p>
      ) : (
        <ul className="timeline-list">
          {ordered.map(event => {
            const factuality = factualityOf(event);
            const tags = event.kind === "response" ? event.receipt.countries : event.claimedCountries;

            return (
              <li
                key={event.id}
                className={
                  event.kind === "dated" ? "timeline-card timeline-card--dated" : "timeline-card"
                }
              >
                <div className="timeline-date">{formatDate(event.date, i18n.language)}</div>

                {tags.length > 0 && (
                  <div className="timeline-tags">
                    {tags.map((countryId: string) => {
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
                {factuality !== undefined && factuality !== "confirmed" && (
                  <p className="timeline-factuality" role="note">
                    {t(`factuality.${factuality}`)}
                  </p>
                )}

                {event.description.split(/\n{2,}/).map((paragraph, i) => (
                  <p key={i} className="timeline-paragraph">{paragraph.trim()}</p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
