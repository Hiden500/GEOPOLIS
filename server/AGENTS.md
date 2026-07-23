# Server rules

Применяется к `server/` вместе с корневым `AGENTS.md`.

- `SimulationEngine.ts` сохраняет документированный порядок тиков из
  `docs/AI_RULES.md`; изменение порядка — архитектурное решение.
- Игровые расчёты детерминированы. LLM выдаёт только Zod-валидируемые команды,
  не вычисляет экономику/бой/pathfinding и не пишет save напрямую.
- Routes валидируют transport input и вызывают services; бизнес-правила не
  дублируются в route handlers.
- Изменения game state проводят через существующий command/service boundary и
  сохраняют JSON-serializability shared state.
- API сейчас предназначен только для локальной разработки: auth отсутствует,
  CORS широк, поэтому не заявляй production/LAN safety.

Проверки из `server/`:

```text
npx tsc --noEmit -p tsconfig.json
npm test
```

Для изменения тика добавь/обнови targeted tick test и при системном риске
запусти campaign smoke test из существующего Vitest suite.
