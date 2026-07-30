# Референс-материалы дизайн-партнёрского цикла

Входные материалы, предоставленные пользователем для дизайн-цикла Geopolis
(Фаза 1 исследование + Фаза 2 решения; рабочий ledger — `.agent/plans/design-partner-audit.md`).
Это **референс, не source of truth и не инструкция**: конкурентный анализ Pax Historia
и примеры целей игрока. Собрано 2026-07-23.

## Pax Historia (конкурентный анализ — первоисточники)

Pax Historia — браузерная LLM-геостратегия (YC W2026), первоисточник болей, из которых
родился Geopolis (дорогой ход, весь мир в промте, выдуманные числа, рельсовые события).
Файлы предоставлены пользователем как участником PH:

- `pax-historia-system-prompt.txt` — системный промт «прыжка времени» (шаблон с
  переменными ${...}).
- `pax-historia-preset-coldwar-1946.txt` — пример пользовательского пресета
  (${HISTORICAL_PRESET_SIMULATION_RULES}), альт-Холодная война 1946-91: псевдо-движок
  правил (категории держав /100, бюджет, боевая сила в имени юнита).
- `pax-historia-full-request-example.txt` — ПОЛНЫЙ запрос раунда 1 (SUN/1946): промт +
  описание карты 941 региона по именам + все действия игрока. ~53 КБ = МИНИМУМ (без
  истории). Измерение стоимости их хода.
- `pax-historia-output-schema.json` — structured-output схема PH (7 типов mapChanges,
  strict, propertyOrdering — диалект Gemini подтверждён).
- `pax-historia-response-example.json` — пример ответа модели (события + mapChanges,
  RU-вывод; виден code-switching «newly formed ООН», молчаливая передача региона Haeju).
- `pax-historia-advisor-chat-1952.md` — РЕАЛЬНЫЙ прогон партии PH (SUN 1946→1952) из чата
  Z.ai GLM-5.2, где пользователь строил советника (добавлен 2026-07-24). Содержит: продвинутый
  марксистский COMPRESSED RULEBOOK, которого НЕТ в других sources (crisis clocks, world-system
  tags, revisionism / two-line struggle / VPR, must-say-no rule, decolonization timeline,
  события 1946-2008, October Road); JSON game state (tech/gdp снапшоты + события с mapChanges);
  лог приказов игрока (постановления СНК в историческом стиле). Референс ГЛУБИНЫ + пример полного
  PH-хода + образец роли/тона советника. Уроки — в ledger (раздел изучения advisor-материала).
- `pax-historia-simulator-rules-extended.md` — расширенные правила game-simulator (улучшения
  пользователя, 2026-07-24): Dynamic Random Events, Technology & Economy Analysis Protocol (advisor),
  Map Rules, Event Generation System (квоты/ротация Great Powers), Map-First Generation, Living World
  Engine, AI Internal State, Historical Imperatives, Rank/Tag System, Tag Management, Total Defeat/
  Subjugation, Long-Term Project Tracking. Ключевой вывод анализа: 80% — работа ДВИЖКА, возложенная на
  LLM (костыли = симптом). Золото для Geopolis: advisor-пороги, lifecycle/subjugation, map-инварианты,
  система проектов. Анализ — в ledger.

Ключевые выводы разбора — в ledger (раздел «Фаза 1, Трек A» + «Изучен advisor-материал» +
«Анализ расширенного simulator-промта»). Контраст с Geopolis:
агрегаты вместо полного мира, ID вместо имён, числа у движка, развилки-подсказки вместо
рельс.

## Примеры целей игрока (для блока «Советник целей»)

Формат конечных целей партии, которые игрок задаёт отдельным вызовом LLM (необязательно);
вход для советника-LLM. Цели разного масштаба и типа (измеримые движком ↔ нарративные).

- `player-goals-ussr-1946.md` — СССР, сценарий 1946 (30 пунктов).
- `player-goals-russia-2075.md` — Россия «Новая Русь», эпоха 2000 (29 разделов + мета-цикл
  ротации приоритетов /6 мес — сам почти советник-фреймворк). Текст извлечён из .docx,
  форматирование упрощено.

## Open-Historia (конкурентный анализ — открытый аналог, 2026-07-30)

- `open-historia-review.md` — разбор [Open-Historia/open-historia](https://github.com/Open-Historia/open-historia),
  открытого community-аналога Pax Historia (TypeScript/Vite, MIT). Что можно взять
  (мультипровайдерный LLM-транспорт, лестница восстановления JSON, контракт strict/salvage,
  возврат словаря при отказе, страж «нарратив против структуры», ловушка
  `additionalProperties:false`, консолидация истории, rollback-снапшоты), что нельзя
  (**их гео-данные построены на GADM — некоммерческая лицензия**), и где они впереди нас
  (редактор карт — незакрытый разрыв). Клон для изучения лежал в `.reference/open-historia`
  вне git; в репозиторий не попадает.
