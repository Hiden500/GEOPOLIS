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
- [x] Африка.
- [x] Азия.
- [x] Океания.
- [x] Удалить оставшиеся искусственные блоки и доказать полноту каталога.
- [x] Синхронизировать каноническую документацию без перезаписи чужих docs.

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
- Инвентаризация только `country_merge.json` недостаточна: upstream местами
  пишет заморские территории прямо на метрополию. Общий аудит direct overseas
  owners нашёл Martinique/Guadeloupe и BES-острова, обходившие merge-map;
  для таких случаев добавлен исполняемый `regionOwnerOverrides`.
- Африка содержала не только legacy colonies, но и известный дубль одной
  территории: RWA/BDI обе назывались Ruanda-Urundi. Исторический owner `QRU`
  заменяет две современные границы на одну бельгийскую администрацию.
- На дату снимка BIOT ещё не существовала, а Comoros не была отдельной от
  Madagascar; source codes `IOT`/`COM` поэтому не становятся Country.
- Азиатский source `IND` смешивал British India с отдельными Jammu and
  Kashmir, Sikkim, Portuguese India и French India; все четыре границы уже
  выражаются существующими полигонами и не требуют новой геометрии.
- Единственный Asian land-полигон без владельца был Spratly Islands. До
  появления disputed-territory model он включён как low-confidence French
  Indochina claim, поэтому pipeline больше не теряет этот регион.
- Современный `ARE` скрывал семь самостоятельных Trucial Sheikhdoms; текущая
  геометрия содержит ровно по одному полигону на каждое и допускает чистое
  разделение без рисования границ.
- Пять океанийских сущностей (Papua and New Guinea, Solomon Islands, Tonga,
  New Hebrides, Western Samoa) уже существовали в исходном каталоге со
  правильными `subject_of`/`subject_type` и уже текли в сгенерированный
  реестр (population anchors были заведены заранее) — разрыв был чисто
  документационный, не пробел в данных.
- `New Hebrides` (`VUT`) и, попутно найденный, Anglo-Egyptian Sudan (`SDN`) —
  единственные две записи каталога с `subject_of` в виде списка (двойной
  сюзерен). Код `subject_of[0] if isinstance(subject_of, list) else
  subject_of` в `puppets_by_suzerain` брал только первого сюзерена — Франция
  (для VUT) и Египет (для SDN) молча выпадали из `diplomacy.puppets`.
  Исправлено отдельным заходом (см. Decision log).
- `country_merge.json` уже не содержал ни одной записи на легаси-блоки
  (`QCG/QCF/QCP/QCN/QCU/QCZ/QCS`) до начала работы над Океанией — механизм
  оказался полностью вытеснен курируемой конфигурацией раньше, чем ожидалось.
  `COLONY_BLOC_CODES` и связанный с ним код в `build_merge_map`/`make_country`
  удалены как мёртвый код (см. Decision log) — вероятная причина "British
  Colonies"/аналогичных названий, которые пользователь видел на карте, это
  старый сейв/сессия, начатая до того, как последний колониальный блок
  перестал использоваться.

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
- 2026-07-17: Африка завершена: отдельные колонии сохранены, AOF/AEF и
  Ruanda-Urundi восстановлены как исторические составные администрации,
  direct-owner Réunion отделён от France, а BIOT/Comoros remap исправлен.
- 2026-07-17: Азия завершена на уровне доступной ADM1-геометрии. Помимо
  демонтажа legacy blocs восстановлены Tibet, Indian States/enclaves,
  Trucial Sheikhdoms и отдельные British Southeast Asia territories;
  Indonesia/Vietnam разделены по воспроизводимым крупным зонам контроля.
- 2026-07-17: городские Allied bridgeheads в Java/Sumatra и локальные фронты
  Indochina не аппроксимируются целыми провинциями; это было бы менее точно,
  чем явная coarse-geometry граница с документированным confidence.
- 2026-07-18: Океания завершена документированием пяти уже корректных
  сущностей (PNG/SLB/TON/VUT/WSM), без изменения владения/дипломатии.
- 2026-07-18: `COLONY_BLOC_CODES` и весь связанный с ним код
  (`build_merge_map` fallback, "X Colonies" name-fallback в цикле стран)
  удалены как подтверждённо мёртвый код — ни один континент больше не
  использует легаси-блоки, полный regen и тестовая батарея дают идентичные
  итоговые суммы до и после удаления.
- 2026-07-18: найден и исправлен баг двойного сюзерена (`subject_of` как
  список) — затрагивал New Hebrides (`VUT`, GBR+FRA) и Anglo-Egyptian Sudan
  (`SDN`, GBR+EGY); оба теперь корректно входят в puppets/sphereOfInfluence
  обоих сюзеренов.
- 2026-07-18 (пользователь): принцип для всего дальнейшего прохода — это не
  глубокий политико-экономический симулятор, местами оправдана игровая
  условность вместо максимальной исторической точности. Применено к Алжиру
  (сворачивается в прямое владение Франции, пересмотр решения по Африке от
  2026-07-17 — Алжир был департаментами Франции с 1848 года, не колонией) и
  явно обсуждено для Занзибара (пользователь подтвердил: остаётся отдельной
  страной, в отличие от Алжира — юридически был отдельным субъектом до унии
  1964 года, не интегрирован со своим сюзереном).
- 2026-07-18 (пользователь): Питкерн → прямое владение Британии (не Фиджи),
  Токелау → прямое владение Новой Зеландии (не Западного Самоа) — оба не
  имели отдельной администрации на месте в 1946 году.
- 2026-07-18 (пользователь): billing/Kuwait-подобная "ресурсная" категория
  отклонена как отдельная ось (концессии — следствие уже существующего
  политического контроля, не независимая ось); вместо этого — `protected_state`
  как уточнение `subjectType` для Кувейта/Бахрейна/Катара/Брунея/Тонги, по
  терминологии UK Home Office 1949 года (Protected State = местный правитель
  сохраняет внутреннее управление, vs Protectorate = Британия строит
  администрацию сама) — механически инертно, только provenance.
- 2026-07-18 (пользователь): цвета зависимых территорий — identity-цвета
  каждой территории сейчас (с оглядкой на будущую независимую идентичность),
  живой пересчёт цвета при смене вассалитета в рантайме — явно отложен:
  это та же архитектура `getDisplayColor`, которую пользователь сам отложил
  2026-06-29 до появления реальной механики annex/puppet; перепроверено
  2026-07-18 — `annex`/`puppet` в `actionSchemas.ts` всё ещё типизированный
  контракт без apply-логики, блокер не снят.
- 2026-07-18 (пользователь): полная миграция `Country.name`/`shortName` на
  `LocalizedText` — не только документация (`historicalNameRu`), реальные
  русские названия должны быть видны в игре для сущностей этого прохода.
- 2026-07-18: Питкерн (~150 человек, губернатор Фиджи по совместительству с
  1898 года) и Токелау (~1000 человек, управлялся дистанционно) свёрнуты в
  прямое владение GBR/NZL соответственно. Anchor'ы GBR/NZL подняты на те же
  суммы (+130/+1000), иначе население терялось бы из мирового тотала —
  тот же класс находки, что и для Алжира/Франции, просто на два порядка
  меньше по величине.
- 2026-07-18: два пробела найдены, но НЕ исправлены в этом проходе — оба
  требуют геометрии, которой сейчас нет, а не только правки конфига:
  **Christmas Island/Cocos (Keeling) Islands** — геометрии нет вообще ни в
  одном `scripts/map/out/*.geojson` (в 1946 были зависимостями Colony of
  Singapore, не GBR напрямую и не Австралии — переданы Австралии только в
  1955/1958); **Фарерские острова** — существовали в устаревшем
  `regions-v2.json` (население ~788k выглядит явно ошибочным для архипелага
  на ~25-30k человек), отсутствуют в текущем live pipeline, и формально вне
  мандата этого файла (никогда не были отчётной Non-Self-Governing Territory
  ООН — интегральная датская территория). `docs/TODO.md` в этом заходе не
  трогается (см. Scope and constraints) — оба пункта логируются здесь как
  кандидаты на отдельное расследование в другой сессии/другим инструментом.

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

