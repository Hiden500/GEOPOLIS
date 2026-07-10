import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getLlmPrompt,
  submitLlmResponse,
  runAutoLlmCycle,
  type LlmCycleResult,
} from "../api/gameApi";

interface Props {
  llmTurn: number;
  onApplied: () => void;
}

/**
 * Читает строковое поле из rejectedActions[].action — тип `unknown`
 * (docs/plans/02_LLM_CONTRACT.md, Шаг 3): точечно отклонённый элемент не
 * гарантированно валиден, мог провалиться ровно на структурной проверке.
 */
function rejectedActionField(action: unknown, key: string): string | undefined {
  if (typeof action !== "object" || action === null || !(key in action)) return undefined;
  const value = (action as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * LLM-цикл: автоматически через Gemini API (POST /llm/auto, требует
 * server/.env с GEMINI_API_KEY) или вручную (ManualClipboardProvider) —
 * скопировать промт → внешняя LLM → вставить ответ → валидация → применение.
 * Оба используют одну и ту же валидацию/применение на сервере.
 */
export function LLMPanel({ llmTurn, onApplied }: Props) {
  const { t } = useTranslation("llmPanel");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [result, setResult] = useState<LlmCycleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGetPrompt = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const { prompt: text } = await getLlmPrompt();
      setPrompt(text);
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      } catch {
        // Clipboard недоступен (нет прав/не-secure context) — промт всё
        // равно показан ниже, можно скопировать вручную.
        setCopied(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.getPrompt"));
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await submitLlmResponse(responseText);
      setResult(res);
      if (res.success) {
        setResponseText("");
        onApplied();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.applyResponse"));
    } finally {
      setBusy(false);
    }
  };

  const handleAuto = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await runAutoLlmCycle();
      setResult(res);
      if (res.success) {
        onApplied();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.autoCycle"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="llm-panel">
      <h2>{t("title")}</h2>
      <p className="llm-turn">{t("turnLabel", { turn: llmTurn })}</p>

      <section className="panel-section">
        <h3>{t("autoSection.title")}</h3>
        <button className="primary" onClick={handleAuto} disabled={busy}>
          {t("autoSection.button")}
        </button>
      </section>

      <section className="panel-section">
        <h3>{t("promptSection.title")}</h3>
        <button className="primary" onClick={handleGetPrompt} disabled={busy}>
          {copied ? t("promptSection.copiedButton") : t("promptSection.getButton")}
        </button>
        {prompt && (
          <textarea
            className="llm-prompt-output"
            aria-label={t("promptSection.ariaLabel")}
            readOnly
            value={prompt}
            rows={6}
            onFocus={e => e.currentTarget.select()}
          />
        )}
      </section>

      <section className="panel-section">
        <h3>{t("responseSection.title")}</h3>
        <textarea
          className="llm-response-input"
          aria-label={t("responseSection.ariaLabel")}
          placeholder={t("responseSection.placeholder")}
          value={responseText}
          onChange={e => setResponseText(e.target.value)}
          rows={6}
        />
        <button
          className="primary"
          onClick={handleApply}
          disabled={busy || responseText.trim().length === 0}
        >
          {t("responseSection.applyButton")}
        </button>
      </section>

      {error && <p className="llm-error">{error}</p>}

      {result && result.success && (
        <section className="panel-section llm-result">
          <h3>{result.title || t("result.defaultTitle")}</h3>
          {result.descriptions && (
            <p className="llm-descriptions">{result.descriptions}</p>
          )}
          <p>
            {t("result.appliedActionsCount", { count: result.appliedActions.length })}
            {result.rejectedActions.length > 0 &&
              t("result.rejectedActionsSuffix", { count: result.rejectedActions.length })}
          </p>
          {result.rejectedActions.length > 0 && (
            <ul className="llm-rejected">
              {result.rejectedActions.map((r, i) => (
                <li key={i}>
                  {rejectedActionField(r.action, "type") ?? "?"} {rejectedActionField(r.action, "sourceCountryId") ?? "?"}
                  {rejectedActionField(r.action, "targetCountryId")
                    ? ` → ${rejectedActionField(r.action, "targetCountryId")}`
                    : ""}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
