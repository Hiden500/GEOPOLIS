import { createApp } from "./app";

// Загружает server/.env (GEMINI_API_KEY и т.п.), если файл есть — не обязателен
// для запуска сервера (ручной LLM-цикл работает без него). Node 24 умеет это
// нативно, доп. зависимость (dotenv) не нужна.
try {
  process.loadEnvFile();
} catch {
  // .env отсутствует — нормально для ручного цикла, автопровайдер просто
  // сообщит об отсутствии ключа при попытке вызова.
}

const app = createApp();

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});