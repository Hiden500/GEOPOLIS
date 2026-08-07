import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Region } from "@shared/types/map/Region";
import { getText, type Locale } from "@shared/types/i18n/LocalizedText";

interface Props {
  regions: Region[];
  intent: string;
  onSave: (intent: string) => Promise<void>;
}

const MAX_SUGGESTIONS = 8;

/**
 * Находит незакрытое упоминание "@..." непосредственно перед кареткой —
 * триггер автокомплита по своим регионам. Возвращает null, если каретка не
 * стоит в середине такого упоминания (например, после пробела/переноса строки).
 */
function findMentionQuery(text: string, cursor: number): { start: number; query: string } | null {
  const uptoCursor = text.slice(0, cursor);
  const at = uptoCursor.lastIndexOf("@");
  if (at === -1) return null;

  const query = uptoCursor.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;

  return { start: at, query };
}

/**
 * Свободный текстовый ввод намерения игрока (взамен структурной ActionPanel,
 * docs/DECISIONS.md 2026-07-04). "@" в тексте открывает автокомплит по
 * собственным регионам — выбор вставляет реальный "id: Название", чтобы
 * игрок (а через него и LLM) не путал регион по одному лишь имени.
 */
export function PlayerIntentPanel({ regions, intent, onSave }: Props) {
  const { t, i18n } = useTranslation("playerIntentPanel");
  const locale = i18n.language as Locale;
  const [text, setText] = useState(intent);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Синхронизация поля с пропом делается СРАВНЕНИЕМ во время рендера, а не
  // эффектом: эффект отрисовывал бы устаревший текст и тут же вызывал второй
  // проход (react.dev, «You Might Not Need an Effect» → «Adjusting state when
  // a prop changes»). Правило react-hooks/set-state-in-effect ловит ровно это.
  const [prevIntent, setPrevIntent] = useState(intent);
  if (intent !== prevIntent) {
    setPrevIntent(intent);
    setText(intent);
  }

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.toLowerCase();
    return regions
      .filter(r => getText(r.names, locale).toLowerCase().includes(query))
      .slice(0, MAX_SUGGESTIONS);
  }, [mention, regions, locale]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    setSaved(false);
    setMention(findMentionQuery(value, e.target.selectionStart));
  };

  const handleSelectRegion = (region: Region) => {
    if (!mention) return;
    const textarea = textareaRef.current;
    const cursor = textarea ? textarea.selectionStart : mention.start + mention.query.length + 1;
    const insertion = `${region.id}: ${getText(region.names, locale)} `;
    const nextText = text.slice(0, mention.start) + insertion + text.slice(cursor);
    setText(nextText);
    setMention(null);
    setSaved(false);

    requestAnimationFrame(() => {
      if (!textarea) return;
      const nextCursor = mention.start + insertion.length;
      textarea.focus();
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleSave = async () => {
    try {
      await onSave(text);
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  return (
    <div className="player-intent-panel">
      <section className="panel-section">
        <p>{t("description")}</p>
        <div className="player-intent-autocomplete-wrap">
          <textarea
            ref={textareaRef}
            aria-label={t("ariaLabel")}
            placeholder={t("placeholder")}
            value={text}
            onChange={handleChange}
            onBlur={() => setMention(null)}
            rows={6}
          />
          {mention && suggestions.length > 0 && (
            <ul className="player-intent-autocomplete">
              {suggestions.map(region => (
                <li key={region.id}>
                  <button
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => handleSelectRegion(region)}
                  >
                    {region.id}: {getText(region.names, locale)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="primary" onClick={handleSave}>
          {t("saveButton")}
        </button>
        {saved && <p className="player-intent-saved">{t("saved")}</p>}
      </section>
    </div>
  );
}
