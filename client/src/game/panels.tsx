import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Coords, ResourceBar, Stat, Tag, TechScale, cx } from "../ui";
import {
  LEDGER_TAB_IDS,
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
  const { t } = useTranslation("panels");
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
        <Section title={t("economy.keyStats")}>
          <div className={styles.statTable}>
            {model.economyStats.map((stat) => (
              <Stat key={stat.label} layout="table" size="lg" {...stat} />
            ))}
          </div>
        </Section>
      )}

      <Section title={t("economy.budget")}>
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
              {saving ? t("economy.saving") : t("economy.save")}
            </Button>
            {dirty && !saving && (
              <Button size="sm" variant="quiet" onClick={() => setDraft(null)}>
                {t("economy.revert")}
              </Button>
            )}
            {failed && <span className={styles.budgetFailed}>{t("economy.failed")}</span>}
          </div>
        )}
      </Section>

      {model.resources.length > 0 && (
        <Section title={t("economy.resources")}>
          <ResourceBar items={model.resources} layout="list" />
        </Section>
      )}
    </>
  );
}

function DefenceTome({ withScience = false }: { withScience?: boolean }) {
  const { t } = useTranslation("panels");
  const model = useModel();
  return (
    <>
      <Section title={t("defence.slots")}>
        {model.techSlots.map((slot) => (
          <TechScale key={slot.name} {...slot} />
        ))}
      </Section>

      <Section title={t("defence.mobilization")}>
        <p className={styles.prose}>{t("defence.mobilizationNote")}</p>
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button variant="order" size="sm">{t("defence.peace")}</Button>
          <Button variant="quiet" size="sm">{t("defence.partial")}</Button>
          <Button variant="quiet" size="sm">{t("defence.full")}</Button>
        </div>
      </Section>

      {model.nuclear !== null && (
        <Section title={t("defence.nuclear")}>
          <div className={styles.row}>
            <span className={styles.rowName}>{t("defence.warheads")}</span>
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
  const { t } = useTranslation("panels");
  const model = useModel();
  return (
    <>
      <Section title={t("science.domains")}>
        <div className={styles.rows}>
          {model.domains.map((domain) => (
            <div key={domain.name}>
              <div className={styles.row}>
                <span className={styles.rowName}>
                  {domain.name}{" "}
                  <span className={styles.rowNote}>{t("science.tier", { tier: domain.tier })}</span>
                </span>
                <span className={styles.rowValue}>{Math.round(domain.progress * 100)}%</span>
              </div>
              <Meter value={domain.progress} />
              {domain.focus !== undefined && (
                <p className={styles.rowNote} style={{ marginTop: 2 }}>
                  {t("science.focus", { percent: Math.round(domain.focus * 100) })}
                </p>
              )}
              {domain.unlocks !== "" && (
                <p className={styles.rowNote} style={{ marginTop: 2 }}>
                  {t("science.next", { unlocks: domain.unlocks })}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("science.projects")}>
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
  const { t } = useTranslation("panels");
  const model = useModel();
  return (
    <>
      {model.politicsStats.length > 0 && (
        <Section title={t("politics.axes")}>
          <div className={styles.statTable}>
            {model.politicsStats.map((stat) => (
              <Stat key={stat.label} layout="table" size="lg" {...stat} />
            ))}
          </div>
        </Section>
      )}

      {model.ideology !== null && (
      <Section title={t("politics.course")}>
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
          {t("politics.courseNote")}
        </p>
      </Section>
      )}

      <Section title={t("politics.unrest")}>
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
  const { t } = useTranslation("panels");
  const model = useModel();
  return (
    <Section title={t("diplomacy.relations")}>
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
                  {t("diplomacy.dossier")}
                </Button>
              </span>
            </div>
          ))}
      </div>
    </Section>
  );
}

function GoalsTome() {
  const { t } = useTranslation("panels");
  const model = useModel();
  return (
    <>
      <Section title={t("goals.title")}>
        <div className={styles.rows}>
          {model.goals.map((goal) => (
            <div key={goal.text}>
              <div className={styles.row}>
                <span className={styles.rowName}>{goal.text}</span>
                <span className={styles.rowValue}>{Math.round(goal.progress * 100)}%</span>
              </div>
              <Meter value={goal.progress} />
              <p className={styles.rowNote}>{t("goals.estimate", { kind: goal.kind })}</p>
            </div>
          ))}
        </div>
      </Section>

      {model.redLines.length > 0 && (
      <Section title={t("goals.redLines")}>
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
        <Section title={t("goals.advisor")}>
          <p className={styles.prose}>
            <strong>{t("goals.assessment")}</strong> {model.advisor.assessment}
          </p>
          <p className={styles.prose} style={{ marginTop: "var(--space-2)" }}>
            <strong>{t("goals.guess")}</strong> {model.advisor.guess}
          </p>
          <p className={styles.rowNote} style={{ marginTop: "var(--space-2)" }}>
            {t("goals.advisorNote")}
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
  const { t } = useTranslation("panels");
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
          <span className={styles.rowName}>{t("region.industry")}</span>
          <span className={styles.rowValue}>{region.industry}</span>
        </div>
        <Section title={t("region.extraction")}>
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
          <span className={styles.rowName}>{t("region.owner")}</span>
          <Tag
            label={model.countries[region.owner].short}
            kind="country"
            onClick={() => onSelectCountry(region.owner)}
          />
        </div>
        <div className={styles.row}>
          <span className={styles.rowName}>{t("region.population")}</span>
          <span className={styles.rowValue}>{region.population}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowName}>{t("region.largestGroup")}</span>
          <span className={styles.rowValue}>
            {region.groups[0].name} {Math.round(region.groups[0].share * 100)}%
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowName}>{t("region.discontent")}</span>
          <span className={styles.rowValue}>{region.discontent.toFixed(2)}</span>
        </div>
      </div>
      <div style={{ marginTop: "var(--space-2)" }}>
        <Meter value={region.discontent} warn={region.discontent > 0.45} />
      </div>
    </>
  );
}

/**
 * Строки сравнения держав: ИДЕНТИФИКАТОР строки и чтение величины. Подпись
 * приходит из словаря (`compareLabels` ниже) — исчерпывающим `Record` по этим
 * же идентификаторам, поэтому пропущенную подпись видит компилятор, а
 * отсутствие строки в словаре — `localeKeys.test.ts`.
 */
const COMPARE_ROWS = [
  { key: "rank", read: (c: ScreenCountry) => `№${c.rank}` },
  { key: "tier", read: (c: ScreenCountry) => c.tier },
  { key: "gdp", read: (c: ScreenCountry) => c.gdp },
  { key: "population", read: (c: ScreenCountry) => c.population },
  { key: "army", read: (c: ScreenCountry) => c.army },
  { key: "ideology", read: (c: ScreenCountry) => c.ideology },
  { key: "bloc", read: (c: ScreenCountry) => c.bloc },
] as const;

type CompareRowKey = (typeof COMPARE_ROWS)[number]["key"];

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
  const { t } = useTranslation("panels");
  const model = useModel();
  const isPlayer = country.id === model.playerId;

  const compareLabels: Record<CompareRowKey, string> = {
    rank: t("compare.rank"),
    tier: t("compare.tier"),
    gdp: t("compare.gdp"),
    population: t("compare.population"),
    army: t("compare.army"),
    ideology: t("compare.ideology"),
    bloc: t("compare.bloc"),
  };

  return (
    <>
      <Section title={isPlayer ? t("country.own") : t("country.intel")}>
        {!isPlayer && (
          <p className={styles.rowNote} style={{ marginBottom: "var(--space-3)" }}>
            {t("country.intelNote")}
          </p>
        )}
        <div className={styles.compare}>
          <span />
          <span className={styles.compareHead}>{country.short}</span>
          <span className={styles.compareHead}>{rival === null ? "" : rival.short}</span>
          {COMPARE_ROWS.map(({ key, read }) => (
            <Fragment key={key}>
              <span className={styles.rowName}>{compareLabels[key]}</span>
              <span className={styles.compareValue}>{read(country)}</span>
              <span className={cx(styles.compareValue, styles.rowNote)}>
                {rival === null ? "" : read(rival)}
              </span>
            </Fragment>
          ))}
        </div>
      </Section>

      <Section title={t("country.compare")}>
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
  const { t } = useTranslation("panels");
  const [sort, setSort] = useState<{ key: string; desc: boolean }>({ key: "rank", desc: false });

  const toggleSort = (key: string) =>
    setSort((prev) => ({ key, desc: prev.key === key ? !prev.desc : true }));

  const model = useModel();
  const mark = (key: string) => (sort.key === key ? <span className={styles.sortMark}> ▾</span> : null);

  /** Подписи вкладок РЕЕСТРА — литеральными ключами, см. `compareLabels` выше. */
  const tabNames: Record<LedgerTabId, string> = {
    powers: t("ledger.tabs.powers"),
    regions: t("ledger.tabs.regions"),
    blocs: t("ledger.tabs.blocs"),
    chronicle: t("ledger.tabs.chronicle"),
  };

  return (
    <>
      <div className={styles.tabs}>
        {LEDGER_TAB_IDS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={id === tab ? "order" : "quiet"}
            onClick={() => onTab(id)}
          >
            {tabNames[id]}
          </Button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        {tab === "powers" && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => toggleSort("rank")}>#{mark("rank")}</th>
                <th onClick={() => toggleSort("name")}>
                  {t("ledger.powers.country")}
                  {mark("name")}
                </th>
                <th onClick={() => toggleSort("gdp")}>
                  {t("ledger.powers.gdp")}
                  {mark("gdp")}
                </th>
                <th onClick={() => toggleSort("population")}>
                  {t("ledger.powers.population")}
                  {mark("population")}
                </th>
                <th onClick={() => toggleSort("army")}>
                  {t("ledger.powers.army")}
                  {mark("army")}
                </th>
                <th onClick={() => toggleSort("relation")}>
                  {t("ledger.powers.relation")}
                  {mark("relation")}
                </th>
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
                <th onClick={() => toggleSort("name")}>
                  {t("ledger.regions.region")}
                  {mark("name")}
                </th>
                <th onClick={() => toggleSort("owner")}>
                  {t("ledger.regions.owner")}
                  {mark("owner")}
                </th>
                <th onClick={() => toggleSort("population")}>
                  {t("ledger.regions.population")}
                  {mark("population")}
                </th>
                <th onClick={() => toggleSort("discontent")}>
                  {t("ledger.regions.discontent")}
                  {mark("discontent")}
                </th>
                <th onClick={() => toggleSort("industry")}>
                  {t("ledger.regions.industry")}
                  {mark("industry")}
                </th>
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
                <th>{t("ledger.blocs.bloc")}</th>
                <th>{t("ledger.blocs.dimension")}</th>
                <th>{t("ledger.blocs.leader")}</th>
                <th>{t("ledger.blocs.members")}</th>
              </tr>
            </thead>
            <tbody>
              <tr onClick={() => onSelectCountry("SUN")}>
                <td>{t("ledger.blocs.sovietSphere")}</td>
                <td>{t("ledger.blocs.sovietDimension")}</td>
                <td>{t("ledger.blocs.sovietLeader")}</td>
                <td className={styles.numeric}>1</td>
              </tr>
              <tr onClick={() => onSelectCountry("USA")}>
                <td>{t("ledger.blocs.brettonWoods")}</td>
                <td>{t("ledger.blocs.brettonDimension")}</td>
                <td>{t("ledger.blocs.brettonLeader")}</td>
                <td className={styles.numeric}>3</td>
              </tr>
              <tr onClick={() => onSelectCountry("USA")}>
                <td>{t("ledger.blocs.securityCouncil")}</td>
                <td>{t("ledger.blocs.securityCouncilDimension")}</td>
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
                <th>{t("ledger.chronicle.date")}</th>
                <th>{t("ledger.chronicle.event")}</th>
                <th>{t("ledger.chronicle.source")}</th>
                <th>{t("ledger.chronicle.factuality")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{event.date}</td>
                  <td>{event.title}</td>
                  <td>
                    {event.order === undefined
                      ? t("ledger.chronicle.world")
                      : t("ledger.chronicle.order")}
                  </td>
                  <td>
                    {event.factuality === "partial"
                      ? t("ledger.chronicle.partial")
                      : event.factuality === "unconfirmed"
                        ? t("ledger.chronicle.unconfirmed")
                        : t("ledger.chronicle.confirmed")}
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
