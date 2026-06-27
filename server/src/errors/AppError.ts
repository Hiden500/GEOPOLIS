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
