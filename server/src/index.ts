import express from "express";
import cors from "cors";
import gameRoutes from "./routes/game";
import scenarioRoutes from "./routes/scenarios";
import playerIntentRoutes from "./routes/playerIntent";
import budgetRoutes from "./routes/budget";
import researchRoutes from "./routes/research";
import llmRoutes from "./routes/llm";

// Загружает server/.env (GEMINI_API_KEY и т.п.), если файл есть — не обязателен
// для запуска сервера (ручной LLM-цикл работает без него). Node 24 умеет это
// нативно, доп. зависимость (dotenv) не нужна.
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — нормально для ручного цикла, автопровайдер просто
  // сообщит об отсутствии ключа при попытке вызова.
}

const app = express();
app.use(cors());
app.use(express.json());
app.use("/game", gameRoutes);
app.use("/scenarios", scenarioRoutes);
app.use("/player-intent", playerIntentRoutes);
app.use("/budget", budgetRoutes);
app.use("/research", researchRoutes);
app.use("/llm", llmRoutes);

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});