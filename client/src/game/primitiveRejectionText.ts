import { useTranslation } from "react-i18next";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { type PrimitiveRejectionRecord } from "@shared/types/politics/PrimitiveRejection";

/**
 * Рендер локализуемой причины отказа (docs/PRIMITIVES.md §3,
 * docs/LOCALIZATION.md).
 *
 * Тот же приём, что у отклика (`usePrimitiveOutcomeText`), и намеренно тот же:
 * отказ и отклик игрок читает в одном списке, и второй способ их собирать
 * означал бы второй способ разъехаться.
 *
 * До Милстоуна 1 здесь была сырая английская строка движка. Она уходила ДВУМ
 * потребителям с несовместимыми требованиями — игроку и в промт модели, — и
 * побеждал промт: игрок читал «Turn impact ceiling reached: suppression on
 * region 68 / group estonians would total 0.238 (max 0.45 per turn)», то есть
 * сырые идентификаторы кода и величину приказа, которого НЕ произошло. Теперь
 * сервер присылает код + параметры, английский рендер для промта живёт на
 * сервере, а величины несостоявшегося действия до клиента не доезжают вовсе.
 */
export function usePrimitiveRejectionText(): (record: PrimitiveRejectionRecord) => string {
  const { t, i18n } = useTranslation("primitiveRejection");
  const locale = i18n.language as Locale;

  return (record: PrimitiveRejectionRecord): string => {
    const names = Object.fromEntries(
      Object.entries(record.names ?? {}).map(([key, value]) => [key, getText(value, locale)])
    );
    // defaultValue — сам код: незнакомый код должен быть ВИДЕН как дефект
    // словаря, а не подменяться правдоподобной пустотой.
    return t(record.code, { ...(record.values ?? {}), ...names, defaultValue: record.code });
  };
}