### Коррекция Северной Америки/Карибов — 2026-07-17

- `python scripts/map/test_country_entities_1946.py`: 7/7 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1366 регионов,
  150 владельцев, мировой тотал 2,252,030,453 в допуске.
- Martinique/Guadeloupe стали отдельными FRA-зависимостями; Bonaire,
  Sint Eustatius и Saba принадлежат QND.
- `npx vitest run src/simulation/__tests__/campaignSmoke.test.ts` (`server/`):
  1/1 passed; `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.
- `python .agent/evals/public/run_public_evals.py`: 132 passed, 0 failed.

### Африка — 2026-07-17

- `python scripts/map/test_country_entities_1946.py`: 8/8 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1366 регионов,
  171 владелец, мировой тотал 2,285,986,440 в допуске.
- Read-only generated audit: все 128 смен владельца ограничены `AFR-*`;
  добавлены 24 ожидаемые сущности, удалены только `BDI`, `RWA`, `QCS`.
- Девять African-регионов с прямым владельцем-метрополией сверены как
  Tripolitania/Cyrenaica, Fezzan, British Somaliland и Eritrea под военными
  администрациями; иных прямых African-owners не осталось.
- `python scripts/map/validate_region_economy_1946.py` и
  `python scripts/map/test_validate_region_economy_1946.py`: passed.
- `npx vitest run src/simulation/__tests__/campaignSmoke.test.ts` (`server/`):
  1/1 passed; `npx tsc --noEmit -p tsconfig.json`: exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.
- `python .agent/evals/public/run_public_evals.py`: 132 passed, 0 failed.
- Full geometry rebuild: не запускался; provenance/dependency gap остаётся.

### Азия — 2026-07-17

- `python scripts/map/test_country_entities_1946.py`: 9/9 passed.
- `python scripts/map/make_1946.py`: финальный standard pipeline exit 0;
  1367 регионов, 196 стран/владельцев, мировой тотал 2,294,630,940 в допуске.
- Read-only generated audit: все 137 добавленных/изменённых owner assignments
  ограничены `ASI-*`; добавлены 28 ожидаемых сущностей, удалены только
  `ARE`, `QCN`, `QCP`; Asian legacy owners отсутствуют.
- Read-only capital/population/diplomacy assertions: 28 сущностей имеют свои
  регионы и owned capitals; `PHL -> USA`, `JOR -> GBR`, custom dependencies
  присутствуют у правильных suzerains — passed.
- `python scripts/map/validate_region_economy_1946.py` и
  `python scripts/map/test_validate_region_economy_1946.py`: passed.
- `npx tsc --noEmit -p tsconfig.json`: exit 0;
  `npx vitest run src/simulation/__tests__/campaignSmoke.test.ts`: 1/1 passed.
- Первый параллельный `npm test` получил filesystem race в существующем
  autosave integration test (`SaveNotFoundError`); изолированный повтор:
  680 passed, 1 skipped, exit 0.
- `python .agent/evals/public/run_public_evals.py`: 132 passed, 0 failed.
- Full geometry rebuild: не запускался; provenance/dependency gap остаётся.

### Океания — 2026-07-18

- `python scripts/map/test_country_entities_1946.py`: 10/10 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1367 регионов,
  201 владелец (без изменений от документирования — все 5 сущностей уже
  были в итоговом реестре), мировой тотал 2,294,652,067 в допуске.
- Read-only проверка: `country_merge.json` не содержит ни одной записи на
  `QCG/QCF/QCP/QCN/QCU/QCZ/QCS`; ни один из этих кодов не присутствует как
  страна в `countries.json` — легаси-механизм полностью вытеснен, код удалён.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.
- Full geometry rebuild: не запускался; provenance/dependency gap остаётся.

### Фикс двойного сюзерена (VUT, SDN) — 2026-07-18

- `python scripts/map/test_country_entities_1946.py`: 11/11 passed (добавлен
  `test_dual_suzerain_condominiums_are_puppets_of_both`).
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1367 регионов,
  201 владелец, мировой тотал 2,294,652,067 в допуске (без изменений — это
  фикс diplomacy, не владения).
- Read-only проверка сгенерированного `countries.json`: `GBR.diplomacy.puppets`
  и `FRA.diplomacy.puppets` оба содержат `"VUT"`; `GBR.diplomacy.puppets` и
  `EGY.diplomacy.puppets` оба содержат `"SDN"` (раньше `FRA`/`EGY` не имели
  этой записи вообще).
- `puppets_by_suzerain` вынесена в отдельную тестируемую функцию
  `build_puppets_by_suzerain()` вместо инлайн-кода в `main()`.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.

### Protected state: Залив + Тонга — 2026-07-18

- `python scripts/map/test_country_entities_1946.py`: 12/12 passed (добавлен
  `test_gulf_and_tonga_are_protected_states_not_protectorates`).
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1367 регионов,
  201 владелец, мировой тотал 2,294,652,067 в допуске — без изменений
  (метаданные-only, `build_merge_map` сравнивает только с `"colony"`).
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.

### Африка, ретроактивные записи — 2026-07-18

- `python scripts/map/test_country_entities_1946.py`: 12/12 passed (7 новых
  кодов в africa `separate`: LSO/BWA/SWZ/UGA/MWI/MAR/TUN — `QSO` не заведён
  как `preserve` из-за несовпадения `CATALOG_CODE_ALIASES` между `main()` и
  тестовым harness, задокументировано комментарием в коде вместо этого).
- `python scripts/map/make_1946.py`: standard pipeline exit 0; без изменений
  владения (все 7 уже были отдельными странами в данных) — мировой тотал
  2,294,652,067 в допуске.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.

### Алжир → прямое владение Франции — 2026-07-18

- `python scripts/map/test_country_entities_1946.py`: 12/12 passed (DZA
  убран из africa `separate`, добавлена проверка `owner_overrides["DZA"] ==
  "FRA"`).
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1367
  регионов, **200** владельцев (было 201 — Алжир больше не отдельная
  страна), мировой тотал 2,294,652,065 (было 2,294,652,067 — расхождение
  в 2 человека, округление при перераспределении по area внутри
  укрупнившейся Франции, не потеря данных).
- **Найдено и исправлено по ходу:** без обновления anchor для `FRA` население
  Алжира (~8.6М) пропадало бы из мирового тотала — регионы Алжира начинают
  делить фиксированный anchor Франции (40.1М) с материковыми регионами,
  вместо того чтобы прибавлять собственное. Anchor `FRA` в
  `economy_1946/anchors.py` поднят до 48.7М (метрополия + Алжир), отдельный
  anchor `DZA` удалён как более не используемый.
- Server-тест `campaignSmoke.test.ts`: `EXPECTED_COUNTRY_COUNT` обновлён
  201→200 (потребует повторного обновления после Work Item 5 Занзибар (+1)
  и Work Item 6 Питкерн/Токелау (-2) — финальное число будет **199**).
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.

### Занзибар (QZN) — 2026-07-18

- `python scripts/map/test_country_entities_1946.py`: 12/12 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1367
  регионов, 201 владелец (было 200 после Алжира — Занзибар добавляет
  страну), мировой тотал 2,294,882,064 (+230,000 от QZN anchor, ровно
  совпадает — `TZA` остался на 6,900,000 без изменений, население не
  потерялось и не задвоилось).
- Read-only проверка: `TZA` population sum = 6,900,000, `QZN` population
  sum = 230,000 — оба точно совпадают с anchor'ами.
- `EXPECTED_COUNTRY_COUNT` в `campaignSmoke.test.ts`: 200→201.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.

### Питкерн/Токелау → прямое владение — 2026-07-18

- `python scripts/map/test_country_entities_1946.py`: 12/12 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 1367
  регионов, **199** владельцев (было 201 — Питкерн/Токелау больше не
  отдельные страны), мировой тотал 2,294,882,064 (без изменений — anchor'ы
  GBR/NZL подняты на изъятые суммы).
- `EXPECTED_COUNTRY_COUNT` в `campaignSmoke.test.ts`: 201→199 (финальное
  число для этого прохода, если не потребуется больше data-изменений).
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.

### Identity-цвета зависимых территорий — 2026-07-18

- Найдено попутно: `CAN`/`AUS`/`NZL`/`ZAF` (полноценные самоуправляемые
  доминионы, не колонии) до этой правки рендерились БУКВАЛЬНО одним и тем же
  цветом `#c9adb5` — тонировались от GBR наравне с любой колонией. Исправлено
  как часть этого прохода (не было в исходном плане, но напрямую относится к
  задаче "разные цвета для разных территорий").
