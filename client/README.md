# Клиент Geopolis

React + TypeScript + Vite-клиент Geopolis. Карта построена на MapLibre GL JS, UI локализуется через `react-i18next`, общие типы импортируются из `shared/src` по alias `@shared`.

## Запуск

```powershell
npm ci
npm run dev
```

Клиент доступен на `http://localhost:5173`. Для игровых API нужен сервер из `../server` на `http://localhost:3000`; Vite проксирует `/game`, `/scenarios`, `/budget`, `/research`, `/player-intent` и `/llm`.

## Проверки

```powershell
npm run build   # TypeScript project build + Vite production build
npm test        # Vitest
npm run lint    # ESLint
npm run preview # просмотр уже собранного dist/
```

Дизайн-система и правила UI описаны в [`../docs/UI_DESIGN.md`](../docs/UI_DESIGN.md), архитектура проекта — в [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
