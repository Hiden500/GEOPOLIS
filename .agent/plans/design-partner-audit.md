# ExecPlan: design-partner — полный аудит и редизайн-цикл Geopolis

Статус: Фаза 2 НАЧАТА (отмашка 2026-07-23). Блок 1 «Видение игрока» — идёт
опрос (раунд 1/2: основной опыт, PH-плюсы, референсы; раунд 2: обязательное/
запрещённое, наказания/поражение, темп хода). Итог блока — Player Experience
Goal (абзац + обязательное/запрещённое) в ledger + стоп-точка.
Research-отчёт Фазы 1: .agent/plans/design-partner-research-report.md.
Ветка/worktree: `claude/design-partner-audit` @ `.claude/worktrees/design-partner-audit`
База аудита: commit `a2b9768` (main == origin/main на 2026-07-23)
Роль: дизайн-партнёр (аудит/исследование/решения/документы). Код и данные НЕ редактирую;
артефакты — только `docs/` и `.agent/`.

## Процесс (напоминание для новой сессии/после compaction)

- Конечные проходы; после каждого — обновить этот файл (покрытие, доказательства,
  неизвестные, следующий scope).
- Стоп-точки: после inventory+matrix (СЕЙЧАС); после Фазы 0b; после списка
  research-вопросов; после research synthesis; после каждого decision-блока;
  перед правкой docs/PROJECT.md или плана 11; перед переносом пачки решений в DECISIONS.
- Решения — в ledger ниже со статусами proposed/accepted/deferred/rejected/superseded;
  в docs/DECISIONS.md — только accepted после проверки блока.
