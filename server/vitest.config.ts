import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  test: {
    environment: "node",
    /**
     * Тесты `shared/` исполняются ЗДЕСЬ (добавлено Милстоуном 1, сессия
     * жизненного цикла).
     *
     * До этого они не запускались НИГДЕ: серверный vitest ищет тесты внутри
     * `server/`, клиентский — внутри `client/`, а `shared/` своего прогона не
     * имеет. `shared/src/utils/nationalPower.test.ts` пролежал мёртвым, и любой
     * новый тест на общие утилиты (агрегация «регионы → страна», модификаторы,
     * недовольство) молча повторил бы его судьбу — то есть выглядел бы
     * покрытием, не будучи им.
     *
     * Прицеплено к серверу, а не к клиенту: окружение `node` этим утилитам
     * подходит, у клиента — `happy-dom`, и DOM им не нужен.
     */
    include: ["src/**/*.test.ts", "../shared/src/**/*.test.ts"],
  },
});
