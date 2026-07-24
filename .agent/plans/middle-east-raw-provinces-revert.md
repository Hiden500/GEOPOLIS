# Откат Сирии/Ливана/Иордании/Палестины(Израиля) на сырые провинции game_map.json + честный Кипр

Status: complete
Owner: Claude (this session)
Starting commit: `02e1f9f66eb1b3523a135b0d7056e199c4d6e688` on `codex/1946-country-borders`

## Objective and observable outcome

Заменить кураторскую историческую реконструкцию Сирии/Ливана/Иордании/
Палестины(Израиля) и кривой Кипр-графт (Кирения) на прямой перенос сырых
провинций из `client/src/assets/game_map.json`, без geometric-слияния,
custom_zoned-группировки или замены другим источником. Разбиение на
под-регионы пользователь укажет позже, отдельными инструкциями.

Observable outcome: живой `/game/start` показывает JOR=12, SYR≈16 (14 сырых
+ UNDOF + Голан), LBN=6, PSE=8 (сырые IL+PS), CY=7 (5 существующих + Northern
Cyprus + Dhekelia) регионов с корректными английскими/русскими названиями и
владельцами; полный чек-лист верификации (раздел ниже) проходит без НОВЫХ
категорий нарушений.

## Scope and constraints

In scope: `scripts/map/build/build_asia_1946.py` (конфиг SY/JO/LB/IL/PS),
`scripts/map/build/build_europe_1946.py` (Кипр: Northern Cyprus/Dhekelia
вместо Кирении), `scripts/map/make_1946.py` (убрать 2 шага), новые записи в
`ownership_1946.json`/`names_ru.json`/`occupation_overlay.json`, каскад
region_id для префиксов `ASI-` и `EUR-`.

