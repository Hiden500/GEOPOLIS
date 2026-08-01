/**
 * Что за модели отдаёт настроенный OpenAI-совместимый эндпоинт.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ КОМАНДА. Список моделей до сих пор печатался только внутри
 * `runCampaignWithLLM` — то есть узнать, доступна ли модель, можно было лишь
 * запустив многочасовую партию. Здесь тот же вызов стоит одной командой и
 * отвечает на три вопроса, которые задают перед прогоном: сервер жив, ключ
 * принят, нужное имя модели существует.
 *
 * Секрет не печатается: про ключ выводится только «задан / не задан».
 *
 * Запуск (из server/):
 *   npx tsx scripts/listLocalModels.ts
 */
// Первым: подхватывает server/.env до чтения любых переменных.
import "./loadEnv";
import { localBaseUrl, listLocalModels, hasApiKey } from "../src/llm/providers/localEndpoint";

async function main(): Promise<void> {
  const baseUrl = localBaseUrl();
  const wanted = process.env.LOCAL_LLM_MODEL;

  console.log(`эндпоинт: ${baseUrl}`);
  console.log(`ключ LOCAL_LLM_API_KEY: ${hasApiKey() ? "задан" : "не задан"}`);

  let ids: string[];
  try {
    ids = await listLocalModels();
  } catch (error) {
    console.error(`\nНЕ ОТВЕЧАЕТ: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nдоступно моделей: ${ids.length}`);
  for (const id of ids) {
    console.log(`  ${id === wanted ? "→" : " "} ${id}`);
  }

  if (!wanted) {
    console.log(
      `\nLOCAL_LLM_MODEL не задан — провайдер отправит имя "local-model". ` +
      `Рантайму с одной загруженной моделью этого хватает, шлюзу с несколькими — нет.`
    );
    return;
  }

  if (ids.includes(wanted)) {
    console.log(`\nLOCAL_LLM_MODEL="${wanted}" — эндпоинт такую отдаёт.`);
  } else {
    // Ненулевой код возврата: расхождение имени ловится в скрипте, а не на
    // первом ходе партии, где ошибка приходит от чужого сервиса.
    console.error(`\nLOCAL_LLM_MODEL="${wanted}" — такой модели у эндпоинта НЕТ.`);
    process.exitCode = 1;
  }
}

void main();
