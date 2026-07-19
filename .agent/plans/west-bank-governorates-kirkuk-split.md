# Разбиение Западного берега на губернаторства + выделение Киркука

Status: complete
Owner: Claude (this session)
Starting commit: `2048689c` (Golan/HaZafon sliver fix) on `codex/1946-country-borders`

## Objective and observable outcome

По итогам обсуждения карты будущих конфликтов Ближнего Востока пользователь
выбрал 2 региона для разбиения из предложенного списка ("Оба"): Западный
берег (сейчас единое пятно, не позволяет моделировать интифады/Осло/рост
поселений) и Киркук (Ирак, сейчас утоплен в geometric-кластере, а это
главная спорная территория курдского вопроса).

Observable outcome: живой `/game/start` показывает PS=17 (было 8: +9 за счёт
10 губернаторств Западного берега минус 1 старое пятно), IQ=10 (было тоже
10, но с Киркуком отдельным регионом вместо одного из 7 geometric-кластеров
"Iraq"), все новые регионы с именами/владельцами, Иерусалим — цельный
полигон без разрывов/дублей.

## Scope and constraints

In scope: `scripts/map/build/build_asia_1946.py` (блок Palestine/Golan:
замена "West Bank" на 10 губернаторств geoBoundaries PSE ADM2 + довесок PSE
"Jerusalem" в существующий регион; `ZONED_GEOMETRIC["IQ"]`: Kirkuk-зона),
`NAME_OVERRIDES_1946` (At-Ta'mim → Kirkuk), каскад region_id для `ASI-`,
рефактор хардкод-теста `test_country_entities_1946.py`.

Out of scope: дальнейшее разбиение Газы/Бейрута (предложены как средний/
низкий приоритет, пользователь не выбирал); реконструкция немецких
оккупационных зон; Ниневия/Мосул (за горизонтом сценария).

## Assumptions and unknowns

- PSE ADM2 "Jerusalem" губернаторство исключено из отдельного вывода (имя
  совпало бы с уже существующим raw "Jerusalem") — решение агента, не
  подтверждено явно пользователем, но логически вынужденное (не дублировать
  имя). Риск: если пользователь ожидал именно ЭТО губернаторство как
  отдельный регион — придётся переделать.
- Русские переводы 10 губернаторств + "Kirkuk" — стандартная
  транслитерация, не вычитана носителем/профессиональным переводчиком.

## Alternatives and selected decision

Рассмотрено: оставить историческую 1946-группировку `SUBDISTRICT_GROUPS` из
superseded `build_palestine_1946.py` (Jenin, Nablus+Tubas+Salfit+Qalqiliya
единым, Tulkarm, Ramallah, Hebron — 5 кусков). Отклонено: пользователь и
вся сессия последовательно выбирали сырую/максимальную грануляцию без
кураторских решений о группировке (принцип записи -i) — 10 отдельных
губернаторств PSE ADM2 без объединения выбраны вместо этого, оставляя
Tubas/Salfit/Qalqiliya различимыми на будущее.

## Progress

- [x] 1. `build_asia_1946.py`: `WEST_BANK_GOVERNORATES` (10 губернаторств
      PSE ADM2), замена "West Bank" в цикле, клип по существующим PS-
      регионам (0 overlaps).
- [x] 2. Найден и закрыт реальный разрыв: PSE "Jerusalem" покрывало 282.6
      km2 больше существующего raw "Jerusalem" — довешено в него вместо
      создания дублирующего региона.
- [x] 3. `ZONED_GEOMETRIC["IQ"]`: Kirkuk-зона (At-Ta'mim → "Kirkuk" через
      `NAME_OVERRIDES_1946`, вынесен из зоны "Iraq" в синглтон ДО
      geometric-слияния, "Iraq" 7→6).
- [x] 4. Найдены и починены 2 MultiPolygon-артефакта от difference/union
      разных источников: HaZafon (4 обрезка, 22.8 km2 → в Golan, отдельный
      коммит) и Jerusalem (5 обрезков, 0.39 km2 → в Bethlehem, тот же класс
      проблемы, найдено сразу).
- [x] 5. Процессная ошибка обнаружена и исправлена: повторный
      `remap_region_ids.py --apply` с тем же `--old`-снимком после
      промежуточной правки (переименование Kirkuk) скорротировал позиционные
      файлы — восстановлено `git checkout --`, remap применён один раз
      поверх финального world.
- [x] 6. `test_country_entities_1946.py` отрефакторен на матчинг по
      (name, iso_a2) вместо хардкод region_id — не сломается на следующем
      сдвиге.
- [x] 7. Верификация: numeric scan 0 overlaps (PS internal), polygonize —
      только фоновый шум, рендеры (Западный берег, Ирак/Киркук) чистые,
      12/12 + 9/9 юнит-тестов, tsc×2 чисто, vitest 680+1, живой
      `/game/start` — PS=17/IQ=10, все с именами/владельцами.
- [x] 8. Документация: `docs/DECISIONS.md` (2026-07-19-j), `map-geometry-qa`
      skill (MultiPolygon-after-difference урок + remap-once-at-the-end
      урок), `scripts/map/README.md` (пункты 19-20), этот ExecPlan.
- [x] 9. Коммит.

## Discoveries

См. `docs/DECISIONS.md` запись 2026-07-19-j и `.claude/skills/
map-geometry-qa/SKILL.md` — оба MultiPolygon-артефакта и remap-double-apply
урок описаны там подробно, не дублирую здесь.

## Decision log

- PSE "Jerusalem" не выделяется отдельным регионом (имя-коллизия с
  существующим raw "Jerusalem") — площадь довешена в существующий регион.
- 10 губернаторств Западного берега БЕЗ объединения в историческую
  1946-группировку — максимальная сырая грануляция, без кураторского
  решения агента.
- Киркук переименован в "Kirkuk" (не "At-Ta'mim") — историческая справка:
  переименование в At-Ta'mim было только с 1976 (Баасистский режим), на
  1946 год исторически корректно "Kirkuk".

## Validation

Числовой скан (0 overlaps), polygonize-diagnostic, рендеры West Bank +
Iraq/Kirkuk, `test_country_entities_1946.py` 12/12, `test_validate_region_
economy_1946.py` 9/9, `validate_region_economy_1946.py` (только известная
отложенная capitalRegionId-категория, 42 записи), server+client
`tsc --noEmit`, server vitest 680+1skip, живой `/game/start`.

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита; до коммита — `git checkout --` по отдельным файлам (сделано
один раз уже в процессе работы, для восстановления после remap-double-
apply инцидента).

## Final outcome

Все 9 пунктов Progress выполнены. Изменено: `build_asia_1946.py` (West
Bank → 10 губернаторств + Jerusalem-довесок + Bethlehem-обрезки, Kirkuk-
зона + переименование), `test_country_entities_1946.py` (рефактор на
content-based матчинг), ~13 новых записей `names_ru.json`/`ownership_1946.
json` (10 губернаторств + Kirkuk + попутно найденный пред-существующий
пробел Chandigarh) через `remap_region_ids.py --apply` (ASI-, один чистый
прогон после восстановления от double-apply инцидента) + ручные добавления.

Итоговые числа: PS 8→17, IQ 10→10 (состав изменён: Kirkuk теперь отдельно).

Baseline failures: `validate_region_economy_1946.py` — известная
отложенная категория `capitalRegionId` (42 записи, тот же класс, что и
раньше — не новая проблема).

Introduced failures: 0 (после всех фиксов, включая восстановление от
remap-double-apply инцидента).

**Поправка (2026-07-19-k):** заявление "Introduced failures: 0" выше было
НЕВЕРНЫМ — пользователь после похвалы нашёл 4 реальных регресса, введённых
МНОЙ в процессе этой самой работы (побочный эффект тестового прогона
`build_namerica_1946.py`, не связанный с West Bank/Kirkuk напрямую, но
случившийся в той же сессии): (1) Северная Америка откачена 268→206 фич
(США 112→51 штат, потеряна Зона Панамского канала); (2) как следствие —
видимое наложение США на Великие озёра; (3) Northern Cyprus/Dhekelia
целиком лежали внутри полигона Средиземного моря (не вычтены при
добавлении); (4) Пуэрто-Рико/Виргинские о-ва получали population=0/gdp=0.
Все 4 найдены и починены в отдельном заходе, полная запись —
`docs/DECISIONS.md` "2026-07-19-k". Мой собственный numeric-scan в разделе
Validation выше проверял ТОЛЬКО страны, затронутые в рамках ЭТОЙ задачи
(PS/JO/SY/LB/IQ/CY) — не весь мир, поэтому не поймал регресс в
North America. Урок для будущих ExecPlan: numeric-scan/live-check в
Validation должен включать хотя бы количество фич per continent globally
(`merge_world_1946.py`'s own "Всего фич"/per-prefix breakdown), не только
страны из Scope.

Unresolved risks: русские переводы новых регионов не вычитаны носителем;
решение не выделять PSE "Jerusalem" отдельно — не подтверждено явно
пользователем (логический вывод агента, см. Assumptions).

Fresh-session requirements: нет.
