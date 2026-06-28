/**
 * Универсальная мультиязычная строка.
 *
 * Заменяет разрозненные пары `name`/`nameEn`: имена регионов, стран и прочих
 * сущностей хранятся как словарь локаль→текст и расширяются новыми языками без
 * изменения схемы.
 */

/** Поддерживаемые локали. Расширяется по мере добавления языков. */
export type Locale = "ru" | "en";

/** Локализуемый текст: частичный словарь локаль→строка. */
export type LocalizedText = Partial<Record<Locale, string>>;

/** Локаль интерфейса по умолчанию. */
export const DEFAULT_LOCALE: Locale = "ru";

/** Локаль, на которой имена уходят в LLM (промпты, исторический контекст). */
export const LLM_LOCALE: Locale = "en";

/**
 * Возвращает текст для запрошенной локали с детерминированным фолбэком:
 * запрошенная → en → ru → первое доступное значение → пустая строка.
 */
export function getText(text: LocalizedText | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!text) return "";
  return (
    text[locale] ??
    text.en ??
    text.ru ??
    Object.values(text).find((v): v is string => typeof v === "string") ??
    ""
  );
}
