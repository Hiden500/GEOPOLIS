# Страны и зависимые территории сценария 1946
Status: active
Owner: /root
Starting commit: 3c6cf29

## Objective and observable outcome

На снимке `1946-01-01` каждая существовавшая политико-территориальная единица
сценария имеет собственного владельца регионов и отдельную запись Country,
если она не была частью другой администрации. Колониальный статус выражается
через `subject_of`/дипломатию, а не через семь искусственных мировых блоков
`QCG/QCF/QCP/QCN/QCU/QCZ/QCS`.

Работа идёт по одному континенту. После каждого континента generated outputs,
историческая конфигурация и документация образуют самостоятельный валидный
commit.

## Scope and constraints

- Единственный сценарий: 1946, дата снимка `1946-01-01`.
- Источник текущей геометрии: существующие континентальные builders и
  `scripts/map/out/ownership_1946.json`; новые полигоны не рисуются без
  доказанного пробела.
- Исторические сущности и исключения авторятся в конфигурации, generated JSON
  напрямую не является единственным источником истины.
- Зависимые территории остаются зависимыми; разделение не означает
  независимость.
- Современный ISO-код не сохраняется как отдельная страна, если единица на
  дату снимка не существовала: такой код ремапится на исторического владельца.
- 1836/2000, экономика, население, военный баланс и MapFeature не входят в scope.
- Предсуществующие незакоммиченные `docs/TODO.md` и `docs/OBJECTIVES.md` не
  редактируются и не включаются в commits.

## Assumptions and unknowns

- Базовый каталог MAP содержит 206 записей, из них 92 `colony`; 89 записей
  сейчас схлопываются в семь блоков.
- Для большинства колоний существующие ISO-геометрии совпадают с границами
  административных единиц 1946 с достаточной для текущей карты точностью.
- `UNKNOWN`: отдельные переходные территории (Индия/Пакистан, Индонезия,
  Индокитай, Руанда-Урунди, Палестина, островные зависимости) требуют
  континентальной сверки и явного remap/override.
- Full rebuild не считается воспроизводимым, пока отсутствуют внешние sources
  и dependency manifest. Стандартный import/generate/validate путь должен
  проходить; geometry full rebuild отмечается отдельно как `UNKNOWN`.

## Alternatives and selected decision

- Отклонено: просто удалить `country_merge.json`. Генератор пересоздаёт его,
  а современные коды включают несуществовавшие в 1946 отдельные территории.
- Отклонено: сделать все исходные 206 записей независимыми странами. Это
  теряет колониальные отношения и создаёт анахронизмы.
- Выбрано: исполняемая историческая конфигурация по континентам с двумя
  операциями: `preserve` для отдельной Country-сущности и `ownerOverrides`
  для объединения современных кодов с реальной администрацией 1946.

## Progress

- [x] Зафиксировать baseline, dirty state и механизм семи колониальных блоков.
- [x] Южная Америка: GUY/SUR/GUF/FLK и Falkland Islands Dependencies.
- [x] Северная Америка и Карибы.
- [x] Европа и европейские островные территории.
- [ ] Африка.
- [ ] Азия.
- [ ] Океания.
- [ ] Удалить оставшиеся искусственные блоки и доказать полноту каталога.
- [ ] Синхронизировать каноническую документацию без перезаписи чужих docs.

## Discoveries

- `generate_country_registry.py::build_merge_map()` автоматически схлопывает
  все `subject_type == "colony"` при наличии более одной колонии у сюзерена.
- Исходный каталог уже хранит исторические имена и `subject_of`; основной
  разрыв — ownership remap, а не отсутствие страновых записей.
- `South Georgia and the South Sandwich Islands` как отдельная современная
  территория возникла в 1985; на дату снимка это Falkland Islands
  Dependencies, поэтому `SGS` не должна стать отдельной Country.
- Standard pipeline потребовал отдельные population anchors. UN A/4192 дал
  GUY=377k, SUR=168k, GUF=27k; Falkland Gazette дал FLK=2,239 и Dependencies
  390. Это заменило прежние приблизительные доли внутри мировых блоков.
- Point-in-polygon столичных координат выявил неверную эвристику largest-area
  для GUY/SUR; Georgetown и Paramaribo закреплены за регионами 1114/1116.
- В Карибах современные островные ISO-коды не равны администрациям 1946:
  Leeward Islands, Windward Islands и Curaçao and Dependencies моделируются
  отдельными историческими owner, а Cayman/Turks входят в Jamaica.
- Исходный MAP-код `NFD` коллидировал между Newfoundland и Norfolk Island.
  Точечный region override возвращает Norfolk Island Австралии; без него
  граница и население Newfoundland были бы неверны уже в североамериканском
  срезе.
