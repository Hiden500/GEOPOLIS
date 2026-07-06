/**
 * Базовый класс для всех ошибок приложения.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Ошибка валидации входных данных.
 */
export class ValidationError extends AppError {
  constructor(message: string, public details?: any) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

/**
 * Ошибка при работе с игрой.
 */
export class GameError extends AppError {
  constructor(message: string) {
    super(message, "GAME_ERROR", 400);
  }
}

/**
 * Ошибка при работе со страной.
 */
export class CountryError extends AppError {
  constructor(message: string) {
    super(message, "COUNTRY_ERROR", 404);
  }
}

/**
 * Ошибка автоматизированного LLM-провайдера (ключ не настроен, сеть,
 * невалидный формат ответа) — 502, так как сбой находится выше по цепочке
 * (внешний API), не в самом приложении.
 */
export class LLMProviderError extends AppError {
  constructor(message: string) {
    super(message, "LLM_PROVIDER_ERROR", 502);
  }
}

/**
 * Гейт хода (docs/DECISIONS.md, 2026-07-06): ход не может продвинуться без
 * ответа LLM в текущем цикле ("LLM — главный двигатель", docs/LLM_RULES.md).
 * 409 — конфликт состояния, не ошибка входных данных и не "не найдено".
 */
export class LLMGateError extends AppError {
  constructor(message: string) {
    super(message, "LLM_GATE_ERROR", 409);
  }
}