- `CURATED_DEPENDENCY_COLORS` — identity-цвета для ~120 значимых зависимых
  территорий (все `preserve`-сущности + доминионы + структурные исключения
  VUT/SDN/QZN), приглушённая палитра EU5/HOI4. `tint_from_suzerain()` заменена
  на детерминированный разброс оттенка (hue rotation ±30° + sat/light jitter,
  засеяно кодом территории) для всех остальных зависимых территорий вне
  курированного списка.
- `python scripts/map/test_country_entities_1946.py`: 12/12 passed.
- `python scripts/map/make_1946.py`: standard pipeline exit 0; 199 владельцев,
  мировой тотал не изменился — цвета не влияют на население.
- Read-only проверка: **0 дублирующихся цветов среди всех 199 стран**
  (изначально было 9 коллизий после первого черновика курированного словаря —
  исправлены точечно).
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0.
- **Живая проверка через реальный API** (`POST /game/start`, `scenarioId:
  "1946", playerCountryId: "GBR"`): 199 стран, `CAN`/`AUS`/`NZL`/`ZAF`/`JAM`/
  `HKG`/`KWT`/`QZN` все получили разные корректные цвета — подтверждено
  напрямую через HTTP, не только статическим чтением файла.
- **Попутно найдено и исправлено:** на порту 3000 (proxy target клиента,
  `client/vite.config.ts`) висел ОСИРОТЕВШИЙ node-процесс с 2026-07-17
  01:07 (предыдущий день) — держал в памяти старые данные (145 стран, плоские
  тонированные цвета), из-за чего браузерная сессия показывала устаревшее
  состояние независимо от регенерации файлов. Именно этот класс проблемы,
  вероятно, объясняет более раннее наблюдение пользователя про "British
  Colonies" на карте. Процесс остановлен, сервер перезапущен на порту 3000.
- **Не удалось получить в этой сессии:** пиксельный скриншот карты — `computer
  {action: "screenshot"}`/`zoom` стабильно зависали по таймауту в Browser pane
  независимо от вышеописанного фикса (похоже на отдельную проблему
  окружения/рендеринга, не связанную с данными). Верификация цветов проведена
  на уровне данных (уникальность всех 199 hex, прямой API-запрос), не
  визуально попиксельно — стоит перепроверить визуально в обычном браузере
  или другой сессии перед финальным приёмом, как и предыдущий Срез 2г плана 12
  сталкивался с похожей проблемой видимости Browser pane.

### Билингвальность: LocalizedText для Country.name/shortName — 2026-07-18

- `shared/src/types/Country.ts`: `name`/`shortName` → `LocalizedText`.
- 12 рукописных файлов `server/src/data/countries/*.ts` (1836/2000) —
  механически обёрнуты в `{en: "..."}` (2 файла — `GermanyFRA`/`UK`/`USA`/
  `USSR` — уже были на русском, обёрнуты в `{ru: "..."}` соответственно, без
  нового контента).
- `scripts/map/generate_country_registry.py::make_country()` эмитирует
  `{en, ru?}`; `ru` берётся из нового `name_ru_by_code` lookup (собран из
  `historicalNameRu` в `preserve`-записях конфига + `name_ru` в
  `CUSTOM_COUNTRIES`) — только для реально авторенных сущностей. На дату
  миграции: 105 из 199 стран получили `ru` (все 67 `preserve`-сущностей всех
  континентов + ~38 значимых `CUSTOM_COUNTRIES` записей); остальные — только
  `en`, без выдуманного перевода.
- `server/src/scenarios/scenario1946Schemas.ts`: новая `localizedTextSchema`
  (`{en: string, ru?: string}`) вместо `z.string()` для `name`/`shortName`.
- `shared/src/types/ScenarioInfo.ts::FeaturedCountry.name` → `LocalizedText`
  тоже (тот же слой данных, что и `Country.name`).
- Клиент: все места чтения `Country.name`/`shortName` переведены на
  `getText(x, i18n.language as Locale)` — `ContextPanel.tsx`,
  `inspectorTitle.ts` (+ новый параметр `locale`), `InspectorPanel.tsx`,
  `ScenarioSelector.tsx`, `WorldRankingPanel.tsx`, `DiplomacyBook.tsx`,
  `EventTimelinePanel.tsx`, `GameView.tsx`, `map/GeoJsonLoader.ts`
  (`loadGameMapData`/`updateMapData` получили новый параметр `locale`).
  Заодно исправлены все 5 ранее известных locale-less вызовов `getText()`
  для `region.names` (`docs/LOCALIZATION.md`), включая пропущенные при
  первом проходе `PlayerIntentPanel.tsx`/`TerritoriesPanel.tsx`.
- Сервер: `LLMService.ts` — 6 мест чтения `.name` переведены на
  `getText(x.name, LLM_LOCALE)` (английский промт LLM независимо от локали
  партии, как и раньше для нарратива).
- `python scripts/map/test_country_entities_1946.py`: 12/12 passed.
- `python scripts/map/make_1946.py`: 199 владельцев, тотал не изменился.
- `npx tsc --noEmit -p tsconfig.json` (`server/`): exit 0.
- `npm test` (`server/`): 680 passed, 1 skipped, exit 0 (потребовал фикса
  `scenario1946Schemas.ts` + `Scenario1946.test.ts`/фикстур с plain-string
  `name`/`shortName` в тестовых Country-литералах).
- `npx tsc -b --noEmit` (`client/`): exit 0 (потребовал фиксов сверх
  изначально предполагаемых 5 файлов — реальный список консьюмеров оказался
  шире: `InspectorPanel.tsx`, `ScenarioSelector.tsx`, `WorldRankingPanel.tsx`,
  `DiplomacyBook.tsx`, `EventTimelinePanel.tsx`, `GameView.tsx`, плюс тестовые
  фикстуры/литералы в 6 server-тестах).
- `npx vitest run` (`client/`): 102/102 passed.
- **Живая проверка через реальный API** (`POST /game/start`): 105/199 стран
  с `ru`, ноль стран без `en`; `scenarios/list` (`FeaturedCountry`) отдаёт
  тот же формат.
- **Живая browser-проверка:** после перезапуска обоих dev-серверов (были
  осиротевшие процессы с предыдущего дня — см. Work Item 7) партия за
  Великобританию стартует, карта рендерится (`.maplibregl-canvas` в DOM),
  без ошибок в консоли/ErrorBoundary. **Найдено попутно и не является багом
  текущего кода:** `computer{action:"left_click"}` через `ref` в этой
  Browser pane сессии периодически не долетал до реального DOM-клика (клик
  через `ref` не продвигал экран, хотя `read_page` показывал корректное
  дерево) — обойдено прямым `element.click()` через `javascript_tool`.
  Также `read_console_messages` в этой сессии показывал один и тот же старый
  стек ошибки после множества `navigate()`, не отражая реальное текущее
  состояние страницы (подтверждено прямой проверкой `document.body.innerText`/
  `.maplibregl-canvas` через `javascript_tool` — ошибок не было). Обе находки —
  об инструментах Browser pane в этой сессии, не о коде проекта.
- `computer{action:"screenshot"/"zoom"}` по-прежнему стабильно зависает по
  таймауту в этой сессии (та же находка, что и в Work Item 7) — пиксельный
  скриншот карты не получен; вместо него — прямая проверка DOM/API.

### Фидбек по скриншоту карты — 2026-07-18 (пользователь, 10 пунктов)

Пользователь прислал скриншот живой карты и дал развёрнутый фидбек. Кратко:

