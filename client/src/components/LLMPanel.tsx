import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getLlmPrompt,
  submitLlmResponse,
  runAutoLlmCycle,
  type LlmCycleResult,
} from "../api/gameApi";
import { usePrimitiveOutcomeText } from "./primitiveOutcomeText";

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
      console.error(err);
      setError(t("errors.getPrompt"));
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
      console.error(err);
      setError(t("errors.applyResponse"));
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
      console.error(err);
      setError(t("errors.autoCycle"));
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

      {result && result.success && <CycleResult result={result} />}
    </div>
  );
}

/**
 * Итог цикла режиссёра.
 *
 * Ключевое различие — `narrativeCanonized` (добавлено 2026-07-26 по внешнему
 * аудиту). Пока панель рисовала `title`/`descriptions` безусловно, «Восстание
 * подавлено» при отклонённом примитиве выглядело для игрока ровно как настоящее
 * событие. Теперь текста при полном отказе нет вовсе (сервер его не отдаёт), а
 * на его месте — человеческое сообщение о том, что режиссёр предложил
 * невозможное, и список причин.
 *
 * Фактический результат примитивов показывается рядом с текстом и при частичном
 * применении: канон строится по нему, а не по прозе (docs/CONCEPT.md §7.2).
 */
function CycleResult({ result }: { result: LlmCycleResult }) {
  const { t } = useTranslation("llmPanel");
  const outcomeText = usePrimitiveOutcomeText();

  return (
    <section className="panel-section llm-result">
      {result.narrativeCanonized ? (
        <>
          <h3>{result.title || t("result.defaultTitle")}</h3>
          {/*
            Та же пометка, что в ленте событий (EventTimelinePanel): текст
            написан ДО применения, и при частичном применении он вправе
            описывать отклонённую часть. Панель — место, где игрок читает его
            ПЕРВЫМ, поэтому оставить её здесь без пометки значило бы отложить
            правду на один экран.
          */}
          {result.factuality && result.factuality !== "confirmed" && (
            <p className="llm-factuality" role="note">
              {t(`result.factuality.${result.factuality}`)}
            </p>
          )}
          {result.descriptions && <p className="llm-descriptions">{result.descriptions}</p>}
        </>
      ) : (
        <>
          <h3>{t("result.notCanonizedTitle")}</h3>
          <p role="status">{t("result.notCanonized")}</p>
        </>
      )}

      <p>
        {t("result.appliedActionsCount", { count: result.appliedActions.length })}
        {result.rejectedActions.length > 0 &&
          t("result.rejectedActionsSuffix", { count: result.rejectedActions.length })}
      </p>

      {result.primitiveOutcomes.length > 0 && (
        <section aria-label={t("result.primitivesApplied")}>
          <h4>{t("result.primitivesApplied")}</h4>
          <ul className="llm-outcomes">
            {result.primitiveOutcomes.map((record, index) => (
              <li key={index}>
                {outcomeText(record.headline)}
                <ul>
                  {record.details.map((line, i) => (
                    <li key={i}>{outcomeText(line)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.rejectedPrimitives.length > 0 && (
        <section aria-label={t("result.primitivesRejected")}>
          <h4>{t("result.primitivesRejected")}</h4>
          {/* Причина приходит с движка сырым английским — тот же осознанный
              хвост, что в панели приказов (docs/TODO.md): одна строка обслуживает
              и игрока, и диагностику модели, разделить их можно только
              структурным кодом отказа в ядре. */}
          <ul className="llm-rejected">
            {result.rejectedPrimitives.map((rejection, index) => (
              <li key={index}>
                {rejection.verb ?? "?"}: <small>{rejection.reason}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

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
  );
}
