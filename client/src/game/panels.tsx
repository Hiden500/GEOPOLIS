import { Fragment, useState } from "react";
import { Button, Coords, ResourceBar, Stat, Tag, TechScale, cx } from "../ui";
import {
  LEDGER_TABS,
  useActions,
  useModel,
  type LedgerTabId,
  type ScreenCountry,
  type ScreenEvent,
  type ScreenRegion,
  type RegionTab,
  type TomeId,
} from "./model";
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

function FlagChip({ country }: { country: ScreenCountry }) {
  return (
    <span
      className={styles.flagChip}
      style={{ background: `linear-gradient(135deg, ${country.colors[0]} 60%, ${country.colors[1]} 60%)` }}
    />
  );
}

/* ── Тома ──────────────────────────────────────────────────────── */

function EconomyTome() {
  const model = useModel();
  const { saveBudget } = useActions();
  /*
   * Черновик долей живёт локально, пока игрок тянет ползунок: отправлять на
   * каждое движение — это десятки запросов на одну правку. Но и оставлять его
   * навсегда локальным нельзя: ползунок, который двигается и ничего не меняет,
   * — это интерфейс, который врёт.
   */
  const [draft, setDraft] = useState<number[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const budget = draft ?? model.budget.map((item) => item.share);
  const dirty = draft !== null && model.budget.some((item, i) => Math.abs(item.share - budget[i]) > 0.001);

  const commit = () => {
    if (saveBudget === undefined || draft === null) return;
    setSaving(true);
    setFailed(false);
    const shares: Record<string, number> = {};
    model.budget.forEach((item, i) => {
      shares[item.key] = budget[i];
    });
    void saveBudget(shares)
      .then(() => setDraft(null))
      .catch(() => setFailed(true))
      .finally(() => setSaving(false));
  };

  return (
    <>
      {model.economyStats.length > 0 && (
        <Section title="Ключевые показатели">
          <div className={styles.statTable}>
            {model.economyStats.map((stat) => (
              <Stat key={stat.label} layout="table" size="lg" {...stat} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Доли бюджета">
        <div className={styles.rows}>
          {model.budget.map((item, index) => (
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
                disabled={saveBudget === undefined || saving}
                onChange={(event) =>
                  setDraft(
                    budget.map((share, i) => (i === index ? Number(event.target.value) / 100 : share)),
                  )
                }
              />
            </div>
          ))}
        </div>
        {saveBudget !== undefined && (
          <div className={styles.budgetActions}>
            <Button size="sm" variant="order" disabled={!dirty || saving} onClick={commit}>
              {saving ? "Сохраняю…" : "Сохранить доли"}
            </Button>
            {dirty && !saving && (
              <Button size="sm" variant="quiet" onClick={() => setDraft(null)}>
                Вернуть
              </Button>
            )}
            {failed && <span className={styles.budgetFailed}>Не сохранилось</span>}
          </div>
        )}
      </Section>

      {model.resources.length > 0 && (
        <Section title="Сырьё">
          <ResourceBar items={model.resources} layout="list" />
        </Section>
      )}
    </>
  );
}

function DefenceTome({ withScience = false }: { withScience?: boolean }) {
  const model = useModel();
  return (
    <>
      <Section title="Слоты, парк и количество">
        {model.techSlots.map((slot) => (
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

      {model.nuclear !== null && (
        <Section title="Ядерное">
          <div className={styles.row}>
            <span className={styles.rowName}>Заряды</span>
            <span className={styles.rowValue}>{model.nuclear.warheads}</span>
          </div>
          {model.nuclear.note !== "" && (
            <p className={styles.rowNote} style={{ marginTop: "var(--space-2)" }}>
              {model.nuclear.note}
            </p>
          )}
        </Section>
      )}

      {/*
       * Вариант «наука внутри обороны»: домены и проекты приезжают сюда, и
       * причина (тир домена) оказывается в одном томе со следствием
       * (разрыв парка). Переключается в МЕНЮ — смотрим оба.
       */}
      {withScience && <ScienceTome />}
    </>
  );
}

function ScienceTome() {
  const model = useModel();
  return (
    <>
      <Section title="Домены и фокус исследований">
        <div className={styles.rows}>
          {model.domains.map((domain) => (
            <div key={domain.name}>
              <div className={styles.row}>
                <span className={styles.rowName}>
                  {domain.name} <span className={styles.rowNote}>· тир {domain.tier}</span>
                </span>
                <span className={styles.rowValue}>{Math.round(domain.progress * 100)}%</span>
              </div>
              <Meter value={domain.progress} />
              {domain.focus !== undefined && (
                <p className={styles.rowNote} style={{ marginTop: 2 }}>
                  Фокус исследований: {Math.round(domain.focus * 100)}%
                </p>
              )}
              {domain.unlocks !== "" && (
                <p className={styles.rowNote} style={{ marginTop: 2 }}>
                  Следующий тир: {domain.unlocks}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Проекты">
        <div className={styles.rows}>
          {model.projects.map((project) => (
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
  const model = useModel();
  return (
    <>
      {model.politicsStats.length > 0 && (
        <Section title="Оси власти">
          <div className={styles.statTable}>
            {model.politicsStats.map((stat) => (
              <Stat key={stat.label} layout="table" size="lg" {...stat} />
            ))}
          </div>
        </Section>
      )}

      {model.ideology !== null && (
      <Section title="Курс">
        <Coords
          point={model.ideology.point}
          rival={model.ideology.rival}
          xFrom={model.ideology.xFrom}
          xTo={model.ideology.xTo}
          yFrom={model.ideology.yFrom}
          yTo={model.ideology.yTo}
          zones={model.ideology.zones}
        />
        <p className={styles.rowNote} style={{ marginTop: "var(--space-3)" }}>
          Точка — ваш курс, ромб — соперник. Недовольство групп и близость союзов считаются
          как расстояние между позициями, поэтому важно не само число, а насколько вы далеко.
        </p>
      </Section>
      )}

      <Section title="Очаги недовольства">
        <div className={styles.rows}>
          {Object.values(model.regions)
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

function DiplomacyTome({ onSelectCountry }: { onSelectCountry: (id: string) => void }) {
  const model = useModel();
  return (
    <Section title="Отношения">
      <div className={styles.rows}>
        {Object.values(model.countries)
          .filter((country) => country.id !== model.playerId)
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
  const model = useModel();
  return (
    <>
      <Section title="Цели державы">
        <div className={styles.rows}>
          {model.goals.map((goal) => (
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

      {model.redLines.length > 0 && (
      <Section title="Красные линии">
        <div className={styles.rows}>
          {model.redLines.map((line) => (
            <div key={line} className={styles.rowName}>
              · {line}
            </div>
          ))}
        </div>
      </Section>
      )}

      {model.advisor !== null && (
        <Section title="Советник">
          <p className={styles.prose}>
            <strong>Оценка.</strong> {model.advisor.assessment}
          </p>
          <p className={styles.prose} style={{ marginTop: "var(--space-2)" }}>
            <strong>Предположение.</strong> {model.advisor.guess}
          </p>
          <p className={styles.rowNote} style={{ marginTop: "var(--space-2)" }}>
            Это оценка и предположение, а не факт. Решение за вами.
          </p>
        </Section>
      )}
    </>
  );
}

export function TomeBody({
  id,
  withScience = false,
  onSelectCountry,
}: {
  id: TomeId;
  /** Наука не отдельным ТОМОМ, а разделами внутри ОБОРОНЫ. */
  withScience?: boolean;
  onSelectCountry: (countryId: string) => void;
}) {
  switch (id) {
    case "economy":
      return <EconomyTome />;
    case "defence":
      return <DefenceTome withScience={withScience} />;
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
  tab,
  onSelectCountry,
}: {
  region: ScreenRegion;
  tab: RegionTab;
  onSelectCountry: (countryId: string) => void;
}) {
  const model = useModel();
  if (tab === "lyudi") {
    return (
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
    );
  }

  if (tab === "hozyaystvo") {
    return (
      <>
        <div className={styles.row}>
          <span className={styles.rowName}>Промышленность</span>
          <span className={styles.rowValue}>{region.industry}</span>
        </div>
        <Section title="Добыча">
          <div className={styles.rows}>
            {region.resources.map((resource) => (
              <div key={resource} className={styles.rowName}>
                · {resource}
              </div>
            ))}
          </div>
        </Section>
      </>
    );
  }

  if (tab === "istoriya") {
    return (
      <div className={styles.history}>
        {region.history.map((entry) => (
          <div key={entry.when} className={styles.historyRow}>
            <span className={styles.historyWhen}>{entry.when}</span>
            <span className={styles.rowName}>{entry.text}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className={styles.rows}>
        <div className={styles.row}>
          <span className={styles.rowName}>Держава</span>
          <Tag
            label={model.countries[region.owner].short}
            kind="country"
            onClick={() => onSelectCountry(region.owner)}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.rowName}>Население</span>
          <span className={styles.rowValue}>{region.population}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowName}>Крупнейшая группа</span>
          <span className={styles.rowValue}>
            {region.groups[0].name} {Math.round(region.groups[0].share * 100)}%
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowName}>Недовольство</span>
          <span className={styles.rowValue}>{region.discontent.toFixed(2)}</span>
        </div>
      </div>
      <div style={{ marginTop: "var(--space-2)" }}>
        <Meter value={region.discontent} warn={region.discontent > 0.45} />
      </div>
    </>
  );
}

const COMPARE_ROWS: Array<[string, (c: ScreenCountry) => string]> = [
  ["Место по ВВП", (c) => `№${c.rank}`],
  ["Тир", (c) => c.tier],
  ["ВВП", (c) => c.gdp],
  ["Население", (c) => c.population],
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
  country: ScreenCountry;
  rival: ScreenCountry | null;
  onCompare: (countryId: string) => void;
  onClearCompare: () => void;
}) {
  const model = useModel();
  const isPlayer = country.id === model.playerId;

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
          {Object.values(model.countries)
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
  onSelectCountry: (countryId: string) => void;
  onSelectRegion: (regionId: string) => void;
  events: ScreenEvent[];
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "rank", desc: false });

  const toggleSort = (key: string) =>
    setSort((prev) => ({ key, desc: prev.key === key ? !prev.desc : true }));

  const model = useModel();
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
                <th onClick={() => toggleSort("population")}>Население{mark("population")}</th>
                <th onClick={() => toggleSort("army")}>Армия{mark("army")}</th>
                <th onClick={() => toggleSort("relation")}>Отношения{mark("relation")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(model.countries)
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
                    <td className={styles.numeric}>{country.population}</td>
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
              {Object.values(model.regions)
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
                    <td>{model.countries[region.owner].short}</td>
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
