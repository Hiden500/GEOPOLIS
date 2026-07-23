# Аудит документации — Phase 2

Дата: 2026-07-15. Режим discovery был read-only; этот отчёт создан после
инвентаризации. `VERIFIED` — подтверждено кодом/manifest/командой;
`INFERRED` — обоснованный вывод; `UNKNOWN` — execution evidence нет.

## Вывод

Документации достаточно, но живые источники истины смешаны с историческими
планами. Самый опасный drift находится не в архиве, а в `TODO`, live index
`DECISIONS`, onboarding и центральной архитектуре. Часть файлов содержит
воспроизводимые команды, часть — старые пути/поля/порты и обещания, которые
код уже опровергает.

## Инвентарь и назначение

| Группа | Аудитория/тип | Фактический источник истины | Состояние |
|---|---|---|---|
| `README.md` | onboarding, explanatory | manifests, CI, `start.ps1`, Vite config | HIGH drift |
| `client/README.md` | frontend onboarding | client manifest/code | Vite template, stale |
| `scripts/map/README.md` | data runbook | `make_1946.py`, builders, `paths.py` | неполная воспроизводимость |
| `docs/*.md` | design/architecture, normative+explanatory | shared types, ticks, routes, services | mixed freshness |
| `docs/plans/**` | execution history/live plan index | `docs/plans/README.md`, code, Git | завершённые планы не всегда помечены |
| `docs/tasks/**` | одноразовые задания | current task/code | один obsolete task опасен |
| `DECISIONS`/archive | live index + historical log | live index/Git | архив нормален, index stale |
| `docs/agent/**` | old agent bootstrap | root/nested AGENTS, skills, CI | не должен быть active authority |
| UI/map audit/reference | historical reference | current UI/map code | требует historical banner |

Проверено 45 Markdown-файлов в `docs/`, три README, HTML reference, manifests,
lockfiles, CI, `start.ps1`, env/config names и ключевые runtime paths.

## Per-document inventory

Типы: `N` — normative/live source, `E` — explanatory, `H` — historical,
`G` — generated/reference, `T` — task/plan. `Commands`: `yes` — сверены с
manifest/code/запуском, `partial` — применимы не все или execution недоступен,
`n/a` — исполняемых примеров нет.