1. Map Features (иконки+подписи городов) скрыты (`visibility: 'none'`) —
   зум/размер не доработаны.
2. Подписи стран на карте скрыты — не доработаны.
3. `regions-fill` `fill-opacity` 0.36 → 0.96 — карта рендерилась через
   `#0c1016` (почти чёрный background layer), из-за чего любой цвет выглядел
   гораздо темнее/приглушённее реального hex, а тонкие геометрические швы
   между регионами читались как яркие светлые линии. Это же — вероятная
   причина пункта про "разрывы/белые линии".
4. **Сворачивание 39 небольших территорий/морских баз в прямое владение**
   (Мальта/Гибралтар/Кипр, весь Карибский бассейн кроме Ньюфаундленда,
   British/French Guiana/Suriname, Réunion, Seychelles/St.Helena/Cape Verde/
   São Tomé, большинство Океании кроме PNG/Solomon/W.Samoa/Cook/Tonga/
   New Hebrides) — критерий согласован с пользователем: нет своей монархии
   И население < ~1М И нет установленного самоуправления. Итог: 199 → 160
   стран. Population метрополий пересчитан (как и для Алжира/Питкерна/
   Токелау ранее) — мировой тотал не изменился (2,294,882,067, было
   2,294,882,064).
   **Найден и исправлен побочный баг:** несколько owner_overrides указывали
   на код, который сам оказался свёрнут в этом же проходе (SGS→FLK, но
   FLK→GBR; CYM/TCA→JAM, но JAM→GBR; TUV→KIR, но KIR→GBR; IOT→MUS, но
   MUS→GBR) — `build_merge_map()` был однопроходным (не резолвил цепочки),
   регионы повисли бы на несуществующем промежуточном коде. Добавлено
   транзитивное разрешение (fixed point) в `build_merge_map()`.
5. **Цвета переписаны на "сочную" Paradox-палитру** — `MAJOR_POWER_COLORS`
   и новый `CURATED_SOVEREIGN_COLORS` (Доминионы + ~25 узнаваемых держав,
   реальные флаго-геральдические ассоциации), `deterministic_color` sat/light
   диапазон поднят с 32-57%/36-53% до 55-85%/38-59%.
6. **Adjacency-aware disambiguation** — новый граф соседства стран
   (`build_country_adjacency`, по общим границам regions.neighboringRegionIds)
   + `disambiguate_from_neighbors()` (Welsh-Powell-подобная эвристика:
   обработка по убыванию числа соседей, вращение оттенка на 15°-шагах при
   коллизии). Проверено: 0 коллизий среди 283 реальных пар соседей.
7. **Зависимые территории тонируются от сюзерена** (`tint_from_suzerain`),
   не получают независимый identity-цвет — откат прошлого решения этого же
   дня (Work Item 7 изначально давал каждой зависимости свой цвет; по фидбеку
   это неверно — зависимость должна визуально читаться как "принадлежит X").
   Доминионы (CAN/AUS/NZL/ZAF) — исключение (`DOMINION_EXCEPTIONS`):
   формально `subject_of=GBR` в данных, но геймплейно самоуправляемые.
8. **Полный перевод реестра на русский** — `SOVEREIGN_NAME_RU` (86 суверенов
   каталога MAP) + `name_ru` во всех оставшихся `CUSTOM_COUNTRIES`
   (оккупационные зоны, QAZ/QMH/QDV/QRI). Итог: 160/160 стран (100%) имеют
   `ru`.
9. Разрывы/белые линии — см. пункт 3 (fill-opacity); часть швов —
   геометрическая неточность источника (`docs/TODO.md`, известный пункт,
   полноценный фикс требует пересборки геометрии — вне мандата этого прохода).
10. Открытым текстом: полноценная миграция UI-строк самой карты, живой
    пересчёт цвета при live-смене владельца, геометрия Christmas/Cocos и
    Фарерских островов — по-прежнему не в этом заходе (см. записи выше).

**Верификация:** полная батарея (server 680/680, client 102/102, tsc чистый
оба пакета) + живая проверка через `/game/start` (население/цвета/имена
совпадают с ожиданиями, 0 коллизий цвета соседей) + живой браузер (партия
за Великобританию: карта рендерится, "№6 / 160", "ГОС-ВО · ВЕЛИКОБРИТАНИЯ"
на русском, 0 ошибок в консоли). Пиксельный скриншот по-прежнему не
получен в этой сессии (`computer{action:"screenshot"}` зависает) — визуальная
калибровка (яркость/контраст конкретных пар, разрывы геометрии) ждёт
следующего скриншота от пользователя.

## Rollback / containment

- Каждый континент — отдельный commit; откат возможен обычным revert этого
  commit без переписывания истории.
- Историческая конфигурация аддитивна по континентам, поэтому незавершённый
  проход не меняет ещё не обработанные блоки.
- Generated outputs коммитятся вместе с их source config/code, исключая
  состояние, которое нельзя воспроизвести стандартным pipeline.

## Final outcome

Завершено 2026-07-18. Все три пункта Progress закрыты: Океания
задокументирована, легаси-блоки удалены как мёртвый код (подтверждено:
ни одного `QCG/QCF/QCP/QCN/QCU/QCZ/QCS` не осталось), документация
синхронизирована (`HISTORICAL_ACCURACY.md`, `SCENARIOS.md`, `LOCALIZATION.md`,
`scripts/map/README.md`).

Помимо изначального объёма (Океания), в этот же заход по явному запросу
пользователя вошли: фикс бага двойного сюзерена (VUT/SDN), новая категория
`protected_state` (Кувейт/Бахрейн/Катар/Бруней/Тонга), 8 ретроактивных
Africa-записей, сворачивание Алжира/Питкерна/Токелау в прямое владение
(игровая условность вместо максимальной историч. точности — явный принцип
пользователя на 2026-07-18), Занзибар как новая отдельная страна,
identity-цвета для ~120 зависимых территорий (включая находку и фикс
коллизии цветов Канада=Австралия=Новая Зеландия=Ю. Африка) и полная миграция
`Country.name`/`shortName` на `LocalizedText` (105/199 стран с реальным `ru`).

Итоговое число стран сценария: **199** (было 201 после Азии; +5 задокументировано
без изменения числа, -1 Алжир, +1 Занзибар, -2 Питкерн/Токелау, +0 остальное).

Не сделано (осознанно, залогировано выше как отдельные будущие задачи вне
мандата config-only прохода): Christmas Island/Cocos (Keeling) Islands —
геометрии нет; Фарерские острова — геометрия дропнулась между регенерациями,
плюс вне исходного мандата (не NSGT); live-пересчёт цвета/`getDisplayColor`
при смене вассалитета в рантайме — блокирован отсутствием реальной apply-
логики `annex`/`puppet` (тот же блокер, что и в решении пользователя от
2026-06-29); `MapView.tsx` UI-строки — не мигрированы на `react-i18next`
(только точечный тип-фикс на `getText()`).

Верификация: полная батарея (`test_country_entities_1946.py`,
`make_1946.py`, `validate_region_economy_1946.py`, `tsc`/`vitest` — server и
client) зелёная после каждого коммита-топика. Живая проверка через реальный
API (`/game/start`, `/scenarios/list`) и живой браузер (партия за
Великобританию, карта рендерится, `.maplibregl-canvas` присутствует, ошибок
в консоли нет) — обе подтверждают корректность конца-в-конец. Пиксельный
скриншот карты не получен из-за независимой проблемы Browser pane
(`computer{action:"screenshot"}` стабильно зависает в этой сессии) —
рекомендуется визуальная проверка цветов в обычном браузере перед финальным
приёмом (см. находки в разделах Work Item 7/8 выше).

## Продолжение 2026-07-18 (сессия 2) — фидбек по скриншоту + хвосты

Коммит `20bc9cc` закрыл предыдущий заход (50 файлов, все Work Items 1-8 +
10-пунктовый фидбек по первому скриншоту карты). Пользователь прислал второй
скриншот с чёрными точками-артефактами, попросил собрать полный список
оставшегося по карте и добить пункты, не требующие его участия, коммитя
каждый этап отдельно.

