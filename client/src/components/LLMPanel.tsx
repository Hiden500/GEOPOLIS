import { useState } from "react";
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
 * LLM-цикл: автоматически через Gemini API (POST /llm/auto, требует
 * server/.env с GEMINI_API_KEY) или вручную (ManualClipboardProvider) —
 * скопировать промт → внешняя LLM → вставить ответ → валидация → применение.
 * Оба используют одну и ту же валидацию/применение на сервере.
 */
export function LLMPanel({ llmTurn, onApplied }: Props) {
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
      setError(err instanceof Error ? err.message : "Ошибка получения промта");
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
      setError(err instanceof Error ? err.message : "Ошибка применения ответа");
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
      setError(err instanceof Error ? err.message : "Ошибка автоматического цикла");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="llm-panel">
      <h2>LLM-симуляция</h2>
      <p className="llm-turn">Ход LLM: {llmTurn}</p>

      <section className="panel-section">
        <h3>Автоматически (Gemini)</h3>
        <button className="primary" onClick={handleAuto} disabled={busy}>
          Сгенерировать и применить автоматически
        </button>
      </section>

      <section className="panel-section">
        <h3>1. Промт (ручной способ)</h3>
        <button className="primary" onClick={handleGetPrompt} disabled={busy}>
          {copied ? "Промт скопирован ✓" : "Получить и скопировать промт"}
        </button>
        {prompt && (
          <textarea
            className="llm-prompt-output"
            aria-label="Промт для LLM"
            readOnly
            value={prompt}
            rows={6}
            onFocus={e => e.currentTarget.select()}
          />
        )}
      </section>

      <section className="panel-section">
        <h3>2. Ответ LLM</h3>
        <textarea
          className="llm-response-input"
          aria-label="Ответ LLM (JSON)"
          placeholder='Вставьте JSON-ответ LLM: { "descriptions": "...", "actions": [...] }'
          value={responseText}
          onChange={e => setResponseText(e.target.value)}
          rows={6}
        />
        <button
          className="primary"
          onClick={handleApply}
          disabled={busy || responseText.trim().length === 0}
        >
          Применить ответ
        </button>
      </section>

      {error && <p className="llm-error">{error}</p>}

      {result && result.success && (
        <section className="panel-section llm-result">
          <h3>{result.title || "Результат"}</h3>
          {result.descriptions && (
            <p className="llm-descriptions">{result.descriptions}</p>
          )}
          <p>
            Применено действий: {result.appliedActions.length}
            {result.rejectedActions.length > 0 &&
              `, отклонено: ${result.rejectedActions.length}`}
          </p>
          {result.rejectedActions.length > 0 && (
            <ul className="llm-rejected">
              {result.rejectedActions.map((r, i) => (
                <li key={i}>
                  {r.action.type} {r.action.sourceCountryId}
                  {r.action.targetCountryId ? ` → ${r.action.targetCountryId}` : ""}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