| Документ | Аудитория; тип | Source of truth | Freshness; commands |
|---|---|---|---|
| `README.md` | новый разработчик; E | manifests, CI, `start.ps1`, Vite | исправлен 2026-07-15; yes |
| `client/README.md` | frontend developer; E | client manifest/code | template заменён; yes |
| `scripts/map/README.md` | data/map developer; E | `make_1946.py`, importer, paths | исправлен; standard yes, full partial |
| `docs/AI_RULES.md` | simulation developer; N | tick/engine code+tests | high drift исправлен; n/a |
| `docs/ARCHITECTURE.md` | maintainers; N/E | types, routes, services, HUD | high drift исправлен; n/a |
| `docs/DECISIONS.md` | maintainers; N+H | live index, Git/history | live index исправлен; n/a |
| `docs/decisions/2026-06.md` | maintainers; H | Git/dated record | immutable archive; n/a |
| `docs/decisions/2026-07.md` | maintainers; H | Git/dated record | immutable archive; n/a |
| `docs/DIPLOMACY.md` | game/system designer; N | diplomacy types/ticks/services | mixed implemented/open, usable; n/a |
| `docs/ECONOMY.md` | game/system designer; N | economy/resource/trade ticks | comparatively fresh; n/a |
| `docs/EVENTS.md` | game designer; T/N draft | future decision+code | explicitly unresolved draft; n/a |
| `docs/GEMINI_MAP_ENGINE.md` | map historians; H | Git/old MAS artifacts | historical banner added; partial |
| `docs/HISTORICAL_ACCURACY.md` | scenario authors; N | cited sources+scenario data | calibration claim corrected; n/a |
| `docs/LLM_RULES.md` | LLM/server developer; N | schemas, provider, routes, tests | comparatively fresh; partial live-provider |
| `docs/LOCALIZATION.md` | client/data developer; N | i18n files, shared types, consumers | stale status/paths corrected; n/a |
| `docs/MAP_FEATURES.md` | map/game designer; N | types/services/render code | removed-field claims corrected; n/a |
| `docs/OBJECTIVES.md` | game/server developer; N | objective service/routes/tests | recent implementation doc; n/a |
| `docs/POLITICS.md` | game/system designer; N | `PoliticsTick`, war effects | live open design, dynamics verified; n/a |
| `docs/PROJECT.md` | maintainers; E/N | repository layout/loaders | stale data sources corrected; n/a |
| `docs/SCENARIOS.md` | scenario authors; N | scenario loader/data schemas | split-data status corrected; n/a |
| `docs/TECH_TREE.md` | game designer; T/N draft | future decision+research code | explicitly unresolved draft; n/a |
| `docs/TODO.md` | all contributors; N | code + plans index + user decisions | blockers/closed work cleaned; n/a |
| `docs/TRADE.md` | game/system designer; N | trade tick/types | implemented v1 + open gaps; n/a |
| `docs/UI_DESIGN.md` | client/UI developer; N | tokens, primitives, HUD/CSS | redesign/tokens corrected; n/a |
| `docs/UI_UX_AUDIT.md` | designers; H | pre-redesign snapshot | historical banner added; n/a |
| `docs/WAR.md` | game/server developer; N | war types/tick/service/tests | current lifecycle + open Phase 3; n/a |
| `docs/WORLD.md` | scenario/map designers; N/E | validator/data + target | target vs current must be distinguished; n/a |
| `docs/agent/ARCHITECTURE_GUARDRAILS.md` | agent-system historians; H | actual tests/CI | partial historical banner; partial |
| `docs/agent/MASTER_PROMPT.md` | agent-system historians; H | AGENTS/skills | superseded, precedence removed; no |
| `docs/agent/PROTOCOLS.md` | agent-system historians; H | AGENTS/skills/PLANS | superseded banner; no |
| `docs/agent/STACK_PLAYBOOK.md` | agent-system historians; H/E | manifests/CI | historical, stale commands warned; no |
| `docs/agent/TEMPLATES.md` | agent-system historians; H | `.agent/PLANS`, skills | superseded banner; no |
| `docs/plans/README.md` | maintainers; N/T index | code/system docs | current status index; n/a |
| `docs/plans/01_PERSISTENCE_STATE.md` | implementers; H/T | save/state code+tests | completed historical plan; partial |
| `docs/plans/02_LLM_CONTRACT.md` | implementers; H/T | LLM code+tests | completed, live provider recheck open; partial |
| `docs/plans/03_MODIFIERS_COMMANDS.md` | implementers; H/T | commands/modifiers/tests | completed with deviations; partial |
| `docs/plans/04_RESOURCES.md` | implementers; H/T | resource code/tests | completed with residual tasks; partial |
| `docs/plans/05_DATA_LAYOUT.md` | implementers; H/T | schemas/loaders/pipeline | completed core, residual client work; partial |
| `docs/plans/06_MAP_FEATURES.md` | future implementers; T | future decision+current map code | not started; no |
| `docs/plans/07_SCENARIO_1836.md` | future implementers; T | future decision+scenario code | out of release scope; no |
| `docs/plans/08_WAR_WAVE1.md` | implementers/historians; H/T | WAR doc+code+tests | completed; interim section bannered; partial |
| `docs/plans/09_MECHANICS_BACKLOG.md` | game designers; T/E | product decisions | reference backlog; n/a |
| `docs/plans/10_CURRENCY_ZONES.md` | implementers; T/H | trade/country code+data | MVP complete, calibration open; partial |
| `docs/plans/11_MVP_ROADMAP.md` | product/implementers; N/T | live code+plan index | active meta-plan; n/a |
| `docs/plans/12_UI_REDESIGN.md` | client implementers; N/T+H | current HUD/UI docs | slices 0–3 complete, 4 open; partial |
| `docs/tasks/GLOBAL_AUDIT.md` | agent-system bootstrap; T | current user task | active input preserved; n/a |
| `docs/tasks/HISTORICAL_HINGE_POINTS_1946.md` | scenario authors; T | sources+scenario IDs | active/open task; partial |
| `docs/tasks/REGION_ECONOMY_FILL.md` | historians; H/T | current split pipeline | obsolete banner added; no |

