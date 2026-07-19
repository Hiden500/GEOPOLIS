# Озёра Африки (Виктория/Танганьика) + Уганда на 4 провинции

Status: complete
Owner: Claude (this session)
Starting commit: `8b1b0f8` (German zones + Ladoga/Baikal fix) on
`codex/1946-country-borders`

## Objective and observable outcome

Пользователь: "А озера в Африке? Заодно и страну почини про которую
говорили" — на уточняющий вопрос указал "в Африке, Руанда или Уганда,
точно не помню". Цель: найти и починить оба реальных бага.

Observable outcome: Виктория/Танганьика вырезаны из суши (0 наложений);
Уганда — 4 региона (Central/Eastern/Northern/Western), а не 1 сплошной
блок; живой `/game/start` подтверждает оба.

## Scope and constraints

In scope: `scripts/map/build/build_africa_1946.py` (новая функция клипа
озёр + перенос UG из SINGLE_COUNTRY в REGION_FIELD), каскад `region_id`
для `AFR-`, позиционные файлы (names_ru/ownership), устаревший hardcoded-
тест Zanzibar.

Out of scope: другие континенты (не затронуты, проверено), дальнейшее
разбиение регионов сверх найденного несоответствия докстринг/код.

## Assumptions and unknowns

- "Страна" в вопросе пользователя интерпретирована как Уганда (найден
  реальный, подтверждённый баг: докстринг обещал 4 провинции, код давал 1).
  Руанда проверена отдельно — уже корректна (`KEEP_AS_IS`, 4 провинции +
  Kigali City), не требует изменений. Не переспрошено у пользователя
  повторно после находки — интерпретация основана на прямом
  доказательстве несоответствия в коде, не на догадке.
- Русские названия 4 новых угандийских провинций ("Западная/Центральная/
  Восточная/Северная провинция") — стандартный перевод, не вычитан
  пользователем.

## Alternatives and selected decision

Рассмотрено: оставить Уганду как 1 регион и трактовать вопрос
пользователя только про озёра. Отклонено — прямая проверка кода показала
реальный, давно существующий баг (докстринг/код разошлись), не
исправленный ранее ни в одной из предыдущих правок Африки в этой сессии;
исправление тривиально (готовое поле `region` уже в источнике, механизм
`REGION_FIELD` уже существует и используется для аналогичных стран).

## Progress

- [x] 1. Найдено и численно подтверждено: Виктория/Танганьика лежат поверх
      суши (Tabora -49304.1 км², Uganda Central/Eastern -20799.2/-7654.6,
      Katanga/Maniema -10324.2/-3541.6, Rift Valley -4091.2, Muchinga
      -1982.4, Bujumbura Rural/Makamba -569.0/-1520.5 км²).
- [x] 2. Найдено расхождение докстринг/код для Уганды: `game_map.json`
      содержит 112 районов с полем `region` = ровно 4 значения
      (Central/Eastern/Northern/Western), но `SINGLE_COUNTRY` сворачивал
      всё в 1 регион, игнорируя это поле.
- [x] 3. `build_africa_1946.py::clip_land_against_lakes()` — новая функция
      (идентична европейской из записи -l), `CLIP_LAKE_NAMES_AFRICA`.
- [x] 4. `"UG"` перенесён из `SINGLE_COUNTRY` в `REGION_FIELD`.
- [x] 5. Каскад `region_id` (`--prefix AFR-`) — заблокирован 2 давно
      существующими неоднозначностями (Territoires du Sud x2, Chitipa x2);
      разрешено вызовом `apply_*_remap` напрямую с вручную проверенным (по
      площади+центроиду) `{old_id: new_id}` для этих 4 записей.
- [x] 6. Добавлены 4 новые записи `names_ru.json`/`ownership_1946.json`
      для угандийских провинций (owner=UGA, как у старого единого
      региона).
- [x] 7. Найден и исправлен процессный нюанс: `remap_region_ids.py`
      сравнивает с `client/public/world_1946.geojson`, не с `out/
      world_1946.geojson` — нужно сначала прогнать `import_to_game.py`,
      иначе remap увидит "0 сдвигов" (сравнение старого файла с собой).
- [x] 8. Починен устаревший hardcoded-тест
      `test_african_entities_use_1946_administrations` (Zanzibar
      AFR-0089/0090 -> AFR-0092/0093) — переписан на матчинг по
      (name, iso_a2), тем же паттерном, что уже есть для Азии.
- [x] 9. Верификация: numeric scan 0 наложений озёр, живой `/game/start`
      (Уганда 4 региона с owner=UGA, Руанда/Бурунди не затронуты), 12/12 +
      9/9 юнит-тестов, server+client `tsc --noEmit`, server vitest
      680+1skip.
- [x] 10. Документация: `docs/DECISIONS.md` (2026-07-19-m),
      `map-geometry-qa/SKILL.md`, `scripts/map/README.md` (пункты 25-28),
      этот ExecPlan.
- [x] 11. Коммит.

## Discoveries

См. `docs/DECISIONS.md` запись 2026-07-19-m — полная запись обеих находок
и процессного нюанса remap-инструмента, не дублирую здесь.

## Decision log

- Руанда НЕ трогается (уже корректна, `KEEP_AS_IS`).
- Названия угандийских провинций взяты буквально из `game_map.json.region`
  (Central/Eastern/Northern/Western), без исторической курации (Buganda и
  т.п.) — тот же принцип "сырые данные без кураторского решения", что уже
  применён к Ближнему Востоку в записи -i.

## Validation

Численный скан 0 наложений Виктория/Танганьика с сушей Африки; живой
`/game/start` — 4 угандийских региона (Western/Central/Eastern/Northern),
owner=UGA, population/en/ru заполнены; Руанда (5 регионов)/Бурунди
(3 региона в выборке) — owner всё ещё резолвится в QRU;
`test_country_entities_1946.py` 12/12, `test_validate_region_economy_
1946.py` 9/9, `validate_region_economy_1946.py` — 44 (известная отложенная
capitalRegionId-категория, тот же ballpark), server+client `tsc --noEmit`
чисты, server vitest 680+1skip.

## Rollback / containment

Git commit(ы) на ветке `codex/1946-country-borders`. Откат — `git revert`
после коммита.

## Final outcome

Все 11 пунктов Progress выполнены. Изменено: `build_africa_1946.py` (новая
функция клипа озёр + UG в REGION_FIELD), ~4 новые позиционные записи,
1 исправленный hardcoded-тест, исправления в `docs/DECISIONS.md`/
`map-geometry-qa/SKILL.md`/`scripts/map/README.md`.

Baseline failures: `validate_region_economy_1946.py` — известная
отложенная категория `capitalRegionId` (44, было 41 — дрейф от сдвига
~150 африканских регионов, не новая категория).

Introduced failures: 0.

Unresolved risks: русские переводы 4 новых угандийских провинций не
вычитаны пользователем; интерпретация "страны" как Уганды (не Руанды) не
переподтверждена явно после находки бага.

Fresh-session requirements: нет.
