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
    },
  })
);
