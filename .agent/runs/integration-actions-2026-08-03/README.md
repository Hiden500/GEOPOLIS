# Интеграция `claude/actions-to-primitives` — замер на ОБЪЕДИНЁННОЙ базе

Дата: 2026-08-03. Ветка интеграции `claude/integration-actions`
(база — `main` `268e9e7`), в неё влита `claude/actions-to-primitives`
(`a34a384`, её собственная база — `eb03e03`, отставание 27 коммитов).

Все числа сняты ЗАНОВО. Отчёт ветки свидетельством не считается: он получен до
того, как в `main` легли `e6d79d0` (образец ответа перестал врать о форме цели),
`a4ca23d` (промт называет ВСЕ домены) и `35ca124` (страны ротации получили
сдвиги фокуса).

## 1. Живой годовой прогон

```
pwsh -File "D:/Pax Historia LOCAL/scripts/llm-run.ps1" `
  -Run "npx tsx scripts/runCampaignWithLLM.ts --years 1"
```

`gemini-3.6-flash-high`, 12 ходов, 1,7 мин. Артефакты: `campaign-1y.llm.jsonl`,
`campaign-1y.world.csv`.

| Величина | Значение |
|---|---|
| Примитивов применено | 59 |
| Примитивов отклонено | 2 (оба на 12-м ходу) |
| Отказов на ход | 0,17 |
| Квитанций с полем `actions` | 0 (поля не существует) |
| Отказов английской строкой | 0 — оба пришли кодом `schemaInvalid` |

Применённые глаголы: `research_shift` 23, `spawn_incident` 12, `diplomacy` 10,
`repress` 6, `enact_reform` 4, `production_shift` 2, `send_aid` 2.

**Сдвиги фокуса у НЕ-мажоров живы:** 5 применений `research_shift` у 5 разных
не-major стран (CSK, FIN, IRN, KHM, LBR) за 12 ходов = 0,42 на ход. Замер `main`
до удаления канала (`director-prompt-p3-p4-2026-08-02`, 72 хода): 26 применений
у 19 стран = 0,36 на ход. Свойство, доказанное коммитом `35ca124`, перенос на
примитивы пережило.

**Оба отказа — не форма цели.** `target` во всём ответе объектом, как требует
`e6d79d0`. Отклонены два `spawn_incident` без поля `sourceCountryId` (схема его
требует; глагол региональный, и модель, назвав регион, источник опустила). Это
свежая находка объединённой базы, вынесена строкой в `docs/TODO.md`.

## 2. Пробник перенесённых глаголов (модель не участвует)

```
npx tsx scripts/probeMigratedVerbs.ts --sample 40
```

Полный вывод — `probe-migrated-verbs.txt`. Числа ветки воспроизведены:

| Проба | Применено | Отказ |
|---|---|---|
| `guarantee` | 40/40 | — |
| `research_shift` (домен из данных) | 40/40 | — |
| `research_shift` (домен выдуман) | 0/40 | `unknownResearchDomain` ×40 |
| `production_shift` | 40/40 | — |
| `build_extraction` (стройка) | 0/40 | `extractionAtMaximum` ×40 |
| `build_extraction` (снос) | 40/40 | — |

Все отказы — структурный код с параметрами; английской строки старого канала не
осталось нигде. Стройка мертва по данным, а не по коду: 2055 пар (регион,
ресурс) с залежью, ниже потолка мощностей — ноль (`docs/IDEAS.md` §12).

## 3. Прочие проверки объединённой базы

- server: `npx tsc --noEmit` чисто; `npm test` — 91 файл, 1411 passed,
  1 skipped (предсуществующий live-LLM гейт). На `main` было 1439 passed при
  92 файлах: ветка удалила `LLMResponseValidator.test.ts` и
  `actionSchemas.test.ts` вместе с каналом и добавила
  `budgetAndCommitmentVerbs.test.ts`.
- client: `npx tsc --noEmit -p tsconfig.app.json` чисто; `npm test` — 16 файлов,
  152 passed.
- public evals: 163 passed, 0 failed. `docs/TODO.md` 1244 строки (порог 1400),
  `docs/DECISIONS.md` 1514 (порог 2000).