- Европейская часть legacy grouping содержала только Cyprus, Gibraltar и
  Malta. Все три перечислены ООН среди отдельных территорий 1946; UN A/4192
  одновременно дал population anchors 447k/20k/291k.

## Decision log

- 2026-07-17: континенты коммитятся последовательно; до завершения последнего
  континента legacy blocks могут оставаться только для ещё не обработанного
  scope.
- 2026-07-17: спорный суверенитет Falklands/Malvinas не решается игрой;
  стартовый фактический администратор моделируется как GBR, а спор фиксируется
  в provenance.
- 2026-07-17: Южная Америка завершена как 4 отдельные зависимые сущности;
  `SGS` ремапится в `FLK`, а не становится пятой современной страной.
- 2026-07-17: Северная Америка/Карибы завершены как 13 новых owner поверх
  предыдущего среза: самостоятельные владения плюс исторические федеративные
  администрации. Современные Cayman/Turks не выделяются из Jamaica.
- 2026-07-17: Norfolk Island исправлен на `AUS` немедленно, а не отложен до
  Океании, потому что коллизия `NFD` нарушала уже проверяемую границу
  Newfoundland.
- 2026-07-17: Европа завершена сохранением CYP/GIB/MLT как трёх отдельных
  британских зависимостей. Современного раздела Cyprus на снимке нет.

## Validation

Для каждого континента из `D:\Pax Historia LOCAL`:

1. Targeted-тест исторической конфигурации и ownership.
2. `python scripts/map/make_1946.py` (standard path, не full rebuild).
3. `python scripts/map/validate_region_economy_1946.py`.
4. `python scripts/map/test_validate_region_economy_1946.py`.
5. Server scenario/data tests и `npx tsc --noEmit -p tsconfig.json` при
   изменении реестра стран.
6. Проверка generated diff: только ожидаемые owners, страны, capitals,
   diplomacy и производные экономические суммы обработанного континента.

Full geometry rebuild остаётся `UNKNOWN`, пока отсутствуют documented external
inputs и dependency manifest.

### Южная Америка — 2026-07-17

- `python scripts/map/test_country_entities_1946.py`: 4/4 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1366 регионов,
  132 владельца, мировой тотал 2,252,010,355 в допуске.
- `npx vitest run src/simulation/__tests__/campaignSmoke.test.ts` (`server/`):
  1/1 passed.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.
- `python .agent/evals/public/run_public_evals.py`: 132 passed, 0 failed.
- Full geometry rebuild: не запускался; provenance/dependency gap остаётся.

### Северная Америка и Карибы — 2026-07-17

- `python scripts/map/test_country_entities_1946.py`: 6/6 passed.
- `python scripts/map/make_1946.py`: финальный end-to-end rerun exit 0; 1366
  регионов, 145 владельцев, мировой тотал 2,251,652,453 в допуске.
- Read-only generated assertions: 145 Country, ожидаемые capitals/owners,
  отсутствие современных island owners, `OCE-0008 -> AUS`, `NFD` владеет
  только Newfoundland — passed.
- `npx vitest run src/simulation/__tests__/campaignSmoke.test.ts` (`server/`):
  1/1 passed.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.
- `python .agent/evals/public/run_public_evals.py`: 132 passed, 0 failed.
- Один промежуточный запуск pipeline получил транзиентный Windows
  `OSError 22` при записи `regions.state.json`; отдельный fill восстановил
  файл, а следующий полный end-to-end запуск прошёл чисто.
- Full geometry rebuild: не запускался; provenance/dependency gap остаётся.

### Европа — 2026-07-17

- `python scripts/map/test_country_entities_1946.py`: 7/7 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1366 регионов,
  148 владельцев, мировой тотал 2,251,631,453 в допуске.
- Read-only generated assertions: CYP=447k/capital 41, GIB=20k/capital 125,
  MLT=291k/capital 194 — passed.
- `npx vitest run src/simulation/__tests__/campaignSmoke.test.ts` (`server/`):
  1/1 passed.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.
- `python .agent/evals/public/run_public_evals.py`: 132 passed, 0 failed.
- Full geometry rebuild: не запускался; provenance/dependency gap остаётся.

## Rollback / containment

- Каждый континент — отдельный commit; откат возможен обычным revert этого
  commit без переписывания истории.
- Историческая конфигурация аддитивна по континентам, поэтому незавершённый
  проход не меняет ещё не обработанные блоки.
- Generated outputs коммитятся вместе с их source config/code, исключая
  состояние, которое нельзя воспроизвести стандартным pipeline.

## Final outcome

_Заполняется после последнего завершённого континента или при достижении
лимита с точной границей последнего валидного commit._
