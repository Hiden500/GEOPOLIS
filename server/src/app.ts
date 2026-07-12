import express, { type Express } from "express";
import cors from "cors";
import gameRoutes from "./routes/game";
import scenarioRoutes from "./routes/scenarios";
import playerIntentRoutes from "./routes/playerIntent";
import budgetRoutes from "./routes/budget";
import researchRoutes from "./routes/research";
import llmRoutes from "./routes/llm";
import objectiveRoutes from "./routes/objective";

/**
 * Собирает Express-приложение без запуска listen() — index.ts зовёт listen()
 * сам, тесты (server/src/routes/__tests__/) зовут createApp() напрямую и
 * бьют по нему через supertest, не поднимая реальный сокет.
 */
export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/game", gameRoutes);
  app.use("/scenarios", scenarioRoutes);
  app.use("/player-intent", playerIntentRoutes);
  app.use("/budget", budgetRoutes);
  app.use("/research", researchRoutes);
  app.use("/llm", llmRoutes);
  app.use("/objective", objectiveRoutes);
  return app;
}