- Иерархия доказательств: runtime/integration → достижимая цепочка от entrypoint →
  unit-тест → статический код → документация. Прошлые аудиты (.agent/audits/*) —
  реестр гипотез, каждой присвоить: подтверждено / исправлено / не воспроизводится /
  недостаточно данных.
- Стоимость хода: полный payload (system+schemas+история+состояние+output+retries),
  модель/тариф/дата цены; перцентили только при телеметрии, иначе UNKNOWN +
  3 fixture-baseline (короткая/типовая/длинная кампания).

## Inventory (Фаза 0a, завершена)

497 tracked-файлов: client 141, server 135, shared 67, docs 48, scripts 41,
.agents 28, .agent 16. Полные листинги воспроизводимы `git ls-files <dir>`.

**Entrypoints и wiring (проверено чтением кода):**
- `start.ps1` → server `npm run dev` (tsx watch src/index.ts, :3000) + client `npm run dev` (vite, :5173).
- `server/src/index.ts` → `createApp()` (`app.ts`): Express 5 + cors + json; маршруты:
  `/game` (start/state/next-turn/save/load/saves CRUD), `/scenarios`, `/player-intent`,
  `/budget`, `/research`, `/llm` (prompt/response/auto), `/objective`.
- Клиент: `main.tsx` → `App.tsx` → `ScenarioSelector` → `GameView` (HUD линии A, срезы 0-3
  плана 12) + панели (Budget/Research/PlayerIntent/LLM/EventTimeline/WorldRanking/
  Territories/Inspector) + `MapView` (MapLibre). Все вызовы API — `client/src/api/gameApi.ts`.

**Игровой цикл (статически подтверждённая цепочка):**
интент игрока (PUT /player-intent) → LLM-цикл: GET /llm/prompt + POST /llm/response
(ручной copy-paste) ИЛИ POST /llm/auto (GeminiProvider) → processResponse: JSON.parse →
envelope Zod → per-action Zod (`actionSchemas.ts`, 11 типов, discriminated union, капы из
`shared/defines/llmActionCaps`) → применимость (`LLMResponseValidator`) → apply через
`commands/*` → событие в eventHistory → гейт `llmRespondedThisTurn=true` →
POST /game/next-turn (1..N месяцев) → `simulateMonth()` × N → autosave.

**simulateMonth порядок:** per-country: economy → resource → trade → research (+тир-факты) →
population → military → politics (+кризис-факты: инфляция/стабильность/долг);
затем глобально: aggregate регионы→страны → diplomacy → war → aiBehavior →
mapFeatures cleanup → modifiers cleanup → objective → дата+1мес → (январь: tier + chronicle).

**LLM-провайдер:** только Gemini (`GeminiProvider.ts`), REST generateContent,
structured output (Zod→JSON Schema с конвертацией под диалект Gemini: const→enum,
без additionalProperties, oneOf→anyOf со схлопыванием одинаковых веток, propertyOrdering),
thinkingLevel: high, модель по умолчанию gemini-3.1-flash-lite. Без retries, без записи
usageMetadata (токены/стоимость не телеметрируются). Ключ — server/.env, в браузер не уходит.

**Промт (generatePrompt, единственный вызов на цикл, без истории сообщений):** секции
Date / Language / Player Country / Major Powers (tier=major, ~10) / Spotlight (ротация 5,
round-robin по id) / Active Wars / Notable Developments (pendingWorldFacts, потребляются
ПРИ РЕНДЕРЕ) / Historical Context (hinge points 1946, счётчик показов инкрементится при
рендере) / Chronicle (годовые summary) / Recent Events (последние 5) / Diplomatic
Situation (ВСЕ пары rivals — неограниченно) / Player Intent / Country IDs / Instructions +
жёсткие капы. «Память» = Recent-строки по стране + Chronicle + Recent Events.

**Состояние и persistence:** одна игра на процесс (`GameStore` — модульная переменная);
`GameState` — полный plain-data мир (countries, regions, wars, modifiers, eventHistory,
chronicle, rngState — seeded RNG, pendingWorldFacts, hingePointShowCount, llm-поля);
сейв = JSON-файл `server/data/saves/<slot>.json`, `SAVE_VERSION` без миграций,
strip llmContext/pendingLlmActions; autosave-слот после каждого хода; slot-имя
защищено от path traversal (`SAVE_SLOT_PATTERN`).

**Данные 1946:** `server/data/scenarios/1946/` (regions.core / regions.state / names.en /
names.ru / countries.json) + `client/public/world_1946.geojson`; Zod-валидация на загрузке
(`scenario1946Schemas.ts`); генерация — `scripts/map/` (Python, оркестратор `make_1946.py`,
build_* по континентам, `import_to_game.py`, валидаторы `validate_region_economy_1946.py` +
его unit-тест; оба в CI). 1836/2000 — заглушки (testRegions + 3 рукописные страны).

**Тесты (статический подсчёт, прогон не выполнялся):** server ~644 `it/test(` в 48 файлах
(заявлено ~679 — проверить прогоном; есть it.each/campaignSmoke), client 92 в 7 файлах,
python 1 файл валидатор-тестов. Есть integration: routes (supertest), persistence
round-trip, campaignSmoke, hingePoints; e2e-подобный buildCountryLabels (client).

**CI:** client (lint+tsc+test), server (tsc+test), data (2 python-валидатора),
security (trufflehog verified + npm audit high, audit continue-on-error).
Отдельно `doc-guardrails.yml` (не читан).

**Конфигурация:** `server/.env` (GEMINI_API_KEY, GEMINI_MODEL), PORT; клиент —
vite proxy (не проверен: `API=""` в gameApi — как маршрутизируется к :3000 — UNKNOWN);
`.mcp.json`, `.claude/launch.json` (не читаны).

## Кандидаты в находки (гипотезы Фазы 0a — НЕ выводы; проверка в 0b)

| # | Гипотеза | Первичное основание |
|---|---|---|
| H1 | annex/puppet: в промте заявлены как типы действий, но apply — no-op c console.log; LLM может «аннексировать» нарративно без изменения мира → рассинхрон нарратив↔состояние | LLMService.applyLlmActions (осознанно, план 02 «не в этом заходе») |
| H2 | generatePrompt мутирует состояние: pendingWorldFacts потребляются и hingePointShowCount++ при КАЖДОМ рендере — двойной GET /prompt или prompt+auto теряет факты/жжёт показы | LLMService.getNotableDevelopmentsInfo/getHingePointHintsInfo |
| H3 | Секция Diplomatic Situation неограничена (все пары rivals всех стран) — рост промта с эскалацией мира | LLMService.getDiplomaticSituation |
| H4 | eventHistory растёт без границ → раздувание сейва и памяти | GameState.ts + TODO (известное отложенное) |
| H5 | usageMetadata Gemini не сохраняется → стоимость хода не телеметрируется вообще | GeminiProvider.generateResponse |
| H6 | API-ключ в URL query (?key=) вместо заголовка — риск утечки в логи | GeminiProvider (низкая серьёзность) |
| H7 | Клиент не имеет save/load UI-вызовов (в gameApi нет saveGame/loadGame/listSaves) — серверная фича недостижима из UI кроме autosave | gameApi.ts vs routes/game.ts |
| H8 | SimulationService — мёртвый код (импортируется только своим тестом) | grep по server/src |
| H9 | pendingLlmActions + savePendingActions/get/clear — мёртвая scaffolding | TODO.md (заявлено подтверждённым) — перепроверить |
| H10 | Рукописные страны TS (USSR/USA/...) мертвы для 1946; stockpile в 1946 стартует пустым | TODO.md — перепроверить по коду |
| H11 | Один ответ LLM разблокирует N месяцев симуляции (гейт проверяется 1 раз) — «LLM-главный-двигатель» разбавляется мульти-месячным ходом | GameService.advanceMonth |
| H12 | CORS открыт всем + сервер слушает без auth — локальная игра, но проверить экспозицию | app.ts |
| H13 | ~679 заявленных тестов ≠ 644 статических — уточнить прогоном | grep |
| H14 | Retry-петли на невалидный ответ LLM нет вообще (невалидное = 400/reject, ход не продвигается) — задокументированное поведение или пробел? | routes/llm.ts |
| H15 | Country.name — plain string (не LocalizedText) в промте → язык имён стран в промте фиксирован — сверить с LOCALIZATION.md | LLMService/TODO |

## Coverage matrix (полнота аудита определяется ТОЛЬКО этим списком)

Статусы: `не начато` / `inventory` (просмотрено при инвентаризации, статический код) /
`аудит OK` / `аудит: находки` / `исключено`. «Кто» заполняется в 0b.

| # | Поверхность | Статус | Доказательство | Кто |
|---|---|---|---|---|
| S1 | Формирование LLM-хода: game state → generatePrompt (все секции, объёмы, мутации) | inventory | чтение LLMService.ts | — |
| S2 | Валидация+применение ответа LLM: envelope → Zod → applicability → apply → commands/* | inventory | чтение actionSchemas/Validator/LLMService | — |
| S3 | LLM-провайдер: GeminiProvider, /llm/auto, structured output, ошибки/ретраи | inventory | чтение GeminiProvider.ts | — |
| S4 | Tick pipeline: simulateMonth + 13 тиков (each: вход/выход/детерминизм/rng) | inventory (каркас) | чтение SimulationEngine.ts | — |
| S5 | Гейт хода/переменная длина: advanceMonth, llmRespondedThisTurn | inventory | чтение GameService.ts | — |
| S6 | Persistence: SaveService, GameStore, autosave, версия, round-trip | inventory | чтение SaveService/GameStore | — |
| S7 | Остальные routes: budget, research, playerIntent, objective, scenarios + validation/schemas.ts | не начато | — | — |
| S8 | Client-server contract: gameApi ↔ routes, недостижимые серверные фичи, vite proxy | не начато | — | — |
| S9 | Client wiring: App/GameView/панели (что реально показывается из GameState) | inventory (imports) | grep imports | — |
| S10 | Map data contract: GeoJsonLoader/MapView/GeometryEngine ↔ regions/geojson (не визуал) | не начато | — | — |
| S11 | Shared: типы (Country/Region/War/...), defines, utils (aggregate/nationalPower/rng/modifiers) | inventory (GameState) | чтение GameState.ts | — |
| S12 | Сценарий 1946: CreateGame, Scenario1946, schemas, 5 JSON-файлов (объёмы, инварианты) | не начато | — | — |
| S13 | Сценарии-заглушки 1836/2000 + рукописные страны TS (жив/мёртв) | не начато | — | — |
| S14 | Data pipeline scripts/map: make_1946, build_*, import_to_game, валидаторы, sources | не начато | — | — |
| S15 | Тесты server: реальный прогон, счёт, классификация, слепые зоны | не начато | — | — |
| S16 | Тесты client + python: прогон, счёт | не начато | — | — |
| S17 | CI: ci.yml (прочитан) + doc-guardrails.yml | inventory (ci.yml) | чтение ci.yml | — |
| S18 | Конфигурация: env, tsconfig-и, vite/vitest configs, .mcp.json, launch.json | частично | .env.example прочитан | — |
| S19 | Docs↔code drift: PROJECT, LLM_RULES, AI_RULES, ARCHITECTURE, ECONOMY, WAR, TRADE, DIPLOMACY, POLITICS, WORLD, TECH_TREE, EVENTS, OBJECTIVES, SCENARIOS, HISTORICAL_ACCURACY, MAP_FEATURES, LOCALIZATION + plans/01-12 vs код | частично | PROJECT/TODO прочитаны | — |
| S20 | Прошлые аудиты .agent/audits/* как реестр гипотез (статус каждой находке) | не начато | — | — |
| S21 | Мёртвый код: полный реестр кандидатов | частично | H8-H10 | — |
| S22 | Поверхность безопасности: CORS/auth/ключи/path traversal/валидация входов | inventory (точечно) | SaveService/GeminiProvider | — |
| S23 | Стоимость хода: 3 fixture-baseline (короткая/типовая/длинная) + instrumentation-задача | не начато | — | — |
| S24 | Вопросы пользователя V1-V7 (см. ниже) — раздельные вердикты | не начато | — | — |
| — | ИСКЛЮЧЕНО: визуальный UI-дизайн (заморожен), node_modules, .idea/.vscode, fonts/assets, localbackup-ветки, .codex/.gemini конфиги чужих агентов (кроме реестра) | исключено | решение пользователя / вне мандата | — |

## Вопросы пользователя (V1-V7, вердикты в 0b)

V1 что делает LLM · V2 что работает без LLM · V3 где хранятся состояние и числа ·
V4 контекст/стоимость на ход · V5 механизм последовательности событий («блокада
Тайваня меняет исход») · V6 ограничение галлюцинаций · V7 что end-to-end, что заглушка.
Формат вердикта: статус реализации · уровень доказательства · качество/риск ·
соответствие докам.

## План проходов Фазы 0b (после отмашки)

- П1 (сам): S1+S23 — промт по секциям, реальные объёмы на fixture (3 baseline), мутации
  при рендере (H2), рост секций (H3).
- П2 (субагент): S2+S22-часть — цепочка ответа, все 11 команд до мутаций, annex/puppet
  (H1), капы, error paths (H14).
- П3 (субагент): S4 — каждый тик: что реально считает, детерминизм (rng-дисциплина),
  сходимость чисел; campaignSmoke как опора.
- П4 (субагент): S6+S13 — persistence round-trip, версия, autosave, GameStore
  однопроцессность; судьба 1836/2000 (H10).
- П5 (субагент): S7+S8+S9 — контракт клиент-сервер полностью, недостижимые фичи (H7),
  vite proxy.
- П6 (субагент): S12+S14 — данные 1946 и python-пайплайн, что гоняет CI.
- П7 (сам): S15+S16 — прогон всех тестов, реальный счёт (H13), классификация.
- П8 (субагент×2): S19 — docs↔code drift по таблице маршрутизации; S20 — реестр
  прошлых аудитов со статусами.
- П9 (субагент): S21+S10+S11 остаток — мёртвый код, shared-утилиты, map data contract.
- Критические выводы субагентов воспроизвожу сам (минимум: H1, H2, стоимость промта,
  один сквозной runtime-прогон сервера).

## Фаза 0b — прогресс (сессия 2026-07-23)

**П7 (сам, runtime) — ЗАВЕРШЁН.** В worktree выполнен `npm ci` + прогоны:
- server: **679 passed | 1 skipped (680), 48 файлов, зелёные** (vitest 4.1.9, 4.8s).
  Заявка «~679 тестов» ПОДТВЕРЖДЕНА (H13 закрыт). Skipped — вероятно live-Gemini
  gated-тест (сверить с отчётом П2).
- client: **92 passed (92), 7 файлов, зелёные**.
- python-валидаторы 1946: зелёные; факты: **1366 регионов, 128 стран**, население
  мира 2,252,044,726 сходится, Китай (CHN+TWN+QMS) 490M; unit-тесты валидатора 9 OK.

**П1 (сам, fixture-baseline стоимости промта) — ЗАВЕРШЁН.**
Метод: scratchpad-скрипт (вне репо) импортирует реальные createGame/LLMService/
simulateMonth; сценарий 1946, player=USA, seed=12345; каждый месяц —
generatePrompt → processResponse(синтетический валидный ответ: title+3 RU-абзаца
~1.4k chars + 4 diplomacy-действия среди мажоров) → simulateMonth. Токены —
оценка chars/4..chars/3 (BPE-токенизатор Gemini не запускался). Полный вывод:
scratchpad/measure-out.json, образец промта B2 — scratchpad/prompt-b2.txt.

| Baseline | Дата | promptChars | ~токены | Топ секции | Сейв (JSON chars) |
|---|---|---|---|---|---|
| B1 старт | 1946-01 | 7 816 | 2.0–2.6k | Instructions 4503 (58%!) | 1 146 009 |
| B2 24 мес | 1948-01 | 10 482 | 2.6–3.5k | Instructions 4503, Majors 2043, Chronicle 823 | 1 358 318 |
| B3 120 мес | 1956-01 | 13 260 | 3.3–4.4k | Instructions 4503, **Chronicle 3289**, Majors 2221 | 1 493 724 |

+ responseSchema Gemini ≈ 4 553 chars (~1.1k ток) КАЖДЫЙ вызов (без учёта
enrichForGemini-трансформации — приближение).
Итого input на цикл ≈ 3–5.5k ток; output+thinking (thinkingLevel: high!) —
UNKNOWN без телеметрии (H5); retries нет (1 вызов). p50/p95 — UNKNOWN,
instrumentation-задача остаётся. Цена в $ — в Фазе 1 (тариф gemini-3.1-flash-lite
+ дата).
Рост промта: драйвер — ТОЛЬКО Chronicle (~+300 chars/год, линейно, без капа):
к 2100 (~154 года) ~46k chars ≈ +12k ток/цикл. eventHistory растёт в сейве
(H4), но в промт идут только последние 5.
Производительность движка: 120 месяцев симуляции (128×1366) = **1.18 сек** —
детерминированное ядро дёшево.

**H-статусы по итогам П1/П7 (+ новые гипотезы из образца промта):**
- H2 ПОДТВЕРЖДЁН эмпирически: pendingWorldFact виден в 1-м рендере, отсутствует
  во 2-м, pendingWorldFacts=0 после (двойной GET /llm/prompt теряет факты).
  Hinge-инкремент в B2-состоянии не проверен (eligible пуст к 1948) — код прочитан.
- H3 СНЯТ в исходной форме: Diplomatic Situation на fixture — 273 chars (пары
  rivals немногочисленны). Но секция дублирует каждую пару A-B/B-A и светит
  сырые float («-98.80000000000007») — мелкая гигиена промта (→H17).
- H13 ЗАКРЫТ (679 подтверждено).
- H16 НОВАЯ: войны не завершаются движком — BRA vs ARG висит при war score +100
  «decisively winning»; CHN vs CAN+GBR — 0 потерь, «front stable», годами. Мир —
  только LLM-действие? ИИ объявляет войны без географического контакта → вечные
  пустые войны. Проверить WarTick/aiBehavior (отчёт П3).
- H17 НОВАЯ: гигиена промта — float-мусор, дубли пар, «no notable tech progress
  yet» у ВСЕХ держав спустя 2 года (тир-пороги слишком медленные, LLM не видит
  технологический сигнал), Spotlight принуждает нарратив про микространы
  (Андорра GDP $0.00B: «You MUST give a concrete beat»).
- H18 НОВАЯ: дипломатия саморазгоняется к экстремумам: затухание к нейтрали
  ничтожно (−99.9 держится годами), AI-nudges (Правило B) доводят пары до дна;
  все видимые в промте отношения ≈ −99..−100 к 1948. Калибровка/дизайн-вопрос.
- H19 РЕШЕНА (сам проверил): setRelation — имя обманчиво, семантика ДЕЛЬТА
  (DiplomacyService.changeRelation, + реципрокный сдвиг 50%); кап ±40 — на
  действие. commands/diplomacy.ts:18-24.
- Калибровка: USA 1948 GDP/cap $771 (реально ~$1800 в долларах 1946) — вопрос
  масштаба единиц к П6/research.
- Ограничение метода: синтетические ответы LLM (пустых/военных действий не
  подавали, мир спокойнее реального) — baseline, не телеметрия.

Матрица: S15, S16 → «аудит OK» (прогоны зелёные); S23 → «baseline снят,
$ и телеметрия — Фаза 1/план»; S1 → частично (объёмы сняты, полный разбор — с
отчётами субагентов). Остальные — ждут отчётов П2-П6, П8-П9 (8 субагентов
запущены в фоне).

### Отчёт П2 (цепочка ответа LLM) — ПРИНЯТ, сессия 2026-07-23

Вердикты: **H1 ПОДТВЕРЖДЁН c усилением** — annex/puppet проходят Zod и applicability,
попадают в appliedActions/eventHistory.countries/ответ клиенту как «применённые», мир
не меняется (LLMService.ts:350-354); «нарративная аннексия» не детектируется ничем.
**H14 ПОДТВЕРЖДЁН** — ретраев нет нигде (1 вызов провайдера, клиент не повторяет,
конкретная причина ошибки в UI не показывается — только generic-текст, причина лишь
в console.error: LLMPanel.tsx:64-99).

Новые находки П2 (все с file:line в отчёте агента; мой спот-чек по уже прочитанным
мной файлам сходится):
- F1. success:true при 100% отклонённых действий: гейт открывается, llmTurn++,
  курсор двигается, playerIntent сжигается, нарратив пишется в историю. Теста нет.
- F2. Идемпотентности нет: двойной POST /llm/response применяет дельты дважды
  (diplomacy/influence/build_extraction); /auto не отслеживает разрыв клиента.
- F3. Батчевый TOCTOU: applicability всего батча по состоянию ДО применения —
  2×build_extraction(+1)=+2 уровня/ответ, 2×sanction=−50 отношений, war+research_shift
  валидируется по довоенному капу.
- F4. CommandResult игнорируется всеми apply*: build_extraction без казны числится
  applied (казну проверяет только команда, validator — нет).
- F5. build_extraction delta=−1: без проверки контроля/принадлежности — любая страна
  бесплатно снижает добычу ЛЮБОГО региона мира; тест закрепляет это поведение
  (resources.test.ts:63-72).
- F6. Σ явных долей research/production НЕ нормализуется в тиках: 14 доменов×0.7 →
  эффективный расход researchSpending ×~9.8; production ×~5.6. Кап — на домен, на
  сумму капа нет. (Сверить с отчётом П3.)
- F7. influence: `data?.influenceChange || 10` — валидный 0 превращается в +10
  (LLMService.ts:410; `??` vs `||`).
- F8. Спам одного действия: 20×diplomacy(±40) на одну пару за один ответ → до ±100;
  кап на действие, не на пару-за-ход.
- F9. descriptions/title без верхней границы длины → раздувание eventHistory/сейва
  (до лимита express.json ~100KB/запрос).
- F10. Фикс. relation-эффекты войны/мира/санкций (−100/−50, +50/+25, −25) лежат вне
  капа ±40 — осознанный дизайн, но war→peace даёт качели сильнее любого diplomacy.
- F11. /auto при ошибке провайдера: 502, цикл не продвинут, НО savePrompt уже
  потребил pendingWorldFacts и сжёг hinge-показы (усиление H2).
- Слепые зоны семантики: война пуппету, guarantee воюющему, sanction союзнику —
  проходят.
- Пробелы тестов (9 пунктов в отчёте): annex-в-appliedActions, 100%-reject
  продвижение, TOCTOU-дубли, Σshare-инфляция, influence 0→10 и др.

### Отчёт П5 (контракт клиент↔сервер) — ПРИНЯТ, сессия 2026-07-23

Вердикт: **H7 ПОДТВЕРЖДЁН и шире** — из 16 endpoint'ов UI использует 9; недостижимы
все 4 save/load (+ GET /budget, GET /research/state, PUT /objective/goals). Save/load:
backend реализован и проверен (curl-цикл в DECISIONS:986-991), UI-панель из плана
01 (:63) не построена, и этот пропуск нигде не задокументирован.

Находки П5:
- F12. Нет DTO-границы API: llmContext/llmResponse/pendingLlmActions уезжают в браузер
  в каждом /game/state|/start|/next-turn (res.json(game) по живой ссылке GameStore);
  клиент их не читает (grep=0). SaveService их вырезает — HTTP нет. Непоследовательность
  + лишний трафик (промт ~10KB на каждый state-запрос).
- F13. LLMGateError = 409 (не 402). Сервер шлёт готовую RU-инструкцию «сначала
  получите ответ LLM», клиент показывает generic «Ошибка хода» (осознанный паттерн
  console.error+generic, GameView.tsx:78-80), кнопка хода НЕ дизейблится по гейту →
  гарантированный 409-клик. UX-обрыв.
- F14. vite proxy: 6 групп из 7 — /objective не проксируется (латентная ловушка).
- F15. TODO.md устарел про ResearchPanel («хардкод технологий») — код итерирует
  domains динамически; пункт пережил закрывший его рефактор. Драйф TODO↔код.
- F16. Сценарий/страны на экране выбора: name — голая RU-строка в коде сервера
  («Холодная война», Scenario1946.ts:124), /scenarios/list без locale, fetch один раз
  → смена языка UI не меняет названий (усиливает H15 про LocalizedText).
- F17. nextTurn(months) — параметр есть на обоих концах, ни разу не передаётся
  (осознанно, UI заморожен; комментарий в gameApi.ts:45).
- F18. BudgetPanel: shares инициализируются один раз при монтировании без
  синхронизации с пропом (в отличие от PlayerIntentPanel) — кандидат stale-state
  при ходе с открытой книгой; рантаймом не воспроизведено (уверенность средняя).
- Клиент→сервер расхождений типа «зов в несуществующий роут» нет; все 9 функций
  совпадают со схемами валидации буквально.

### Отчёт П3 (tick pipeline) — ПРИНЯТ, сессия 2026-07-23

Вердикты: **H16 ПОДТВЕРЖДЁН механизмом** — ИИ (правило D, только non-major↔non-major)
объявляет войны, но `makePeace` вызывается ЕДИНСТВЕННО из LLM-действия peace →
войны, которые LLM игнорирует, вечны; заморская пара без сухопутного контакта — ноль
фронта/потерь навсегда (WarTick «явный пробел Phase 1»: морских десантов нет).
Majors в правиле D пассивны — их войны только через LLM. **Детерминизм ЧИСТЫЙ**:
0 Math.random в исполняемом коде, 0 for..in, insertion-order стабилен через
JSON round-trip, architecture.test это сторожит (правила 1/2/4/5/6/9/10). rngState —
«спящая» инфраструктура (потребляет только seedAiTraits при создании партии).

Находки П3:
- F19. Военные units/equipment в бою НЕ участвуют: WarTick читает activePersonnel +
  equipmentPower, а armyStrength/navyStrength/airStrength — статичные нули
  («негодны как прокси», WarTick.ts:14-16); TierTick-military ≈ manpower.
- F20. Неограниченный рост: eventHistory (каждый LLM-ход), wars (завершённые лежат
  навсегда, warTick итерирует весь массив ежемесячно), chronicle (+1/год),
  pendingWorldFacts в headless-прогонах (чистятся только generatePrompt'ом).
- F21. Числовые риски: ВВП не умеет падать (пол роста 0 — кризис лишь останавливает
  рост); inflation без клампа в обе стороны (может уйти в минус); долговая петля
  (проценты до ~19%/год) — аустерити защищает ТОЛЬКО ИИ, у игрока пола нет;
  транзиентно-отрицательная казна (politicsTick дренит после economyTick).
- F22. PopulationTick: миграция заявлена в комментарии, в коде отсутствует; полы-
  заплатки (регион ≥1000 чел, рождаемость ≥0.5×) — открытая калибровка бедных стран.
- F23. aggregateCountryData: больше половины вычислений мёртвые (weightedStability/
  Development/avgSectors/deposits считаются и выбрасываются; реально пишутся только
  population и gdp). Прямого теста нет.
- F24. TierTick — единственный тик без теста вообще; январская ветка (tier+chronicle)
  юнитом не покрыта; нет теста сейв-инвариантности посреди войны.
- F25. Wall-clock спящий баг: MapFeatureService.removeExpiredFeatures сравнивает
  expiresAt с new Date() (вызывается каждый месяц); сейчас no-op (expiresAt никто
  не ставит), задокументирован и в whitelist architecture.test.
- F26. Перевороты/смена режима: только pendingWorldFact при stability&lt;20 — сам
  переворот должен делать LLM, у которой НЕТ подходящего действия (только нарратив).
- Подтверждено: LLM в тиках не участвует (0 импортов); SimulationService мёртв (H8);
  campaignSmoke = 60 мес × 128 стран, полы населения, монотонность тиров.

### Отчёт П8b (реестр прошлых аудитов) — ПРИНЯТ + мой прогон eval, сессия 2026-07-23

Калибровка: аудиты 2026-07-23 описывали состояние ДО собственной интеграции; большинство
их CRITICAL/HIGH исправлено в тот же день (PR #10/#11). Реестр — 42 позиции в отчёте
агента. Живое (НЕ исправлено):
- F27. DIPLOMACY.md §«Санкции без эффекта» лжёт: TradeTick.ts:53 реально режет экспорт
  по trade_embargo. Живой doc↔code конфликт.
- F28. Шапки планов 03/05 «Статус: не начато» при фактической реализации (05
  самопротиворечив внутри одного файла: строка 4 vs 158).
- F29. DECISIONS.md 1092 строки / 112KB — архивация просрочена и ухудшается.
- F30. WORLD.md «около 1500 регионов» vs фактические 1366 (+128 стран).
- F31. Country.researchedTechnologyIds — мёртвое поле живо (используется только тестом).
- F32. План 12 ссылается на несуществующий asset (1946-hud-reference.html vs
  geopolis-1946-hud.html).
Честность записей: (а) public eval «150/150» — Я ПЕРЕЗАПУСТИЛ: 150 passed, 0 failed
✔ текущее состояние честно (исторические 132/159 — неверифицируемы, но безвредны);
(б) «46 предсуществующих FAIL data-валидатора» — артефакта нет; на main валидатор
зелёный (мой прогон П7); (в) «независимые ревью» (GPT-5.6, Codex) — без сохранённых
review-packet'ов, пересказ автора; (г) прецедент пойманной лжи в журнале ЕСТЬ:
Gemini «наполнение экономики 1946» (2026-07-03) опровергнуто аудитом Claude
(2026-07-04) — записи «(модель) сделано» без даты-аудита читать только как заявку.

### Отчёт П6 (данные 1946 + python-пайплайн) — ПРИНЯТ, сессия 2026-07-23

Подсчёты live: 1366 регионов (core=state=names.en=names.ru побитово по id), 128 стран,
все страны владеют ≥1 регионом. GeoJSON: 1498 фич (1374 land + 124 ocean); 8 land-фич
без владельца (Spratly + 7 секторов Антарктиды) осознанно не стали регионами.
- F33. **Full rebuild невоспроизводим**: seed-геометрия game_map.json удалена из репо
  (36МБ, commit b561624), заявленная замена scripts/map/sources/ отсутствует на диске;
  фундаментальнее — ownership_1946/countries_1946/names_ru.json НЕ производятся ни
  одним скриптом репо (внешний d:/MAP). Стандартный путь (из закоммиченных out/*) —
  работает и детерминирован. Python-манифеста зависимостей нет (подтверждено).
- F34. **world_1946.geojson = 34.4 МБ** грузится клиентом as-is (цель «≤5МБ» из
  плана 05 не сделана — известный отложенный пункт TODO).
- F35. Дыры валидации данных: Zod при загрузке НЕ проверяет соседей (id могут не
  существовать), уникальность id, puppets/sphereOfInfluence-ссылки, ключи stockpile
  vs каталог (тихий каст as CountryInput); это ловит только офлайн python-валидатор
  (и то не всё). CI job data не регенерирует resource_catalog.json → staleness-риск
  при правке TS-каталога. Геометрическая валидность — только печать в full-rebuild,
  никогда в CI.
- F36. Подтверждены известные баги данных: Ruanda-Urundi = 2 страны с одним именем
  (RWA 5 + BDI 3 региона; пайплайн ЗНАЕТ — split_ruanda_urundi делит один тотал);
  Австрия 9 регионов без зон оккупации (зонирование есть только DEU/KOR).
- F37. stockpile: 0/128 стран (подтверждено); казна/ВВП живут с хода 0, склад пуст
  до первого ResourceTick.
- Каталог ресурсов TS↔Python: единый источник, дрейфа НЕТ (20 ресурсов 1:1);
  устаревший комментарий про «ручной синхрон» в defines/resources.ts:26-28.
- Минорное: config/country_merge.json — write-only дамп.

### Отчёт П9 (мёртвый код / shared / map contract) — ПРИНЯТ, сессия 2026-07-23

Метод надёжен: barrel-реэкспортов в репо нет (0 `export * from`), динимпортов вне
тестов нет → grep-вердикты крепкие. Repowise дал 2 подсказки — обе проверены и
оказались стейл/ложными (несуществующий файл и несуществующая функция) — индекс в
вердикты не допущен (подтверждает правило CLAUDE.md «evidence, не authority»).

- F38. **Заглушки 1836/2000 доступны игроку**: ScenarioRegistry статически импортирует
  оба, /scenarios/list фильтрует только countries.length>0 → «Век империй 1836» и
  «2000» с 3 странами и регионами test-1 РЕНДЕРЯТСЯ в ScenarioSelector и стартуемы.
  Это не мёртвая ветка, а действующий сломанный продукт-контент. (Уточнение H10:
  «мертвы для 1946» — да; «мертвы вообще» — нет для USSR/USA/UK+testRegion.)
- F39. МЁРТВ (0 импортёров): 9/12 рукописных стран (China, France, Germany×5, Italy,
  Taiwan); client RegionLayer.tsx (файл 0 байт!), CountryColors.ts (канон цвета
  задублирован литералом '#808080' в GeoJsonLoader:76); shared/data/
  {countryIsoMapping, historicalData1946, regionTranslations}; shared/utils/
  regionFilter.ts (LOD-заготовка); types/constructions/*, types/resources/
  ResourceDeposit (док плана 04 сам признаёт).
- F40. ТОЛЬКО-ТЕСТ: SimulationService (H8 ✔), RegionService, pendingLlmActions-квартет
  (H9 ✔, SaveService их вычищает). MilitaryService достижим, но без юнит-теста.
- F41. Твины-формулы на комментарии: nationalPower.militaryStrength ≡
  WarTick.sideStrength (синхронизация держится на докстринге, не общей функции).
- F42. Map contract: join по Region.geoJsonId + sourceAdm1Codes[] (многие-к-одному)
  против properties.region_id; расхождение — МОЛЧА: фича без региона → серый «Neutral»
  (и выпадает из топологии границ), регион без фичи → невидим на карте; ошибок нет,
  только console.log-счётчики.
- F43. Клиентская стоимость хода: useEffect в MapView на [regions,countries] делает
  ПОЛНЫЙ re-fetch world_1946.geojson (34МБ, F34) + пересборку топологии на каждый
  ответ сервера, плюс параллельный updateMapData — двойная работа на каждый ход.
- F44. rngState: потребитель один (seedAiTraits при создании) — «seeded RNG для всей
  симуляции» пока рамка, не факт; тики полностью формульные (сходится с П3).
- Достижимость остального из списка кандидатов подтверждена (полный реестр — в
  отчёте агента; shared/defines — все 20 живые, слой чистый).

### Отчёт П4 (persistence + заглушки) — ПРИНЯТ, сессия 2026-07-23

Round-trip: срезаются ровно llmContext+pendingLlmActions; llmResponse оставлен
осознанно; pendingWorldFacts/hingePointShowCount/llmSpotlightCursor/llmTurn/
llmRespondedThisTurn переживают сейв (намеренно, гейт доказан integration-тестом
косвенно). SAVE_VERSION=3 (v1→2 chronicle, v2→3 modifiers), миграций нет нигде —
честный отказ, задокументировано. Прод-seed = Date.now() (детерминизм — только
между прогонами одного seed; сам seed не фиксирован и нигде не показывается).
- F45. Запись сейва не атомарна (writeFileSync без tmp+rename/fsync/бэкапа) — крах
  посреди записи необратимо портит слот, включая autosave.
- F46. listSaves(): один битый JSON-файл в saves/ роняет ВЕСЬ GET /game/saves;
  плюс синхронный полный parse каждого файла ради 2 полей (блокировка event loop
  растёт с объёмом сейвов).
- F47. Глубокое toEqual round-trip есть только на тривиальной фикстуре (пустые
  массивы); populated 128×1366 сейв через save/load ни один тест глубоко не сверяет.
- F48. **Заглушки 1836/2000 — живые и битые** (усиливает F38): (а) шкала 0-100 vs
  канон 0-1 в testRegion.ts → формула ВВП завышает ×~10 000 (Zod 1946 это ловит,
  заглушки идут мимо Zod); (б) столицы по чужим кодам: СССР → «Baku», UK →
  «Kuzbass» (регион СССР); только USA случайно совпал; (в) testRegions — калька
  зон Германии/Китая 1946 для «1836» и «2000». Ни одного теста на эти сценарии.
- F49. wars растут без прунинга (только .push, active:false навсегда) — новое
  наблюдение для сейва (сходится с F20); eventHistory — известный TODO.
- GameStore: один процесс = одна игра, /start и /load молча замещают чужую партию —
  известно и задокументировано (план 01:9-12), не устранено.
- Пробелы тестов: атомарность, битый файл, GameStore-перезапись, populated
  round-trip, сценарии-заглушки (0 тестов).

### Отчёт П8a (docs↔code drift) — ПРИНЯТ, сессия 2026-07-23

~148 материальных утверждений из 20+ доков и 13 планов: ~135 совпали, 13 расхождений
(2 высоких, 6 средних). **Общий вывод: докам верить МОЖНО** — ядро (LLM-контракт,
война, сейвы, команды, ресурсы, цели, локализация) совпадает с кодом до констант;
систематическая слабость — устаревание, не выдумки. Особые пункты (а)-(и): LLM_RULES
10/10, WAR 12/12, план 02 «конституция» закреплена исполняемыми fitness-тестами.
- F50 (ВЫСОКАЯ). **Фантомная фича lastTurnReport/NationalBriefing**: ARCHITECTURE и
  OBJECTIVES («Last updated 2026-07-16, реализован UI…») описывают контракт как
  сделанный — в main нет ни поля, ни компонента (grep=0 вне доков). Согласуется с
  TODO: срез 4 живёт на незамерженной bootstrap-линии. Доки зафиксировали
  незамерженную работу как свершившуюся.
- F51 (средняя×4): DIPLOMACY «санкции ничто не читает» — ложь (TradeTick режет
  экспорт, = F27); MAP_FEATURES ложный техдолг «pipeline отсутствует в типе» (есть);
  ECONOMY цитирует старый коэффициент 0.5 при факте 0.15 (тюнинг по доку ошибётся
  ×3.3) и устаревший вывод taxRate; шапки планов 05 («не начато» vs тело
  «реализовано») и 11 («остался Шаг 2b» — реализован) = F28.
- Низкие: WORLD 8 ресурсов с алюминием vs каталог 20 без него (противоречит
  принятому решению); AI_RULES «война→military» vs факт «доминирование игрока»;
  productionAllocation не документирован; сместившиеся line-refs; междоковое
  1500 vs 1366 регионов (= F30).
- H15 ПОДТВЕРЖДЁН: Country.name/shortName — plain string; док честен об этом.
- Не проверяемо статически: live Gemini, рантайм-баги плана 11 (A1-A3), поведение
  модели (2 spotlight-бита, 3 абзаца), историческая калибровка, числа прогонов.

## Фаза 0b — ИТОГ (матрица заполнена; supersedes раннюю таблицу выше)

| S | Поверхность | Статус | Кто/доказательство |
|---|---|---|---|
| S1 | Промт из состояния | аудит: находки | я (fixture-прогон, H2 runtime) + П2 |
| S2 | Валидация/применение ответа | аудит: находки (F1-F11) | П2, спот-чек мой |
| S3 | GeminiProvider | аудит: находки (H5, H6); live-вызов НЕ выполнялся | П2/я |
| S4 | Tick pipeline (13 тиков) | аудит: находки (F19-F26) | П3 |
| S5 | Гейт/advanceMonth | аудит: находки (F1, F13) | П2/П5 |
| S6 | Persistence | аудит: находки (F45-F47, F49) | П4 |
| S7 | Остальные routes | аудит OK (расхождений нет) | П5 |
| S8 | Клиент↔сервер контракт | аудит: находки (F12-F17, H7✔) | П5 |
| S9 | Client wiring | аудит OK | П5 |
| S10 | Map data contract | аудит: находки (F42-F43) | П9 |
| S11 | Shared типы/утилиты | аудит: находки (F23, F31, F41) | П3/П9 |
| S12 | Данные 1946 + Zod | аудит: находки (F35-F37) | П6/П4 |
| S13 | Заглушки 1836/2000 | аудит: находки (F38, F48) | П4/П9 |
| S14 | Python-пайплайн | аудит: находки (F33) | П6 |
| S15 | Тесты server | аудит OK: 679 passed, 1 skipped | я (прогон) |
| S16 | Тесты client+python | аудит OK: 92 + 9 + валидатор | я (прогон) |
| S17 | CI | аудит OK (ci.yml); doc-guardrails.yml не разобран детально | я/П8b |
| S18 | Конфиги | частично: vite proxy (F14), .mcp.json; launch.json не смотрели | П5/П8b |
| S19 | Docs↔code | аудит: находки (13 расхождений, F50-F51) | П8a |
| S20 | Прошлые аудиты | аудит OK: 42 позиции со статусами; eval 150/150 мной | П8b/я |
| S21 | Мёртвый код | аудит OK: полный реестр (F39-F40) | П9 |
| S22 | Безопасность | частично: точечно (no-auth задокументирован, ключ в URL); полный security-аудит НЕ проводился | все |
| S23 | Стоимость хода | baseline снят (3 фикстуры); $/телеметрия — Фаза 1 | я |
| S24 | Вопросы V1-V7 | вердикты ниже | я (синтез) |

Не закрыто (явно): live-вызов Gemini (ключ/квота); launch.json; doc-guardrails
детально; ~/.claude hooks (вне репо); populated save round-trip (нет теста);
рантайм 1836/2000 дальше старта.

## Вердикты V1-V7 (формат: статус · доказательство · качество/риск · соответствие докам)

**V1 Что делает LLM:** end-to-end (ручной copy-paste + авто-Gemini) · runtime (мой
прогон processResponse + integration-тесты) · получает пересобираемый из состояния
промт, возвращает нарратив + ≤20 капованных действий 11 типов; 9 реально мутируют мир,
annex/puppet — «применённые-пустые» (H1); её title/descriptions становятся историей
мира · LLM_RULES совпадает 10/10.

**V2 Что работает без LLM:** вся симуляция — 13 детерминированных тиков, 120 мес /
128 стран / 1366 регионов за 1.2 сек · runtime (мой прогон + campaignSmoke) · НО ход
через API заблокирован гейтом без ответа LLM (осознанный дизайн); ИИ-страны действуют
(аустерити/угрозы/войны миноров), но мир не заключают и major-войны не начинают —
только LLM · соответствует докам.

**V3 Хранение состояния/чисел:** все числа у движка в одном GameState (plain data,
in-memory, одна игра/процесс); сейв = JSON-слот ~1.1-1.5МБ, autosave каждый ход,
version=3 без миграций · runtime + тесты · риски: неатомарная запись (F45), битый файл
роняет listSaves (F46), unbounded eventHistory/wars (F20/F49) · план 01 совпадает.

**V4 Контекст на ход:** промт пересобирается каждый цикл, истории сообщений НЕТ;
~2-2.6k ток старт → ~3.3-4.4k ток к 10 годам + ~1.1k ток схемы; в промте не «весь
мир», а игрок+10 major+5 spotlight+войны+факты+летопись+5 событий+intent (~18 стран
из 128) · fixture-baseline (3 точки) · рост — только Chronicle (линейно, без капа);
output/thinking — UNKNOWN (телеметрии нет, F/H5); Instructions 4.5k chars = 43-58%
промта — статичный кандидат на context-cache · докам соответствует.

**V5 Последовательность событий («блокада Тайваня меняет исход»):** механизм ЕСТЬ и
правильный по фундаменту — промт строится ТОЛЬКО из состояния, изменённое состояние
меняет все будущие промты; + pendingWorldFacts (движок детектирует пороги), + 6 hinge
points 1946-53 (подсказки с предусловиями, не рельсы), + Chronicle/Recent (память
причинности), + intent «спекулятивное = канон» · статический код + мой runtime H2 ·
НО: покрытие тонкое — самой механики «блокада» нет (морской войны нет вообще),
переворот/распад/объединение LLM выразить не может (нет действий), консистентность
нарратив↔мир не проверяется (H1), каталог развилок 6 записей до 1953 · доки честны.

**V6 Ограничение галлюцинаций:** сильное против чисел — LLM не источник ни одного
числа мира (движок владеет всеми), структурная цепочка schema→envelope→per-action
Zod→applicability→капы, Country IDs против выдуманных id (регрессия SOV/ROM закрыта),
запрет стран вне списка · тесты + код · слабое против нарратива — рассказ не
сверяется с состоянием (нарративная аннексия, F1: success при 100% reject) · докам
соответствует.

**V7 End-to-end vs заглушки:** end-to-end — сценарий 1946 целиком (данные→игра→
LLM-цикл→тики→сейв→HUD) · заглушки/пустоты: annex/puppet no-op; 1836/2000 достижимы
и битые (F48); save/load без UI (H7); Map Features декоративны (иконки не различаются,
mine/factory/port не генерятся); units не воюют (F19); переворотов/миграции/морской
войны нет; NationalBriefing — фантом доков (F50); леджер уведомлений отсутствует.

## Вердикты по крупным прошлым решениям

ПОДТВЕРЖДАЮ: Zod-контракт+капы+гейт (работает, оттестирован); детерминированное ядро
без Math.random (образцово, закреплено arch-тестом); ручной цикл как независимый от
ключа путь; расслоение данных 1946 (core/state/names) + двойная валидация;
SAVE_VERSION-отказ без миграций (адекватно стадии); фиксация языка на старте партии;
единый каталог ресурсов TS↔Python.
СОМНЕВАЮСЬ: единственный провайдер Gemini без телеметрии/ретраев (H5/H14 — хрупко и
слепо по цене); Spotlight-ротация равномерно по id (Андорра-эффект — форс-нарратив
про микространы); «один ответ LLM разблокирует N месяцев» (H11 — размывает
«LLM-главный двигатель»); состав HISTORICAL_TIERS_1946 (уже под сомнением
пользователя — данные подтверждают абсурд CHN-major/TWN-нет).
ПРЕДЛАГАЮ ПЕРЕСМОТРЕТЬ: unbounded eventHistory + descriptions без лимита (сейв
раздувается — миссия прямо запрещает); отсутствие DTO-границы API (промт в каждом
/game/state); достижимость битых 1836/2000 из UI; отсутствие механизма завершения
войн без LLM (вечные войны).

## Гейм-дизайнерский срез (по запросу пользователя, вход Фазы 2)

Карта: 1366/128, MapLibre, **8 режимов реализовано** (pol/eco/inf/sta/pop/res/dip/mil
с легендами, пороги по перцентилям живых данных — mapModeColors.ts); клик→инспектор,
подписи стран, перекраска владения/оккупации. Слабости: 34МБ+re-fetch на ход (F43),
Map Features визуально неразличимы кроме столицы, mil-режим = «оккупирован?», нет
LOD/флагов/двухуровневых границ. Карта = витрина состояния, не пространство приказов.
Механики (глубина v1): экономика доли+долг+инфляция (ВВП не падает); ресурсы 20 видов
депозиты/добыча/истощение; торговля мировой пул+эмбарго+валютные зоны(7); исследования
домен-тиры без каталога (сигнал игроку слаб — «no notable tech» 2 года); население
без миграции; война сухопутный фронт/оккупация/warScore/репарации, units декоративны,
моря нет; дипломатия отношения/альянсы(идеология)/гарантии-втягивание/санкции/сферы;
политика 4 оси, перевороты только как факт; ИИ аустерити/угрозы/войны миноров
(majors пассивны); цели игрока + рейтинг; событийной системы нет (события = записи LLM).
Концепт PROJECT.md не реализован в частях: каталог Map Features (десятки типов),
автостроительство, климат, транспорт, 1836/2000/2100, 150+ стран, «десятки тысяч фич».
ГЛАВНЫЙ ДИЗАЙН-РАЗРЫВ: мир-аквариум живёт, игрок — зритель с 3 рычагами (интент-текст,
бюджет-слайдеры, research-фокус); обратная связь хода отсутствует (F50 фантом);
решения игрока редки и не имеют трения/цены. Вопрос Фазы 2: «где игра?»

### П10 (meta): слепые зоны самого аудита — частично закрыто, сессия 2026-07-23

ДИРЕКТИВА ПОЛЬЗОВАТЕЛЯ (2026-07-23): «внешку» дальше не проверять — дизайн на
переработке; фокус — backend. UI-находки ниже остаются в реестре как факты.

Закрыто живым прогоном (HTTP E2E на :57503 + UI E2E через vite-proxy на idle-сервер
:3000; ВАЖНО: preview-инфра запускала процессы из ОСНОВНОГО checkout — код идентичен
worktree, оба на a2b9768 clean):
- Полный цикл продукта ЖИВ: scenarios→start(USA/1946)→409-гейт→prompt(7816 chars,
  == fixture B1 байт-в-байт)→response applied→next-turn(months=3)→дата 1946-04,
  autosave создан. Высшая ступень доказательности для ядра.
- F52. LLM может действовать ЗА страну игрока: в server/src/llm/ ноль упоминаний
  playerCountryId — никакой защиты агентности игрока (война/research_shift от имени
  игрока валидны). Дизайн-вопрос Фазы 2.
- F53. Сервер слушает 0.0.0.0 (netstat, PID 8868) — LAN-экспозиция без auth
  (README предупреждает, но bind не сужен до 127.0.0.1 — 1-строчный фикс).
- F54. XSS-вектор через LLM-текст ОТСУТСТВУЕТ (0 dangerouslySetInnerHTML/innerHTML
  в client/src; React экранирует). Закрыто.
- F55. Атрибуции geoBoundaries (CC BY 4.0) нет в клиенте — обязательна перед любой
  публикацией. Юр-гигиена.
- F56. Выбор страны УЖЕ сгруппирован по тирам (TODO-жалоба «плоский список кодов»
  устарела); витрина тиров подтверждает абсурд состава: ARG/BRA/CAN «★Великая
  держава», TWN — в «малых государствах (92)».
- F57. F13 подтверждён дословно в UI: toast «Ошибка хода», полезная инструкция — 
  только в консоли; пилюля гейта работает («ЖДЁМ ОТВЕТ LLM·ХОД 0»→«ХОД ГОТОВ·ХОД 1»);
  toast не автоскрывается. F1 виден игроку честно («Применено действий: 0»).
- F58. Идемпотентность: повторный POST того же ответа → success (F2 живьём);
  llmContext едет в каждом /next-turn (1.32МБ ответ; F12 живьём).
Инциденты аудита: (а) autosave.json в main checkout перезаписан/создан моим
прогоном (в каталоге был только мой файл; существовал ли пользовательский до —
UNKNOWN); удаление заблокировано классификатором — оставлен, пользователь уведомлён;
(б) тестовая партия в памяти PID 8868 до рестарта. Временные файлы worktree
(vite.audit.config.mts, правка launch.json) откачены — git status: только ledger.
Browser pane held hidden (скриншоты недоступны — тот же режим, что в TODO про Срез
2г) — проверка шла по DOM/сети/консоли.

Осталось из слепых зон (backend): марафон 1946→2000 (ниже, П11); live Gemini
(нужен ключ — замер output/thinking токенов); eval-harness КАЧЕСТВА игровой LLM
(нарратив/следование правилам — главная неизмеренная поверхность, кандидат в план);
populated round-trip (закрою в П11); adjacency-качество графа соседей (П11);
память процесса на длинной кампании; происхождение relations→война (П11).

### П11 (backend-марафон 1946→2000, чистый движок) — ЗАВЕРШЁН, сессия 2026-07-23

Метод: 648 месяцев × (generatePrompt → processResponse с ПУСТЫМИ actions →
simulateMonth), seed 12345, player USA; изолирует собственную динамику движка от
LLM-действий. Скрипты в scratchpad (marathon/debt-check), полный вывод —
marathon-out.json.
- F59 (ФУНДАМЕНТАЛЬНАЯ). **Мир без LLM дипломатически инертен**: за 54 года 0
  созданных relations-ключей, 0 rivals, 0 войн (правило D не срабатывает никогда —
  ему не с чего). Стартовых отношений в данных 1946 НЕТ вообще (пусто у всех 128).
  Вся геополитика существует только если её инициирует LLM; движок лишь развивает
  уже созданные связи. «Холодная война» должна самозародиться из нарратива.
- F60. **Долговая спираль — эксклюзив игрока**: к 1970 ровно одна страна с
  долгом>1×ВВП — USA (25.6×), к 2000 — 625× ВВП (133 838 млрд при ВВП 214);
  все 127 ИИ-стран здоровы (аустерити правила A работает и гасит долг: медиана
  0.69× в 1948 → 0 к 1970). Последствий долга нет (дефолт — одноразовый
  pendingWorldFact). Бездействие игрока = зомби-государство без наказания и без
  игровой реакции.
- F61. **Демографический взрыв**: население мира ×9.2 за 54 года (2 252→20 763
  млн; реальный 2000 ≈ 6 000). campaignSmoke сторожит только ВЫМИРАНИЕ (≤2%/год),
  взрывной рост не сторожится — тест-слепота, калибровка рождаемости сломана
  в обе стороны (ранее чинили падение — перечинили в рост).
- F62. Тех-сигнал: первый T1 у мажоров — 1954 (8 лет тишины), T2 1964, T3 1978,
  T4 1994. Столетний темп осмыслен, стартовая глухота подтверждена числом.
- F63. Закрыто эмпирически: populated round-trip (1 379 215 байт) РАВЕН байт-в-байт
  после save/load (пробел F47 снят для текущего формата); NaN/Infinity после 648
  мес: 0. Численная дисциплина движка образцовая.
- F64. Граф соседей: 143/1366 регионов (10.5%) полностью изолированы (0 соседей —
  острова: нет морских связей) → принципиально недостижимы для войны и соседских
  механик; висячих ссылок 0; медиана степени 4, max 16. Великобритания/Япония —
  проверить принадлежность к изолированным (кандидат: сухопутная война с ними
  невозможна вообще).
- Размер/производительность: state 1.32→1.39МБ (без LLM-текстов), промт
  7.9k→9.5k chars, 648 месяцев симуляции ≈ 6.8 сек. Инфраструктурного потолка
  для «долгих кампаний» нет — потолок целиком в балансе/данных.

## Фаза 1 — research-вопросы (сформированы из находок; статус: на утверждении)

Трек A — Pax Historia (первоисточник болей):
A1 что делает LLM на ход (вызовов/что в промте — весь мир?) ↔ наш V4;
A2 хранение мира/чисел (движок или LLM-выдумка) ↔ наша боль «выдуманные числа»;
A3 обработка действий игрока (свободный текст? валидация?) ↔ intent+Zod;
A4 память между ходами/долгие кампании ↔ Chronicle;
A5 реестр жалоб игроков (рельсовость «Чан Кайши», непоследовательность, цена) —
   «что не повторяем»;
A6 цена хода/модель монетизации — ориентир для нашей стоимости;
A7 холодный старт мира (стартовые отношения/сценарный сетап) ↔ F59.

Трек B — аналоги (4-8, отобрать в разведке): кандидаты — WorldSim (Nous),
AI Dungeon (постмортемы памяти/консистентности), Cicero/Diplomacy (разделение
движок↔язык), Generative Agents (Stanford; память/рефлексия), LLM-моды стратегий
(RimGPT, CK3/Stellaris-моды), свежие LLM-grand-strategy проекты 2024-2026.
По каждому: что делает LLM / что движок; формат и валидация команд; память;
цена; известные провалы. Критерий включения — применимость к Geopolis.

Трек C — практики/технологии (кластеры → находки):
C1 Gemini: тариф gemini-3.1-flash-lite (дата!), биллинг thinking-токенов, context
   caching (кэшируемы ли статичные 43-58% промта+схема) ↔ V4/H5/F11;
C2 надёжность structured output + retry-паттерны при невалидном ответе ↔ H14/F1;
C3 идемпотентность LLM-циклов (двухфазный commit промт→ответ) ↔ H2/F2/F11;
C4 action space для «больших» событий (переворот/распад/объединение) — каталог
   команд vs freeform vs hybrid ↔ V5/F26/H1;
C5 датасеты стартовой дипломатии 1946 (Correlates of War, ICOW и т.п.) ↔ F59;
C6 память длинных кампаний: иерархическая суммаризация vs retrieval vs reflection;
   цена ↔ Chronicle/H4;
C7 event sourcing/снапшот+лог для игрового состояния, компакция, миграции сейвов ↔
   F20/F45/F49/version-отказ;
C8 калибровка макро-моделей в grand strategy (популяция/долг): полы-потолки,
   guard-тесты, постмортемы Paradox ↔ F60/F61/F21;
C9 смешанный язык (EN-промт → RU-вывод): влияние на качество, практики ↔ locale;
C10 консистентность нарратив↔состояние (post-hoc валидация, constrained narration)
    ↔ V6/H1;
C11 токен-телеметрия/бюджетирование p50-p95 ↔ H5/S23;
C12 морская смежность/sea zones в region-графах: подходы+датасеты ↔ F64;
C13 eval-harness игровых LLM-фич (фреймворки, локальные практики) ↔ «главная
    неизмеренная поверхность»;
C14 мульти-провайдер/фолбэк (OpenRouter, локальные модели) — TCO без смены стека ↔
    единственный Gemini.

План исполнения: 5 субагентов-разведчиков (A: Pax Historia; B: аналоги; C1-C3+C11+C14:
LLM-инфраструктура; C4+C6+C9+C10+C13: контекст/память/eval; C5+C7+C8+C12: данные/
хранение/калибровка) → синтез мой. Каждое утверждение — с градацией источника
(первичный/вторичный/маркетинг/anecdote/inference/неизвестно) и датой доступа;
конфликтующие свидетельства показывать. Итог: research-отчёт «чему учимся / что
не повторяем / что берём с полки» с ценой внедрения. СТОП-ТОЧКА после синтеза.

### Фаза 1, Трек A (Pax Historia) — отчёт ПРИНЯТ, 2026-07-23

PH = YC W2026 (Bullock-Papa/Zhang), 35k DAU, «100B+ токенов/неделю» [П/М].
Архитектура [В/И — research-док Pax-Automata + vgtimes 26.02.2026]:
- «Прыжок времени» вместо хода: действия/чаты бесплатны, токены списываются при
  jump (неделя—год). 8 категорий промтов (Chat/Advisor/Jump/Auto-Jump/Actions/
  NextSpeaker/Description-to-Action/EventConsolidator) — серия специализированных
  вызовов, не монолит. Контекст = текстовое описание карты + сводки батальонов +
  история событий.
- Числа: ГИБРИД — карта/батальоны структурные (~1000 регионов), экономика — чистый
  нарратив БЕЗ чисел вообще («укрепились связи. Это всё») [В+А]. Рассинхроны:
  новый «Константинополь» вместо переименования, захваты ломаются к ~40 ходу,
  территория отошла «экономически» без войны [А×3].
- Валидации действий НЕТ: свободный текст, «легко уговорить на что угодно»,
  «prompt engineering dressed up as grand strategy» [В]. Рельсовость признана
  их же wiki («tends to railroad») [П].
- Память: с 15 раунда суммаризация событий чанками по 5 раундов (Event
  Consolidator); к ~80 раунду контекст ~100k ток; советник отключается при
  переполнении [В/И+А].
- Экономика продукта: free 0.2 токена/день (кап 1.2); тиры Light/Pro/Max
  (Gemini Flash/3.0 Flash/2.5 Pro ≈ 0.002/0.02/0.07 токена/ход НА СТАРТЕ);
  **стоимость прыжка РАСТЁТ с раундом: ~0.52 → ~32 токена к 250-му** [В/И];
  «$1 сгорает за 15-20 мин» [В]; «20 руб/ход» [А]. BYO-key подписка Patron
  ЗАМОРОЖЕНА после урезания Google API-лимитов [В DTF 07.03.2026] — прецедент
  зависимости монетизации от провайдера. UGC-пресеты (4000+) с роялти 10%.
- Холодный старт: пресет = карта+акторы+нарративный historical context; никакого
  журнала договоров/структурной дипломатии нет вообще [В]; стартовые отношения —
  видимо только текстом [И, низкая уверенность].
Реестр жалоб (15 категорий с цитатами в транскрипте агента): рельсовость,
шиза/зацикливание моделей, игнор/зеркаление приказов, податливость, рассинхрон
карта↔нарратив, экономика без чисел, деградация длинных кампаний, «бесплатная
модель — рыгня», цены, откат прогресса без возврата токенов, прожорливый советник,
латентность thinking-моделей, гео-блоки/VPN, заморозка Patron, нет реестра договоров.
Неизвестное: точное число вызовов/прыжок, схема вывода, структурные стартовые
дипсети, EN-Reddit-цитаты (сабреддита нет), wiki 403.
ВОПРОСЫ ПОЛЬЗОВАТЕЛЮ (задать после всех разведок): 1) сколько генераций видно за
прыжок; 2) противоречия текст↔карта — частота/модели; 3) что ломается первым после
~40-80 хода и растёт ли цена прыжка; 4) стартовые альянсы в UI или только текст;
5) реакция на невозможные действия («авианосец в 1200»); 6) видны ли числа
армий/экономики и стыкуются ли между прыжками; 7) рельсы реальной истории — зависят
ли от тира модели; 8) Patron: что давал/что после заморозки/менялись ли цены.

### Фаза 1, Трек B (аналоги) — отчёт ПРИНЯТ, 2026-07-23

8 профилей: Cicero (Meta/Diplomacy) · AI Diplomacy (Every, 2025) · WarAgent
(arXiv 2311.17227) · Generative Agents (Stanford) · AI Dungeon (Latitude) ·
Voices of the Court (мод CK3) · WorldSim (Nous) · RimWorld LLM-моды
(RimTalk/RiMind). Отброшены с причинами: AI People, char.ai-персоны, GPS2026
(не LLM), WebSim, research-репо без пользователей и др.
Кросс-уроки (полные — в транскрипте агента):
1. Архитектура «движок владеет миром, LLM — голос» подтверждена трижды (Cicero,
   VotC, RimWorld-моды); обратные (WorldSim, Smallville, AI Dungeon) = дрейф и
   «тысячи долларов». Для нас — уже сделано.
2. Схемы мало — нужны ПРЕДУСЛОВИЯ (WarAgent secretary: whitelist 7 действий +
   логика «союз, который не предлагали», ≤4 ретрая); отклонения = метрика модели,
   не краш (AI Diplomacy). Цена низкая-средняя. ↔ наши F3/H14.
3. Память кампании = дневник + периодическая консолидация ДЕШЁВОЙ моделью
   (AI Diplomacy: годовая суммаризация Gemini Flash; AI Dungeon 2026: память и
   автосуммаризация — независимые слои после ~4 переделок). ↔ Chronicle.
4. Отбор в контекст по recency+importance+relevance и ТЕСТИРОВАТЬ retrieval —
   главный класс ошибок Smallville («failed to retrieve relevant memories»).
5. Числа токсичны для LLM-памяти (AI Dungeon «memory poisoning»; WarAgent: точность
   решений о войне 54.6%): LLM не хранит/не выводит числа — категории/тренды.
6. Консистентность нарратив↔состояние — сравнением каналов (AI Diplomacy
   lie-detection: сообщения vs дневник vs приказы; Cicero: 7% мимо intent ДАЖЕ с
   ансамблем фильтров → несколько % расхождений = норма, нужен фильтр). ↔ V6/H1.
7. Состояние в промт — компактными таблицами с per-country видимостью (WarAgent
   «Board and Stick»: мультитёрн → сингл-тёрн).
8. Экономика: минимум две модели (дорогая — вызов цикла, flash — суммаризация) +
   каскад fallback (RiMind); DeepSeek-класс ~200× дешевле reasoning-топов.
9. Approval-окно для тяжёлых команд (VotC Action Approval «safety valve») —
   продуктовая развилка пользователю. ↔ F52.
10. Анонимизация стран в eval-прогонах (WarAgent) — проверять альтернативность
    истории, не пересказ учебника. ↔ C13.
UNKNOWN: статус WorldSim 2025-26, тарифы AI Dungeon 2026, независимые замеры
RimWorld-модов, цена инференса Cicero.

### Фаза 1, Трек C-контекст (C4/C6/C9/C10/C13) — отчёт ПРИНЯТ, 2026-07-23

C4 (крупные события): эталон = наш же паттерн propose→validate→apply; даже свежая
Orchestrated Reality (arXiv 2606.16014, 2026) НЕ решает создание/распад сущностей.
Рекомендация: НЕ строить generic-событие; добавить 2-4 узких параметризованных
типа команд (dissolve_state/form_union/…) с движковыми пре/пост-инвариантами;
LLM-repair-вызов не внедрять — движковый downgrade до no-op (как «hold» в
Diplomacy-харнессе: невалидных приказов 6-14% даже у топ-моделей). SINE:
«repair iterations центральны, grammar masking сам по себе — нет».
C6 (память): летопись = признанный паттерн (recursive summarization, arXiv
2308.15022; AI Dungeon пришёл к тому же после ~4 переделок). LoCoMo: больше
сырой истории БЕЗ retrieval может ухудшать (context dilution). Reflection-вызов
не внедрять (цена+нарушение «движок владеет фактами»); retrieval-слой НАД
летописью — опция средней цены. AGA (arXiv 2402.02053): замена вызовов выученными
политиками → 31% стоимости — направление для ИИ-стран, не для нарратива.
C9 (язык): промт на русский НЕ переписывать (EN-инструкции не хуже, риск в
выводе: code-switching/тон/локальные форматы). Действия: locale-constraints в
промте + RU-eval-чек + убедиться, что даты/числа в JSON идут от движка
(у нас так — числа не от LLM). Точные проценты штрафов — grade inference.
C10 (нарратив↔состояние): шипнутых игр с runtime-NLI НЕ НАЙДЕНО (мы были бы
первыми). NLI/ConFactCheck-класс — 4-5 вызовов, AUC-PR 0.66-0.86 — НЕ брать.
Первая линия: детерминированный NER/whitelist на движке («сущности текста ⊆
сущностям состояния» — наша задача ЗАМКНУТАЯ, проще академической), находки
логировать, не блокировать; запасной — 1 дешёвый бинарный вызов-верификатор.
C13 (eval): **promptfoo** (MIT, TS/Node, локальный; куплен OpenAI 2026-03-09 —
код открыт, риск дорожной карты отмечен) + golden-fixtures «N состояний × M
прогонов × asserts» (детерминированные — масса, LLM-judge — только субъективное)
+ приём «Critical State Analysis» из Diplomacy-харнесса (реплей одного хода
30-120×, ~1/80 стоимости кампании, эксперимент ~$10). deepeval — мимо стека;
LangSmith/Braintrust self-host = Enterprise-only (конфликт источников разрешён
по первичным докам).
Мета-предупреждение агента: ни одна работа не тестировалась на масштабе «тысячи
регионов» (все ≤25 агентов/5 тестеров) — переносимость = экстраполяция.

### Фаза 1, Трек C-инфра (C1-C3, C11, C14) — отчёт ПРИНЯТ, 2026-07-23

C1 Тариф gemini-3.1-flash-lite [ПЕРВИЧНЫЙ ai.google.dev/pricing, 2026-07-23]:
input $0.25/1M, output $1.50/1M «including thinking tokens»; cache-чтение
$0.025/1M, cache-storage $1.00/1M/час; Batch ×0.5. **Наш цикл ≈ $0.0025/ход →
$1.62 за кампанию 648 ходов** (4k in/1k out); implicit-кэш в лучшем случае $1.13.
Explicit-кэш ДЛЯ НАШЕГО редкоходового профиля НЕВЫГОДЕН (storage-безубыток ≈146
часов суммарной жизни кэша; месяц хранения $2.41 > вся кампания). Вывод: цена —
НЕ проблема Geopolis; оптимизация кэшем не оправдана, дешевле сократить
Instructions/проверить thinkingLevel. Free-tier RPM/RPD: Google убрал статическую
таблицу — смотреть в AI Studio консоли (вторичные источники противоречат:
15RPM/1000RPD vs 30RPM — оба неподтверждённые).
Thinking: биллится как output по той же ставке; high vs low НЕ квантифицировано
нигде — только эмпирически через thoughtsTokenCount (совпадает с нашей
instrumentation-задачей). responseSchema-в-input и кэшируемость схемы — UNKNOWN
(community-правило без первоисточника). Минимальный префикс implicit-кэша для
flash-lite ОТСУТСТВУЕТ в официальной таблице.
C2: официальных цифр невалидности structured output НЕТ; JSONSchemaBench (arXiv
2501.10868, старые модели): compliance 0.07-0.86 в зависимости от СЛОЖНОСТИ схемы
— наша простая схема в благоприятной зоне; «retry SAFETY 2-3 раза» — блог-миф,
на первичных страницах не найден. Community-паттерн: repair-loop ≤2-3 попытки.
C3: индустриальный паттерн 1:1 с нашей нуждой — idempotency key на ход, «спросить
LLM» чистая операция, «применить» — транзакция ≤1 раза (закрывает F2/F11 дизайном).
C11: usageMetadata отдаёт всё нужное (promptTokenCount/cachedContentTokenCount/
candidatesTokenCount/thoughtsTokenCount/totalTokenCount) — 30-строчный самодельный
JSONL-логгер + перцентили скриптом; npm-обёртки не оправданы (и был чужой баг
суммирования thinking — simonw/llm-gemini#75, anecdote).
C14: gpt-5.4-nano $0.00205/вызов — паритет с Gemini, строгая схема есть; DeepSeek
V4-Flash $0.00084 и Qwen-Turbo $0.0004 — дешевле, но БЕЗ строгой json_schema
(только json_object → нужен наш repair-слой); OpenRouter — наценка непрозрачна;
Ollama grammar-constrained — синтаксис гарантирован, но официальное предупреждение
о просадке качества «creative/reasoning» задач + RU-качество = UNKNOWN (нет
бенчмарков). Наш интерфейс LLMProvider — достаточная точка расширения; работа =
маппинг схем + repair-слой для нестрогих провайдеров.

### Фаза 1, Трек C-данные (C5/C7/C8/C12) — отчёт ПРИНЯТ, 2026-07-23. Разведка ЗАВЕРШЕНА (5/5)

C5 (стартовая дипломатия 1946): рекомендация — ATOP 5.1 (типы обязательств союзов)
+ COW Formal Alliances v4.1 как сверка → стартовые allies/relations; rivalry-датасеты
Thompson/Klein-Goertz-Diehl через R-пакет peacesciencer (GPL-2) → стартовые rivals
(две научные школы — списки могут расходиться, выбор задокументировать). Коды COW ≠
ISO3 (похожи, не идентичны — нужен конвертер cow2iso + ручная сверка ~130 строк:
оккупированные/разделённые — продуктовые решения). ⚠ ЛИЦЕНЗИИ: COW — некоммерческое
использование, запрет пере-раздачи; CShapes 2.0 (GeoJSON границ 1886-2019) —
CC BY-NC-SA. Если Geopolis когда-либо коммерциализируется — это ограничение; данные
использовать как ИСТОЧНИК для ручной-авторской таблицы, не как встраиваемый датасет
(продуктовая развилка). Сферы влияния/оккупации 1946 — датасета НЕТ, ручной список
~10-20 записей (Truman Library map + Wikipedia как отправные точки).
C7 (хранение): снапшот ОСТАВИТЬ (event sourcing не брать — усугубит рост журналов);
атомарность = write-file-atomic (пакет самого npm) ЛИБО своя ~15-строчная
tmp+fsync+rename; миграции = массив {version, migrate}[] чистых функций + golden-
тесты на фикстурах прошлых версий; модель Factorio (стабильность + редкие явные
разрывы), АНТИпример Paradox (тихие поломки, патч 1.30.5 портил сейвы безвозвратно).
Журналы: отдельный append-лог с ротацией вместо роста внутри главного файла.
C8 (калибровка): население — логистический рост Ферхюльста с ёмкостью K(еда/
инфра/тех) вместо экспоненты (лечит F61 системно, не заплаткой); долг — softcap
через risk premium (ставка растёт с долг/ВВП, r-vs-g спираль) + РЕАЛЬНЫЕ последствия
дефолта (лечит F60); guard-прогон 50+ лет в CI с порогами (население ≤X%/год,
долг/ВВП ≤Y) — закрывает тест-слепоту campaignSmoke. Мета-урок Vic3 (сообщество:
«fundamentally broken», Paradox добавила переключаемую калибровку 1.4.4): важнее
МЕХАНИЗМ перекалибровки (параметры снаружи + guard-тесты), чем идеальные числа.
C12 (море): дешёвые паттерны — HOI4 «пролив = сухопутный чекпоинт» + Vic2/3
«блокада = presence-check флота» (булевы гейты, БЕЗ морского боя); формат данных —
EU4 adjacencies.csv ([regionA, regionB, throughOceanId]); генерация — разовый
offline Python-скрипт (searoute-py MIT / свой Дейкстра по нашим 124 ocean-фичам) →
статичные данные, не рантайм-зависимость. Лечит F64 (143 изолированных острова).
Конфликты/UNKNOWN: лицензии ATOP/ICOW дословно не найдены; производительность
geojson-dijkstra на 1366×124 не тестирована; «Monte-Carlo Simulation Balancing» —
только заголовок; marnet-данные Eurostat — лицензия предположительно CC BY 4.0.

СЛЕДУЮЩИЙ ШАГ: вопросы пользователю по PH (см. Трек A) → синтез → research-отчёт
(«чему учимся / не повторяем / берём с полки») → СТОП-ТОЧКА.

### Фаза 1, Трек A — АПГРЕЙД ДО ПЕРВИЧНОГО ИСТОЧНИКА (2026-07-23)

Пользователь предоставил: (1) полный system prompt PH (jump-промт, D:\System Prompt
PH.txt — сохранена копия факта, сам файл вне репо); (2) пример пользовательского
${HISTORICAL_PRESET_SIMULATION_RULES} (Cold War 1946-91); (3) ответы участника на
4 вопроса. Обещан полный сетевой запрос игры (для замера payload в токенах).
Подтверждено ДОКУМЕНТОМ [П]:
- Промт шлёт КАЖДЫЙ прыжок: полное описание карты (${GRAND_MAP_DESCRIPTION_NO_CITY}
  — «every polity, region, and most map features»; по опыту пользователя ~3000-4000
  Map Features ВСЕГДА) + ВСЕ прошлые действия игрока за всю партию
  (${PLAYER_EVERY_ACTION_NOT_PREVIOUS}, накопительно) + консолидированные события +
  сырые чаты неконсолидированных раундов. Деградация длинных кампаний у PH —
  архитектурная (контекст растёт с историей), пользователь видит её «сразу».
- Структурное состояние = ТОЛЬКО карта: polity(name,color,flag) + regions + map
  features (в т.ч. battalion-теги). Экономики/чисел в движке НЕТ вообще; события =
  headline+description+map changes, 10-15 на прыжок «STRICTLY».
- Матчинг по ИМЕНАМ: «everything read by the code must be its EXACT original name»
  (регионы/фичи перечислены строкой через запятую) — класс ошибок, который Geopolis
  закрыл Country-IDs секцией после регрессии SOV/ROM.
- Рельсовость — ИНСТРУКЦИЕЙ: «events that the player doesn't proactively attempt
  to change... should always occur» — «Чан Кайши всегда сбегает» это дизайн, не баг.
- Player agency guard — В ПРОМТЕ: «Never execute actions FOR the player... If the
  player DIDN'T make any actions, DON'T simulate ANY actions for the player» —
  PH защищает агентность игрока текстом; у Geopolis такой защиты нет НИГДЕ (F52) —
  перенять на уровне ВАЛИДАТОРА, не текста.
- Пресеты = пользовательские псевдо-движки в промте: стаунтые категории держав со
  статами /100, порогами промоции, бюджет /100, боевая сила В ИМЕНИ юнита
  («Italian Armed Forces (15/20)»), би-ануальные отчёты — всё это ДОЛЖНА вести
  сама модель. Ответ пользователя: «все модели, кроме самых дорогих, их выдумывают».
Ответы участника [П-участник]: (1) стартовая дипломатия — только из текста промта
(historical → «по истории»), структурной нет; (2) числа живут в Map Features и
событиях, выдумываются всеми моделями кроме топовых; (3) валидации нет — «за
Лихтенштейн-2016 за пару ходов объединил Центральную Европу дипломатией»;
(4) длинные кампании: модель повторяет одни события в разных формулировках,
территории «передаются» текущему владельцу (движок PH выдаёт ошибку, НО СОБЫТИЕ
ОСТАЁТСЯ — их версия нашего H1, хуже), главная боль — накопление всех действий +
полная карта всегда.
Следствие для синтеза: боли-первоисточники Geopolis подтверждены на уровне
дизайн-документа конкурента; ставка «агрегаты вместо полного мира + ID вместо имён
+ числа у движка + развилки-подсказки вместо рельс» бьёт в каждую из них адресно.

### Фаза 1, Трек A — ИЗМЕРЕННЫЙ PAYLOAD PH (первичные артефакты, 2026-07-23)

Пользователь дал полный треугольник: запрос (D:\Полный запрос PH.txt), схему
structured output (D:\json схема.txt), ответ модели (D:\Ответ модели.txt).
Замеры (wc -c): запрос раунда 1 (МИНИМУМ: без истории/действий/чатов) =
**53 503 байт ≈ 13-14k ток** (941 регион, ~150 polities с регионами ПО ИМЕНАМ
строками, батальоны с силой в имени, моря); схема = **23 867 байт ≈ ~6k ток**
на каждый вызов (7 типов mapChanges в anyOf, strict, propertyOrdering → диалект
Gemini ПОДТВЕРЖДЁН); ответ = 15 465 байт (10 событий RU ≈ 6-7k ток output).
Сравнение с Geopolis: вход PH раунда 1 ≈ 19-20k ток vs наш 3.5-5.5k (≈4-5×);
к ~80 раунду у них ~100k vs наш ~5.5k (≈20×); их output ~6-7k vs наш ~1-2k.
Улики в самих артефактах:
- Стартовые данные УЖЕ битые: «Brazilian Armed Forces (15/60)» числится в списке
  батальонов МЕКСИКИ; батальоны-персоны («Oscar Sigvald Julius Strugstad» у
  Норвегии, «Gösta Lilliehöök» у Швеции).
- Ответ модели передаёт КНДР регион Haeju, принадлежащий ПО КАРТЕ США — без
  войны и упоминания (класс «territory отошла молча», подтверждён документом).
- Name-chaining: transfer ссылается на polity по НОВОМУ русскому имени сразу
  после updatePolity — хрупкая цепочка переименований.
- Code-switching в RU-нарративе flash-тира: «newly formed ООН», «consultations
  regarding будущей интеграции» — живое подтверждение риска C9.
- Валидации магнитуд нет вообще: transferRegionOwnership без ограничений,
  dissolvePolity по имени.
Трек A закрыт полностью; исходники вне репо (D:\), в отчёте — только выжимки.

### Блок A.2 — ВОЙНА + МОРЕ (decision-блок, в процессе, 2026-07-23)

Перечитан живой war-код (WarTick/warScore/WarService/defines/war). Факты:
- Фронт = сухопутная смежность (neighboringRegionIds) + effectiveController;
  флип оккупации при перевесе силы >1.5×; сила = activePersonnel×combined-arms +
  equipmentPower×500 (armyStrength/navy/air = нули, ДЕКОРАЦИЯ, F19 подтверждён).
- Потери 10k×фронт-регионы; warScore −100..100 (флипы×15 + баланс потерь×40).
- makePeace (applyPeaceTerms): при |score|≥30 победитель аннексирует оккупированные
  регионы проигравшего (transferRegion меняет ownerCountryId), бюджет floor(|score|/25);
  иначе белый мир. + легитимность-штраф, репарации 10% казны, усталость при затяжной
  ничьей. Коалиции: авто-втягивание союзников/пуппетов/сюзерена/гарантов (1 уровень).
Дыры под game over-определение (из A.1):
- D1. Аннексия ≠ исчезновение: страна с 0 регионов ПРОДОЛЖАЕТ жить (нет «поглощения»).
  Прямой пробел под «game over когда страны не станет».
- D2. Мир заключает ТОЛЬКО LLM (makePeace из command peace) → вечные войны (H16),
  движок сам не завершает.
- D3. Моря нет (контакт только сухопутный) → 143 острова недосягаемы (F64),
  «блокада Тайваня» невозможна.
- D4. Units декоративны → флот не может воевать/десантировать даже при смежности.
- D5. Оккупация (occupiedBy) ≠ владение (ownerCountryId): оккупация всего ≠ поражение.
Трёхролевой разбор (эталон) + продуктовые развилки (game over-триггер, уровень моря)
вынесены пользователю. Глубина боя (абстрактный фронт без юнит-микро — запрет
пользователя) и движковое завершение войн — техрешение (рекомендация в тексте).
Sequencing войны: (1) units дают реальную силу (не декорация) → (2) движковое
завершение (капитуляция при разгроме + белый мир по истощению, чинит вечные войны) →
(3) game over-хвост: поглощение (0 регионов+капитуляция → страна исчезает; ИИ →
стык с A.3 осколки) → (4) море MVP (пролив-чекпоинт + десант/блокада presence-гейт).
Углубление (окружение/логистика/доктрины/морской бой флот-vs-флот) — позже.

### Блок A.2 — решения и уточнения (2026-07-23)

accepted:
- game over в войне = **капитуляция-событие**: движок при потере критической массы
  регионов выставляет факт «на грани капитуляции», LLM разыгрывает падение, полная
  аннексия → game over. Сопротивление/правительство в изгнании возможно до конца.
- Море = **полноценная морская война** (вариант 2), но СЛОЯМИ: (1) морской граф +
  честная сила флота + присутствие → достижимость островов+десант; (2) морской бой
  флот-vs-флот → господство; (3) конвои/блокада-экономика.
- Флот = абстрактная проекция силы (НЕ ручное вождение — следствие запрета микро):
  покрывает морские зоны у портов/побережья, при заморской войне движок авто-
  прокладывает морской путь (Дейкстра по морскому графу, searoute из C12); игрок
  задаёт намерение верхнего уровня. navyStrength = морская техника (destroyers/
  submarines УЖЕ в каталоге, домен naval) + флотский л/с. Нужно РАЗДЕЛИТЬ getEquipmentPower
  на сухопутную/морскую силу (сейчас всё в одно число). Морской бой = как суша
  (сила+случайность) в ocean-зонах → господство → гейты десант/блокада/конвои.
  Предложено (опц.): добавить carriers в EquipmentType (Тихий 1946). Флот-подход
  вынесен на подтверждение (техника из запрета микро).
- НУЖНО построить: граф морских зон (124 ocean-фичи не связаны; neighboringRegionIds
  сухопутные; isCoastal нет — TODO подтверждает isCoastalRegion()≡false). Offline-скрипт.

Развилка вынесена пользователю: УРОВЕНЬ случайности в бою. Факт: сейчас бой ПОЛНОСТЬЮ
детерминирован (флип при силе×1.5, 0 рандома; rngState не потребляется боем).
Рекомендация: сидированная (game.rngState, воспроизводимо) + ограниченная (модификатор
±% к силе, сила доминирует). Диапазон — выбор пользователя.
УТОЧНЕНИЕ пользователя: случайность для ОБОИХ боёв (сухопутный+морской), один
механизм; суша первична (уже в коде). accepted.

ИДЕИ, ПРЕДЛОЖЕННЫЕ МНОЙ по войне (proposed, наверстывание проактивности — принять/
отклонить при финализации плана войны):
- Терреновая асимметрия обороны (горы/река/пролив держат при меньшей силе; модификатор
  к порогу флипа по типу региона) — делает карту и «блокаду Тайваня» осмысленными.
  Кандидат в MVP.
- Мобилизация как рычаг игрока (экономика на военные рельсы: +сила ценой гражданской
  экономики/стабильности) — стык война↔экономика, решение с ценой в кризис.
- (в блок B) Ядерное сдерживание меняет поведение ИИ — ядерные избегают прямой войны.

МЕТА-УРОК (поведение дизайн-партнёра, зафиксировать для след. сессий): в A.1/A.2 был
слишком реактивен — аудировал код и выносил развилки, но НЕ приносил дизайн-идеи сам
(случайность боя намерена в Фазе 0, но подана только как плюс детерминизма, не как
дизайн-рычаг). Роль = ВЕСТИ и предлагать, не только спрашивать. Дальше: по каждой
системе приносить полный набор дыр+идей проактивно, пользователю — выбор и возражения.

### Блок A.2 — рода войск, флот, морские зоны (2026-07-23)

accepted: ширина случайности боя = **средняя ±25%** (оба боя, сидированная).

Новые темы (пользователь): авиация/ракеты, типы кораблей, производство, морские зоны.
Факт: сейчас все рода войск — слагаемые ОДНОГО числа силы (getEquipmentPower);
fighters/bombers есть, но воздушного превосходства нет; ракет нет.
Предложения мои (proposed):
- Глубина родов — **средний путь**: рода имеют ХАРАКТЕР (авиация→наступление/проекция,
  флот→море/десант, ПВО/укрепления→оборона, броня→прорыв), combined-arms бонус за
  баланс (УЖЕ частично: getCombinedArmsMultiplier); игрок задаёт производственный
  фокус, НЕ микро. Развилка вынесена (плоская/средний/rock-paper-scissors).
- **СЛОТЫ-ЭВОЛЮЦИЯ** (идея пользователя, развёрнута в принцип): техника = слот,
  эволюционирующий по tech tree/эпохе (капитал.корабль: броненосец→дредноут→линкор→
  ракетный крейсер; танк 1946≠2000, слот один). Решает эпохо-агностичность + «carriers
  не фича-1946, а слот, пустой в 1836». Слоты флота: капитал.корабль/авианосец/эскорт/
  подлодка, каждый эволюционирует по naval-домену. accepted как принцип.
- Против «100 линкоров»: сейчас лимит только бюджет. Рекомендация — **верфи (мощность,
  прибрежные регионы) + содержание (upkeep, стык с экономикой)**; делит технику на
  капитальную (мощности) и массовую (деньги/ресурсы). Вторичное: ресурсы+время постройки.
- Ракеты/ПВО — категории, раскрываются в связке с ядерным → блок B.
- Морские зоны: текущие ~124 фичи СЛИШКОМ грубые (Тихий=1 зона). Кандидат-источник:
  **Natural Earth marine polygons** (public domain, именованные театры, GeoJSON) —
  проверить гранулярность вживую [не проверено]. Альт: IHO Limits of Oceans and Seas
  (Marine Regions). Data-задача для scripts/map.
Развилка вынесена пользователю: глубина родов войск.
accepted: глубина родов = **средний путь** (рода-характеры + combined-arms, без микро).
Запущена проверочная задача: субагент скачивает Natural Earth marine polygons
(10m/50m) + пробует IHO, считает гранулярность, рендерит SVG для визуальной оценки
пригодности vs текущие ~124 ocean-фичи. Ждём результат.

### Блок A.2 — ПОЛНЫЙ КАТАЛОГ ВОЕННЫХ СЛОТОВ (proposed, 2026-07-23)

Домены по эпохам (eras.ts, факт): 1836 = industry/railways/agriculture/medicine/
metallurgy/chemistry/naval/artillery/infantry/administration (НЕТ armor/aviation/
nuclear). 1946 = nuclear/rocketry/electronics/computing/microelectronics/aviation/
radar/biology/armor/naval/infantry/space/materials/industry. 2000 = AI/quantum/
robotics/cyberwarfare/spaceSystems/biotech/hypersonics/electronics/energy/nano/
fusion/materials. Домен-привязка слота ЭПОХО-ЗАВИСИМА (артиллерия: artillery→infantry).
Поле nuclearWarheads УЖЕ в MilitaryState (механики нет).

Каталог слотов (принцип: слот стабилен, облик эволюц. по домену эпохи; активность
слота = профиль эпохи):
ЗЕМЛЯ: пехота(rifles,infantry,масса)✅ · артиллерия(artillery/infantry,огонь)✅ ·
броня(tanks,armor,прорыв)✅ · транспорт(trucks,industry,снабжение)✅ · ПВО(radar/
rocketry,оборона от авиации)➕ДОБАВИТЬ.
ВОЗДУХ: истребители(aviation,возд.превосходство)✅ · бомбардировщики(aviation/nuclear,
удар+носитель)✅ · вертолёты(поздний,2000)➕.
МОРЕ(все капитальные=верфи+upkeep): капит.корабль(naval,линкор→крейсер)➕ВЫДЕЛИТЬ ·
авианосец(naval+aviation)➕ · эскорт(destroyers,ПЛО/конвои)✅ · подлодка(naval,
рейдерство/носитель)✅.
СТРАТЕГ(→блок B): ракеты(rocketry,носитель)➕ · ядер.боеголовки(nuclear,nuclearWarheads
поле есть,механики нет).
2000-надстройки: спутники/космос(spaceSystems), кибер(cyberwarfare), дроны/роботы(AI/
robotics) — не MVP-1946.

Структурное следствие (не просто +enum): слот = род+роль+домен+тип производства;
сила РАЗДЕЛЯЕТСЯ по родам (сейчас всё в getEquipmentPower одним числом); эпоха =
профиль активных слотов+домен-привязка.

СПОРНЫЕ — РЕШЕНО (2026-07-23): вертолёты в 1946 ✅ accepted; хим/био ОМП ✅ accepted
(отдельный класс помимо ядерного, табу/эскалация); крейсер — СЛИТ в «капитальный
корабль» (не выделять); десантные корабли — НЕ отдельный слот, десант = абстрактный
гейт от любого флота при господстве. Инженерные укрепления = строительство/Map Feature
(не слот equipment). РЭБ/радар = модификатор (не слот).

Пользователь: «цепочка маленькая, простроить больше, пока только 1946». Запущен агент:
детальные ПОКОЛЕНИЯ техники внутри Cold War (1946-1999) по тирам домена для каждого
слота — заготовка наполнения tech tree. Числа силы = ПЛЕЙСХОЛДЕРЫ (балансировка на
симуляции позже). Это опережающее наполнение (уровень Фазы 3), НЕ блокирует решения
Фазы 2. Параллельно морскому агенту.

### Морские зоны — результат агента + мой спот-чек (2026-07-23)

ПЕРЕВОРОТ РАМКИ (воспроизведено мной по PNG): текущие 124 ocean-фичи — НЕ примитив.
94/124 имён побуквенно = официальный IHO Sea Areas v3 → карта уже на морском стандарте
+ внутренние моря/озёра (Каспий/Великие озёра/Байкал), которых нет во внешних. Прибрежье
в порядке (Средиземное/Японское/Балтика детальны). РЕАЛЬНАЯ проблема — только открытый
океан: 18 «секторных» зон = грубые прямоугольники по долготе (не театры).
Внешние источники НЕ решают: NE10m (306 зон, public domain, +мультиязычные имена
name_ru/ja/… бесплатно) и IHO (101 зона, CC-BY, 247МБ сырой → упрощать) — у ОБОИХ
открытый океан монолитный (1-2 зоны/океан, ХУЖЕ наших секторов; топ-5 = 74-75% площади
vs наши 30.8%). Граф смежности зон не даёт НИКТО — считать в любом случае.
ВЫВОД: не заменять источник, а ДОРАБОТАТЬ наши: (a) перенарезать 18 секторов открытого
океана в театры; (b) граф смежности (обязательно); (c) забрать мультиязычные имена +
мелкие проливы из NE (public domain). Для Фазы 2: морская война РЕАЛИЗУЕМА, риск снят.
Перенарезка = наполнение данными (не блокирует решения). Рендеры: scratchpad/marine/
{current_oceans,ne10m,ne50m,iho_seas}.{png,svg}. Развилка вынесена: принцип детализации
открытого океана.
accepted (2026-07-23): детализация океана = **гибрид** (осмысленные театры где идут/
могут идти бои — Сев.Атлантика/Норвежское/Филиппинское/Коралловое; крупные зоны в
пустых водах). Data-задача: перенарезать 18 секторов гибридно + граф смежности +
забрать мультиязычные имена из NE (public domain). Море-риск снят, A.2 почти закрыт
(ждём агента поколений техники → затем финализация A.2 → A.3).

### Поколения техники 1946 — агент вернулся + мои решения (2026-07-23)

Справочник готов: scratchpad/tech-generations-1946.md (15 слотов × 6 тиров 0-5,
тир0=1946→тир5=~1999, образец/веха/относит.сила плейсхолдер). Ничего в репозиторий.
Триада-периодизация: бомбардировщик тир0 (1946, только US); МБР+ПЛАРБ тир2 (~1960);
полная триада ~1960-62; до 1949 не взаимное (СССР=0). → вход для блока B (сдерживание).

Агент поймал дизайн-дыры (я решил, не проглотил):
- accepted (техрешение): «эсминцы масса vs море капитал» — naval весь на верфях
  (инфраструктура), но ЭКОНОМИЧЕСКИ капитальны только тяжёлые (линкор/крейсер/
  авианосец/ПЛАРБ); эсминцы+обычные ПЛ = массовые.
- accepted: категория производства = свойство пары (СЛОТ, ТИР), не фикс за слотом
  (истребитель массовый T0→капитальный T5; подлодка дизель→атом→ПЛАРБ).
- accepted: ТРЕТЬЯ категория производства «программное» — ядер.боеголовки + хим/био
  ОМП ограничены расщепляющимся материалом/научной базой (не деньги/верфи); уран
  уже ресурс мира. Стык с блоком B.
- proposed (рекомендую, возражение открыто): добавить слот СПУТНИКИ/КОСМОС (домен
  space, есть в эре 1946; тир2 ~1957: разведка/раннее предупреждение/связь; усиливает
  ядерное сдерживание). Каталог ядра → 16 слотов.
Заметки реализации: ОМП 2 трека (публичный/скрытый); осторожность с воен.преступлениями
(Отряд 731) в нарративе; числа силы нормализованы только внутри слота (кросс-слот —
балансировка на симуляции).

A.2 (война+море) — все темы разобраны. СЛЕДУЮЩЕЕ: финализация A.2 (собрать все accepted
+ вынести 3 моих ждущих предложения: терреновая асимметрия, мобилизация, верфи+содержание)
→ затем A.3 (перевороты+распад/рождение, отложенный вопрос «при расколе за кого играешь»).

### Блок A.2 — финальные предложения приняты (2026-07-23)

Справочник техники положен в дерево: .agent/plans/tech-generations-1946.md (с шапкой
о статусе-заготовке). accepted: все 4 моих предложения — терреновая асимметрия обороны,
мобилизация как рычаг (стык война↔экономика), верфи+содержание (против «100 линкоров»),
слот Спутники/космос (домен space, тир2 ~1957 → каталог 16 слотов).

Пользователь поднял нюанс терреновой обороны: «регионы большие, как делить на горы/реки?».
Мой разбор — 3 подхода: (1) тип региона (усредняет); (2) БАРЬЕРЫ НА ГРАНИЦАХ/рёбрах графа
(форсирование реки/переход хребта/морской пролив — решает «большие регионы», историчен,
морской барьер уже заложен, реки из Natural Earth rivers public domain); (3) гибрид.
Рекомендация: (2) барьеры-на-границах как основа, тип региона — опц. второй слой. Развилка
вынесена. После неё — A.2 ЗАКРЫТ, финализация + переход к A.3 (перевороты+распад).

### БЛОК A.2 (ВОЙНА + МОРЕ) — ЗАКРЫТ, полный свод (2026-07-23)

game over (опора дизайна, из A.1): только полное исчезновение государства игрока
(капитуляция-событие → полная аннексия). Раскол/переворот ≠ конец.
ВОЙНА: абстрактный фронт (сила+сухопутная смежность+флип, без юнит-микро); случайность
боя сидированная ±25% (суша+море); рода войск средний путь (характеры+combined-arms);
терреновая оборона = БАРЬЕРЫ НА ГРАНИЦАХ (рёбра: река/хребет/пролив; реки из NE public
domain); движок сам завершает войны (капитуляция при разгроме + белый мир по истощению);
мобилизация как рычаг игрока (стык с экономикой).
МОРЕ: полноценная морская война слоями (граф+сила флота+присутствие → бой флот-vs-флот →
конвои/блокада); флот = проекция силы + намерение (не ручное вождение); морские зоны =
гибрид (театры где бои) + граф смежности + мультиязычные имена из NE (данные уже на
IHO-основе, дорабатываем 18 секторов); десант = гейт от флота при господстве.
ТЕХНИКА: 16 слотов (5 земля/3 воздух/4 море/3 стратег/+спутники), эволюция по тирам
домена (слот стабилен, облик растёт); производство капитальное(верфи+содержание)/массовое/
программное(ОМП+ядерное=расщепляющийся материал/наука), категория плавает по (слот,тир);
крейсер слит в капитал.корабль; десантных кораблей нет (гейт). Справочник поколений:
.agent/plans/tech-generations-1946.md (заготовка, числа плейсхолдер).
→ БЛОК B: ядерное/ОМП сдерживание (периодизация триады готова: US-монополия 1946-49 →
только бомбардировщик 1949-60 → полная триада 1960+). Заметки реализации: ОМП 2 трека
(публичный/скрытый), осторожность с воен.преступлениями в нарративе, кросс-слот нормализация.

СЛЕДУЮЩЕЕ: A.3 (перевороты + распад/рождение государств); отложенный вопрос «при расколе
за кого играет игрок». СТОП-ТОЧКА — жду отмашки.

### Блок A.3 — ПЕРЕВОРОТЫ + РАСПАД/РОЖДЕНИЕ (decision-блок, в процессе, 2026-07-23)

Перечитан код: politicsTick (stability/legitimacy/govSupport/corruption = дрейф к
равновесиям от экономики, детерминир.); факт при stability<20 (F26). countries.push
ТОЛЬКО в тестах → динамич. создания/удаления страны В ПРОДЕ НЕТ вообще. Country имеет
color/name/ideology (переворот трогает их). Region НЕ имеет поля «преемник» → данные
распада создавать. Команд regime_change/split/create/unify НЕТ (annex/puppet no-op).
Три подсистемы (все НОВЫЕ):
1. Переворот/смена режима (не смертельно): движок=давление от stability; LLM=разыгрывает+
   команда regime_change(идеология,[имя,цвет]); движок=применяет (ideology/color/name/
   сброс legitimacy/пересчёт отношений с блоками).
2. Распад (не смертельно игроку — преемник): движок=условие (низкая stab+поражение)→факт;
   LLM/движок=split_state; движок создаёт осколки, раздаёт регионы, делит население/армию/
   казну, инварианты (сумма сходится).
3. Рождение (деколонизация/сепаратизм/объединение): create_state/secede/unify; движок
   создаёт polity, раздаёт регионы, валидирует.
ПРИНЦИП (PH-урок+C4): структурные команды карты — самое хрупкое место LLM (PH плодит
дубли, событие остаётся при ошибке движка). Наш ответ жёстче: движок валидирует ВСЕ
инварианты, невалидная команда ОТКЛОНЯЕТСЯ целиком, исторические осколки ИЗ ДАННЫХ.
Мои предложения (proposed): игрок спонсирует чужой переворот (разведоружие ХВ); движок
форсирует при затяжном экстремуме (анти-зомби); предопределённые преемники в данных региона.
Развилки вынесены: (1) при расколе игрока за кого продолжает; (2) свобода рождения
(данные/LLM/гибрид).

### БЛОК A.3 (ПЕРЕВОРОТЫ + РАСПАД/РОЖДЕНИЕ) — ЗАКРЫТ (2026-07-23)

accepted: при расколе игрока — ВЫБОР ИГРОКА за какой осколок продолжать (дефолт
наследник столицы); свобода рождения = ГИБРИД (исторические осколки из данных +
LLM неисторические при дивергенции, движок валидирует); предопределённые преемники
в данных региона (следствие гибрида, data-задача); движок ФОРСИРУЕТ переворот/распад
при затяжном экстремуме стабильности (анти-зомби, как долг); игрок СПОНСИРУЕТ чужой
переворот (разведоружие ХВ). Принцип: структурные команды карты (regime_change/
split_state/create_state/secede/unify) — движок валидирует ВСЕ инварианты, невалидное
отклоняется ЦЕЛИКОМ (не как PH), исторические осколки из данных.

## ═══ БЛОК A (ЯДРО СТАВОК) — ЗАКРЫТ ЦЕЛИКОМ ═══
A.1 экономика/долг · A.2 война+море · A.3 перевороты+распад. Все три связаны в
game over-цепочку: экономика (рецессия/долг/инфляция) → нестабильность → переворот
ИЛИ распад (продолжение) → военное добивание ослабленного → game over (исчезновение
государства). Раскол/переворот НЕ смертельны. Числа — движок, LLM — рассказчик+
капованные команды, развилки-подсказки не рельсы.
СЛЕДУЮЩЕЕ: Блок B (сферы влияния+патрон-клиент → МО+валютные зоны → технологии+
ядерное) ИЛИ пауза. СТОП-ТОЧКА.

### Блок B.1 — СФЕРЫ ВЛИЯНИЯ + ПАТРОН-КЛИЕНТ (decision-блок, в процессе, 2026-07-23)

Код: DiplomacyState = allies/rivals/puppets/sphereOfInfluence/relations/influence(0-100)/
guarantees/sanctions. DiplomacyTick: influence decay + sphere enter/exit по порогам;
calculateBaseInfluence = military+gdp ratio + плоская география. WarService: coalition
drag-in (пуппеты/гаранты/союзники в войну). НЕТ (grep proxy/tribute/vassal/patron пусто):
патрон-клиент экономики, прокси-войн, реальных прав сферы. Сфера почти КОСМЕТИЧНА
(только coalition). Прокси-война — центр ХВ — только текстовое правило в промте, не механика.
Три роли: движок=influence-числа+пороги+[новое]права/прокси; LLM=разыгрывает борьбу+
команды influence/guarantee/[proxy_support]; движок применяет. Не рельсы: влияние —
следствие мощи+действий (эконом/воен помощь, идеология, спонсирование переворота A.3).
Мои предложения (proposed): экономические права сферы (ресурсы/рынок клиента); ограничение
дипломатии клиента (не вступить в чужой блок); ПРОКСИ-ВОЙНА (патрон вливает силу клиенту
не вступая, стык с ядерным B.3); военные базы в сфере (проекция силы, стык с флотом).
Развилки вынесены: (1) глубина прав сферы; (2) прокси-война как механика.

### БЛОК B.1 (СФЕРЫ ВЛИЯНИЯ + ПАТРОН-КЛИЕНТ) — ЗАКРЫТ (2026-07-23)

accepted: права сферы = СРЕДНЯЯ (экономические права: доступ к ресурсам/рынку клиента +
ограничение дипломатии клиента: не вступит в чужой блок без разрыва + обязанность
защищать/coalition уже есть); ПРОКСИ-ВОЙНА = МЕХАНИКА (патрон вливает военную силу/
ресурсы клиенту в его войне, не вступая сам; стык с ядерным B.3 — воевать чужими руками);
военные базы в сфере = проекция силы (принято рекомендацией, стык с флотом/прокси, не
микро — модификатор присутствия; возражение открыто). Не рельсы: влияние = следствие
мощи+действий (эконом/воен помощь, идеология, спонсирование переворота A.3).
СЛЕДУЮЩЕЕ: B.2 (международные организации + валютные зоны). СТОП-ТОЧКА.

### Блок B.2 — МЕЖД. ОРГАНИЗАЦИИ + ВАЛЮТНЫЕ ЗОНЫ (decision-блок, в процессе, 2026-07-23)

Код: валютные зоны работают (currencyZoneAnchor; TradeTick: член зоны +5% экспорт /
5% скидка импорт / 50% защита от ВНЕШНИХ санкций; план 10 MVP 7 стран, плейсхолдеры).
МО — grep UN/NATO/Warsaw/treaty/organization ПУСТО, нет вообще.
ИНСАЙТ (мой, ключевой): сфера(B.1)/военсоюз/эконблок/валютзона/ООН = ПЯТЬ названий одной
вещи «объединение стран». ЕДИНАЯ МОДЕЛЬ: БЛОК с ИЗМЕРЕНИЯМИ — военное (коллективная
оборона, НАТО/ОВД) / экономическое (общий рынок+валютная зона+помощь, СЭВ/ЕЭС) /
дипломатическое-трибуна (легитимность/осуждение/санкции, ООН). Сфера = неформальный блок
(1 патрон, неравноправные); формальный блок/МО = устав; валютзона = эконом-измерение
(currencyZoneAnchor → членство в эконом-блоке). Одна структура вместо пяти.
Три роли: движок=эффекты блока(оборона/эконом/легитимность)+членство; LLM=формирование/
распад/резолюции+команды found_bloc/join_bloc/leave_bloc; движок применяет. Не рельсы:
блоки по влиянию/идеологии/действиям (НАТО не обязано появиться в 1949).
Мои предложения (proposed): единая модель блоков; эконом.помощь через блок (план Маршалла-
тип, стык B.1+экономика); ООН-трибуна = легитимность (осуждение бьёт легитимность агрессора,
стык A.3; санкции с межд.печатью).
Развилки вынесены: (1) единая модель блоков vs раздельно; (2) глубина МО.

### БЛОК B.2 (МЕЖД. ОРГАНИЗАЦИИ + ВАЛЮТНЫЕ ЗОНЫ) — ЗАКРЫТ (2026-07-23)

accepted: ЕДИНАЯ МОДЕЛЬ уточнена — один КЛАСС Bloc, МНОГО ЭКЗЕМПЛЯРОВ (СЭВ/ОВД/НАТО/
ЕЭС/ООН/сферы = РАЗНЫЕ блоки с разным членством!), страна в НЕСКОЛЬКИХ блоках (ФРГ в
НАТО+ЕЭС), на карте — переключаемые СЛОИ (военные/экономические/сферы). Измерения:
военное(колл.оборона)/экономическое(рынок+валютзона+помощь)/дипломатическое(трибуна).
Сфера(B.1)=неформальный блок (лидер+неравноправные); валютзона=эконом-измерение
(currencyZoneAnchor→членство в эконом-блоке). ООН = Совбез с ВЕТО-ДЕРЖАТЕЛЯМИ
(постоянные члены US/SUN/GBR/FRA/Китай блокируют резолюции против себя/своей сферы —
детерминированное ПРАВИЛО по позициям, БЕЗ поимённого голосования; исторично, реализуемо).
Эконом.помощь через блок (план Маршалла-тип); ООН-осуждение → −легитимность (стык A.3).
ДАННЫЕ-НЮАНС: постоянный член Совбеза «Китай» 1946 = Гоминьдан=TWN → цепляет открытый
вопрос состава великих держав (CHN-major/TWN-нет).
СЛЕДУЮЩЕЕ: B.3 (технологии + ядерное сдерживание). СТОП-ТОЧКА.

### Блок «СОВЕТНИК ЦЕЛЕЙ» (спонтанный запрос пользователя, в процессе, 2026-07-23)

Пользователь дал 2 примера конечных целей партии (СССР-1946 текстом 30 пунктов; Россия-2075
docx 29 разделов — прочитан scratchpad/goals2075.txt). Хочет: советник как в PH, НО
ориентированный на цели игрока + система памяти; советует под игрока/партию (фокус/избегать).
Цели задаются отдельным вызовом LLM, необязательны.
Наблюдение: цели разного МАСШТАБА (спасти Сталина ↔ мировой гегемон) и ТИПА:
- измеримые движком (ВВП/население/территории/тех-тиры/победа в войне/рубль-валюта);
- нарративные (сов.архитектура/спасение Сталина/реабилитация/разрушить США изнутри).
2075-план сам почти советник-фреймворк (квартальный цикл, ротация приоритетов /6 мес).
Уже есть в коде: Country.goals + ObjectiveTick (оценка достижения, playerStanding) +
PUT /objective/goals — механическая часть ЧАСТИЧНО заложена. НЕТ: советника-LLM.
Дизайн: ГИБРИД — при вводе LLM структурирует цели (измеримые→метрики движка, нарративные→
текст); движок трекает измеримые, советник интерпретирует нарративные+стратегию.
Три роли: движок хранит цели+трекает прогресс+память советника; LLM-советник (ОТДЕЛЬНЫЙ
вызов, не нарратор) читает цели+прогресс+агрегат+память→советы; игрок задаёт цели+запрашивает.
Не рельсы: советует, не действует; под ЕГО цели.
PH-урок: советник прожорлив, отключается при переполнении → наш с УПРАВЛЯЕМОЙ памятью
(цели+сжатый прогресс+агрегат, НЕ весь мир).
Мои предложения (proposed): гибрид оценки; периодическая переоценка приоритетов (раз в год,
= «ротация /6мес» из плана 2075, стык с ObjectiveTick); флаг КОНФЛИКТОВ целей (trade-offs
бюджета/ресурсов).
Развилки вынесены: (1) оценка целей (механика/нарратив/гибрид); (2) частота советника.
accepted: оценка = ГИБРИД (измеримые движок, нарративные советник-LLM); частота = ПО
ЗАПРОСУ игрока (+ моё предложение годовой переоценки — не подтверждено).
ДОПОЛНЕНИЯ ПОЛЬЗОВАТЕЛЯ (2026-07-23, выжимки §8-14):
Цели: raw-формулировка хранится НЕИЗМЕННО; отдельный LLM-вызов структурирует;
неоднозначности показываются игроку; план НЕ активен до утверждения (approval-цикл);
красные линии/ограничения — отдельная сущность; игра полноценна без плана. [accepted]
Советник: СПОРИТ с игроком (цель — успех партии, не согласие); указывает конкретные
панели/решения/параметры/последовательность; отслеживает отклонения; РАЗЛИЧАЕТ факт/
оценку/предположение/неизвестность; личность отделена от аналитического ядра; ОДИН
советник с несколькими ракурсами (не хор). [accepted — совпадает с градацией уверенности]
АВТОПИЛОТ (НОВОЕ, крупное): ИИ сам играет по сверхцели (разбивает на этапы/строит
стратегию/выбирает решения/адаптируется; ТОЛЬКО валидированные команды; не объявляет
достижение без подтверждения состояния; пауза/наблюдение/вмешательство). Советник→
рекомендации, автопилот→команды, ОБЩЕЕ аналитическое ядро, разные права.
МОЯ КРИТИКА (не поддакивать): автопилот дорог (LLM-планирование КАЖДЫЙ ход vs наш $1.6/
кампания — переворачивает экономику); качество LLM-стратегии сомнительно (WarAgent 54%);
сложен в реализации («LLM играет grand strategy сам»). Рекомендация: ПОЗДНЯЯ ОПЦИОНАЛЬНАЯ
фича, НЕ MVP; сначала советник (по запросу, дёшево), автопилот — надстройка над тем же
ядром. Развилка вынесена.
Допустимые жертвы: ИИ «всё ради цели» в рамках правил+красных линий+СОХРАНЕНИЯ СУБЪЕКТА
цели (не уничтожить то, ради чего цель). [accepted — рамки автономии автопилота]
Сложность (расширение C.1): меняет НЕ только числа, а горизонт планирования/скорость
реакции/замечание угроз/координацию союзников/адаптацию/агрессивность/ОБЪЁМ ИНФОРМАЦИИ
ИГРОКУ (=туман войны/разведка, был отложен)/устойчивость режимов/интенсивность кризисов.
[accepted — детализация C.1]
Историчность/события: гибрид (дата/окно+предпосылки+адаптация+отмена при разрушении
причин = наши hinge-points детальнее); LLM не надёжная ист.БД (описывает/адаптирует/
предлагает/связывает, НЕ определяет даты-факты/не объявляет каноном/не создаёт сущности
в GameState без проверки); цикл отклонений: предложение→проверка→последствия→принятие/
отклонение→журнал→обязательный учёт. [accepted — совпадает с нашим принципом валидации]
Примеры целей: .agent/reference/player-goals-{ussr-1946,russia-2075}.md.
Развилка вынесена: приоритет/scope автопилота.
accepted: автопилот = ПОЗДНЯЯ ОПЦИОНАЛЬНАЯ (в дорожную карту после советника, надстройка
над общим ядром, флаг стоимости).

ДОПОЛНЕНИЯ-2 пользователя (2026-07-23):
- Память советника = структурированный DECISION-LOG с причинностью (цель→приоритет→шаг→
  действие игрока→результат→корректировка, не плоский лог). accepted + нюанс: управляемая/
  сжимаемая (recursive summarization, иначе рост как eventHistory/PH-переполнение).
- PER-РОЛЬ МОДЕЛИ + интерфейс настройки: LLMProvider уже абстрагирован → нарратор/советник/
  автопилот/парсинг-целей = разные модели; советник можно на ДЕШЁВОЙ (C14: nano/DeepSeek/
  Qwen для аналитики). Интерфейс = UI-задача (UI заморожен; конфиг через файл пока, панель
  позже). Нюанс: маппинг схем разных провайдеров (уже в C14). accepted.
- БЕЗОПАСНОСТЬ «данные никуда не отправляются» — МОЁ ВОЗРАЖЕНИЕ: несовместимо с облачной LLM
  (промт с состоянием физически уходит провайдеру). Развилка: полная локальность (приватность
  vs качество RU-нарратива, C14) / облако-с-гарантиями (только выбранный провайдер, ноль
  телеметрии/третьих сторон, санитайзер промта от секретов, ключ не утекает) / гибрид
  (локально по умолчанию, облако опция с предупреждением). Механизм («скилл/агент») = GUARD:
  архитектурный тест (нет сетевых вызовов кроме LLMProvider) + санитайзер промта + ноль
  телеметрии; база есть (промт из состояния не из файлов, ключ в .env не на клиент).
  accepted: приватность = ОБЛАКО С ГАРАНТИЯМИ (данные только выбранному провайдеру, ноль
  телеметрии/третьих сторон, санитайзер промта от секретов, guard-тест «нет сетевых вызовов
  кроме LLMProvider», ключ не утекает). Guard-безопасность = задача в дорожную карту.
Блок «Советник целей» ПОЛНОСТЬЮ ЗАКРЫТ (2 раунда дополнений).
[Вернулись к B.3 технологии+ядерное по слову пользователя «вернёмся к основным механикам».]

### Блок B.3 — ТЕХНОЛОГИИ + ЯДЕРНОЕ СДЕРЖИВАНИЕ (decision-блок, в процессе, 2026-07-23)

Код: technology.ts — тир = floor(progress/100), combined-arms бонус за min-тир военных
доменов. ResearchTick: рост domains от researchSpending×share, замедляется (1+tier×0.3).
Марафон П11: T1 1954/T2 1964/T3 1978/T4 1994 (стартовая тишина 8 лет, F17). nuclearWarheads
поле есть, механики НЕТ.
ТЕХНОЛОГИИ дыры: стартовая тишина (LLM не видит сигнала); тир даёт мало помимо военного
(nuclear/space/industry не разблокируют возможности); тех-лидерство измеримо (стык с
советником целей). Рекомендация (тех): ускорить ранний темп; тир домена РАЗБЛОКИРУЕТ
возможности (nuclear→программа, space→спутники, industry→бонус ВВП), не только бой.
ЯДЕРНОЕ (механики нет): цепочка — программа (домен nuclear→наработка боеголовок, уран+
наука=«программное») → носители триады (слоты A.2: бомбардировщик т0/ракета т2/ПЛАРБ т2;
периодизация из справочника: монополия US 1946-49→уязвимый бомбардировщик→триада 1960+) →
MAD-сдерживание (неуязвимый ответ → прямая война самоубийство → ИИ избегает/игрок рискует →
ПРОКСИ, мост к B.1) → порог применения/табу/эскалация (отдельный механизм, не обычная сила).
Не рельсы: гонка по вложениям nuclear/rocketry, не расписание. Кульминация: технологии→
носители(A.2)→сдерживание(прокси B.1)→эскалация(события)→легитимность(ООН B.2).
Развилки вынесены: (1) что тир технологий даёт (узко/широко); (2) ядерное сдерживание глубина.

### БЛОК B.3 (ТЕХНОЛОГИИ + ЯДЕРНОЕ) — ЗАКРЫТ (2026-07-23)

accepted: тир технологий даёт ШИРОКО — РАЗБЛОКИРУЕТ возможности (nuclear→ядерная
программа, space→спутники, industry→бонус ВВП) + слоты-эволюция (A.2) + combined-arms;
ускорить ранний темп (рекомендация, чтобы прогресс виден). Ядерное = MVP-MAD: программа
(домен nuclear→боеголовки, уран+наука=программное) + триада-носители (слоты A.2) +
сдерживание (неуязвимый ответ→прямая война самоубийство→прокси, мост B.1) + порог
применения/табу; эскалация = СОБЫТИЕ LLM, не микро-лестница.

## ═══ БЛОК B (ГЕОПОЛИТИЧЕСКИЙ СЛОЙ) — ЗАКРЫТ ЦЕЛИКОМ ═══
B.1 сферы+патрон-клиент (средняя права+прокси-механика) · B.2 МО+валютзоны (единая
модель блоков: класс+много экземпляров+слои карты; ООН Совбез-вето) · B.3 технологии
(широко)+ядерное (MVP-MAD). Кульминация ХВ: технологии→носители→сдерживание→прокси→
эскалация→легитимность связаны.

ФАЙЛЫ ПЕРЕНЕСЕНЫ в .agent/reference/ (README): 5 первоисточников PH (system-prompt,
preset-coldwar, full-request 53КБ, output-schema, response-example) + 2 набора целей
игрока (ussr-1946, russia-2075). Референс, не source of truth.

ОСТАЛОСЬ в Фазе 2: Блок C (ИИ-державы с целями+угрозой+настройка сложности; холодный
старт мира — стартовая дипломатия F59). Отложено: советник целей (дополнение
пользователя); состав великих держав TWN/CHN (продуктовый, всплывал 3×). Затем Фаза 3
(концепт-документ + дорожная карта план 11). СТОП-ТОЧКА.

### Блок C.1 — ИИ-ДЕРЖАВЫ С ЦЕЛЯМИ + УГРОЗА + СЛОЖНОСТЬ (decision-блок, в процессе, 2026-07-23)

Код (AiBehaviorTick прочитан): 4 правила — A аустерити, B ответ на угрозу ОТ ИГРОКА
(dom=influence игрока; вооружение+контр-блок ИЛИ бандвагонинг), C welfare-нудж при
stab<40, D война non-major сопернику (aiTraits aggressiveness/riskTolerance). Всё
РЕАКТИВНОЕ. Major пассивны (правило D не трогает, только LLM; марафон: 0 войн без LLM).
Угроза ТОЛЬКО от игрока (нет balance of power между ИИ). Нет целей ИИ, нет сложности.
Дыры («болванчики»): нет проактивных целей; major пусты; нет balance of power ИИ↔ИИ;
нет сложности.
Три роли: движок = базовое давление к целям + balance of power (угроза от ВСЕХ) +
характеры + сложность (живой мир БЕЗ каждоходового LLM, критично — марафон); LLM =
крупные ходы major под цели, драма; игрок = активные соперники + настройка сложности.
СТЫК: цели ИИ = та же структура goals, что у игрока (советник). Одна система целей.
Связь: цели ИИ приостановлены пользователем 2026-07-06 «до пересмотра состава major» →
упирается в вопрос TWN/CHN (всплывал 3×), разобрать следующим (холодный старт/ростер).
Развилки вынесены: (1) кто ведёт ИИ к целям (движок/LLM/гибрид); (2) что меняет сложность.

### БЛОК C.1 (ИИ-ДЕРЖАВЫ С ЦЕЛЯМИ + УГРОЗА + СЛОЖНОСТЬ) — ЗАКРЫТ (2026-07-23)

accepted: ИИ к целям = ГИБРИД (движок базовое давление к целям + balance of power ИИ↔ИИ,
живой мир БЕЗ каждоходового LLM; LLM крупные ходы major под цели + драма). Сложность =
ПОВЕДЕНИЕ+ЖЁСТКОСТЬ МИРА (активность/компетентность ИИ преследовать цели и противодействовать
игроку + шанс успеха амбициозных действий игрока; от песочницы до вызова; НЕ читы).
Цели ИИ = та же структура goals, что у игрока (советник) — одна система целей на всех.
СЛЕДУЮЩЕЕ: C.2 (холодный старт мира — стартовая дипломатия F59 + СОСТАВ ВЕЛИКИХ ДЕРЖАВ
TWN/CHN, всплывал 3×, цели ИИ приостановлены до него). СТОП-ТОЧКА.

### Блок C.2 — ХОЛОДНЫЙ СТАРТ + СОСТАВ ВЕЛИКИХ ДЕРЖАВ (decision-блок, в процессе, 2026-07-23)

Код (TierTick прочитан): HISTORICAL_TIERS_1946 (Claude 2026-06-30, без утверждения) =
10 major: USA/SUN/GBR/FRA/CHN/JPN/ITA/BRA/ARG/CAN. Проблемы (подтверждены):
- CHN/TWN ПУТАНИЦА: TWN=«Republic of China (Kuomintang)» держит МАТЕРИК 34 региона+Совбез;
  CHN=коммунисты 8 регионов. В major стоит CHN(коммунисты), Гоминьдан(TWN) нет — исторически
  наоборот (1946 Гоминьдан=законное правительство+Совбез). Имена сбивают (TWN обычно Тайвань).
- tierTick ПЕРЕВОРАЧИВАЕТ старт: пересчёт по score раз в год → TWN(34 региона) всплывает,
  CHN выпадает. Стартовый список сам себе противоречит.
- ARG/BRA/CAN как major 1946 сомнительны (региональные максимум).
- JPN/ITA оккупированы/побеждены 1946 (спорно major).
- Индия не отдельная сущность (под QCG British Colonies), крупнейшая колония до 1947.
Эталон 1946 = 5 постоянных Совбеза: US/SUN/GBR/FRA/Китай-Гоминьдан.
Решаем: (1) состав major; (2) механика tier (фикс-исторический vs пересчёт по данным —
сейчас пересчёт стирает историю); (3) стартовая дипломатия (F59 пусто; блоки ХВ+оси-союзники).
Детальный ростер+дипломатия = data-задача (агент, как техника/зоны); ПРИНЦИП — пользователю.
Развилки вынесены: (1) направление состава major; (2) механика tier.

### БЛОК C.2 (ХОЛОДНЫЙ СТАРТ + СОСТАВ) — ЗАКРЫТ (2026-07-23)

accepted: РАСШИРИТЬ тиры до ПЯТИ — сверхдержава(2: US/SUN)/великая(GBR/FRA/Гоминьдан)/
региональная/средняя/малая-непризнанная (калька PH-пресета+история). tier-механика =
ГИБРИД (старт исторический + пересчёт по данным С ИНЕРЦИЕЙ, не дёргает от шума).
РЕГИОНАЛЬНЫЕ ЛИДЕРЫ + МАКРОРЕГИОНЫ (~8-10: Сев/Лат.Америка, Зап/Вост.Европа, Бл.Восток,
Юж/Вост/ЮВ.Азия, Африка, Океания) — лидер = сильнейшая держава макрорегиона; стыки:
B.1 (сверхдержавы борются за лидеров), C.1 (ИИ-цель доминирования в регионе), карта (слой).
Исправить CHN/TWN путаницу (Гоминьдан=законное правительство 1946). Детальный ростер +
стартовая дипломатия (F59) + макрорегионы + привязка лидеров = DATA-ЗАДАЧА (агент).
[СВЕДЕНИЕ ПРОТИВОРЕЧИЯ 2026-07-24: «data-задача» относится к НАПОЛНЕНИЮ (ростер/стартовая дипломатия/
членство). САМА структура макрорегионов УТОЧНЕНА Codex S12 (supersede, позднее): MacroregionDefinition +
membership rule + homeMacroregionId = ПРОДУКТОВЫЕ ПРАВИЛА, не чистая data. Концепт §5.8 взял S12-версию —
accepted. Итог: правила макрорегионов = продукт (S12); наполнение ростера/дипломатии = data-задача (C.2).]

## ═══ БЛОК C (ИИ + ХОЛОДНЫЙ СТАРТ) — ЗАКРЫТ ═══
C.1 ИИ-державы с целями (гибрид движок+LLM, balance of power, сложность=поведение+жёсткость,
не читы) · C.2 пять тиров + региональные лидеры/макрорегионы + гибрид tier + исправление ростера.

## ═══════ ВСЕ СИСТЕМНЫЕ БЛОКИ ФАЗЫ 2 ЗАКРЫТЫ ═══════
A (ядро ставок): экономика/долг · война+море · перевороты+распад.
B (геополитика): сферы+патрон-клиент · МО+валютзоны · технологии+ядерное.
C (ИИ+старт): ИИ-державы с целями+сложность · пять тиров+региональные лидеры+холодный старт.
+ Советник целей (частично: гибрид+по запросу; ⏸ ОТЛОЖЕН — пользователь дополнит).
DATA-задачи накоплены (в дорожную карту Фазы 3): морские зоны (гибрид театров+граф+
мультиязычные имена NE) · поколения техники (справочник готов) · стартовая дипломатия+
детальный ростер 5 тиров+макрорегионы+лидеры · предопределённые преемники распада ·
terrain-барьеры (реки NE) · валютные зоны расширение.
СЛЕДУЮЩЕЕ: советник (дополнения) ИЛИ Фаза 3 (концепт-документ + дорожная карта план 11).

### Независимое ревью Codex заказано (2026-07-23)
Пользователь заказал независимое адверсариальное ревью Фазы 2 другой моделью (роль
«независимый рецензент» из AGENTS.md — взгляд с другой стороны). Задание сформировано:
.agent/plans/codex-design-review-task.md (самодостаточное, read-only, не принимать
объяснения Claude за доказательство, проверять по коду, находки по уровням критичности).
ВАЖНО: я НЕ могу запустить Codex сам (отдельный инструмент, codex.exe заблокирован —
подтверждено аудитом). Пользователь запускает Codex с этим заданием. Материалы — в этом
worktree (ветка claude/design-partner-audit), не в main. ЖДЁМ отчёт Codex → свести с
нашими решениями (Codex-находки — evidence, не automatic authority; спорные проверить сам).
СТОП-ТОЧКА.

### СИНТЕЗ РЕВЮ CODEX (2026-07-23) — вердикт NOT READY принят

Отчёт: .codex/worktrees/design-review/.agent/plans/codex-design-review-report.md (7 критичных,
14 средних, 5 мелких, + «согласен с Claude», + исправленный sequencing Milestone 0-5).
Я оценил критически (не на веру) — все 7 критичных ОБОСНОВАНЫ, ссылаются на реальный код,
который я подтверждал в аудите. ГЛАВНЫЙ УРОК (принят): слово «ЗАКРЫТ» преждевременно —
закрыты ПРОДУКТОВЫЕ развилки (что хочет пользователь — валидно, Codex не оспаривает), но НЕ
системные КОНТРАКТЫ. Различение: продуктовое направление принято ✓; инженерные контракты =
работа Фазы 3, которую Codex правильно очертил.

7 КРИТИЧНЫХ — ПРИНЯТЫ ВСЕ:
- K1 (game over не state machine): нужна plain-data campaignStatus (active→succession_choice_
  pending→active|defeated(reason)) + PolityLifecycleResult (что с каждой ссылкой: регионы/
  дипломатия/войны/цели/техника/долги/playerStanding при удалении страны). «Проверить
  инварианты» ≠ спецификация. ↔ усиливает наш A.3.
- K2 (pipeline не атомарен): TOCTOU (=наш F3, LLMService:123-145) + нарратив пишется
  безусловно (=F1/H1). Тяжёлые команды: plan→validate clone→post-invariants→atomic commit;
  макс 1 структурная команда/ответ ИЛИ WorldMutationPlan; нарратив ТОЛЬКО после commit +
  appliedResult; reject → диагностический факт, не ложный канон.
- K3 (агентность игрока): наш F52 НЕ закрыт, расширение делает опаснее. Policy-матрица:
  ai_only/player_proposed/player_explicit/engine_only + approval-step для войны/режима/
  раскола/блоков/ядерного. Prompt-правило без validator недостаточно. ПРИЗНАЮ: оставил F52
  недофинализированным.
- K4 (слот-эволюция vs агрегат): equipment=Record<type,number> без поколения → пересечение
  тира мгновенно апгрейдит весь парк. Разделить 3 оси: technology capability / force
  inventory-readiness / doctrine-treaty posture. Договоры (РСМД) НЕ тех-тиры. MVP: агрегат
  averageGeneration + стоимость модернизации, не cohort-парк. ПРИЗНАЮ: не продумал.
- K5 (цели игрока ≠ policy AI): StrategicGoal=4 achievement-predicate, ObjectiveTick только
  игрок, docs/OBJECTIVES выводит AI-цели из слоя. Моё «одна структура goals» — упрощение.
  Разделить: PlayerObjective / AiPolicyGoal(target,priority,horizon,guardrails) / AdvisorGoalView.
  Общий КОНТЕЙНЕР (id/progress/UI) остаётся — Codex сам подтверждает. ПРИЗНАЮ: слишком легко
  объединил C.1.
- K6 (tier перегружен): tier сейчас = статус+LLM-spotlight+исключение из rule D+top-N score.
  Пять тиров добавили престиж/сверхдержавность/лидерство. Разделить: powerBand / diplomaticStatus
  (Совбез/вето) / regionalLeadership[] / llmAttention(scheduler по relevance). ПРИЗНАЮ: умножил
  тиры не разделив оси.
- K7 (scope без vertical slice): огромный дизайн, нет MVP-среза/бюджета решений. Первый срез:
  стартовая дипломатия→AI pressure→кризис→решение игрока→детерминир. последствие→война/мир→
  продолжение|game over. Море MVP = только presence-гейт достижимости. ПРИЗНАЮ: не определил MVP.

СРЕДНИЕ (ключевые приняты): S1 (порог долга 1.0 = trigger-кандидат не факт; hysteresis/
recovery) · S2 (±25% RNG нужен grain: 1 roll на warId+month+frontEdge, triangular, +oracle-тест) ·
S3 (море: «данные пригодны» ≠ «риск снят» — ПОПРАВКА мне, принимаю) · S4 (proxy: War.supporters
УЖЕ есть — поправка моему «с нуля»; supportLevel none/limited/major) · S5 (институты: общая
оболочка да, единая семантика нет; НЕ runtime-class, plain JSON; миграция или views не оба) ·
S6 (MAD: наличие бомб ≠ second strike; deliverableWarheads/survivability/detection) · S7
(сложность «шанс успеха игрока» = скрытый чит если невидим; менять planning/coordination/risk) ·
S8 (советник: bounded AdvisorSnapshot, succession → reconfirm целей) · S9 (стоимость $1.62 НЕ
переносить на новый дизайн — ПОПРАВКА, принимаю; бюджеты p95 в roadmap) · S10 (docs drift —
оформить superseding decisions) · S11 (forced extreme = bounded menu исходов + timeout, не
жёсткий 1 исход) · S12 (макрорегионы = продуктовые правила, не чистая data: MacroregionDefinition+
membership rule; homeMacroregionId) · S13 (лицензии = release gate; MVP авторская ручная таблица) ·
S14 (save-compat в стоимость: миграция или явный break/milestone).
МЕЛКИЕ: M1 (Institution не class Bloc) · M2 (CHN/TWN через display/history mapping, НЕ
переименование id — ПОПРАВКА, принимаю) · M3 (Совбез-место = temporal seat ownership, не
вечно TWN/CHN) · M4 (реки = маркированный BorderEdgeModifier, не любое пересечение) · M5
(ОМП = prohibitedWeaponsPosture без operational detail для MVP).

СЛЕДСТВИЕ ДЛЯ ФАЗЫ 3: строить на sequencing Codex (Milestone 0-5, vertical slice первым) +
5 правок до концепта (state machine + polity lifecycle · atomic command pipeline + approval ·
разделить перегруженные сущности goals/tier/tech · сузить vertical slice · бюджеты+gates).
Продуктовые решения Фазы 2 = ВХОД; контракты = Фаза 3. Понизить статусы «ЗАКРЫТ» →
«продуктовое направление принято, контракт в Фазу 3». Не начинать полный roadmap по текущему
ledger — сначала 5 правок.
Codex worktree: ветка codex/design-review (продуктовый код/данные/main/мой worktree НЕ трогал).

## ФАЗА 3-prep: 5 ПРАВОК CODEX (по блокам, потом концепт). Выбор пользователя 2026-07-23.
Правка 1: state machine кампании + polity lifecycle (K1).
Правка 2: атомарный command-pipeline + approval/агентность (K2+K3).
Правка 3: разделить перегруженные сущности — goals (K5) / tier (K6) / tech (K4).
Правка 4: сузить первый vertical slice (K7).
Правка 5: бюджеты + gates (save/prompt/cost/кризисы/лицензии; S9/S14/S1/S13).

### ПРАВКА 1 — STATE MACHINE + POLITY LIFECYCLE (в процессе, 2026-07-23)
Код (подтверждено, = находки Codex K1): GameState = playerCountryId + countries[], НЕТ
campaignStatus/причины/pending-выбора/паузы (GameState.ts:13-22). Country без lifecycle/
predecessor/successor (Country.ts:14-77). Страна денормализована в регионах/дипломатии/
войнах/событиях/modifiers/playerStanding/LLM-ротации. Страна с 0 регионов остаётся полной
записью (EconomyTick делает инертной, не удаляет). ObjectiveTick/AiBehaviorTick молча
возвращаются если игрок не найден.
Контракт (техрешение, по Codex): campaignStatus: active → succession_choice_pending →
active(playerCountryId=выбранный осколок) | defeated(reason). PolityLifecycleResult:
явный перенос при create/dissolve/split/unify — регионы, капитал, дипломатия (relations/
allies/rivals/puppets/sphere/guarantees/sanctions у ВСЕХ ссылающихся), стороны/потери войн,
цели, техника, долги, modifiers, playerStanding, LLM-курсор, playerCountryId. Property-тест:
сумма населения/казны/manpower/регионов сходится, уникальность id, ноль dangling-ref.
Game over ВЫЧИСЛЯЕТСЯ движком после атомарной команды, не из текста LLM.
Продуктовые развилки вынесены: (1) что именно = «государство игрока исчезло»; (2)
правительство в изгнании — MVP или позже.
accepted: game over = ФОРМАЛЬНАЯ КАПИТУЛЯЦИЯ (все регионы аннексированы + капитуляция-
событие; оккупация всех регионов ≠ конец; согласуется с A.2 капитуляция-событием).
Правительство в изгнании = ПОЗЖЕ, не MVP. Puppet/unify — НЕ считать game over (вассал/
преемник существует). ПРАВКА 1 ЗАКРЫТА.

### ПРАВКА 2 — АТОМАРНЫЙ PIPELINE + АГЕНТНОСТЬ — ЗАКРЫТА (2026-07-23)
Техконтракт (Codex K2): тяжёлые команды plan→validate-clone→post-invariants→atomic commit;
макс 1 структурная/ответ ИЛИ WorldMutationPlan; нарратив ТОЛЬКО после commit + appliedResult;
reject→диагностич. факт (не ложный канон); idempotency key на ход (F2). Лечит F1/F3/H1.
accepted (K3 агентность): LLM за страну игрока = ВСЁ ПРЕДЛОЖЕНИЕМ (player_proposed — LLM
НИКОГДА не применяет молча, F52 ЗАКРЫТ; может предлагать любые ходы вкл. войну → очередь
утверждения игрока). Необратимые (война/режим/раскол/ядерное/блоки) — ПОДТВЕРЖДЕНИЕ «точно?»
даже от игрока напрямую. engine_only (капитуляция/game over/числа) — только движок. UI-очередь
предложений+подтверждение = UI-задача (заморожен; команды помечаются policy, применяются
после подтверждения). ПРАВКА 2 ЗАКРЫТА.

### ПРАВКА 3 — РАЗДЕЛИТЬ ПЕРЕГРУЖЕННЫЕ СУЩНОСТИ — ЗАКРЫТА (2026-07-23)
Три разделения (реализуют уже принятое, не меняют продуктовые решения):
- ЦЕЛИ (K5): общий контейнер, типы PlayerObjective (достижение/мечта, советник) /
  AiPolicyGoal (target+приоритет+горизонт+guardrails, движок) / AdvisorGoalView (проекция,
  не source of truth). Исправляет моё упрощение «одна структура goals».
- TIER (K6): powerBand (сила, 5 тиров с инерцией) / diplomaticStatus (признание+Совбез+вето,
  не теряется от ВВП; temporal seat ownership из M3) / regionalLeadership[] (макрорегионы) /
  llmAttention (scheduler по relevance, не титул).
- ТЕХНИКА (K4): capability (что умеет проектировать=тир домена) / inventory-readiness (что
  произведено+averageGeneration) / doctrine-posture (что разрешено; договоры РСМД=posture НЕ
  тех-тир). accepted: модернизация = СРЕДНЕЕ ПОКОЛЕНИЕ + ПЛАТНАЯ МОДЕРНИЗАЦИЯ (парк не
  апгрейдится бесплатно при новом тире; агрегат по слоту, не cohort-микро, не бесплатный апгрейд).
ПРАВКА 3 ЗАКРЫТА.

### ПРОБЕЛ ВЫЯВЛЕН пользователем (2026-07-23) — Правка 4 ПРИОСТАНОВЛЕНА
Пользователь верно поймал: план A/B/C НЕ покрыл системно 4 системы:
- ПРОИЗВОДСТВО: разобрано только военное (слоты A.2); гражданское/промышленное, заводы как
  эконом-юниты — НЕТ. Аудит: «фабрики не моделируются экономически».
- РЕСУРСЫ: базово есть (deposits/extraction/торговля, план 04), но НЕ ПОТРЕБЛЯЮТСЯ (только
  продаются, F из аудита) — нет цепочки ресурс→производство→техника/товары.
- ПОЛИТИКА: politicsTick + перевороты (A.3) есть, но ВНУТРЕННЯЯ политика как система
  (фракции/идеология-сдвиги/реформы/репрессии-реабилитация/плановая↔рыночная) — НЕТ.
  Пользователь хочет (цели 1946: Берия/Хрущёв, реабилитация, отход от плановой).
- КАРТА + MAP FEATURES: касались вскользь; Map Features ДЕКОРАТИВНЫ (иконки не различаются,
  mine/factory/port не генерятся), роль не определена. Механика/данные (не визуал — заморожен).
Эти 4 ФУНДАМЕНТАЛЬНЫ: vertical slice (Правка 4) не определить без них (MVP-петля опирается
на производство/ресурсы; кризис часто политический).
ДОБАВЛЕН БЛОК D (перед Правкой 4): D.1 производство+ресурсы (цепочка ресурс→завод→техника/
товары, потребление) · D.2 внутренняя политика (фракции/идеология/реформы/репрессии/тип
экономики) · D.3 карта+Map Features (что на карте, роль фич, взаимодействие — механика/данные).
Порядок вынесен пользователю. Затем вернуться к Правке 4 (vertical slice) и Правке 5 (бюджеты).

### ПОЛНАЯ ИНВЕНТАРИЗАЦИЯ ПРОБЕЛОВ (по запросу «что ещё пропустили», 2026-07-23)
Метод: сверка закрытого в Фазе 2 с реальным списком механик из гейм-дизайнерского среза
(ledger стр. 594-600) + вердикт V5/V7. Доказательно, не по памяти.
ПРОВЕРЕНО что НЕ пробел: авиация/ракеты/ОМП/ПВО — закрыты в A.2 как слоты (стр. 1099-1108);
дипломатия-механика (отношения/альянсы/гарантии/санкции) — покрыта B.1 + код; переговорный
слой осознанно отложен пользователем до публикации.
СИСТЕМНЫЕ ПРОБЕЛЫ (дизайн-сессия):
- D.1 ПРОИЗВОДСТВО+РЕСУРСЫ: A.1 закрыл макро (долг/ВВП/бюджет), НЕ микро-фундамент — откуда
  ВВП (производство), чем воюет армия, потребление ресурсов (сейчас только добыча+продажа,
  не потребляются). + торговые зависимости/блокада-как-оружие + демография/людской ресурс
  (население «без миграции», мобилизация-рычаг из A.2 есть, миграция/урбанизация/потери нет).
- D.2 ПОЛИТИКА+ИДЕОЛОГИЯ: A.3 закрыл МЕХАНИКУ распада, не ПРИЧИНУ. Идеология/национализм/
  сепаратизм — driver для A.3-распада, B.1-сфер, деколонизации 1946 — НЕ разобран.
  Риск: распад/сферы на произволе движка = рельсы PH (та самая боль). + внутр.политика
  (фракции/реформы/репрессии-реабилитация/плановая↔рыночная — цели 1946 пользователя).
- D.3 КАРТА+MAP FEATURES: «витрина, не пространство приказов»; фичи неразличимы, mine/
  factory/port не генерятся; где заводы/шахты/армии/базы, как игрок взаимодействует — механика/
  данные (не визуал).
НАДСТРОЙКИ (встроить): демография→D.1; торг-зависимости→D.1; событийная система (частично в
советнике/hinge points)→статус в концепте.
КАНДИДАТЫ «НЕ ДЕЛАЕМ v1» (решение пользователя): разведка/шпионаж (для ХВ просится, но крупно,
в коде нет); автостроительство/климат/транспорт (PROJECT.md, не v1); дипломатия-переговоры-роль
(уже отложено). ← вынести пользователю на явное утверждение.
ПОРЯДОК блока D — развилка пользователю. Затем Правка 4 (vertical slice) + Правка 5.

### D.1 — АРХИТЕКТУРА ПРОИЗВОДСТВА решена + РЕВИЗОР ПОЛНОТЫ вернулся (2026-07-23)
Факт по коду (прочитано): 3 изолированных потока — ① сырьё (ResourceTick: deposit→extraction→
stockpile→ТУПИК, не потребляется, только TradeTick) · ② техника (MilitaryTick:87: militarySpending×
доля→equipment, БЕЗ ресурсов/заводов, чистые деньги) · ③ ВВП (EconomyTick:155: industry-сектор =
множитель роста, не мощность). Демография↔армия ЧАСТИЧНО есть (manpower от населения MilitaryTick:34).
РЕШЕНИЕ (глубина D.1): вариант (B) промышленная мощность, НО capacity = АГРЕГАТ РЕГИОНАЛЬНЫХ вкладов
(не абстрактный страновой пул — поправка пользователя, он прав). Доказательство паттерна: ВВП уже так
(region.gdp→агрегация country.gdp EconomyTick:197); region.economy.industry уже региональный (Region.ts:
49-54), мёртв. Потеря региона = вклад выпадает автоматически (filter по ownerCountryId). НЕ микро:
рождается по регионам (движок суммирует), используется на стране (игрок задаёт приоритеты). (C) цепочки
переделов ОТСЕЧЕНО по миссии (микро+раздувание).

РЕВИЗОР ПОЛНОТЫ (независимый агент, 219k ток, read-only) — ключевое:
- ПОДТВЕРЖДАЕТ регион-пул (секторы уже региональные). D.1 наполовину УЖЕ ЕСТЬ и мёртв: developSectors/
  investInSector не вызываются; economyType planned/mixed/market СУЩЕСТВУЕТ (EconomyType.ts), мёртв
  (только стартовый архетип CreateCountry:51, ни один тик не читает). «Оживить», не «строить».
- D.1 и D.3 — ФИЗИЧЕСКИ ОДИН вопрос: промышл. Map Features (factory/steel_mill/refinery/shipyard/mine/
  power_plant, 6 из 24 типов MapFeature.ts) = где стоит мощность. Разбирать вместе.
- КОРЕНЬ под D.2 (я не назвал): у регионов НЕТ демографического состава (этнос/религия/нация) — только
  число population (grep этнос/культура=ноль). Национализм/сепаратизм/деколонизация не на что опереть =
  рельсы. Демо-состав = ФУНДАМЕНТ под D.2/A.3, не фича. (B1 ревизора — критично.)
- НЕСУЩИЕ для 1946 (не надстройки): B2 гражданская война (War всегда между СТРАНАМИ War.ts; Китай 1946=
  костыль 2 страны CHN+TWN; динамич. раскол стабильной страны механики НЕТ) · B3 колонии/деколонизация
  (grep colony/vassal=ноль; колония≠puppet; Индия блобом F36; до 1/3 суши 1946-75) · B4 инсургентность=
  цена оккупации (occupiedBy=бесплатно Region.ts:19; uprising/protest фичи не генерятся).
- ЖЕЛАТЕЛЬНО: B5 асимметрия информации (C.1 принял «ИИ-угроза»+«сложность=объём инфо», механики НЕТ —
  всё видно точно; лёгкий туман дёшев) · B6 миграция/беженцы (F22 заявлена, нет) · B7 мягкая сила/
  идеол.привлекательность (influence=только mil+gdp+гео) · B8 выборы (демократии знают только переворот).
- НЕ ДЕЛАЕМ v1 (ревизор согласен + добавил): полная разведка (оставить B5), климат/погода, логистика/
  снабжение, религия отдельным слоем (свернуть в этно-состав), терроризм (2000), детальные финансы.
- UNKNOWN ревизора: есть ли этно/конфесс. данные во внешнем d:/MAP (если нет — B1 крупная data-задача,
  источник+лицензия не верифицированы); аналоги (Victoria/HOI/EU4) по знанию жанра, не веб-верифицированы.
ПОЛНЫЙ отчёт ревизора — в транскрипте задачи (не в дереве, read-only мандат).
СТРУКТУРА блока D: пользователь выбрал «доузко доделать D.1», находки ревизора встраивать ПО ХОДУ
(не пересобирать план сейчас). D.1+D.3-слияние, демо-состав-фундамент, гражд.война/колонии — учесть
позже как встроенные, порядок D.1→D.2→D.3 сохранён.
D.1 ПОД-РЕШЕНИЯ (2026-07-23, приняты пользователем):
- Потребление сырья = ГЕЙТ (бинарно): нет ключевого ресурса → слот техники не производится. Пользователь
  выбрал из 3 (гейт/множитель/гибрид-рек). РИСК известен и принят: резкие обрывы выпуска — смягчаемо при
  балансе буфером/порогом (моя пометка, не переигрывать выбор).
- Гражданский выход мощности = вклад в ВВП/благосостояние, БЕЗ отдельной сущности «товары» в v1. Хук
  «уровень жизни»/товары-дефицит (историчный СССР-нарратив, стык D.2) — отложено-желательное.
- Рабочая сила = НЕЯВНО v1 (capacity от населения/развития региона; мобилизация-рычаг A.2 создаёт
  напряжение армия/производство). Явный labor-пул — post-v1. Дешёвый хук: мобилизация штрафует выпуск
  (стык A.2↔D.1) — техническое, решено само.
D.1 почти собран (регион-пул мощности + гейт-сырьё + гражд→ВВП + рабсила неявно); ФИНАЛИЗАЦИЯ свода D.1
после серии вопросов пользователя (прервался «есть несколько вопросов», 2026-07-23).

### ЛИЦЕНЗИОННЫЙ АУДИТ (фоновый агент, read-only, 2026-07-23)
Цель: чистота для публикации на GitHub (сейчас бесплатно, потенциально платно позже).
Ключевое разграничение: сырьё scripts/map/sources/** в .gitignore (не шипится), но ПРОИЗВОДНЫЕ
закоммичены (client/public/world_1946.geojson force-add, server/data/scenarios/1946/*.json,
scripts/map/out/*.json) — лицензия источника переходит на производную.
ЧИСТОЕ: Natural Earth (PD, база геометрии) · все npm permissive (675 MIT/49 ISC/20 Apache/25 BSD,
НИ ОДНОГО GPL/AGPL/CC-NC — заражающих нет) · maplibre BSD-3 · jsts/turf EDL-1.0 (выбор) · Gemini
ключ пустой в .env.example (не закоммичен).
БЛОКЕРЫ публикации:
1. [V] НЕТ файла LICENSE + противоречие: README.md:3 «личный НЕКОММЕРЧЕСКИЙ проект», server/
   package.json:13 "ISC", client "private:true". Без LICENSE код = «all rights reserved»,
   open-source юридически нельзя; «некоммерческий» конфликтует и с OSS, и с монетизацией. БЛОКЕР ЦЕЛИ.
2. [V] CC-BY 4.0 geoBoundaries (границы США/Китай/др. в world_1946.geojson) — атрибуции НЕТ нигде =
   формальное нарушение. Правится строкой NOTICE. Коммерцию CC-BY разрешает.
3. [U] Исторический Китай 1947-49 (china_hist, ссылка «Virtual Shanghai» build_china_1946_v2.py:263) —
   источник/лицензия НЕИЗВЕСТНЫ; риск NC (блокирует платно) или SA/атрибуция. Проверить до релиза.
4. [V] OFL-шрифты (EB Garamond/IBM Plex/Oswald, client/public/fonts) без текста лицензии = наруш. OFL.
   Правится добавлением OFL.txt.
РЕКОМЕНДАЦИИ: код MIT (или Apache-2.0 c патентным грантом; оба разрешают будущую монетизацию,
правообладатель — пользователь, closed будущие версии можно, отозвать опубликованное нельзя);
данные отдельно под CC-BY 4.0 с атрибуцией geoBoundaries; файл NOTICE/THIRD_PARTY (geoBoundaries
цитата Runfola 2020 + NE + OFL + jsts/maplibre); синхронизировать README/package.json; self-host
глифов подписей (сейчас CARTO CDN MapView.tsx:141 — чужой ToS + точка отказа).
НА ПОЛЬЗОВАТЕЛЕ (агент не смог): провенанс d:/MAP (decisions/2026-07.md:107 — ownership/коды 1946;
факты не охраняются, но если собран из лицензированной БД — database rights); источник Китая 1947-49;
немецкие зоны оккупации; hero.png (сирота, вероятно удалить). МУСОР: license_page.html в корне =
HTML «404 Not Found» (артефакт, НЕ лицензия) — удалить (это тот ?? файл из стартового git status).
БУДУЩЕЕ (TODO:315-320, ещё нет в репо): флаги (flag-icons MIT), текстура морей (Gemini-генерация —
проверить права на AI-изображения). ПОЛНЫЙ отчёт — транскрипт задачи.

### ИДЕНТИЧНОСТЬ + СХЕМА ВЛИЯНИЯ LLM — ФУНДАМЕНТАЛЬНОЕ РЕШЕНИЕ (ядро концепта Фазы 3, 2026-07-23)
Контекст: пользователь усомнился в направлении цикла (не поддакиваю ли; не переусложняем ли; не
теряем ли свободу PH; не слишком амбициозно). Разобрали идентичность игры.
ПРОБЛЕМА: дрейф к «Victoria 3 + нарратор» — LLM всё больше комментатор самодвижущейся симуляции.
Свобода PH (LLM двигает мир) — коммерческая ценность («игрокам нравится свобода PH»), но несла боли
(выдуманные числа, рельсы, цена). Пользователь: «хочу чтобы модель ВЛИЯЛА на мир, не только текст».
РЕШЕНИЕ (принято): Geopolis = детерминированная симуляция, где LLM — РЕЖИССЁР+АВТОР событий, НЕ
сценарист чисел. Схема влияния = **АЛФАВИТ ПРИМИТИВОВ ВОЗДЕЙСТВИЯ**: малый набор (~15-20) элементарных
примитивов-глаголов (изменить_отношение/сместить_правительство/разжечь_конфликт_в_регионе/сдвинуть_
настроение_группы/бегство_капитала/...); LLM свободно КОМБИНИРУЕТ их в любое событие (свобода «ЧТО»),
движок ВАЛИДИРУЕТ предпосылки + СЧИТАЕТ числа (надёжность «можно ли / насколько»). Алфавит vs 11 фикс-
команд = буквы vs готовые слова. Свобода PH + надёжность движка в одной схеме.
ВЫБОР: ШИРОКИЙ алфавит (пользователь) — свобода > безопасность, ценой сложности валидатора. ДЕТАЛИ
алфавита (состав примитивов, контракт валидатора) = ОТДЕЛЬНАЯ БУДУЩАЯ СЕССИЯ (пользователь отложил).
СЛЕДСТВИЯ (ПЕРЕОПРЕДЕЛЯЮТ прошлые блоки — учесть в концепте Фазы 3):
- Спец-механики (перевороты/гражд.война/восстания из A.3/блока D) = НЕ отдельные тики, а ПРИМИТИВЫ +
  предпосылки. Сокращает число систем → ответ на «слишком амбициозно».
- Богатство СОСТОЯНИЯ мира (демография/экономика/отношения) — СОХРАНЯЕМ/наращиваем: примитивам нужна
  опора для предпосылок и последствий. «Не переусложнять» = про МЕХАНИКИ, НЕ про СОСТОЯНИЕ.
- Демо-состав регионов (B1 ревизора) ПОДНЯЛСЯ: фундамент не только под D.2/A.3, а под ВСЮ схему влияния
  (примитив «восстание» не проверить без «кто населяет / почему недоволен»).
- 4 зоны свободы LLM в концепт: режиссёр кризисов (движок даёт порог→LLM выбирает ветку/подачу→движок
  считает) · голос мира (нарратив) · переводчик намерения игрока (playerIntent→валидные примитивы) ·
  альт-исторические развилки. ГРАНИЦЫ: не числа, не произвол создания/удаления стран (только lifecycle-
  команды), не карта напрямую, не скриптовые рельсы (движок даёт пороги, не сценарий).
ЧЕСТНАЯ ЦЕНА (НЕ серебряная пуля): валидатор примитивов = новое сердце сложности (слабый→произвол PH;
строгий→LLM бессильна) · балансировка формул каждого примитива = работа · предпосылки требуют богатого
состояния. Схема ПЕРЕНОСИТ сложность (20 механик → 1 арбитр + богатое состояние), не устраняет.
НЕРЕШЁННЫЕ РИСКИ рамки (мои, честно): «режиссёр кризисов» может стать новыми рельсами если LLM навязывает
игроку события (граница «давление vs навязывание» не проведена) · «влияние в рамках» может быть косметикой
если движок предрешает исход (нужно N разных веток, не 1) · эмерджентность НЕ бесплатна от количества
(проектируется связями систем). Разобрать при детализации алфавита.
ПРИНЦИП против расползания: геймплейная система обязана иметь точку влияния (LLM/игрок); чистый фон, не
питающий другие системы = кандидат на рез из v1.

### БЛОК D.1 (ПРОИЗВОДСТВО + РЕСУРСЫ) — ЗАКРЫТ, свод (2026-07-23)
Глубина (B) промышленная мощность = АГРЕГАТ региональных вкладов (регион-пул, НЕ страновой — паттерн
region.gdp→country.gdp EconomyTick:197; потеря региона = вклад выпадает авто, filter ownerCountryId).
ОЖИВИТЬ мёртвое (не строить с нуля): region.economy.industry-сектор (Region.ts:49-54), developSectors/
investInSector (не звались вне тестов), economyType planned/mixed/market (EconomyType.ts, мёртв).
Потребление сырья = ГЕЙТ бинарно: нет ключевого ресурса → слот техники не производится (риск резких
обрывов принят, смягчаемо буфером/порогом при балансе).
Гражданский выход мощности → ВВП/благосостояние, БЕЗ отдельной сущности «товары» v1 (хук уровень жизни/
товары-дефицит-СССР — отложено-желательное, стык D.2).
Рабочая сила = НЕЯВНО v1 (capacity от населения/развития региона; мобилизация A.2 штрафует выпуск —
дешёвый хук A.2↔D.1). Явный labor-пул — post-v1. (manpower от населения уже есть MilitaryTick:34.)
Военный выход: техника = мощность + сырьё(гейт) + деньги — заменяет «чистые деньги» MilitaryTick:87.
D.1 ≈ D.3: промышленные Map Features (factory/steel_mill/refinery/shipyard/mine/power_plant, 6 из 24
MapFeature.ts) = ГДЕ стоит мощность — разбирать ВМЕСТЕ с D.3 (находка ревизора).
СТЫК С АЛФАВИТОМ: производство = СОСТОЯНИЕ мира (сохраняем — богатство для предпосылок примитивов);
влияние игрока/LLM на производство (инвестиция/саботаж/национализация) = через ПРИМИТИВЫ позже, не
спец-команды. Три роли (движок считает · LLM озвучивает+кризисы · игрок приоритеты/инвестиции/
мобилизация/запас сырья) — зафиксированы в сессии.
СЛЕДУЮЩЕЕ: D.2 В СВЕТЕ АЛФАВИТА = демо-состав регионов (фундамент-состояние) + политические примитивы,
НЕ спец-механика переворотов. Стоп-точка — жду отмашки.

### БЛОК D.2 (ПОЛИТИКА + ИДЕОЛОГИЯ, в свете алфавита) — ЗАКРЫТ, свод (2026-07-23)
Факт: политика на уровне СТРАНЫ (PoliticsState: 4 оси stability/legitimacy/corruption/governmentSupport +
ideology/governmentType строки-ярлыки); регион политически ПУСТ (Region.ts: population/urbanization/
stability, нет «кто населяет»); ideology влияет на базисы (PoliticsTick) но не движется; economyType
planned/mixed/market (EconomyType.ts) МЁРТВ (не читается тиками); переворотов в тике НЕТ (оси дрейфуют).
СОСТОЯНИЕ — демо-состав региона = СРЕДНИЙ (принято): доминант + 1-3 меньшинства (нация/культура + опц.
конфессия) с долями. Настроение НЕ хранится — движок выводит из (идеология власти vs группа + экономика +
репрессии/уступки + оккупация). Лёгкий слой, НЕ Victoria-pops. НАПОЛНЕНИЕ ~1366 регионов = крупная data+
лицензия задача (этно-источник не найден — ревизор+лиценз-агент UNKNOWN; как морские зоны — отложенное,
отдельный агент позже).
ИДЕОЛОГИЯ = ДВИГАЕМАЯ, ФОРМА = ГИБРИД спектр+зоны (принято; ПЕРЕСМОТР: сначала предлагал дискретные из
осторожности, пользователь верно усомнился, пересмотрел в пользу гибрида). 2 непрерывные оси под капотом
(экономическая лево-право × политическая авторитаризм-демократия) — движок хранит КООРДИНАТЫ; ИМЕНОВАННЫЕ
ЗОНЫ сверху (регион спектра = «коммунизм»/«фашизм»/… для читаемости LLM/игроком). Даёт: нюанс (СССР≠
Югославия≠Китай на ярлыке одинаковы, на спектре разные), плавный дрейф, союзы = близость координат, и
ГЛАВНОЕ — недовольство группы = ГЕОМЕТРИЧЕСКАЯ ДИСТАНЦИЯ «позиция власти vs позиция группы» (убирает ручные
таблицы «X недоволен при Y», прямой стык с демо-составом + примитив разжечь_сепаратизм). Размен по нашему
принципу: усложняет СОСТОЯНИЕ (координаты стран), УПРОЩАЕТ механику (недовольство/союзы = геометрия, не
таблицы). Примитив сдвинуть_идеологию = плавное смещение координат. Стартовые координаты ~128 стран 1946 =
data-задача (субъективна, но именованные зоны дают проверяемость). Чистый спектр отклонён (нечитаемо для
LLM/игрока), чистые дискретные отклонены (нет нюанса/геометрии недовольства).
economyType ОЖИВИТЬ: отдельная ось от идеологии, статистически связана (коммунизм→плановая, но возможен
рыночный социализм/госкапитализм). Модификатор: плановая = гос-контроль производства (стык D.1), ниже
коррупции-от-рынка, ниже роста/инноваций; рыночная наоборот. Примитив провести_реформу двигает. Цель 1946
«отход от плановой» = серия реформ с политической ценой.
ВЫБОРЫ (ревизор B8): примитив выборы для демократий (легальная смена власти/курса, иной ритм чем переворот);
детальные циклы post-v1, примитив в алфавите с начала.
ПОЛИТИЧЕСКИЕ ПРИМИТИВЫ в алфавит: сместить_правительство · сдвинуть_идеологию · провести_реформу ·
разжечь_сепаратизм · репрессировать↔уступить · выборы. Спец-механики (переворот/гражд.война/восстание —
находки ревизора B2) = СБОРКИ примитивов+предпосылки, НЕ отдельные системы.
Три роли: движок (хранит демо-состав, выводит недовольство, валидирует предпосылки, считает последствия) ·
LLM (режиссирует полит-события из примитивов) · игрок (реформы/репрессии/уступки/смена курса, реакция на
кризисы). СТЫК: демо-состав = фундамент под сепаратизм/A.3-распад/B.1-сферы/деколонизацию/всю схему влияния.
СЛЕДУЮЩЕЕ: D.3 карта + Map Features (слит с D.1: где на карте мощность/базы/фичи, взаимодействие). Стоп-точка.

### БЛОК D.3 (КАРТА + MAP FEATURES, слит с D.1) — ЗАКРЫТ, свод (2026-07-23)
Факт: MapFeature (24 типа: поселения/промышленность/военные/инфра/политические) = ЧИСТЫЙ ДЕКОР — тип несёт
только coordinates/name/tags/visibleAtZoom, НИ ОДНОГО игрового атрибута (MapFeature.ts); MapFeatureService =
CRUD-список без логики. Генерация частична (generateMapFeatures.ts): столицы+города(>1M) да; ПОРТЫ=заглушка
(isCoastalRegion всегда false:116); фабрики по порогу development/infrastructure>0.5 частично; steel_mill/
refinery/shipyard/mine/power_plant/военные/инфраструктура/политические — НЕ генерятся ничем. Ни одна фича ни
на что не влияет. Подтверждает аудит «фичи декоративны, живёт ~1».
РЕШЕНИЕ = ПРОИЗВОДНАЯ ВИЗУАЛИЗАЦИЯ (принято). Ловушка обойдена: мощность уже в region.economy.industry (D.1);
фичи НЕ второй источник истины, а ОТОБРАЖЕНИЕ. Генерация = проекция состояния: factory от industry-сектора,
mine от extraction, база от военного присутствия, порт от прибрежности (починить isCoastalRegion через
соседство с океан-зоной — данные есть). Приказы адресуются к РЕГИОНАМ, не фичам (примитив повредить_
производство(регион)→сектор, фича показывает результат); точечные фича-цели («разбомбить мост») post-v1.
Политфичи (protest/uprising) = событийный след примитивов D.2 (разжечь_сепаратизм→uprising, временные
expiresAt — механизм есть). Карта-как-ввод-приказов = UI (заморожен), post-заморозка; механически приказы
уже к объектам карты. Отклонено: полноценные носители (передел архитектуры + дублирование с D.1); чистый
декор (противоречит D.1/ревизору). Три роли: движок (генерит фичи проекцией, чинит генерацию) · LLM
(примитивы→событийные фичи) · игрок (видит что где, приказы к регионам, клик→инспектор есть).
СТЫК: D.3 замыкает D.1 (где мощность физически на карте) БЕЗ дублирования состояния.

## ═══════ БЛОК D (ПРОИЗВОДСТВО/ПОЛИТИКА/КАРТА) — ЗАКРЫТ ЦЕЛИКОМ ═══════
D.1 производство+ресурсы (регион-пул мощности, гейт-сырьё, гражд→ВВП, оживить мёртвое) · D.2 политика+
идеология (демо-состав доминант+меньшинства, идеология гибрид спектр+зоны, economyType-реформы, полит-
примитивы) · D.3 карта+Map Features (производная визуализация). + ФУНДАМЕНТ: идентичность = алфавит
примитивов воздействия (LLM режиссёр, не сценарист чисел). Демо-состав = фундамент под всю схему влияния.
ВСЕ СИСТЕМНЫЕ БЛОКИ (A/B/C/D) + идентичность ЗАКРЫТЫ.
ОСТАЛОСЬ до Фазы 3: Правка 4 Codex (вертикальный срез — минимальная играбельная петля, в свете алфавита;
прямой ответ на «амбиции» — построить узкое играбельное) · Правка 5 (бюджеты/гейты save/prompt/cost/crises/
licenses) · затем Фаза 3 концепт-документ + дорожная карта (план 11), ядро = алфавит примитивов.
DATA-ДОЛГ накоплен (отложенные наполнения, не блокируют дизайн): демо-состав ~1366 регионов + этно-источник/
лицензия · стартовые координаты идеологии ~128 стран · морские театры+граф · tech-поколения · стартовая
дипломатия+тиры · преемники распада · барьеры-реки · макрорегионы. + ЛИЦЕНЗИИ (блокеры публикации, см. выше).

### БЛОК D.3 — ПЕРЕОСМЫСЛЕН ЗАНОВО (2026-07-23), SUPERSEDES «производную визуализацию» выше
Два указания пользователя: (1) при разборе механик начинать С НУЛЯ, не якорясь на существующем коде
(→ память design-mechanics-from-scratch-first); (2) Map Features ДИНАМИЧЕСКИЕ — движок/модель умеют
СОЗДАВАТЬ/МЕНЯТЬ (порт строят, столица переезжает). Моё «производная визуализация» это ЛОМАЛО (через число
состояния столица не переместится, порт не построить). Пересобрано с чистого листа.
ТРЕБОВАНИЯ (с нуля): показывать массовое · нести уникальные места · ДИНАМИКА (создать/менять/двигать/
разрушать) · клик→инспектор+история места · не дублировать/не раздувать.
МОДЕЛЬ C (ПРИНЯТА) — гибрид по природе объекта:
- Массовое количественное (мощность/добыча/население/недовольство) → ПРОИЗВОДНЫЕ СЛОИ раскраски (8 режимов
  уже есть), меняется через состояние региона, НЕ хранится пообъектно.
- Уникальные объекты (столица/порт/верфь/ядерный/крепость/landmarks + новые deposit/nuclear_site/
  fortification) → ХРАНИМЫЕ ДИНАМИЧЕСКИЕ объекты; создаются/двигаются/разрушаются ЯВНО; их мало → дёшево.
- События (восстание/протест/border_dispute) → ВРЕМЕННЫЕ объекты (примитив создаёт, expiresAt чистит).
ДИНАМИКА = ЕДИНЫЙ МЕХАНИЗМ ПРИМИТИВОВ (ПРИНЯТО): игрок и LLM меняют карту ОДНИМ алфавитом. Строительство
игрока (построить_порт/заложить_верфь/возвести_крепость) = те же примитивы, что применяет LLM; движок
валидирует предпосылки (побережье для порта). НЕ отдельный build-путь (один валидатор, без дублирования
систем). Возвращает СТРОИТЕЛЬСТВО как геймплей — рычаг игрока на карте (ревизор просил «минимальный build»;
прямой ответ на «карта=пространство действий, не витрина»). СЛЕДСТВИЕ: алфавит примитивов РАСШИРЯЕТСЯ на
карту — построить_объект/переместить_объект/разрушить_объект (не только политика/дипломатия). Единый язык
изменения мира для игрока и LLM.
ИСТОРИЯ МЕСТА (идея пользователя, ПРИНЯТА с условием): каждый уникальный объект/значимый регион копит
ЛОКАЛИЗОВАННУЮ хронику (Берлин: 1948 блокада→1953 восстание→1961 стена); клик→инспектор показывает. Делает
места живыми+уникальными («Берлин твоей партии ≠ чужой»), альт-историю осязаемой. Ложится на chronicle
(сейчас глобальный→+локализованный)+примитивы (применение к месту=запись)+LLM-режиссёр. УСЛОВИЕ: капирование/
рекурсивная суммаризация (боль unbounded chronicle/eventHistory F20/F49 — миссия запрещает раздувание save);
копят ТОЛЬКО значимые места, не каждый пустой регион.
Три роли: движок (производные слои; хранит+валидирует уникальные/событийные объекты; история места с капом) ·
LLM (примитивы создают/меняют объекты+события; озвучивает историю) · игрок (строит через примитивы; клик→
инспектор+история). Факт: MapFeatureService уже имеет create/update/delete (динамику код поддерживает — моё
«чисто производное» её бы выбросило); массовое убрать из хранения в слои. D.3 ЗАКРЫТ (переосмыслен).

### ПРАВКА 4 (ВЕРТИКАЛЬНЫЙ СРЕЗ, Codex K7) — ЗАКРЫТА, спецификация первого милстоуна (2026-07-23)
Разобрано С НУЛЯ (мета-урок). Vertical slice = минимальная ПОЛНАЯ вертикаль через весь стек, играбельная —
НЕ «все системы узко». Проектируем (не кодим) — станет первым милстоуном дорожной карты (прямой ответ на
«не слишком ли амбициозно»: одна вертикаль вглубь вместо десяти систем вширь).
ПРИНЦИП (расхождение с Codex): Codex предлагал внешнюю петлю (стартовая дипломатия→давление ИИ→война/мир).
Пересмотрено: срез должен бить в САМОЕ РИСКОВАННОЕ = валидатор примитивов («новое сердце сложности»), не в
войну. Срез = ПЕРВАЯ реализация алфавита на ОДНОМ кризисе через полный цикл.
ВЫБОР (принято): внутренний политический кризис · сценарий СССР + Прибалтика/Украина (игрок ЗА СССР —
играет, не наблюдает; цель 1946 пользователя) · глубина = ТОЛЬКО ЦИКЛ недовольства (БЕЗ отделения/рождения
государства — lifecycle-контракт в срез не тянем).
ПЕТЛЯ: ① тики живут, недовольство группы растёт от демо-дистанции (идеология власти vs группа на спектре) +
экономика · ② порог → pendingWorldFact «кризис в регионе X» · ③ LLM режиссирует событие из примитивов
(разжечь_недовольство + создать_событие + нарратив), движок ВАЛИДИРУЕТ предпосылку · ④ игрок решает
примитивом (подавить / уступить-автономия / реформа-сдвиг идеологии) · ⑤ движок детерминированно: подавил →
недовольство↓ кратко, легитимность/дистанция↑ (загнал вглубь); уступил → ↓ но другие меньшинства осмелели;
реформа → медленный сдвиг · петля: новое состояние → новое давление. Отклик: хроника + история места +
объект на карте.
ДОКАЗЫВАЕТ: валидатор примитивов работает на НЕТРИВИАЛЬНОЙ предпосылке (демо-дистанция, не просто число).
РЕАЛИЗОВАТЬ НОВО: демо-состав СССР + 1-2 нацрегиона (вручную) · расчёт недовольства (дистанция + экономика) ·
детекция порога · минимальный алфавит ~5 примитивов (разжечь_недовольство / подавить / уступить / реформа /
создать_событие) · валидатор предпосылок · путь игрок→примитив · отклик (хроника + история места + карта-объект).
ПЕРЕИСПОЛЬЗУЕТСЯ: тики, PoliticsState, pendingWorldFacts, chronicle, LLM-цикл, MapFeature CRUD.
ВНЕ СРЕЗА: война / море / дипломатия / D.1-глубоко / полный демо-состав (1366) / полный алфавит / красивый UI /
отделение-lifecycle. СЛЕДУЮЩЕЕ: Правка 5 (бюджеты/гейты save/prompt/cost/crises/licenses), затем Фаза 3 концепт.

### ПРАВКА 5 (БЮДЖЕТЫ + ГЕЙТЫ) — ЗАКРЫТА (2026-07-23)
5 числовых пределов под миссию (без раздувания/полного мира/дорого/микро):
- SAVE: <~3-5МБ даже в долгой кампании; кап + рекурсивная суммаризация chronicle/eventHistory/истории места
  (боль F20/F49); гейт = сжатие старого, не отбрасывание.
- PROMPT: <~8-10k ток/ход даже поздно; кап секций + context-cache статичных Instructions (4.5k) + агрегаты
  не весь мир (есть); гейт = приоритизация секций при переполнении.
- COST: ГИБРИД ПРОВАЙДЕРОВ (принято) — провайдер-абстракция: BYO-key облако (мощно, ноль затрат разработчика
  → устойчивая бесплатная публикация) + ЛОКАЛЬНАЯ модель (приватно/бесплатно, данные дома — закрывает исходную
  приватность-заботу пользователя) + ручной путь (есть в коде). Советник = отдельная дешёвая/локальная модель
  (пользователь хотел UI-настройку моделей). Телеметрия токенов РЕАЛИЗОВАТЬ (H5 — сейчас слепо по цене).
  КЛЮЧЕВОЙ ИНСАЙТ: детерминированное ядро (движок валидирует примитивы + владеет числами) делает СЛАБУЮ
  локальную модель ЖИЗНЕСПОСОБНОЙ — PH не мог (слабая модель = мусор чисел), Geopolis может (движок = страховка
  от слабости). Конкурентное преимущество архитектуры + решение приватности.
- CRISES: ДИНАМИЧЕСКИ (принято) N = base + масштаб(размер · нестабильность · число меньшинств), HARD-CAP сверху
  ≤~5 чтобы не завалить (миссия без микро); остальные давления тлеют фоном/агрегатом, всплывают по остроте.
- LICENSES: ГЕЙТ РЕЛИЗА (не разработки) — v1 строим свободно, публикацию блокируем до зелёного: реестр источников
  + NOTICE (атрибуции geoBoundaries CC-BY / OFL-шрифты) + замена несовместимых + выбор лицензии (MIT код /
  CC-BY данные) + провенанс d:/MAP и Китая 1947-49. Не число — условие релиза.

## ═══════ ВЕСЬ ДИЗАЙН-ЦИКЛ ЗАВЕРШЁН ═══════
Фаза 0 (аудит) · Фаза 1 (research) · Фаза 2 блоки A/B/C · ИДЕНТИЧНОСТЬ (алфавит примитивов) · блок D
(D.1 производство / D.2 политика+идеология / D.3 карта+динамические объекты+история места) · правки Codex 1-5
(1 state machine / 2 атомарный pipeline / 3 разделение сущностей / 4 вертикальный срез / 5 бюджеты). ВСЁ ЗАКРЫТО.
ОСТАЛОСЬ: ФАЗА 3 — концепт-документ + дорожная карта (синтез всего в единый источник; ядро = алфавит примитивов
воздействия; первый милстоун = вертикальный срез СССР-нацрегион). Это НАПИСАНИЕ синтеза, не новые развилки.

### ИЗУЧЕН ADVISOR-МАТЕРИАЛ ПОЛЬЗОВАТЕЛЯ (чат Z.ai GLM, PH-прогон 1946→1952) — 2026-07-24
Пользователь дал экспорт чата, где строил советника для своей партии Pax Historia (роль СССР, старт 1946).
Изучено: промт советника + продвинутый марксистский COMPRESSED RULEBOOK (resource/action costs, crisis
clocks, must-say-no rule, stability/legitimacy, world-system tags Core/Periphery/Neocolony, политэконом-типы,
transition pathways, circuit of capital, revisionism / two-line struggle / VPR, capitalist restoration
[shock therapy / state-capitalist], socialist planning [cybernetic], guerrilla / protracted people's war /
quick strike war, decolonization timeline, историч. события 1946-2008, October Road / core insurrection) +
JSON game state (techSnapshot / gdpSnapshot по странам + текстовые события с mapChanges createMapFeature /
transferRegionOwnership; партия развилась 1946→1952: СССР выиграл Корею, блок 62/38, египетский переворот,
Вьетминь наступает) + лог приказов игрока (постановления СНК: атом «Бородино» Курчатову/Берии, МЭСМ, флот
«Глубина», изоляция Хрущёва, «Щит Вождя» медаудит Сталина, агентура по всем направлениям).
СОХРАНЁН: .agent/reference/pax-historia-advisor-chat-1952.md (956K, шапка-провенанс + контент).
ПОДТВЕРЖДАЕТ наши решения (PH-механика ↔ наше): must-say-no rule ≈ ВАЛИДАТОР ПРИМИТИВОВ; crisis clocks ≈
дин.кап кризисов + режиссура; revisionism accumulation (соц→госкап дрейф) ≈ идеология-спектр-дрейф;
delayed consequences (откр/скрытые) ≈ примитивы + история места; distance/logistics ≈ морские зоны;
independence movements / internal colonies ≈ демо-состав + сепаратизм; tags world-system ≈ economyType +
идеология-слой.
ИГРОВОЙ ПОЧЕРК пользователя (EVIDENCE, не догадка): ролевой отыгрыш ПРИКАЗАМИ естественным языком (не
кнопки), историчность до имён/проектов/дат, РАЗВЕДКА/тайные операции ЦЕНТРАЛЬНО (каждый ход), многодоменность
одного хода (атом+флот+жильё+дипломатия+медицина разом), альт-история МАТЕРИАЛЬНЫМИ действиями.
ПОДТВЕРЖДАЕТ боль PH: весь rulebook (тысячи строк) + весь state (JSON всех стран + все события + все приказы)
в ОДНОМ промте (десятки тыс. токенов, дорого); LLM генерит события + mapChanges + числа (gdpSnapshot).
РЕШЕНИЯ: разведка ОСТАЁТСЯ post-v1 (пользователь подтвердил — срез узкий; разведка = ветка примитивов позже,
НЕ тяжёлая система). rulebook PH = карта ГЛУБИНЫ на будущее Geopolis (revisionism/world-system/two-line/
циклы капитала → движковые системы/предпосылки примитивов), НЕ v1 (границы амбиций — тот же вопрос).
ДЛЯ ФАЗЫ 3: наш подход = сохранить ГЛУБИНУ + ролевой отыгрыш PH, убрав цену (движок числа, агрегаты в промт,
примитивы под валидатором). Advisor-промт пользователя = образец роли/тона нашего советника (immersion, RU-
вывод, буллеты/заголовки, «speculative future consequences, don't say anything will happen for sure», не
раскрывать что это игра).

### АНАЛИЗ РАСШИРЕННОГО SIMULATOR-ПРОМТА + СИСТЕМА ПРОЕКТОВ / ГОНКИ ВЕХ (2026-07-24)
Пользователь скинул расширенный promt-«улучшение» PH (event generation/квоты/ротация, map rules, living
world, tags, project tracking) + Tech&Economy advisor-protocol. Сохранён:
.agent/reference/pax-historia-simulator-rules-extended.md.
АНАЛИЗ (не поддакивание): 80% промта = работа ДВИЖКА, возложенная на LLM. Костыли-самопризнания
пользователя = доказательство: «count events before finalizing» (LLM не держит квоту), «PROGRESS
CONSISTENCY CHECK, 42% after 3 years recalculate» (LLM врёт проценты), «NAME MATCHING exact or don't
touch» (LLM теряет имена→дубли), «#1 map-breaking error: createPolity for existing» (LLM дублирует),
«MUST SAY NO RULE» (LLM говорит да невозможному), «maintain mental rotation» (LLM не держит state между
вызовами). ⇒ сильнейшее подтверждение архитектуры Geopolis: это ТЗ на движок в форме промта.
ЧЬЯ РАБОТА: движок = scheduler событий/ротация, tag-система (состояние), project tracking (проценты),
map-применение (по ID не именам), rank recalc, autonomous AI (imperatives), map-инварианты. LLM = event
detailing (WHO/WHAT/WHY), тон, режиссура, advisor-анализ. Правило: считать/помнить-между-ходами/точно-
матчить = движок; рассказать интересно = LLM.
ЗОЛОТО в Geopolis почти 1:1: Tech&Economy Analysis Protocol → спека СОВЕТНИКА (пороги: deficit<-10%GDP,
industrialOutput<30%US, unemployment>10%/5% план→волнения) · Total Defeat/Colony rebellion (rebel→subject
не overlord, catastrophic triggers) → спека PolityLifecycle (правка Codex 1) · Living World cause-effect →
принцип эмерджентности через связи · Event Detailing → нарративное качество LLM · Player Action Processing
→ чинит F50 (обратная связь хода).

СИСТЕМА ПРОЕКТОВ (разобрано с нуля):
- КЛЮЧ: проект = ОТЛОЖЕННЫЙ ПРИМИТИВ С ПРОГРЕССОМ (временнóе измерение алфавита, не отдельная система).
  Обычный примитив срабатывает сразу; проект = примитив(ы) с прогрессом, применяется при 100%.
- ОТКРЫТАЯ СИСТЕМА (решение пользователя, критично для альт-истории): НЕ жёсткий список вех (=рельсы).
  LLM/игрок СОЗДАЮТ проекты динамически (начать_проект(тип,цель,эффект)) — Марс, ОГАС, что угодно.
  Хранение = открытая JSON-структура проектов в state.
- РАЗДЕЛЕНИЕ (моё дополнение против боли PH): LLM задаёт МЕТА (что/цель/категория/желаемый эффект),
  ДВИЖОК задаёт ЧИСЛА (стоимость/время оценивает по КАТЕГОРИИ+состоянии: Марс=space+rocketry-разрыв→
  движок считает; НЕ LLM выдумывает). Completion-эффекты = из ПАЛИТРЫ примитивов (престиж/tech/модификатор),
  не произвол: Марс→престиж+tech, ОГАС→модификатор_экономики(плановая+). LLM выбирает эффект из
  валидируемого набора, величину считает движок. ← ACCEPTED пользователем (2026-07-24, «Согласен по
  проектам»; провенанс закреплён в ledger, не только память чата — по запросу Фаза-3-сессии).
- Три роли: движок (прогресс+=f(вложение,мощность D.1,предпосылки); stalled если нет ресурса; 100%→
  примитивы) · игрок (начать_проект примитивом, приоритет вложения, решение при stalled) · LLM (озвучивает
  вехи 25/50/100%, режиссирует кризис проекта, НЕ считает).
- СТЫКИ: стоимость=деньги+мощность D.1 (проект конкурирует за мощность) · completion→Map Feature D.3 /
  tech B.3 / unlock · предпосылки→валидатор примитивов · ЛИМИТ проектов (admin capacity из промта: base 3
  +индустрия/стабильность −войны/turmoil) против микро (миссия) · stalled→кризис D.2 (бьёт легитимность).
- ИСТОРИЧЕСКИЕ ЯКОРЯ + открытость (гибрид): исторические проекты/вехи (Sputnik57/Луна69/РДС-1)=seed
  (движок знает контекст+дедлайн=hinge points, ориентир не рельса); новые (Марс/ОГАС)=динамически поверх.

ГОНКИ ВЕХ = обобщённый класс (принято): космос+ядерная(B.3)+тех-прорывы — ОДИН механизм (цепочка проектов→
ГЛОБАЛЬНАЯ веха-соревнование→первый достигший получает престиж+capability). Не плодит системы, объединяет
новое (космос) с решённым (ядерное B.3). Тоже ОТКРЫТЫЕ (Марс=новая веха, не зашита).
ПРЕСТИЖ вехи = ВСЕ ТРИ (пользователь): мягкая сила/третий мир (B1/B7) + внутр.легитимность (D.2) + tech/
военный бонус. Движок применяет как примитивы при достижении.
ПРЕДСТАВЛЕНИЕ: график %готовности+краткая сводка (данные-прогресс готовы у движка; график=UI post-заморозка).
ГРАНИЦЫ «что проект/что нет» — пользователь отложил на разработку (калибровка, не архитектура).

### ИИ-ДЕРЖАВЫ ↔ ПРОЕКТЫ + НАЗВАНИЯ + ВЫБОР (2026-07-24)
Вопрос пользователя: LLM придумывает проекты для ИИ-стран? Принцип (защита от PH-боли): НЕ постоянно.
- ИИ-проекты ведёт ДВИЖОК детерминированно: цели (C.1) + историч.императивы (seed из PH-промта) + состояние —
  тот же механизм, что AiBehaviorTick. Держит V2 (мир живёт без LLM), детерминизм (replay), дёшево.
- Альт-история ИИ ЭМЕРДЖЕНТНА: движок выбирает по ТЕКУЩЕМУ состоянию (не скрипт); игрок изменил баланс →
  ИИ реагирует другими проектами. + РЕДКИЕ LLM-искры (альт-проект = режиссёрское событие через примитив,
  валидируется движком). LLM НЕ менеджерит все страны (иначе PH: думать за мир, терять state, дорого).
- Роль LLM: озвучивать ИИ-проекты + изредка вбрасывать искру. Баланс: склонность «редко, движок-костяк»
  (рек; пользователь явно не зафиксировал — при разработке).
НАЗВАНИЯ: имя = НАРРАТИВ (LLM), НЕ механика (движок). Движок ведёт проект как СТРУКТУРУ (тип space / цель
Марс / tier / прогресс) + рабочее имя-шаблон или seed для историч.якорей; LLM УЛУЧШАЕТ до колоритного по
стране/эпохе (СССР→«Союз»/«Н1»; США-Марс-первыми → LLM генерит «Ares» и т.п.). Изменившийся мир меняет
ЯРЛЫК, не механику. Мир живёт без LLM (дефолт-имя всегда есть).
ВЫБОР проекта ИИ = обобщённая UTILITY-функция (score = вклад_в_цели×веса_целей + предпосылки_выполнимы +
по_карману + историч.якорь-бонус + реакция_на_игрока). Веса на ЦЕЛЯХ страны (данные C.1), НЕ ручные веса
под каждый проект/страну (128×N не масштабируется — против миссии). Кандидаты из пула (доступные по tech/
эпохе/якорям/целям), топ в рамках лимита проектов. Новый проект (Марс) оценивается ТОЙ ЖЕ функцией — без
дописывания весов. ДЕТАЛИ (коэффициенты utility, границы «что проект», баланс искр) — отложены на разработку.

### АЛФАВИТ ПРИМИТИВОВ — детальная дизайн-сессия (Фаза-3-сессия + пользователь, 2026-07-24)
Проведена соседней сессией с пользователем (закрыт главный пробел ядра §2). ДЕТАЛИ = docs/PRIMITIVES.md
(source of truth, коммит 5d29ad5); §2 CONCEPT обновлён ссылкой. Сводка для координации ledger:
- КОНТРАКТ: примитив = {verb, target, params-качественные}; движок держит preconditions (pass/reject
  ЦЕЛИКОМ) + magnitude (считает сам) + effects-палитра (whitelist полей). Гранулярность = атомарное
  воздействие игрового смысла. 2 класса: мягкие / структурные (макс 1/ход). Расширение = КОМБИНАТОРИКА,
  не число глаголов. Имена = АНГЛИЙСКИЙ.
- СОСТАВ ~18 (тестовый v0): reuse diplomacy/sanction/war/peace; семейства раздельные (build/move/destroy,
  form/join/leave, split/create/merge); lifecycle на словаре country (polity — кандидат post-v1);
  incite_unrest vs stoke_discontent открыт (по имени переменной состояния). Полный список — PRIMITIVES.md.
- ВАЛИДАТОР: 3 фазы validate/compute/apply; reject целиком; нарратив ТОЛЬКО после commit; палитра-whitelist;
  magnitude ВСЕГДА движок (политика/экономика детерм., бой сид ±25%); частичный reject = гибрид по классу;
  TOCTOU = последовательно с пересчётом / кап verb-цель-ход.
- КОМБИНИРОВАНИЕ+ТЕМП: порядок массива = очередь исполнения; капы ~8-10 мягких + ≤1 структурный/ход.
- РИСКИ РАМКИ проверяемы ТЕСТОМ (закрывает мои ранее открытые риски рельсы/косметика/хаос): у кризиса ≥2
  путей (не рельса); разные ответы → разное состояние = property-тест (не косметика); примитив трогает ≥1
  другой домен (не хаос-в-углу).
ТРИ НОВЫХ ПРОДУКТОВЫХ РЕШЕНИЯ (приняты с пользователем — зафиксировать явно):
1. ГИБРИД-ИНТЕРФЕЙС игрока: свободный текст замысла (LLM переводит в примитивы, показывает распознанное на
   ПОДТВЕРЖДЕНИЕ) + быстрые кнопки для рутины/кризисных развилок. Примитивы игроку НЕВИДИМЫ — сохраняет
   свободу текста PH. Стык с зоной свободы «переводчик намерения».
2. ТЕМП = ДВА СЛОЯ событий: фон (движок, все страны, без лимита, дёшево) + режиссура (LLM только значимое).
   Лимит ~10 примитивов = на ОДНО событие, НЕ на мир-год. Длинный ход = цепочка остановок (движок проматывает
   спокойное, ТОРМОЗИТ на пороге значимого, зовёт LLM). Кризисов-фокусов ≤5 (Правка 5). ИИ-рутина = движок
   (utility §5.8), драма major = LLM. Решает стоимость длинного хода.
3. ЧИСЛА-В-ОПИСАНИИ-ОТ-ДВИЖКА (уточнение принципа «LLM не считает»): НЕ запрет чисел в нарративе, а запрет
   ВЫДУМЫВАНИЯ. Числа-последствия считает движок; числа в ОПИСАНИИ события — тоже от движка (appliedResult
   после commit возвращает LLM реальные величины, она вплетает в нарратив). События с цифрами, но ПРАВДИВЫМИ.
Всё консистентно с фундаментом (алфавит/валидатор/бюджеты/ИИ-utility), уточняет и развивает. Детали —
docs/PRIMITIVES.md. Синхронизировано в ledger по запросу Фаза-3-сессии.

## Ledger решений

### Фаза 2, Блок 1 «Видение игрока» — В ПРОЦЕССЕ (2026-07-23)

Ответы пользователя (заход 1+2), статус proposed:
- Базовый цикл: **гибрид «наблюдение + кризисы»** — кризисы (война/дефолт/переворот/
  ультиматум) переключают в плотный режим решений с ценой.
- Ставки: **вплоть до game over** (падение государства = конец кампании).
- PH-плюсы сохранить: свобода текста, переменный темп, хроника мира. Дипломатия-
  переписка ВТОРИЧНА для пользователя + «очень абузна в PH» → если публиковать,
  делать ОТДЕЛЬНОЙ РОЛЬЮ и анти-абузной (не в ядре).
- Референсы ощущения: **EU4/Victoria** (макро-управление державой) + **Civilization**
  (долгая дуга, понятность, «ещё один ход»).
- Обязательные механики (из выбора + дополнений пользователя): перевороты/смена
  режимов; море (десанты/блокады); распад/рождение государств; ядерное оружие/
  сдерживание; + СФЕРЫ ВЛИЯНИЯ, ВАЛЮТНЫЕ ЗОНЫ, МЕЖДУНАРОДНЫЕ ОРГАНИЗАЦИИ, РАЗВИТИЕ
  ТЕХНОЛОГИЙ, ИИ-ДЕРЖАВЫ С ЦЕЛЯМИ И РЕАЛЬНОЙ УГРОЗОЙ + НАСТРОЙКА СЛОЖНОСТИ.
- Пользователь попросил: (а) «предложи ещё варианты» обязательных механик;
  (б) РАСПИСАТЬ каждую систему — как считают движок и LLM, «не будет ли рельсами».
- ВСКРЫТО НЕДОПОНИМАНИЕ: пользователь планировал 3 сценария (1836/1946/2000), удивлён
  «1 эпохе». Источник: TODO.md «Постоянные рамки» — решение 2026-07-06 «охват ДО
  РЕЛИЗА только 1946; 1836/2000 — заглушки». Это про ПОРЯДОК релиза, не отказ от
  видения PROJECT.md (три эпохи 1836-2100). F48: заглушки сейчас сломаны. ОТКРЫТЫЙ
  ВОПРОС для подтверждения: «механика эпохо-агностична, данные/релиз инкрементально
  от 1946» vs «три эпохи параллельно» (моя рекомендация — первое).

Player Experience Goal (ЧЕРНОВИК, финализировать после разбора систем и «запрещённого»):
Geopolis — одиночная grand strategy альт-истории; игрок ведёт державу через
десятилетия. База — наблюдение за живым миром + намерения свободным текстом,
переменный темп; кризисы переключают в плотные решения с ценой вплоть до game over.
Мир не на рельсах: державы преследуют цели и реально угрожают (настройка сложности).
Ощущение: макро-держава (EU4/Vic) + понятная долгая дуга (Civ), БЕЗ микроменеджмента.
Числа — движок, LLM — рассказчик+двигатель в рамках капованных команд.
«Запрещённое» — НЕ финализировано (пользователь хочет сначала понять механику систем).
Следующий шаг: эталонный разбор 1 системы (перевороты) как образец «движок/LLM/
анти-рельсы» → согласовать формат → пройти системы по одной (это decision-блоки 2-N).

ЭПОХИ — accepted (2026-07-23): цель — 3 эпохи (PROJECT.md), но релиз/данные
инкрементально от 1946; механику строим ЭПОХО-АГНОСТИЧНО через «профиль эпохи»
(данные/конфиг), НЕ хардкод. Пользователь верно уточнил: системы РАСХОДЯТСЯ по
эпохам. Классификация расхождений (моя, accepted): (1) вкл/выкл подсистемы
(колонизация активна 1836→мертва 2000; нефть/мировой рынок включаются по
eraIntroduced — механизм УЖЕ есть в resourceCatalog + EraDefinition); (2)
пере-калибровка тех же систем (прямые войны 1836 vs прокси — не другая война, а
отсутствие модификатора «ядерное сдерживание» в поведении ИИ); (3) новые
надстройки поздней эпохи (2000: межд. организации на первом месте, терроризм,
информация/кибер, космос, ИИ). Всё через слой «профиль эпохи» поверх общего ядра.
Поправка пользователю (зафиксировать): в 1836 торговля БЫЛА (меркантилизм/колонии),
но иная по структуре — не «нет торговли», а «другая модель». Порядок систем
внедрять от простого, не всё сразу (запрос пользователя — вести sequencing в
каждом блоке).

Порядок разбора систем (согласован): Блок A (экономика/долг → война+море →
перевороты+распад/рождение) → Блок B (сферы влияния+патрон-клиент → МО+валютные
зоны → технологии+ядерное) → Блок C (ИИ-державы с целями+сложность → холодный
старт). Пользователь: «начинай с блока A».

### Блок A.1 — ЭКОНОМИКА и ДОЛГ (decision-блок, в процессе, 2026-07-23)

Перечитан живой код (EconomyTick.ts, defines/economy.ts, EconomyState.ts) —
УТОЧНЕНИЕ АУДИТА: risk-premium на долг УЖЕ реализован (debtMonthlyInterestRate =
0.003 + 0.013×(1−health), health=(legit+stab)/2; ~3.7%→19%/год). Штраф росту ВВП
выше долг/ВВП 0.6; факт «на грани дефолта» при долг/ВВП 1.0. Значит рекомендация
C8 частично в коде. F60 УТОЧНЯЕТСЯ: последствия долга ЕСТЬ (ставка↑, рост↓, факт),
но (а) слабые, (б) долг НЕ бьёт по стабильности/легитимности напрямую (health→ставка
есть, долг→health НЕТ — спираль не конвертируется в политкризис), (в) нет game over,
(г) у игрока нет аустерити → копит до 625×. Плюс F21 (ВВП не умеет падать — рецессии
нет; инфляция без клампа), F61 (популяция логистическую ещё не получила).
Продуктовые развилки вынесены пользователю (как экономика доводит до game over +
глубина модели). Sequencing экономики: (1) фундамент-калибровка (рецессия/инфляция-
границы/логистич. популяция + guard-тест 50 лет) → (2) связь долг/инфляция/
безработица→стабильность → (3) дефолт как кризис-событие при пороге 1.0 → (4)
game over-хвост (стык с политикой/распадом, позже).

РЕШЕНИЯ блока A.1 (accepted 2026-07-23):
- **ОПОРА ДИЗАЙНА — определение game over** (глобальное, влияет на A.2 войну и A.3
  распад): game over ТОЛЬКО при полном исчезновении государства игрока (аннексия/
  завоевание/потеря всей территории и суверенитета). РАСКОЛ/РАСПАД (пример СССР
  1991) = НЕ конец, игра продолжается за преемника. ПЕРЕВОРОТ = НЕ конец (та же
  страна, другой режим). Следствие: мир устойчив и драматичен; экономика НИКОГДА
  не даёт game over напрямую.
- Глубина экономики: **текущая + последствия** (макро: ВВП-якорь + доли бюджета +
  долг; БЕЗ Victoria-микро). Добавить: рецессия (ВВП умеет падать), инфляция с
  границами, логистич. популяция.
- Механика «как долг→потрясение»: **комбинация** (эмерджент долг/инфляция/
  безработица→стабильность↓ + дефолт-кризис-событие при пороге долг/ВВП=1.0,
  движок даёт числа+удар, LLM разыгрывает) — взято как техрешение (рекомендация),
  ЦЕЛЬ = кризис/переворот/раскол, НЕ game over. Цепочка: экономика → нестабильность
  → переворот ИЛИ раскол (продолжение) → и только военное добивание ослабленной
  страны → game over.
- ОТКРЫТО для A.3 (распад): при расколе страны игрока — за кого продолжает игрок
  (крупнейший преемник? наследник столицы/ядра? выбор игрока?).
Блок A.1 ЗАВЕРШЁН. Далее: A.2 (война + море) — game over-определение применяется там.

ФОРМАТ-ЭТАЛОН (обязателен для КАЖДОГО системного разбора, зафиксировано после
замечания пользователя 2026-07-23, что A.1 отошёл от обещанного): трёхролевая
таблица как на переворотах — (1) Движок: детерминированные числа + выставляет
ФАКТ при пороге, НЕ решает исход; (2) LLM: факт+контекст → нарратив + капованная
команда, решает разыграть/игнорировать, НЕ трогает числа; (3) Движок применяет
команду структурно, числа последствий — его. + блок «почему не рельсы» (3 уровня:
порог=следствие решений игрока, не расписание; LLM решает как/разыграть ли;
игрок — причина, не зритель). ВАЖНО: вес ролей РАЗНЫЙ по системам — чем измеримее
система, тем меньше в ней LLM (экономика: в мирный ход LLM=0, подключается только
в кризис; перевороты: LLM центральный — решает исход). Это дизайн-сигнал, не
недоработка. A.1 переоформлен в этот формат, решения не изменились.

## Неизвестные / ограничения сессии

- Живой вызов Gemini не выполнялся (нужен ключ в server/.env; free-tier квота может
  быть исчерпана — см. TODO про live gated-тест). Стоимость — только fixture-оценка.
- Repowise MCP заявлен, но не использовался в 0a (deferred tools; прямой скан дешевле);
  оценю в 0b по необходимости.
- p50/p95 стоимости хода — UNKNOWN (телеметрии нет, H5); предложить instrumentation.
- `.codex/visualizations/...` worktree (interface-from-scratch) — вне мандата, не трогаю.