Out of scope (явно исключено пользователем/по его же принципу "решения о
делении — позже"): дальнейшее разбиение полученных сырых провинций;
реконструкция немецких оккупационных зон (Берлин/Кильский канал) — отдельная
задача; Аральское море.

## Assumptions and unknowns

- Голанские высоты: исключение сохраняется (Голан вырезается из HaZafon,
  приклеивается к Сирии) — подтверждено пользователем.
- UNDOF/An Nabatiyah/Dhekelia (современные анахронизмы): оставляются
  буквально как отдельные регионы — подтверждено пользователем (для
  UNDOF/An Nabatiyah явно; для Dhekelia — по аналогии, см. Decision log).
- UNKNOWN до выполнения: точные русские переводы ~44 новых названий (нужно
  проверить устоявшийся стиль по соседним уже переведённым записям);
  какой именно снимок `world_1946.geojson` брать для `--prefix EUR-` remap
  (Кипр менялся несколько раз за сегодня — нужен снимок ИМЕННО перед этой
  правкой, не commit 146933a, который использовался для записи -h).

## Alternatives and selected decision

Отклонено: держать историческую реконструкцию Палестины/Ливана (пользователь
явно потребовал откат — уродливый рендер Кипра и потеря немецких зон
подорвали доверие к кастомным реконструкциям, когда источники расходятся по
охвату/точности с остальным пайплайном). Выбрано: сырой перенос из
game_map.json, кураторские решения — по явному запросу пользователя, не
инициативой агента.

## Progress

- [x] 1. `build_asia_1946.py`: SY/JO/LB → `KEEP_AS_IS`; сырой блок IL+PS
      (output `iso_a2="PS"`) с Golan-carve из geoBoundaries ISR ADM2.
      Результат: SY=16, JO=12, LB=6, PS=8. absorb_middle_east_slivers сошёлся
      (28 поглощено, 2й проход 0).
- [x] 2. `build_europe_1946.py`: Northern Cyprus + Dhekelia добавлены как
      сырые фичи (`add_cyprus_extra_territories`); Кирения-мост убран.
      Результат: CY=7, суммарная площадь 9179.4 km2 (было 9045.3 без
      Dhekelia-клипа), 0 overlaps.
- [x] 3. `make_1946.py`: `build_palestine_1946.py` и `extract_kyrenia.py`
      убраны из `FULL_REBUILD_STEPS`.
- [x] 4. Пересборка: `fill_palestine_egypt_gap.py` (перезапуск, зависит от
      нового Asia-вывода) → `merge_world_1946.py` → `build_neighbor_graph.py`
      → `translate_world.py` → `import_to_game.py`. Все сошлись чисто.
- [x] 5. `remap_region_ids.py --prefix ASI- --apply` (390/0/13, 275 сдвигов)
      и `--prefix EUR- --apply` (367/0/1-Kyrenia, 0 сдвигов).
- [x] 6. Добавлено 28 записей `names_ru.json` + 21 запись `ownership_1946.json`
      для всех новых регионов (включая 6 попутно найденных пред-существующих
      пробелов: Kashmir/Spratly/Abu Dhabi/Badakhshan/Hirat/Farah — не мои
      регионы, но были без имени, закрыл заодно).
- [x] 7. Верификация: numeric scan (0 overlaps JO/SY/LB/PS ↔ IQ/TR/SA/EG,
      0 overlaps Кипр), polygonize-diagnostic (только фоновый прибрежный шум,
      не новые проблемы), рендеры (Кипр, Голан-трипойнт, весь Ближний
      Восток — все чистые), 12/12 + 9/9 юнит-тестов (1 тест — hardcoded
      region_id — обновлён под новую нумерацию), tsc×2 чисто, vitest 680+1,
      живой `/game/start` — SY=16/JO=12/LB=6/PS=8/CY=7, все с именами и
      владельцами.
- [x] 8. Документация: `docs/DECISIONS.md` (2026-07-19-i), `map-geometry-qa`
      skill, `scripts/map/README.md` (пункты 15/17/18 + внешний источник
      помечен superseded), `.agent/plans/1946-country-borders.md`
      (пойнтер на этот файл), `.agent/EVOLUTION.md` (пункт 5 + validation),
      докстринги `extract_kyrenia.py`/`build_palestine_1946.py`/
      `fix_cyprus_famagusta_gap` помечены superseded.
- [x] 9. Коммит(ы).

## Discoveries

- **`fix_cyprus_famagusta_gap` (комментированный в bdb8f74 как реальная
  дыра источника) оказался ЛОЖНЫМ срабатыванием той же природы, что и
  Кирения.** Численно: main-body Larnaca касается Northern Cyprus на
  distance=0.0, Famagusta тоже касается Northern Cyprus на distance=0.0 —
  Larnaca и Famagusta НЕ смежны напрямую, между ними законно Northern
  Cyprus. Построенный ранее буферный мост на 100.27 из 101.5 km2
  накладывался на настоящую территорию Northern Cyprus. Вызов убран из
  main(), функция оставлена в коде с исправленным докстрингом (та же
  конвенция, что extract_kyrenia.py/build_palestine_1946.py). `fix_cyprus_
  larnaca_exclave` — проверен отдельно, НЕ пересекается с Northern Cyprus
  (0.052° до него), остаётся в силе.
- 12 крошечных прибрежных слайверов (макс ~1 км², против моря, не между
  сушей) остались по всему острову равномерно (включая старый западный
  берег Пафоса) — тот же фоновый шум береговой линии, что везде в проекте,
  не новая проблема этой правки.
- **UNDOF реально накладывался на Golan** (42.6 km2, ~16% площади UNDOF) —
  разные источники (Natural Earth vs geoBoundaries ISR) независимо
  оцифровали пересекающуюся территорию. Golan (специально построенная
  историческая граница) — авторитетен; сырые сирийские юниты обрезаны по
  нему в `build_asia_1946.py` перед склейкой.
- **Тест `test_gulf_and_tonga_are_protected_states_not_protectorates`
  хардкодит region_id напрямую** (не читает их из текущего состояния) —
  сломался на сдвиге, обновлён на новые id из живого config.
- **Ложноположительный "живой" результат из-за зомби-процесса сервера.**
  Первая проверка `/game/start` показала 1365 регионов и "MISSING" для
  Dhekelia — процесс, слушающий порт 3000, был запущен МНОГО РАНЬШЕ в этой
  сессии (реальный Windows PID виден только через `netstat -ano`, НЕ через
  `ps aux` в Git Bash — там были другие, wrapper-PID, `kill` по ним не
  трогал настоящий процесс). После `taskkill //F //PID <netstat-pid>` и
  чистого рестарта — корректные 1310/CY=7. Для живой проверки ВСЕГДА
  сверять `netstat -ano | grep :3000` с PID, а не доверять `ps aux`/своим
  же `nohup`-PID в Git Bash на Windows.

## Decision log

- Голан: сохранить исключение (подтверждено AskUserQuestion).
- UNDOF/An Nabatiyah: оставить буквально, не сворачивать (подтверждено
  AskUserQuestion).
- Northern Cyprus/Dhekelia: `iso_a2="-1"` в game_map.json, distance/overlap
  к существующим 5 округам Кипра == 0.0/0.0 (проверено численно) — прямой
  перенос без моста/внешнего источника.

## Validation

- Числовой скан наложений/разрывов (JO/SY/LB/PS против Ирака/Турции/Саудии/
  Египта; Кипр Northern Cyprus/Dhekelia против 5 округов).
- Diagnostic polygonize — 0 поглощаемых ячеек.
- Пофичевые рендеры ключевых стыков (см. предыдущий план-файл для списка).
- `test_country_entities_1946.py`, `test_validate_region_economy_1946.py`,
  `validate_region_economy_1946.py` (ожидается только известная ~31
  capitalRegionId категория).
- `server`+`client` `npx tsc --noEmit`, `server` `npx vitest run`.
- Живой `/game/start`.

## Rollback / containment

Обратимая единица — сам git commit(ы) этой правки на ветке
`codex/1946-country-borders` (не в `main`). Откат: `git revert` конкретного
коммита(ов) после завершения; до коммита — рабочее дерево, `git checkout --`
по отдельным файлам при необходимости (не `git reset --hard`, если в дереве
есть посторонние незакоммиченные изменения — проверить `git status` перед
любым откатом).

## Final outcome

Все 9 пунктов Progress выполнены. Изменено: `build_asia_1946.py` (SY/JO/LB
→ KEEP_AS_IS, сырой блок IL+PS, Golan-carve с обрезкой UNDOF),
`build_europe_1946.py` (Northern Cyprus/Dhekelia вместо Кирении, отмена
Famagusta-моста), `make_1946.py` (−2 шага), `test_country_entities_1946.py`
(обновлён хардкод region_id), ~49 новых/перенесённых записей в
`ownership_1946.json`/`names_ru.json`/`occupation_overlay.json` через
`remap_region_ids.py --apply` (ASI- и EUR-) + ручные добавления.

Итоговые числа: SY 10→16, JO 6→12, LB 5→6, PS(IL+PS) 15→8, CY 6→7.

Baseline failures: `validate_region_economy_1946.py` — известная отложенная
категория `capitalRegionId` (42 записи, был ~31-33 до этой правки; тот же
класс, задокументирован, не новая проблема — см. skill/README).

Introduced failures: 0 (после всех фиксов — UNDOF/Golan overlap исправлен,
тест с хардкодом обновлён, zombie-server распознан и не является багом
геометрии).

Unresolved risks: русские переводы новых ~44 названий не вычитаны носителем
языка (стандартная транслитерация, не проверена профессиональным
переводчиком); дальнейшее разбиение сырых провинций — явно отложено на
будущие инструкции пользователя.

Fresh-session requirements: нет — вся работа проверена и закоммичена в
рамках этой сессии, ничего не оставлено в промежуточном состоянии.
