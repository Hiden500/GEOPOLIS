# Gemini adapter — Geopolis

Сначала применяй корневой `AGENTS.md` и nested-инструкции затронутого модуля.
Этот файл не имеет собственного precedence и не дублирует общие команды.

Рекомендуемая роль Gemini в проекте — bounded content work: историческая
калибровка сценарных данных по первичным источникам, тексты/контент и генерация
визуальных ассетов. Кодовые изменения разрешены только в явно заданном scope и
по тем же ownership/safety правилам, что для любого агента.

- Не делай автоматический `checkout main`, `pull`, merge или push.
- Не меняй `shared/src/types/` параллельно с другими worktrees.
- Для исторических данных следуй `docs/HISTORICAL_ACCURACY.md`, отделяй source,
  estimate и assumption.
- Для UI следуй `client/AGENTS.md`; текущий `client/` не закреплён за Gemini.
- Не считай старый MAS map pipeline активной instruction system:
  `docs/GEMINI_MAP_ENGINE.md` — исторический материал.

Если platform-specific tool или skill отсутствует, явно отметь это и используй
доступный безопасный эквивалент; не выдумывай выполнение browser QA.
