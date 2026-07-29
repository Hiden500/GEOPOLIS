# Структурные глаголы — подчинение и состав держав
Status: active
Owner: Claude (Opus), worktree `.claude/worktrees/structural-verbs`, ветка `claude/structural-verbs`
Starting commit: c6cbf90

## Objective and observable outcome

Алфавит примитивов получает глаголы, меняющие ПОДЧИНЕНИЕ и СОСТАВ государств:
`puppet`, `annex` (обязательный минимум), затем `merge_countries`,
`create_country`. Тем же действием закрывается долг: юридический статус
(`politics.sovereigntyStatus`/`overlordIds`) и рантайм-отношение
(`diplomacy.puppets`) перестают расходиться — механика вассалитета меняет оба
поля одним действием, и инвариант становится рантайм-проверяемым.

Наблюдаемый результат:

- `puppet`/`annex` в `PRIMITIVE_VERBS`, `PRIMITIVE_SCHEMAS`, палитре, сверке,
  капах хода, контракте промта, обеих локалях;
- `findStateViolations` держит «марионетка не суверенна, её сюзерен —
  в `overlordIds`»; сейв и транзакция ответа отказываются принимать состояние,
  где это нарушено;
- аннексия последнего региона страны игрока ведёт в машину состояний кампании
  (`defeated / absorbed`), а не удаляет игрока из партии;
- суммы (население, казна, живая сила, число регионов) сходятся в обе стороны:
  деление (`split_country`) и сложение (`merge_countries`).

## Scope and constraints

**Меняю:**

- `server/src/primitives/` — `types.ts`, `primitiveSchemas.ts`, `palette.ts`,
  `reconciliation.ts`, `PrimitiveEngine.ts`, `polityLifecycle.ts`,
  `rejections.ts`, `outcomes.ts`, `invariants.ts`, `turnBatch.ts`, новый
  `subordination.ts`;
- `server/src/llm/primitiveContract.ts` — описание новых глаголов для модели;
- `shared/src/types/politics/PrimitiveOutcome.ts` — при необходимости;
- `client/src/i18n/locales/{ru,en}/primitiveOrders.json`,
  `primitiveOutcome.json`, `primitiveRejection.json` — строки двух локалей;
- `docs/PRIMITIVES.md`, `docs/DIPLOMACY.md`, `docs/CONCEPT.md`,
  `docs/DECISIONS.md`, `docs/TODO.md`.

**Не трогаю:**

- `client/src/map/**` — замороженный домен;
- клиентские компоненты вне словарей i18n (параллельная сессия
  `claude/interface-rebuild`);
- `simulation/diplomacy/affinity.ts`, коридоры мягких глаголов, калибровку
  существующих коэффициентов;
- семейство `form_bloc`/`join_bloc`/`leave_bloc` — сущности «блок» в состоянии
  не существует, это отдельная сессия;
- миграцию сохранений: `SAVE_VERSION` поднимается только при изменении формата,
  и тогда это называется явно.

**Пересечения с параллельными задачами.** Активны `claude/interface-rebuild`
(клиент), `claude/1946-map-coastline-fixes` (геометрия карты),
`codex/design-review`, `codex/milestone-0-audit`. Мой scope — сервер, shared
(только при необходимости) и словари i18n; `client/src/components/**` и
`scripts/map/**` не трогаю. `shared/src/types/` — правлю только если новый
глагол потребует поля результата, и это фиксируется в Decision log.

## Assumptions and unknowns

- **Предположение:** сегодня в рантайме в `diplomacy.puppets` не пишет НИКТО
  (проверено grep: только сценарий заполняет, `WarService`/`DiplomacyTick`
  читают, `countryRefs` переносит). Значит перенос инварианта в
  `findStateViolations` не ломает существующие пути.
- **UNKNOWN на старте:** проходит ли раскол страны, участвующей в отношениях
  подчинения, палитру — `countryRefs` переносит `politics.overlordIds`, но
  этого пути в палитре `split_country` НЕТ. Проверяется тестом до правки.
- **UNKNOWN:** укладываются ли `stage_coup`/`hold_election` в сессию. Если нет —
  остаются в `docs/TODO.md` явной записью.

## Alternatives and selected decision

Заполняется по ходу — см. Decision log.

## Progress

- [x] Baseline снят: server 1161 passed | 1 skipped (71 файл), client
      143 passed (16 файлов), обе typecheck зелёные.
- [ ] Проверить гипотезу о палитре `split_country` и `overlordIds`.
- [ ] Свести подчинение: `subordination.ts`, инвариант, палитра раскола.
- [ ] `puppet`.
- [ ] `annex` + переход кампании.
- [ ] `merge_countries` (сложение сумм).
- [ ] `create_country`.
- [ ] Проверка на боевых данных 1946.
- [ ] Docs footprint.

## Discoveries

- `evaluateCampaign` зовётся ТОЛЬКО в `SimulationEngine` (конец месяца).
  `split_country` зовёт `applyLifecycleToCampaign` прямо в apply — прецедент
  для `annex`, которому иначе пришлось бы ждать конца месяца.
- `invariants.ts` уже разрешает страну без регионов (§7.1), поэтому `annex`
  над последним регионом не обязан никого удалять.

## Decision log

## Validation

```text
server: npx tsc --noEmit -p tsconfig.json
server: npm test
client: npx tsc --noEmit -p tsconfig.app.json
client: npm test
client: npm run build
root:   python scripts/map/validate_demographics_1946.py
root:   python .agent/evals/public/run_public_evals.py
```

Каждый новый тест прогоняется против восстановленного старого поведения;
падение показывается в отчёте.

## Rollback / containment

Работа изолирована в worktree `.claude/worktrees/structural-verbs` на ветке
`claude/structural-verbs`. Откат — отказ от ветки целиком либо `git revert`
конкретного коммита. Формат сейва не меняется, пока это не объявлено явно;
данные сценария 1946 не правятся.

## Final outcome
