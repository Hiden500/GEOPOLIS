import { useTranslation } from "react-i18next";
import { resolveIdeologyLabel } from "@shared/utils/ideologyLabel";
import { resolveIdeologyCoordinates } from "@shared/utils/discontent";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { type IdeologyAnchor } from "@shared/types/politics/IdeologyAnchor";
import { type PoliticsState } from "@shared/types/PoliticsState";

/**
 * Ярлык идеологии для показа игроку.
 *
 * Две половины ярлыка приходят из разных мест, и это не случайность реализации,
 * а следствие того, кто владеет строкой (`docs/LOCALIZATION.md`): ступени шкалы
 * задаёт движок и переводит словарь интерфейса, а имя якоря приносит сценарий
 * вместе с готовыми переводами. Поэтому здесь `t()` для одного случая и
 * `getText()` для другого.
 *
 * Строка НЕ хранится в состоянии: сдвиг координат реформой обязан менять то,
 * что видит игрок, а хранимая строка осталась бы прежней.
 */
export function useIdeologyLabel(): (
  politics: PoliticsState,
  anchors: readonly IdeologyAnchor[]
) => string {
  const { t, i18n } = useTranslation("ideology");

  return (politics, anchors) => {
    const label = resolveIdeologyLabel(resolveIdeologyCoordinates(politics), anchors);
    if (label.kind === "anchor") {
      return getText(label.anchor.name, i18n.language as Locale);
    }
    return [
      t(`bands.economic.${label.economic.key}`),
      t(`bands.political.${label.political.key}`),
    ].join(t("separator"));
  };
}
