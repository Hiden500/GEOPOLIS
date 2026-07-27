import { useTranslation } from "react-i18next";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { type PrimitiveOutcomeLine } from "@shared/types/politics/PrimitiveOutcome";

/**
 * Рендер локализуемой строки отклика (docs/LOCALIZATION.md, два слоя).
 *
 * Сервер присылает ключ + параметры, а не готовый текст, и здесь эти два слоя
 * сходятся: `values` (числа, уже отформатированные движком) подставляются как
 * есть, а `names` — имена сущностей мира в виде `LocalizedText` — сначала
 * разрешаются локалью интерфейса. Разрешение принадлежит клиенту, потому что
 * язык интерфейса знает он, а не сервер: партия может идти на английском
 * нарративе при русском интерфейсе.
 *
 * Числа НЕ переформатируются: они пришли из фактических дельт движка
 * (docs/PRIMITIVES.md §4), и любое округление здесь было бы вторым мнением о
 * том, что произошло в мире.
 */
export function usePrimitiveOutcomeText(): (line: PrimitiveOutcomeLine) => string {
  const { t, i18n } = useTranslation("primitiveOutcome");
  const locale = i18n.language as Locale;

  return (line: PrimitiveOutcomeLine): string => {
    const names = Object.fromEntries(
      Object.entries(line.names ?? {}).map(([key, value]) => [key, getText(value, locale)])
    );
    // defaultValue — сам ключ: незнакомый ключ должен быть ВИДЕН как дефект
    // словаря, а не подменяться правдоподобной пустотой.
    return t(line.key, { ...(line.values ?? {}), ...names, defaultValue: line.key });
  };
}
