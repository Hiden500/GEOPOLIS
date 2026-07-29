import { Fragment, useState } from "react";
import { Button, ResourceBar, Stat, Tag, TechScale, cx } from "../ui";
import {
  BUDGET,
  COUNTRIES,
  DOMAINS,
  GOALS,
  LEDGER_TABS,
  PROJECTS,
  RED_LINES,
  REGIONS,
  RESOURCES,
  TECH_SLOTS,
  type Country,
  type CountryId,
  type LedgerTabId,
  type ProtoEvent,
  type Region,
  type TomeId,
} from "./data";
import styles from "./panels.module.css";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function Meter({ value, warn = false }: { value: number; warn?: boolean }) {
  return (
    <div className={styles.meter}>
      <div
        className={cx(styles.meterFill, warn && styles.meterWarn)}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

function FlagChip({ country }: { country: Country }) {
  return (
    <span
      className={styles.flagChip}
      style={{ background: `linear-gradient(135deg, ${country.colors[0]} 60%, ${country.colors[1]} 60%)` }}
    />
  );
}

/* ── Тома ──────────────────────────────────────────────────────── */

function EconomyTome() {
  const [budget, setBudget] = useState(BUDGET.map((item) => item.share));

  return (
    <>
      <Section title="Ключевые показатели">
        <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap" }}>
          <Stat label="ВВП" value="1,46T" delta={{ text: "+3,2%", tone: "good" }} size="lg" />
          <Stat label="Баланс" value="+12,4B" delta={{ text: "+1,8B", tone: "good" }} size="lg" />
          <Stat label="Долг к ВВП" value="0,94" delta={{ text: "+0,03", tone: "bad" }} threshold="near" size="lg" />
          <Stat label="Инфляция" value="6,1%" delta={{ text: "+0,4", tone: "bad" }} size="lg" />
        </div>
      </Section>

      <Section title="Доли бюджета">
        <div className={styles.rows}>
          {BUDGET.map((item, index) => (
            <div key={item.name}>
              <div className={styles.row}>
                <span className={styles.rowName}>{item.name}</span>
                <span className={styles.rowValue}>{Math.round(budget[index] * 100)}%</span>
              </div>
              <input
                className={styles.slider}
                type="range"
                min={0}
                max={60}
                value={Math.round(budget[index] * 100)}
                aria-label={item.name}
                onChange={(event) =>
                  setBudget((prev) =>
                    prev.map((share, i) => (i === index ? Number(event.target.value) / 100 : share)),
                  )
                }
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Сырьё">
        <ResourceBar items={RESOURCES} layout="list" />
      </Section>
    </>
  );
}

function DefenceTome() {
  return (
    <>
      <Section title="Слоты, парк и количество">
        {TECH_SLOTS.map((slot) => (
          <TechScale key={slot.name} {...slot} />
        ))}
      </Section>

      <Section title="Мобилизация">
        <p className={styles.prose}>
          Мобилизация даёт силу ценой гражданской экономики и стабильности. Сейчас — мирное
          положение.
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="order" size="sm">Мирное</Button>
          <Button variant="quiet" size="sm">Частичная</Button>
          <Button variant="quiet" size="sm">Полная</Button>
        </div>
      </Section>

      <Section title="Ядерное">
        <div className={styles.row}>
          <span className={styles.rowName}>Заряды</span>
          <span className={styles.rowValue}>0</span>
        </div>
        <p className={styles.rowNote} style={{ marginTop: "var(--space-2)" }}>
          Носителей нет. Программа РДС даст первый заряд не раньше 1949 года.
        </p>
      </Section>
    </>
  );
}

function ScienceTome() {
  return (
    <>
      <Section title="Домены и фокус исследований">
        <div className={styles.rows}>
          {DOMAINS.map((domain) => (
            <div key={domain.name}>
              <div className={styles.row}>
                <span className={styles.rowName}>
                  {domain.name} <span className={styles.rowNote}>· тир {domain.tier}</span>
                </span>
                <span className={styles.rowValue}>{Math.round(domain.progress * 100)}%</span>
              </div>
              <Meter value={domain.progress} />
              <p className={styles.rowNote} style={{ marginTop: 2 }}>
                Следующий тир: {domain.unlocks}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Проекты">
        <div className={styles.rows}>
          {PROJECTS.map((project) => (
            <div key={project.name}>
              <div className={styles.row}>
                <span className={styles.rowName}>{project.name}</span>
                <span className={styles.rowValue}>{project.eta}</span>
              </div>
              <Meter value={project.progress} warn={project.note !== ""} />
              {project.note !== "" && <p className={styles.rowNote}>{project.note}</p>}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function PoliticsTome() {
  return (
    <>
      <Section title="Оси власти">
        <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap" }}>
          <Stat label="Стабильность" value="71" delta={{ text: "−1", tone: "bad" }} size="lg" />
          <Stat label="Легитимность" value="83" delta={{ text: "+2", tone: "good" }} size="lg" />
          <Stat label="Коррупция" value="34" delta={{ text: "0", tone: "neutral" }} size="lg" />
          <Stat label="Поддержка" value="66" delta={{ text: "−3", tone: "bad" }} size="lg" />
        </div>
      </Section>

      <Section title="Курс">
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowName}>Экономическая ось</span>
            <span className={styles.rowValue}>−0,82 · плановая</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowName}>Политическая ось</span>
            <span className={styles.rowValue}>−0,91 · авторитаризм</span>
          </div>
          <p className={styles.rowNote}>
            Зона на спектре: коммунизм. Реформа двигает координаты постепенно и стоит политического
            капитала.
          </p>
        </div>
      </Section>

      <Section title="Очаги недовольства">
        <div className={styles.rows}>
          {Object.values(REGIONS)
            .filter((region) => region.discontent > 0.3)
            .sort((a, b) => b.discontent - a.discontent)
            .map((region) => (
              <div key={region.id}>
                <div className={styles.row}>
                  <span className={styles.rowName}>{region.name}</span>
                  <span className={styles.rowValue}>{region.discontent.toFixed(2)}</span>
                </div>
                <Meter value={region.discontent} warn={region.discontent > 0.45} />
              </div>
            ))}
        </div>
      </Section>
    </>
  );
}

function DiplomacyTome({ onSelectCountry }: { onSelectCountry: (id: CountryId) => void }) {
  return (
    <Section title="Отношения">
      <div className={styles.rows}>
        {Object.values(COUNTRIES)
          .filter((country) => country.id !== "SUN")
          .map((country) => (
            <div key={country.id} className={styles.row}>
              <span className={styles.rowName}>
                <FlagChip country={country} />
                {country.short}
              </span>
              <span style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
                <span
                  className={styles.rowValue}
                  style={{ color: country.relation < 0 ? "var(--fall)" : "var(--rise)" }}
                >
                  {country.relation > 0 ? `+${country.relation}` : country.relation}
                </span>
                <Button size="sm" variant="quiet" onClick={() => onSelectCountry(country.id)}>
                  Досье
                </Button>
              </span>
            </div>
          ))}
      </div>
    </Section>
  );
}

function GoalsTome() {
  return (
    <>
      <Section title="Цели державы">
        <div className={styles.rows}>
          {GOALS.map((goal) => (
            <div key={goal.text}>
              <div className={styles.row}>
                <span className={styles.rowName}>{goal.text}</span>
                <span className={styles.rowValue}>{Math.round(goal.progress * 100)}%</span>
              </div>
              <Meter value={goal.progress} />
              <p className={styles.rowNote}>Оценка: {goal.kind}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Красные линии">
        <div className={styles.rows}>
          {RED_LINES.map((line) => (
            <div key={line} className={styles.rowName}>
              · {line}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Советник">
        <p className={styles.prose}>
          <strong>Оценка.</strong> Разрыв по промышленному выпуску не сокращается третий год.
          Бюджет обороны в 34% удерживает паритет, но съедает то, что должно было стать станками.
        </p>
        <p className={styles.prose} style={{ marginTop: "var(--space-2)" }}>
          <strong>Предположение.</strong> Если доля обороны упадёт до 28%, разрыв начнёт сокращаться
          к 1949 году — ценой риска на западной границе.
        </p>
        <p className={styles.rowNote} style={{ marginTop: "var(--space-2)" }}>
          Это оценка и предположение, а не факт. Решение за вами.
        </p>
      </Section>
    </>
  );
}

export function TomeBody({
  id,
  onSelectCountry,
}: {
  id: TomeId;
  onSelectCountry: (countryId: CountryId) => void;
}) {
  switch (id) {
    case "economy":
      return <EconomyTome />;
    case "defence":
      return <DefenceTome />;
    case "science":
      return <ScienceTome />;
    case "politics":
      return <PoliticsTome />;
    case "diplomacy":
      return <DiplomacyTome onSelectCountry={onSelectCountry} />;
    case "goals":
      return <GoalsTome />;
  }
}

/* ── Инспекторы ────────────────────────────────────────────────── */

export function RegionDetail({
  region,
  onSelectCountry,
}: {
  region: Region;
  onSelectCountry: (countryId: CountryId) => void;
}) {
  return (
    <>
      <Section title="Общее">
        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowName}>Держава</span>
            <Tag
              label={COUNTRIES[region.owner].short}
              kind="country"
              onClick={() => onSelectCountry(region.owner)}
            />
          </div>
          <div className={styles.row}>
            <span className={styles.rowName}>Население</span>
            <span className={styles.rowValue}>{region.population}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowName}>Промышленность</span>
            <span className={styles.rowValue}>{region.industry}</span>
          </div>
        </div>
      </Section>

      <Section title="Состав населения">
        <div className={styles.groups}>
          {region.groups.map((group) => (
            <div key={group.name} className={styles.groupRow}>
              <span className={styles.rowName}>{group.name}</span>
              <span className={cx(styles.rowValue, styles.numeric)}>
                {Math.round(group.share * 100)}%
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Недовольство">
        <div className={styles.row}>
          <span className={styles.rowName}>Текущий уровень</span>
          <span className={styles.rowValue}>{region.discontent.toFixed(2)}</span>
        </div>
        <div style={{ marginTop: "var(--space-2)" }}>
          <Meter value={region.discontent} warn={region.discontent > 0.45} />
        </div>
      </Section>

      <Section title="Добыча">
        <div className={styles.rows}>
          {region.resources.map((resource) => (
            <div key={resource} className={styles.rowName}>
              · {resource}
            </div>
          ))}
        </div>
      </Section>

      <Section title="История места">
        <div className={styles.history}>
          {region.history.map((entry) => (
            <div key={entry.when} className={styles.historyRow}>
              <span className={styles.historyWhen}>{entry.when}</span>
              <span className={styles.rowName}>{entry.text}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

const COMPARE_ROWS: Array<[string, (c: Country) => string]> = [
  ["Ранг", (c) => `№${c.rank}`],
  ["Тир", (c) => c.tier],
  ["ВВП", (c) => c.gdp],
  ["Промвыпуск", (c) => c.industry],
  ["Армия", (c) => c.army],
  ["Курс", (c) => c.ideology],
  ["Блок", (c) => c.bloc],
];

export function CountryDetail({
  country,
  rival,
  onCompare,
  onClearCompare,
}: {
  country: Country;
  rival: Country | null;
  onCompare: (countryId: CountryId) => void;
  onClearCompare: () => void;
}) {
  const isPlayer = country.id === "SUN";

  return (
    <>
      <Section title={isPlayer ? "Ваша держава" : "Оценка разведки"}>
        {!isPlayer && (
          <p className={styles.rowNote} style={{ marginBottom: "var(--space-3)" }}>
            Данные о чужой державе — оценка, а не факт. Точность зависит от близости и присутствия.
          </p>
        )}
        <div className={styles.compare}>
          <span />
          <span className={styles.compareHead}>{country.short}</span>
          <span className={styles.compareHead}>{rival === null ? "" : rival.short}</span>
          {COMPARE_ROWS.map(([label, read]) => (
            <Fragment key={label}>
              <span className={styles.rowName}>{label}</span>
              <span className={styles.compareValue}>{read(country)}</span>
              <span className={cx(styles.compareValue, styles.rowNote)}>
                {rival === null ? "" : read(rival)}
              </span>
            </Fragment>
          ))}
        </div>
      </Section>

      <Section title="Сравнить">
        <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
          {Object.values(COUNTRIES)
            .filter((other) => other.id !== country.id)
            .map((other) => (
              <Button
                key={other.id}
                size="sm"
                variant={rival?.id === other.id ? "order" : "quiet"}
                onClick={() => (rival?.id === other.id ? onClearCompare() : onCompare(other.id))}
              >
                {other.short}
              </Button>
            ))}
        </div>
      </Section>
    </>
  );
}

/* ── Реестр ────────────────────────────────────────────────────── */

export function LedgerBody({
  tab,
  onTab,
  onSelectCountry,
  onSelectRegion,
  events,
}: {
  tab: LedgerTabId;
  onTab: (tab: LedgerTabId) => void;
  onSelectCountry: (countryId: CountryId) => void;
  onSelectRegion: (regionId: string) => void;
  events: ProtoEvent[];
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "rank", desc: false });

  const toggleSort = (key: string) =>
    setSort((prev) => ({ key, desc: prev.key === key ? !prev.desc : true }));

  const mark = (key: string) => (sort.key === key ? <span className={styles.sortMark}> ▾</span> : null);

  return (
    <>
      <div className={styles.tabs}>
        {LEDGER_TABS.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={item.id === tab ? "order" : "quiet"}
            onClick={() => onTab(item.id)}
          >
            {item.name}
          </Button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        {tab === "powers" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("rank")}>#{mark("rank")}</th>
                <th onClick={() => toggleSort("name")}>Держава{mark("name")}</th>
                <th onClick={() => toggleSort("gdp")}>ВВП{mark("gdp")}</th>
                <th onClick={() => toggleSort("industry")}>Промвыпуск{mark("industry")}</th>
                <th onClick={() => toggleSort("army")}>Армия{mark("army")}</th>
                <th onClick={() => toggleSort("relation")}>Отношения{mark("relation")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(COUNTRIES)
                .slice()
                .sort((a, b) => {
                  const dir = sort.desc ? -1 : 1;
                  if (sort.key === "relation") return (a.relation - b.relation) * dir;
                  if (sort.key === "name") return a.short.localeCompare(b.short) * dir;
                  return (a.rank - b.rank) * dir;
                })
                .map((country) => (
                  <tr
                    key={country.id}
                    className={cx(country.id === "SUN" && styles.playerRow)}
                    onClick={() => onSelectCountry(country.id)}
                  >
                    <td className={styles.numeric}>{country.rank}</td>
                    <td>
                      <FlagChip country={country} />
                      {country.short}
                    </td>
                    <td className={styles.numeric}>{country.gdp}</td>
                    <td className={styles.numeric}>{country.industry}</td>
                    <td className={styles.numeric}>{country.army}</td>
                    <td className={styles.numeric}>{country.relation}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {tab === "regions" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")}>Регион{mark("name")}</th>
                <th onClick={() => toggleSort("owner")}>Держава{mark("owner")}</th>
                <th onClick={() => toggleSort("population")}>Население{mark("population")}</th>
                <th onClick={() => toggleSort("discontent")}>Недовольство{mark("discontent")}</th>
                <th onClick={() => toggleSort("industry")}>Промышленность{mark("industry")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(REGIONS)
                .slice()
                .sort((a, b) => {
                  const dir = sort.desc ? -1 : 1;
                  if (sort.key === "discontent") return (a.discontent - b.discontent) * dir;
                  if (sort.key === "industry") return (a.industry - b.industry) * dir;
                  return a.name.localeCompare(b.name) * dir;
                })
                .map((region) => (
                  <tr key={region.id} onClick={() => onSelectRegion(region.id)}>
                    <td>{region.name}</td>
                    <td>{COUNTRIES[region.owner].short}</td>
                    <td className={styles.numeric}>{region.population}</td>
                    <td className={styles.numeric}>{region.discontent.toFixed(2)}</td>
                    <td className={styles.numeric}>{region.industry}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {tab === "blocs" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Блок</th>
                <th>Измерение</th>
                <th>Лидер</th>
                <th>Участники</th>
              </tr>
            </thead>
            <tbody>
              <tr onClick={() => onSelectCountry("SUN")}>
                <td>Сфера СССР</td>
                <td>военное · экономическое</td>
                <td>СССР</td>
                <td className={styles.numeric}>1</td>
              </tr>
              <tr onClick={() => onSelectCountry("USA")}>
                <td>Бреттон-Вудс</td>
                <td>экономическое</td>
                <td>США</td>
                <td className={styles.numeric}>3</td>
              </tr>
              <tr onClick={() => onSelectCountry("USA")}>
                <td>Совет Безопасности</td>
                <td>дипломатическое</td>
                <td>—</td>
                <td className={styles.numeric}>5</td>
              </tr>
            </tbody>
          </table>
        )}

        {tab === "chronicle" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Событие</th>
                <th>Источник</th>
                <th>Достоверность</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{event.date}</td>
                  <td>{event.title}</td>
                  <td>{event.order === undefined ? "мир" : "ваш приказ"}</td>
                  <td>
                    {event.factuality === "partial"
                      ? "частично"
                      : event.factuality === "unconfirmed"
                        ? "не подтверждено"
                        : "подтверждено"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
