import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Переиспользуем vite-конфиг (react-плагин, alias @shared), добавляя только
// настройки тестового окружения. Прокси из vite.config на тесты не влияет.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "happy-dom",
      globals: true,
      /*
       * CSS-модули РЕАЛЬНО подключаются к документу теста. По умолчанию vitest
       * их выбрасывает, отдавая только имена классов, — и тогда раскладка не
       * проверяема вовсе: `getComputedStyle` возвращает пустоту, а дефект
       * «панель рамы уехала за край окна» жил именно в CSS (инлайновый стиль
       * компонента перебивал класс раскладки). Проверяются вычисленные
       * свойства, не геометрия: движка раскладки у happy-dom нет, `offsetTop`
       * и `getBoundingClientRect` в нём всегда нули.
       *
       * Ограничено модулями: глобальные таблицы (`App.css`, `styles/`) в
       * проверках не участвуют, а их разбор — лишняя работа на каждом файле.
       */
      css: { include: [/\.module\.css$/] },
    },
  })
);