HTML HUD reference is a static `G` artifact consumed by plan 12; manifests,
schemas, CI and source files were evidence, not documentation inventory rows.

## BLOCKER

1. **Live status противоречит завершённой реализации.** `TODO` утверждал, что
   war plan 08 steps 2–4/`transferRegion` ещё строятся, а план, decision entries
   и `server/src/commands/war.ts` показывают завершённую реализацию. В том же
   `TODO` карта одновременно unfrozen и frozen. Live index `DECISIONS` называл
   politics почти статичной, хотя `PoliticsTick.ts` обновляет показатели.
   Следствие: старое правило «при конфликте остановиться» блокировало обычную
   работу на заведомо ложном status layer.

## HIGH

2. **Onboarding расходится с manifests/runtime.** `README` утверждал третий
   package manifest в `shared/` (его нет), отсутствие client tests (92 проходят)
   и старый proxy `/player` вместо `/player-intent`; не документировал lint,
   typecheck, build, data checks и local-only API boundary.

3. **Заявленный verification gate невыполним.** `STACK_PLAYBOOK` говорил «main
   всегда зелёный» и требовал green lint; реально client lint падает с 20
   documented baseline errors. Такие errors нельзя назвать зелёными, но нельзя
   и приписывать текущей docs/config работе.

4. **Map rebuild не воспроизводим.** Нет Python dependency manifest и точных
   provenance URLs; локально отсутствует PyShp. Старый README задаёт неверный
   порядок builders и устаревший `regions.json`. Даже `make_1946.py --help`
   падает на Windows CP1251 из-за символа `→`. Validators проходят, но это не
   доказательство полного rebuild.

5. **Центральная архитектура описывала удалённые структуры.** Найдены
   `Region.resourceProduction` вместо `deposits`/`extraction`, ложный статус
   `transferRegion`, old floating-window-only UI и несуществующие
   `regions.json`/`world-map.geojson` как source of truth.

6. **Simulation/map docs содержали ложные current claims.** AI budget nudges
   отмечены как отсутствующие, хотя реализованы; `MAP_FEATURES` ссылался на
   удалённый `generateMineFeatures()`/`resourceProduction`.

7. **UI docs не догнали HUD redesign.** `Window` назывался единственным
   контейнером, пути указывали на удалённый `TopStatBar` и отсутствующий HTML;
   `GEMINI_MAP_ENGINE` выглядел активным и назначал старого владельца.

8. **`REGION_ECONOMY_FILL.md` нельзя исполнять.** Он требует старый monolithic
   JSON, удалённое поле, неверное число стран и удалённый component. Нужен
   `OBSOLETE/DO NOT RUN` banner; актуальное поведение — pipeline scripts/code.

9. **Historical provenance обещана шире evidence.** Один документ называл
   1946 dataset готовым по UN/Maddison/COW, другой честно говорил, что country
   values не сверены. Корректный статус: структурно валиден, исторически не
   полностью калиброван.

10. **Security boundary не была документирована.** Express API имеет широкий
    CORS, mutating routes без auth и не доказанный loopback-only bind. Проект
    нельзя выставлять в LAN/Internet как production service.

## MEDIUM

- CI фиксирует Node 22/Python 3.12, но repository runtime pins/`engines` и
  Python manifest отсутствуют.
- `PORT` читается server, но fixed Vite proxy/start script делают его изменение
  неполным workflow.
