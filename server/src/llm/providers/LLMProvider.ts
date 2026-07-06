/**
 * Абстракция автоматизированного LLM-провайдера (docs/TODO.md, P2.5) —
 * заменяет ручной copy-paste цикл прямым вызовом внешнего API. Единственный
 * метод намеренно узкий: провайдер получает готовый промт (уже собранный
 * `LLMService.generatePrompt()`) и возвращает сырой текст ответа — ровно то,
 * что раньше вставлялось вручную в "Ответ LLM". Вся валидация/применение
 * остаются в `LLMService.processResponse()`, провайдер её не дублирует.
 */
export interface LLMProvider {
  generateResponse(prompt: string): Promise<string>;
}
