# Client rules

Применяется к `client/` вместе с корневым `AGENTS.md`.

- Стек фиксирован: React 19, Vite, MapLibre, TypeScript, react-i18next.
- Перед UI-изменениями прочитай `docs/UI_DESIGN.md`; для локализации —
  `docs/LOCALIZATION.md`. Все новые видимые строки используют `t()` и namespace
  с обеими локалями `client/src/i18n/locales/{ru,en}/`.
- Геометрию, топологию, polygon rendering и country-label algorithms в
  `client/src/map/` меняй только при доказанной причине. UI-слой карты
  (mapmodes, popup, legend, controls) — обычный UI scope.
- Переиспользуй design tokens и существующие HUD/components; не складывай
  новые паттерны в общий CSS без необходимости.
- Перед реализацией любого нетривиального изменения UI-компоновки сначала
  покажи пользователю низкодетальную схему/wireframe и дождись явного
  подтверждения. На схеме обязательно отметь границы элементов и поведение
  ширины (`по контенту`, `фиксированная`, `растягивается`), а также целевые
  viewport. Обсуждение проблемы или список идей не считать утверждением схемы.
- Для UI проверь loading, empty, error, success, длинный RU/EN текст, keyboard
  focus, overflow и хотя бы узкий/широкий viewport, когда browser tooling
  доступен. Статическую проверку не называй визуальным QA.

Проверки из `client/`:

```text
npx tsc --noEmit -p tsconfig.app.json
npm test
npm run lint
npm run build
```

Предсуществующие lint failures фиксируй отдельно; не добавляй новые.