- Нет компактного полного API overview/error contracts и save recovery runbook.
- `start.ps1` печатает readiness после fixed delay без health check.
- Заголовки планов 03/05/11/12 расходились с их собственным статусом/индексом.
- Нет согласованной лицензии: README «некоммерческий», server manifest ISC,
  `LICENSE` отсутствует.

## LOW/COSMETIC

- Остались старое имя Pax Historia, точные устаревающие test counts и старые
  component names в historical/live смеси.
- `WORLD.md` говорит «около 1500», validator показывает 1366; это может быть
  target-vs-current, но формулировка должна различать их.
- `LOCALIZATION.md` одновременно описывает v1 как in-progress и complete.

## Выполненная проверка

| Команда/проверка | Результат |
|---|---|
| server typecheck | exit 0 |
| server Vitest | 679 passed, 1 skipped, exit 0 |
| client typecheck | exit 0 |
| client Vitest | 92 passed, exit 0 |
| client lint | exit 1, 20 baseline errors |
| 1946 data validator | 1366 regions/128 countries, exit 0 |
| Python validator tests | 9 passed, exit 0 |
| `make_1946.py --help` | exit 1, Windows encoding error |
| `make_1946.py --help` после bootstrap fix | exit 0; China→Asia order также исправлен |
| local Markdown link check | 0 missing targets |
| external target sample | 8/8 reachable during audit |

Client build и npm audits отдельно выполнены в Phase 0 и отражены в
`baseline.md`. Dev/browser, `start.ps1`, full map generation, Node 22 CI и save
recovery не выполнялись.

## Выбранная архитектура источников истины

- Commands/versions: manifests, lockfiles, CI, executable help.
- Current behavior: source + schemas + tests.
- Product intent: named domain docs, не любой файл в `docs/`.
- Current work: очищенный `TODO` + `docs/plans/README.md`.
- Decisions: latest live entries/index; history — archive/Git.
- Agent behavior: root/nested `AGENTS.md`, conditional skills, `.agent/PLANS`.
- Historical plans/audits: явный banner, отсутствие instruction precedence.

## Минимальное исправление

В рамках bootstrap синхронизируются high-impact live docs/onboarding, статусные
противоречия и historical banners; public eval проверяет локальные links,
essential commands и agent config. Не создаются отдельные runbook/API/security
документы только ради количества: подтверждённые предупреждения добавляются в
существующие sources.

Отдельным backlog остаются reproducible Python environment/provenance, Windows
encoding help, лицензия, health/readiness, save recovery и runtime pins. Они
требуют product/tooling решений, а не только редакторской правки.

## Выбор инструментов

Переиспользованы существующие TypeScript/Vitest/ESLint/Vite, Python validators,
`npm audit`, CI TruffleHog configuration и stdlib Python для нового public
eval. Новых dependencies не добавлено.

Осознанно не добавлены:

- Playwright/browser/a11y tooling — application UI не менялся, browser control
  в сессии не был доступен; установка ради bootstrap не даёт проверяемого flow;
- coverage gate — текущая задача не меняет runtime code, threshold/consumer не
  определены; существующие targeted и campaign tests выполнены;
- formatter — проект не имеет общей convention, массовый churn не оправдан;
- новый SAST/SBOM/license/container/IaC scanner — production/container/IaC
  manifests отсутствуют, а output не имел бы назначенного remediation flow;
- fuzz/property tests — agent/config/docs contracts детерминированы и лучше
  покрываются прямым public eval; product parsers в этом bootstrap не менялись;
- migration/deploy/release tools — database, migrations, CD и release workflow
  отсутствуют;
- второй secret scanner — TruffleHog уже настроен в CI, локальный executable
  отсутствовал; literal secret values не читались и не выводились.

Python dependency manifest, API/save recovery, readiness, license и bundle
splitting признаны реальными gaps и записаны в живой backlog, но их нельзя
честно закрыть одной docs/config задачей без отдельных решений и проверки.
