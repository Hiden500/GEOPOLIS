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
 * Ошибка симуляции.
 */
export class SimulationError extends AppError {
  constructor(message: string) {
    super(message, "SIMULATION_ERROR", 500);
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
 * Ошибка при работе с регионом.
 */
export class RegionError extends AppError {
  constructor(message: string) {
    super(message, "REGION_ERROR", 404);
  }
}

/**
 * Ошибка сценария.
 */
export class ScenarioError extends AppError {
  constructor(message: string) {
    super(message, "SCENARIO_ERROR", 404);
  }
}

/**
 * Ошибка авторизации.
 */
export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, "AUTHENTICATION_ERROR", 401);
  }
}

/**
 * Ошибка доступа.
 */
export class AuthorizationError extends AppError {
  constructor(message: string = "Access denied") {
    super(message, "AUTHORIZATION_ERROR", 403);
  }
}

/**
 * Ошибка ресурса не найден.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
    super(message, "NOT_FOUND", 404);
  }
}