**Фикс 1 — уточнение диагноза чёрных артефактов (commit `2128914`).**
Point-in-polygon перепроверка (`shapely` + `STRtree`, не bbox-overlap, как в
прошлый раз) показала: Каспийское море **покрыто** ocean-фичей — прошлая
находка про "нет полигона вообще" была ошибкой анализа. Проверены ещё 22
крупных водоёма (Аральское, Байкал, Виктория, Великие озёра, Чёрное море и
т.д.) — все покрыты. Полный грид-скан всей карты (шаг 1°, 456×170 точек,
STRtree) нашёл 61 реальный разрыв — все мелкие: острова (Галапагос,
части Индонезии/Филиппин/Соломоновых), устья рек, арктические архипелаги без
своей административной записи (Шпицберген, Земля Франца-Иосифа), стыки
берегов Скандинавии/Адриатики/Карибов. Это тот же пункт бэклога
`docs/TODO.md` "береговые линии не стыкуются", не новая находка — фикс фона
(`#1a3a5c`) из прошлого коммита их уже маскирует под воду, доп. код не
понадобился.

**Проверка 2 — живое подтверждение через браузер.** Поднял dev-сервер
(обнаружил уже работающий процесс на порту 3000/5173 от предыдущей сессии,
переиспользован вместо дублирования), выбрал сценарий "Холодная война",
страну Великобританию, вошёл в игру. `computer{action:"screenshot"}`
по-прежнему зависает в этой среде — вместо него: снял пиксели канваса
(`canvas.maplibregl-canvas`) через `drawImage`+`getImageData` и посчитал долю
почти-чёрных пикселей (`r,g,b < 15`) на трёх видах — приближение на
Великобританию (69k сэмплов), полный мир на zoom 2 (275k сэмплов), Арктика
на zoom 3 (275k сэмплов). Результат: **0 чёрных пикселей на всех трёх** —
фикс фона полностью убрал видимые артефакты. Ошибок в консоли нет.

Задача "чёрные точки" закрыта на этом заходе; полноценная пересборка
геометрии (устранение самих микрощелей, не только маскировка цветом) —
по-прежнему отдельная будущая задача, blocked на отсутствии лучших исходных
геометрических данных.

**Следующие шаги в этом же заходе (коммит на каждый этап):** слияние
дублирующей записи Ruanda-Urundi (RWA/BDI — баг данных из `docs/TODO.md`),
разбивка Австрии на 4 зоны оккупации + Вена на 4 сектора (аналог существующего
`occupation_overlay.json` для Германии). Остальной бэклог карты
(гео-перенарезка Ближнего Востока, `tier`-поле, флаги, mapmodes,
границы по зуму, colonial blocks) — крупные отдельные фичи, оставлены для
обсуждения с пользователем после его возвращения.

**Исследование Австрии — отложено, требует решения пользователя.**
Разобрался в механизме, которым уже реализованы зоны Германии, прежде чем
что-либо трогать:

