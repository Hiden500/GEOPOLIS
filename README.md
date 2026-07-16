# Geopolis

Браузерная глобальная стратегия с альтернативной историей (1836–2100), личный некоммерческий проект.

Подробности замысла, архитектуры и правил работы над проектом — в [`AGENTS.md`](AGENTS.md) и [`docs/`](docs/). Журнал архитектурных решений — в [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Структура репозитория

```text
client/   — React + TypeScript + Vite, карта на MapLibre GL JS
server/   — Node.js + TypeScript, игровой движок и симуляция
shared/   — общие TypeScript-типы и утилиты для client/server
docs/     — правила, архитектура и дизайн-документы
scripts/  — Python-пайплайн генерации карты/регионов (см. docs/WORLD.md)
```

Это монорепо без workspace-конфига. Собственные `package.json` есть в корне, `server/` и `client/`; `shared/` подключается к обоим приложениям как исходный код и отдельного пакета не имеет.

## Требования и установка

CI использует Node.js 22 и Python 3.12. Для воспроизводимой установки используйте lock-файлы:

```powershell
npm ci
cd server; npm ci
cd ../client; npm ci
```

Настройки серверных интеграций описаны в [`server/.env.example`](server/.env.example). Секреты из локального `.env` не коммитятся.

## Запуск

Быстрый способ для Windows поднимает Express на `http://localhost:3000`, Vite на `http://localhost:5173` и открывает клиент:

```powershell
.\start.ps1 -Install   # первый запуск
.\start.ps1            # последующие запуски
```

Вручную запустите процессы в двух терминалах:

```powershell
cd server; npm run dev
cd client; npm run dev
```

Vite проксирует на Express маршруты `/game`, `/scenarios`, `/budget`, `/research`, `/player-intent` и `/llm`; актуальный список находится в [`client/vite.config.ts`](client/vite.config.ts).

> Сервер разработки не имеет аутентификации и разрешает CORS. Он предназначен только для локальной разработки: не публикуйте порт 3000 в локальную сеть или интернет.

## Проверки

```powershell
# server
cd server
npx tsc --noEmit -p tsconfig.json
npm test

# client
cd ../client
npx tsc --noEmit -p tsconfig.app.json
npm test
npm run lint
npm run build

# данные сценария 1946
cd ..
python scripts/map/validate_region_economy_1946.py
python scripts/map/test_validate_region_economy_1946.py
```

`npm run build` клиента включает TypeScript-проверку. Перед изменениями сверяйтесь с обязательными командами и известными baseline-проблемами в [`AGENTS.md`](AGENTS.md) и [`docs/TODO.md`](docs/TODO.md); успешность проверки определяется фактическим кодом выхода, а не этим README.
