import { useTranslation } from "react-i18next";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";
import { type Country } from "@shared/types/Country";
import { type PoliticsState } from "@shared/types/PoliticsState";
import { SOVEREIGN_STATUS } from "@shared/types/politics/Government";

/**
 * Ярлык формы правления и юридического положения для показа игроку.
 *
 * Две половины приходят из разных мест по тому же правилу владения строкой, что
 * у `useIdeologyLabel` (`docs/LOCALIZATION.md`): названия форм власти и статусов
 * — словарь ДВИЖКА с фиксированным множеством значений
 * (`shared/src/types/politics/Government.ts`), поэтому `t()`; имя метрополии —
 * `LocalizedText` страны сценария, поэтому `getText()`.
 *
 * ПОЧЕМУ «Колония — Великобритания», А НЕ «Британская колония». Прилагательная
 * форма метрополии на русском требует согласования по роду с существительным
 * статуса: колония и зона женского рода, протекторат, мандат, доминион и
 * кондоминиум — мужского. Одиннадцать статусов на тринадцать метрополий — это
 * либо новое поле данных с сотней склоняемых форм, либо словарь по id страны,
 * который придётся пополнять при каждой новой метрополии, и в обоих случаях
 * ошибка согласования не ловится ничем, кроме глаза. Приложение через тире
 * стоит стилистики и ничего больше, зато работает для любой пары и для обеих
 * локалей.
 *
 * Строка НЕ хранится в состоянии: статус меняется деколонизацией, а хранимая
 * строка осталась бы прежней (то же соображение, что у ярлыка идеологии).
 */
export function useGovernmentLabel(): (
  politics: PoliticsState,
  countries: readonly Country[]
) => string {
  const { t, i18n } = useTranslation("government");

  return (politics, countries) => {
    const parts: string[] = [];

    if (politics.powerStructure !== undefined) {
      parts.push(t(`powerStructure.${politics.powerStructure}`));
    }

    const status = politics.sovereigntyStatus;
    // Суверенитет — состояние по умолчанию: подписывать им шестьдесят восемь
    // стран из ста пятидесяти семи значит писать «обычное» там, где строка
    // должна сообщать особенное. Показывается только подчинение.
    if (status !== undefined && status !== SOVEREIGN_STATUS) {
      const statusLabel = t(`sovereigntyStatus.${status}`);
      const overlords = (politics.overlordIds ?? [])
        .map(id => countries.find(c => c.id === id))
        .filter((c): c is Country => c !== undefined)
        .map(c => getText(c.shortName, i18n.language as Locale));

      parts.push(
        overlords.length > 0
          ? t("withOverlord", { status: statusLabel, overlords: overlords.join(t("overlordJoin")) })
          : statusLabel
      );
    }

    return parts.join(t("separator"));
  };
}