- `ownership_1946.json[region_id]` для 21 немецкого региона нативно содержит
  `controller` (SUN/USA/GBR/FRA) прямо из исходника MAP — включая **Берлин,
  уже раздробленный MAP на 4 отдельных region_id** ("Berlin — Soviet/American/
  British/French Sector", `EUR-0367..0370`). `import_to_game.py::resolve_owner()`
  превращает `(owner=DEU, controller=X)` в игровой код зоны через
  `ZONE_CODES_BY_OWNER["DEU"]` — поэтому `DEU` как страна не существует
  вообще, есть только 4 зоны.
- У Австрии (9 регионов = 9 федеральных земель: Niederösterreich,
  Oberösterreich, Burgenland, Vorarlberg, Tirol, Salzburg, Kärnten,
  Steiermark, **Wien**) поле `controller` в исходнике **отсутствует
  полностью** (0 из 59 controller-записей — все немецкие/корейские), и, в
  отличие от Берлина, **Вена в исходнике MAP не раздроблена на секторы** —
  только один регион "Wien" целиком. Значит буквально "Вена на 4 сектора"
  геометрически невозможно без ручной перерисовки полигона (нет исходных
  данных о границах секторов/районов Вены), а зоны остальных 8 земель можно
  было бы проставить вручную через `occupation_overlay.json` (тот же
  `overlay.get(region_id) or owner` фолбэк, что уже используется для
  Маньчжурии/Китая), реальное распределение: СССР — Niederösterreich +
  Burgenland; США — Oberösterreich (реально был раздел по Дунаю пополам,
  Линц — административный центр амер. зоны, огрублено до целой земли) +
  Salzburg; Британия — Kärnten + Steiermark; Франция — Tirol + Vorarlberg.
- **Историческая развилка, которую нужно решить пользователю, а не молча
  скопировать паттерн Германии:** в отличие от Германии (не было единого
  немецкого правительства до 1949), Австрия **сохраняла собственное
  правительство** (кабинет Реннера, апрель 1945, признан СССР немедленно,
  западными союзниками — октябрь 1945) под надзором Союзной контрольной
  комиссии — оккупация была военно-административной, не политическим
  роспуском государства. Копирование германского паттерна 1:1 удалило бы
  `AUT` из списка стран (как `DEU` сейчас отсутствует) и добавило 4 новые
  играбельные страны — это меняет число стран сценария и список выбора
  страны, а не просто добавляет декоративную аннотацию. Не стал делать это
  односторонне: варианты для обсуждения — (a) полный германский паттерн
  (4 новые страны, Австрия исчезает, Вена целиком к одной из зон); (b) `AUT`
  остаётся единственной играбельной страной, зоны — чисто описательное поле
  `occupationZone` на регионах без изменения владения/списка стран (ближе к
  реальной истории, не влияет на геймплей/тесты). Ничего не закоммичено по
  этому пункту.

## Точки-артефакты на заливке регионов (второй скриншот пользователя, 2026-07-18)

Пользователь прислал новый скриншот: рассеянные тёмно-синие точки поверх
сплошной заливки страны (СССР), пропадающие при приближении. Не путать с
находкой "чёрные точки" из предыдущего раздела (там был `#0c1016`
почти-чёрный фон, уже пофикшено) — это отдельная, более мелкая проблема,
видна и после фикса фона, просто фон изменил их цвет с чёрного на тёмно-синий
(`#1a3a5c`), не убрал сами точки.

**Диагноз, подтверждён эмпирически.** `fill-antialias: false` на слое
`regions-fill` стоял с 2026-07-01 (коммит `0e8b7b0`) как фикс белых швов при
полупрозрачной заливке. Побочный эффект, всплывший только сейчас (после
подъёма `fill-opacity` 0.36→0.96 и насыщенности палитры 2026-07-18): без
антиалиасинга суб-пиксельные геометрические швы между соседними регионами
(та же природа неточности, что и разрывы берегов/озёр из предыдущего
раздела, только на уровне отдельных провинций, а не целых водоёмов)
рендерятся не смягчённым краем, а жёсткими одиночными пикселями цвета фона.

Подтверждено через WebGL `readPixels` на живой карте (обошёл `computer
{screenshot}`, который зависает, и баг с `preserveDrawingBuffer:false`,
из-за которого `drawImage`-снятие канваса иногда ловит уже очищенный буфер
— пришлось форсировать `map._render()` перед чтением в одном тике): зум
~3.5, вглубь материка СССР (95°в.д., 60°с.ш., подальше от реальных
побережий) — из ~601k непреобладающих пикселей 742 оказались изолированными
(≥7 из 8 соседей — цвет заливки), и их цвет — ровно `(26,58,92)`, тот же
фон. Это количественно то же самое, что пользователь видит визуально.

**Фикс** (`client/src/map/MapView.tsx`, слой `regions-fill`): вернул
`fill-antialias: true` и добавил `fill-outline-color`, совпадающий с
`fill-color` (тот же coalesce-выражение mapmode/ownerColor) — стандартный
приём против швов между соседними полигонами в вектор-тайловых рендерерах:
каждый регион докрашивает свой край собственным цветом вместо того, чтобы
оставлять фон просвечивать сквозь субпиксельный зазор. `fill-opacity`
сейчас уже 0.96 (близко к непрозрачному), так что исходный баг с двойным
альфа-блендингом на полупрозрачной заливке, ради которого антиалиасинг
когда-то выключили, по идее не должен вернуться.

**Верификация — частичная, честно.** `tsc --noEmit` (client) чист,
`vitest run` (client) 102/102 без изменений. Живую пиксельную
переверификацию ПОСЛЕ фикса (тем же методом readPixels на том же месте)
получить не удалось: Browser pane деградировал за день интенсивных
перезагрузок 34МБ `world_1946.geojson` (десяток+ раз за сессию) — карта
перестала догружаться (`map.isStyleLoaded()` не становится `true`) даже
на СВЕЖЕМ сервере, свежем клиенте и совершенно новой вкладке. Провёл
контрольный A/B: `git stash` вернул ИСХОДНЫЙ, уже закоммиченный код — та же
самая карта так же не грузится — подтверждает, что зависание среды не
связано с этим изменением. `fill-outline-color`/`fill-antialias` —
проверенные валидные свойства в установленной версии `maplibre-gl`
(5.24.0, проверено grep по бандлу). Рекомендация: пользователю проверить
на своей стороне (после перезапуска dev-сервера) визуально, что точки
пропали и белые швы не вернулись при разных уровнях зума.

## Австрия: реализация зон оккупации (2026-07-19)

Пользователь снял оба открытых вопроса из предыдущего исследования разом:
**"Вену можно не делить, но зоны оккупации нужны"** — т.е. полный
германский паттерн (распустить `AUT`, 4 новые играбельные зоны), но без
попытки геометрически раздробить Вену на секторы.

**Реализация** (тот же механизм, что и Маньчжурия/раздел Китая —
`occupation_overlay.json` override по `region_id`, не нативное
`controller`-поле, которого у Австрии в MAP нет):
- Новые коды `QOS`/`QOA`/`QOB`/`QOF` (Soviet/American/British/French
  Occupation Zone (Austria)) в `CUSTOM_COUNTRIES`, `ZONE_TINT_SUZERAIN`
  (тонировка от СССР/США/Британии/Франции — та же логика, что и зоны
  Германии) и `CURRENCY_ZONE_ANCHOR`.
- `occupation_overlay.json`: 9 регионов Австрии (= 9 федеральных земель)
  вручную распределены по зонам (источник — en.wikipedia.org/wiki/
  Allied-occupied_Austria): СССР — Niederösterreich + Burgenland + **Вена**
  (целиком, не делится — физически анклав внутри советской Нижней
  Австрии, хотя административно управлялась всеми 4 державами совместно);
  США — Oberösterreich + Salzburg; Британия — Kärnten + Steiermark;
  Франция — Tirol + Vorarlberg (Восточный Тироль формально был
  британским, но регион у нас один, большинство населения в Северном
  (французском) — не дробим).
- `anchors.py`: убран плоский `AUT` anchor (6.9М), заменён на
  `MULTI_FRAGMENT_TOTALS["AUSTRIA_TOTAL"]` = 6,881,000 (сумма по землям —
  перепись 1951, ближайшая доступная детализация к 1946; чуть точнее
  прежней грубой оценки, поэтому мировой тотал сдвинулся на -19,000 —
  **единственный раз в этой ветке, когда тотал МЕНЯЕТСЯ**, а не сохраняется
  побитово, так как источник сам стал точнее, а не потому что население
  потерялось при переносе).
- `country_splits.py`: `AUSTRIA_SPLIT` (тот же паттерн, что
  `GERMANY_SPLIT`/`KOREA_SPLIT`), с `assert sum(...) ==
  AUSTRIA_TOTAL.population`.
- `fill_region_economy_1946.py`/`validate_region_economy_1946.py`:
  `AUSTRIA_SPLIT` добавлен в `DIRECT_OWNER_POPULATION`; `_DEV_TIERS` —
  `AUT` заменён на все 4 новых кода в том же тире индустриализации
  (0.42/0.38/0.42, где раньше была одна Австрия — сам уровень развития
  Австрии не меняется от того, что она оккупирована, как и у Германии).
- `SOVEREIGN_NAME_RU`: убран `AUT` (страна больше не существует как единое
  целое — тот же паттерн, что и у `DEU`, которого там никогда не было).

**Итог:** 160 → 163 страны (-1 AUT, +4 зоны). Тесты:
`test_country_entities_1946.py` 12/12, `make_1946.py` полный прогон чист
(`validate_region_economy_1946.py`: 0 нарушений, мировой тотал
2,294,863,068 — в допуске), server vitest 680/680 (+1 gated skip), client
vitest 102/102, `tsc --noEmit` чист на обоих пакетах.
`EXPECTED_COUNTRY_COUNT` в `campaignSmoke.test.ts` обновлён 160→163.

**Верификация — через прямой вызов API** (`curl POST /game/start`),
т.к. Browser pane на момент этой работы был в нерабочем состоянии (см.
раздел выше про точки-артефакты): после перезапуска dev-сервера (данные
кэшировались в памяти, не подхватили regen без рестарта) —
`playerCountryId: "QOS"` возвращает 163 страны, `QOS`/`QOA`/`QOB`/`QOF`
присутствуют с ожидаемыми именами/идеологиями (Communism/Liberal
Democracy ×3) и различимыми тонированными цветами
(`#c5645f`/`#b24fc0`/`#cc93b1`/`#52aca3`), `AUT` подтверждённо отсутствует.
Пиксельную/визуальную проверку карты (границы зон, цвета на глаз) пока не
получил — тот же блокер Browser pane, что и в разделе про точки;
пользователю стоит проверить визуально после следующего запуска.

## Ближний Восток: историческая Палестина, Ливан на мухафазы, разворот ОАЭ (2026-07-19)

Развитие пункта "Ближний Восток" из `docs/TODO.md`. Пользователь
перенаправил приоритет с "Турция/Сирия/Иордания тоньше" на "Израиль и
Палестину переделать, смотри конфликты для точных границ" — детали решения
и весь ход разведки/уточнений см. в истории conversation этой сессии;
здесь — техническая сводка реализации и находок.

### Таблица группировки Палестины (build_palestine_1946.py)

Источник — geoBoundaries ISR ADM2 (15 округов) + PSE ADM2 (16
губернаторств), CC0/CC BY 4.0 (полный provenance — `scripts/map/README.md`).
Голан исключён (территория Сирии в 1946). Итог — 15 подрайонов вместо
теоретических 16 (Назарет+Бейсан физически слились в один современный
округ Yizre'el):

| Подрайон 1946 | Округ | Источник (geoBoundaries) |
|---|---|---|
| Acre | Galilee | ISR: Akko |
| Safad | Galilee | ISR: Zefat |
| Tiberias | Galilee | ISR: Kinneret |
| Nazareth-Beisan | Galilee | ISR: Yizre'el (оба слились, см. Wikipedia Beisan Subdistrict) |
| Haifa | Haifa | ISR: Haifa + Hadera (Hadera была частью Haifa Subdistrict до 1948) |
| Jenin | Samaria | PSE: Jenin |
| Nablus | Samaria | PSE: Nablus + Tubas + Salfit + Qalqiliya (все три исторически "Jabal Nablus") |
| Tulkarm | Samaria | PSE: Tulkarm |
| Jerusalem | Jerusalem | ISR: Jerusalem + PSE: Jerusalem + Bethlehem + Jericho & Al Aghwar (поправка 1942 слила Вифлеем+Иерихон в Иерусалим) |
| Hebron | Jerusalem | PSE: Hebron |
| Ramallah | Jerusalem | PSE: Ramallah & Al Bireh |
| Jaffa | Lydda | ISR: Tel Aviv + Petah Tiqwa + HaSharon (подтверждено поимённым списком нас. пунктов подрайона Яффа в Wikipedia — Kfar Saba/Ra'anana/Herzliya тоже были в нём) |
| Ramle | Lydda | ISR: Ramla + Rehovot (подтверждено: "Ramla Subdistrict... became... subdivided between a newly created Ramla Subdistrict and Rehovot Subdistrict") |
| Gaza | Gaza | PSE: Gaza + North Gaza + Deir Al Balah + Khan Yunis + Rafah + ISR: Ashqelon (Wikipedia Gaza Subdistrict прямо включает Khan Yunis/Rafah и "El Majdal"=совр. Ашкелон — вопреки первоначальной гипотезе, что они в Беэр-Шеве) |
| Beersheba | Gaza | ISR: Be'er Sheva |

Все 15 получают владельца `PSE` через новые записи в
`occupation_overlay.json` (внешний `ownership_1946.json` знает только
старые 6+2 региона под старыми id).

### Ливан: 5 реальных мухафаз (не 4 geometric-merge)

`build_asia_1946.py::CUSTOM_ZONED["LB"]` — курированная группировка (не
слепой `GEOMETRIC`), зоны Beirut/Mount Lebanon/North Lebanon/South
Lebanon/Beqaa, с "An Nabatiyah" (мухафаза только с 1975) свёрнутой в South
Lebanon. Побочный найденный баг: алгоритм слияния называет объединённый
кластер по имени наибольшей по площади исходной части — "An Nabatiyah"
оказалась больше "South Lebanon" в этом источнике, поэтому итоговый регион
без явного фикса назывался бы анахронично. Добавлен точечный
post-processing rename в `main()` (`if iso2 == "LB": ...`) сразу после
построения кластеров.

### ОАЭ: разворот на `ARE` напрямую (не `QAB`)

`GEOMETRIC["AE"]` снижен с 7 до 1. Убраны: `ownerOverrides` `ARE→QAB` и 6
`regionOwnerOverrides` шейхств из `country_entities_1946.json`; 7
`CUSTOM_COUNTRIES` записей (`QAB/QDU/QSH/QAJ/QUQ/QRK/QFU`) и их вхождения в
`PUPPET_OVERRIDES["GBR"]` из `generate_country_registry.py`; 7 population
anchors в `anchors.py` заменены одним `"ARE": Anchor(80_000, ...)`.
Итоговая страна использует нативный код каталога `ARE` ("Trucial States")
напрямую — не нужен искусственный `QAB`, поскольку `ARE` уже
`subject_of: GBR` в каталоге MAP и корректно попадает в
`GBR.diplomacy.puppets` через обычный catalog-driven путь.

### Критичная находка: `ownership_1946.json` — позиционная хрупкость

Полное описание — `docs/HISTORICAL_ACCURACY.md` ("Важная находка о
хрупкости..."). Кратко: этот внешний, нерегенерируемый файл (1498 записей)
привязан к `region_id` строго позиционно. Palestine 8→15 (+7) + Lebanon
4→5 (+1) + ARE 7→1 (-6) сдвинули нумерацию практически всей Азии (блок
Палестины физически вставлен в начало сборки, аналогично Китаю — сдвиг
затронул не только алфавитно-более-поздние страны, как ожидалось
изначально при планировании, а вообще всё).

**Обнаружение:** не через явный провал теста — population-по-anchor
проверка сверяет только СУММУУ population по стране, не распределение по
регионам, поэтому "молча" пропустила скрэмблинг. Реальный симптом:
Афганистан показал 1 регион с полным population анкера страны;
Индонезия/Пакистан получили несколько регионов с `ownerCountryId=PSE`
(стек-трейс: `region 681/682/770/772/773: сосед 775 не существует` —
из-за того, что один из скрэмбленных регионов (Al Jawf, Йемен) не получил
owner вообще и был пропущен, что "сломало" граф соседей у геометрически
рядом стоящих регионов).

**Метод исправления (дважды применён — сначала точечно на 99 известных
`regionOwnerOverrides`/`occupation_overlay.json` записях, затем полностью
на весь 401-записный `ownership_1946.json`):** снимок `{region_id: имя}` из
`git show HEAD:client/public/world_1946.geojson` (до правки) и из свежей
пересборки, сопоставление по `(name, iso_a2)` как составному ключу (0
неоднозначностей на полном датасете Азии), применение remap-словаря к
JSON-ключам напрямую (не текстовым regex-заменами — коллизии new-id ==
old-id делают наивную последовательную замену небезопасной). Финальная
кросс-проверка (все 401 старых записи) нашла ровно ОДНО реальное изменение
владельца — намеренную консолидацию ОАЭ (`QAB`→`ARE`) — подтверждение, что
никакого остаточного разъезда не осталось.

**На будущее — не просто "повторить вручную", а готовый инструмент
(2026-07-19, по замечанию пользователя после разбора `bug_report.md`
прошлой сессии: постпроцессинг вне пайплайна гарантированно теряется —
п.7 того отчёта, тот же паттерн).** Методика оформлена как переиспользуемый
скрипт `scripts/map/build/remap_region_ids.py` — сравнивает
`world_1946.geojson` до/после правки по `(name, iso_a2)`, автоматически
remap'ит `ownership_1946.json`/`occupation_overlay.json`/
`country_entities_1946.json::regionOwnerOverrides`, dry-run по умолчанию.
Прогнан против сегодняшнего снимка — 386/401 совпало автоматически, 0
неоднозначностей, те же 15 ожидаемо-исчезнувших сущностей, что и при
ручном разборе. Использовать перед любой будущей правкой числа регионов
любой азиатской страны (включая ещё не сделанный проход по Турции/Сирии/
Иордании) — см. докстринг скрипта за инструкцией.

### Итог

163→157 стран. `test_country_entities_1946.py` 12/12. Полный
`make_1946.py`: 0 пропущенных владельцев (кроме ожидаемой Антарктиды), 0
ошибок графа соседей, мировой тотал населения не изменился (Палестина/
Ливан/ОАЭ не пересчитывались заново, только перегеометрились/
консолидировались — anchor-суммы сошлись точно: PSE 1,900,000/15
регионов, LBN 1,199,999/5, ARE 80,000/1). Только `capitalRegionId`
нарушения остаются (явно отложены пользователем: "Сейчас не нужно. Когда
всю карту доделаем — прогоним"). Server vitest 680/680 (+1 skip), client
vitest 102/102, `tsc --noEmit` чист на обоих пакетах.
`EXPECTED_COUNTRY_COUNT` в `campaignSmoke.test.ts` обновлён 163→157.
Верификация — `curl POST /game/start`: 157 стран, `PSE`/`LBN`/`ARE`
присутствуют с ожидаемыми именами. Пиксельную проверку геометрии на карте
получить не удалось (Browser pane снова оказался нерабочим в этой сессии —
не грузился даже на полностью свежем сервере/клиенте/вкладке); визуальная
калибровка ждёт следующего скриншота от пользователя.

Не сделано в этом заходе (осознанно, отдельные задачи на будущее):
Турция/Сирия/Иордания — более тонкая нарезка (Хатай остаётся поглощён
"Sanliurfa"); общее поле `tier` для бюджета регионов у DOM/OMN/
Центральной Америки; `capitalRegionId` — полный прогон после завершения
всей карты.

## Визуальный аудит по скриншотам пользователя (2026-07-19-b)

"Пиксельную проверку получить не удалось" (см. выше) оказалось неверным
успокоением — пользователь сделал собственные скриншоты фактического
рендера и нашёл 4 реальные проблемы, которые прошлый "чистый" числовой
прогон (`invalid`/`overlaps` в `merge_world_1946.py`) не поймал. Полная
находка/фикс каждой — `docs/DECISIONS.md`, "2026-07-19-b". Кратко:

1. **Газа/Беэр-Шева ↔ Синай, разрыв ~0.02°/~0.01°** — `clip_palestine_
   to_neighbors()` не может учесть Египет физически (Africa строится
   ПОСЛЕ Asia в `make_1946.py`). Новый шаг пайплайна
   `build/fill_palestine_egypt_gap.py` (после `build_africa_1946.py`) —
   буфер считается ОТДЕЛЬНО для Газы и для Беэр-Шевы (не от их
   объединения), иначе вся ~200-км прибрежная лента зазора уходит одному
   "ближайшему" победителю целиком.
2. **~14 взаимных наложений между 15 подрайонами Палестины** (ISR/PSE
   ADM2 не идеально стыкуются) — `trim_internal_overlaps()` в
   `build_palestine_1946.py`, детерминированный приоритет по порядку
   `SUBDISTRICT_GROUPS`.
3. **Границы заходят на Мёртвое море** (Иерусалим/Хеврон/Карак/Амман) —
   ни один клип не учитывал водоёмы. `clip_against_dead_sea()` в
   `build_asia_1946.py`, только "Мёртвое море" (Аральское НЕ трогать —
   явно отложено пользователем).
4. **Голанские высоты (~1157 км²) отсутствовали целиком** — исключены из
   Палестины (верно, это Сирия 1946), но `game_map.json` не содержит эту
   территорию ни в сирийском, ни в израильском наборе — реальная дыра.
   `build_palestine_1946.py` теперь экспортирует её геометрию отдельной
   фичей (`iso_a2="SY"`); `build_asia_1946.py` вливает как доп. юнит
   Сирии до `GEOMETRIC`-слияния (алгоритм сам подхватил к `Rif Dimashq`),
   предварительно обрезав по сырым юнитам Иордании (иначе новое
   наложение Amman/Rif Dimashq).

Все 4 верифицированы визуально — matplotlib-рендер конкретно этих
регионов + соседей (не всего мира), PNG в scratchpad, просмотр через
Read (Browser pane снова не годился). Region-id НЕ сдвинулись (число
выходных регионов SY/PS не изменилось) — `remap_region_ids.py` не
понадобился. Полный прогон чист: тесты 12/12 + 680 vitest + 1 skip, tsc
чист на server/client, живой `/game/start` — 157 стран, PSE=15, SYR=10.
`scripts/map/README.md` чек-лист дополнен пунктами 8-10 (визуальная
проверка ОБЯЗАТЕЛЬНА, межконтинентальные швы — отдельный шаг пайплайна,
дыры от исключений не ловятся попарными overlap/distance проверками).

## Ещё раунд визуальных багов: "пипка" (round join), "зиппер" JO/SY/LB (2026-07-19-d)

После записи выше пользователь коммитнул отдельный фикс `names_ru.json`
позиционного рассинхрона (`db63e18`, не мой — см. `docs/DECISIONS.md`
"2026-07-19-c") и затем прислал ЕЩЁ 2 скрина: реальная округлая "пипка" на
Газе (не Мёртвом море — тот случай оказался чистым шумом double-precision)
и "зиппер" мелких разрывов вдоль ВСЕЙ границы Палестина/Иордания. Полная
находка/фикс — `docs/DECISIONS.md`, "2026-07-19-d". Кратко:

- **Пипка**: `fill_palestine_egypt_gap.py` использовал `buffer()` с
  дефолтным round join — круглая дуга на выпуклых углах добавленного
  куска. Фикс: `join_style=3` (bevel) везде, где буфер используется для
  gap-fill (не для validity-фикса `buffer(0)`).
- **Зиппер**: `clip_palestine_to_neighbors` только вычитает наложение,
  никогда не дозаполняет разрыв на тех же двух источниках — новая
  `fill_palestine_gaps_to_neighbors()` (буфер каждого подрайона отдельно,
  bevel), нужно 3 прохода для сходимости (открыто эмпирически — 1 проход
  оставлял решаемые куски, `own_gap` считается от состояния ДО цикла).
- **Попутно**: тот же баг между JO/SY/LB друг против друга (все три из
  одного `game_map.json`, но сливаются независимо) —
  `fill_gap_between_countries()`, LB→SY и JO→SY, 2 прохода. LB-SY
  0.0029→0.0003 deg² (-90%), JO-SY 0.00088→0.00021 (-76%); полностью до
  нуля не сошлось — упирается в тройной стык Ливан/Сирия/Палестина у горы
  Хермон (реально спорная граница), остаток на 2-3 порядка меньше и не
  виден на игровом зуме.
- **Побочные наложения от многопроходного дозаполнения** (буфер раздувает
  фичу во все стороны, не только к нужному соседу): Amman/Rif Dimashq,
  Al-Anbar/Mafraq (Иордания-Ирак), Беэр-Шева/Гулф-оф-Акаба, North
  Lebanon/Средиземное море — все найдены и исправлены финальным клипом
  (`clip_country_against()` обобщённый для любой пары стран,
  `clip_asia_against_seas()` обобщённый для `seas_1946.geojson`).

Верификация: полный пересчёт gap/overlap для всех пар (PS-соседи, JO-SY,
LB-SY, JO-LB) — наложений 0; тесты/vitest/tsc чисты; `names.ru.json`
точечно проверен на 8 регионов — не съехал (число регионов SY/JO/LB/PS не
изменилось); живой `/game/start` 157/15/10. `scripts/map/README.md`
чек-лист дополнен пунктами 11-14 (bevel join, клип не равен дозаполнению,
сходимость за несколько проходов, финальный клип против ВСЕХ соседей
после дозаполнения).

## Gap-first absorb_slivers: буферный подход заменён целиком (2026-07-19-e)

Пользователь потребовал надёжный алгоритм вместо латания ("Пока не будет
идеального 'прилипания' полигонов — не отстану"). Весь buffer-based слой
предыдущего раздела (fill_palestine_gaps_to_neighbors,
fill_gap_between_countries, clip_country_against, clip_asia_against_seas,
~200 строк + 8 вызовов) удалён и заменён одним механизмом —
`scripts/map/build/geometry_cleanup.py::absorb_slivers`: polygonize всех
границ -> ячейки, не покрытые ни землёй, ни водой = настоящая пустота ->
каждая отдаётся фиче с самой длинной общей границей (ленты режутся
рекурсивно, чтобы сегменты ушли ближайшим регионам). Сходится за 1 проход
по построению, наложений не создаёт, "пипки" невозможны (нет буферов).
`fill_palestine_egypt_gap.py` переписан на тот же вызов. Попутно: Голан
дообрезан по сырому Ливану (наложение у Шебаа/Хермон), Кинерет оказался
покрыт Tiberias'ом из самого источника (не дыра — защита
PROTECTED_HOLE_POINTS оставлена на будущее). Хермонский микро-остаток
из прошлого раздела закрыт полностью. Детали — docs/DECISIONS.md
"2026-07-19-e"; чек-лист README пункты 11-14 переписаны под новый метод.
Верифицировано численно (0 наложений по 10 парам, 0 поглощаемых ячеек в
диагностике финального файла) и рендерами всех стыков (Газа-Синай, долина
Иордана, тройник Хермона, Мёртвое море, Кинерет/Голан).

## Кинерет → озеро, скилл geometry-QA, сведение доков (2026-07-19-f)

Финал раунда правок Ближнего Востока. Три части (полностью — docs/DECISIONS.md
"2026-07-19-f"):
1. **Кинерет вырезан в настоящее озеро** из Natural Earth ne_10m_lakes
   ("Sea of Galilee", ~160 км²) — `build/extract_kinneret.py` кладёт его в
   lakes_1946.geojson, `clip_against_dead_sea` (обобщён в CLIP_LAKE_NAMES)
   вырезает из Tiberias, absorb видит воду через load_water_geoms.
   Структурно как Мёртвое море (LAK-0012). Попутно исправлен латентный
   баг import_to_game: фильтр соседей брал land/water из позиционного
   names_ru.json → новый водоём утекал висячей ссылкой; теперь land-set
   из самого world-файла.
2. **Скилл `map-geometry-qa`** (`.claude/skills/map-geometry-qa/SKILL.md`) —
   кодифицирует все уроки -a…-f для будущей нарезки (тот самый скилл, о
   котором просил пользователь в начале сессии).
3. **Документация сведена**: README (Natural Earth источник, hand-maintained
   входы, секция QA со ссылкой на скилл), DECISIONS -f, этот план.

На этом весь блок геометрии Ближнего Востока (Палестина/Ливан/ОАЭ/швы/
озёра) закрыт и верифицирован. Осталось общее (не про этот регион):
Турция/Сирия/Иордания тоньше, поле `tier`, capitalRegionId полным
прогоном после всей карты, Аральское море (отложено пользователем).
