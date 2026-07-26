import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type PrimitiveOutcomeRecord } from "@shared/types/politics/PrimitiveOutcome";
import { Button } from "../primitives";
import {
  applyPrimitives,
  translatePlayerOrder,
  type ApplyPrimitivesResult,
} from "../api/gameApi";
import { usePrimitiveOutcomeText } from "./primitiveOutcomeText";

/**
 * Гибридный интерфейс приказа (docs/PRIMITIVES.md §1).
 *
 * Две дороги к одному движку:
 *   - свободный текст → перевод моделью → **показ распознанного** →
 *     подтверждение → применение. Подтверждение здесь не вежливость: перевод —
 *     единственное место петли, где возможна ошибка ПОНИМАНИЯ, и игрок обязан
 *     увидеть, что понято, до того как это случится;
 *   - быстрые кнопки: кнопка = примитив напрямую, без перевода и без риска
 *     ошибиться в понимании. Ими же отвечают на кризисную развилку.
 *
 * Примитивы игроку невидимы: он видит локализованное человеческое описание
 * намерения (до) и фактических последствий (после). Ни на одном экране этой
 * панели не появляется ни имя глагола, ни магнитуда до применения — величины
 * не существует, пока движок её не посчитал.
 *
 * Оформление намеренно минимальное: визуальный дизайн панели делает
 * пользователь отдельно, здесь — рабочая функциональность на существующих
 * UI-примитивах.
 */

type Intensity = "mild" | "moderate" | "severe";
const INTENSITIES: Intensity[] = ["mild", "moderate", "severe"];

export interface PrimitiveOrdersPanelProps {
  playerCountryId: string;
  /** Регион, выделенный на карте, если он принадлежит игроку. */
  selectedRegionId: number | null;
  /** Перечитать состояние партии — мир изменился, интерфейс обязан догнать. */
  onApplied: () => void | Promise<void>;
}

interface PendingOrder {
  primitives: unknown[];
  preview: PrimitiveOutcomeRecord[];
  /**
   * Ключ идемпотентности рождается вместе с приказом и переживает повторную
   * ОТПРАВКУ того же приказа: второй клик по «Подтвердить» несёт ТОТ ЖЕ ключ, и
   * сервер узнаёт дубль (docs/CONCEPT.md §7.2). Блокировка кнопки на время
   * запроса от этого не избавляет — она не переживает ретрай сети.
   *
   * У свободного текста «тот же приказ» — это объект `PendingOrder`, живущий до
   * успешной отправки. У быстрых кнопок объекта нет, приказ собирается на
   * клике, поэтому ключ для них хранится отдельно (`quickOrderKeys`) — иначе
   * повтор после сетевого сбоя чеканил бы новый ключ и применялся вторым
   * приказом (найдено ревью 2026-07-26).
   */
  idempotencyKey: string;
}

function newOrderKey(): string {
  // `crypto.randomUUID` есть в браузере и в jsdom-тестах; фолбэк — на случай
  // небезопасного контекста, где его нет.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PrimitiveOrdersPanel({
  playerCountryId,
  selectedRegionId,
  onApplied,
}: PrimitiveOrdersPanelProps) {
  const { t } = useTranslation("primitiveOrders");
  const outcomeText = usePrimitiveOutcomeText();

  const [text, setText] = useState("");
  const [intensity, setIntensity] = useState<Intensity>("moderate");
  const [pending, setPending] = useState<PendingOrder | null>(null);
  const [busy, setBusy] = useState<"translate" | "apply" | null>(null);
  const [result, setResult] = useState<ApplyPrimitivesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nothingRecognized, setNothingRecognized] = useState(false);

  /**
   * Ключи «в полёте» по быстрым кнопкам: сигнатура кнопки → ключ приказа.
   * `useRef`, а не `useState`: значение читается и пишется внутри одного
   * обработчика и не должно вызывать перерисовку.
   */
  const quickOrderKeys = useRef(new Map<string, string>());

  const reset = () => {
    setPending(null);
    setResult(null);
    setError(null);
    setNothingRecognized(false);
  };

  const handleRecognize = async () => {
    if (!text.trim()) return;
    reset();
    setBusy("translate");
    try {
      const translation = await translatePlayerOrder(
        text,
        selectedRegionId ?? undefined
      );
      if (translation.primitives.length === 0) {
        setNothingRecognized(true);
        return;
      }
      setPending({
        primitives: translation.primitives,
        preview: translation.preview,
        idempotencyKey: newOrderKey(),
      });
    } catch (err) {
      console.error(err);
      setError(t("errors.translateFailed"));
    } finally {
      setBusy(null);
    }
  };

  /** @returns дошёл ли запрос до сервера (ответ получен, каким бы он ни был). */
  const run = async (order: PendingOrder): Promise<boolean> => {
    setBusy("apply");
    setError(null);
    try {
      const applied = await applyPrimitives(order.primitives, order.idempotencyKey);
      setResult(applied);
      setPending(null);
      await onApplied();
      return true;
    } catch (err) {
      console.error(err);
      setError(t("errors.applyFailed"));
      return false;
    } finally {
      setBusy(null);
    }
  };

  /**
   * Быстрая кнопка: примитив собирается здесь и идёт в движок без перевода.
   *
   * `signature` — что именно нажали (глагол, цель, характер). Пока запрос по
   * этой сигнатуре не дошёл до сервера, ключ переиспользуется: сценарий
   * «применилось, но ответ потерялся в сети» игрок видит как «Не удалось» и
   * жмёт ту же кнопку снова, и с новым ключом это был бы ВТОРОЙ приказ.
   * Дошедший запрос ключ освобождает: осознанный второй приказ того же вида —
   * не ретрай, он обязан честно дойти до движка и упереться в кап хода
   * (docs/PRIMITIVES.md §4), а не быть проглоченным как дубль.
   */
  const quickOrder = async (signature: string, primitive: Record<string, unknown>) => {
    reset();
    const key = quickOrderKeys.current.get(signature) ?? newOrderKey();
    quickOrderKeys.current.set(signature, key);

    const delivered = await run({ primitives: [primitive], preview: [], idempotencyKey: key });
    if (delivered) quickOrderKeys.current.delete(signature);
  };

  const regionOrder = (verb: "repress" | "grant_autonomy") => {
    if (selectedRegionId === null) return;
    void quickOrder(`${verb}:${selectedRegionId}:${intensity}`, {
      verb,
      sourceCountryId: playerCountryId,
      target: { regionId: selectedRegionId },
      params: { intensity },
    });
  };

  const reformOrder = (politicalDirection: "democratic" | "authoritarian") => {
    void quickOrder(`enact_reform:${politicalDirection}:${intensity}`, {
      verb: "enact_reform",
      sourceCountryId: playerCountryId,
      target: { countryId: playerCountryId },
      params: { politicalDirection, intensity },
    });
  };

  return (
    <div className="primitive-orders-panel">
      <p>{t("description")}</p>

      <textarea
        aria-label={t("ariaLabel")}
        placeholder={t("placeholder")}
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
      />

      <Button
        variant="secondary"
        onClick={handleRecognize}
        disabled={busy !== null || text.trim().length === 0}
      >
        {busy === "translate" ? t("recognizing") : t("recognize")}
      </Button>

      {pending && (
        <section aria-label={t("recognized")}>
          <h4>{t("recognized")}</h4>
          <ul>
            {pending.preview.map((record, index) => (
              <li key={index}>
                {outcomeText(record.headline)}
                {record.details.length > 0 && (
                  <span> — {record.details.map(outcomeText).join("; ")}</span>
                )}
              </li>
            ))}
          </ul>
          <Button variant="primary" onClick={() => void run(pending)} disabled={busy !== null}>
            {busy === "apply" ? t("applying") : t("confirm")}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={busy !== null}>
            {t("cancel")}
          </Button>
        </section>
      )}

      {nothingRecognized && <p role="status">{t("nothingRecognized")}</p>}

      <section aria-label={t("quick.title")}>
        <h4>{t("quick.title")}</h4>

        <label>
          {t("quick.intensity")}
          <select value={intensity} onChange={e => setIntensity(e.target.value as Intensity)}>
            {INTENSITIES.map(value => (
              <option key={value} value={value}>
                {t(`intensity.${value}`)}
              </option>
            ))}
          </select>
        </label>

        {selectedRegionId === null ? (
          <p>{t("quick.needRegion")}</p>
        ) : (
          <>
            <Button onClick={() => regionOrder("repress")} disabled={busy !== null}>
              {t("quick.repress")}
            </Button>
            <Button onClick={() => regionOrder("grant_autonomy")} disabled={busy !== null}>
              {t("quick.grantAutonomy")}
            </Button>
          </>
        )}

        <Button onClick={() => reformOrder("democratic")} disabled={busy !== null}>
          {t("quick.reformDemocratic")}
        </Button>
        <Button onClick={() => reformOrder("authoritarian")} disabled={busy !== null}>
          {t("quick.reformAuthoritarian")}
        </Button>
      </section>

      {error && <p role="alert">{error}</p>}

      {result && <OrderResult result={result} />}
    </div>
  );
}

/**
 * Итог приказа человеческим языком.
 *
 * Отказ показывается как «Не удалось: <действие>» плюс техническая причина
 * отдельной строкой (docs/PRIMITIVES.md §3 — «не удалось: причина»). Имя
 * глагола локализуется; сама причина приходит с движка английским текстом и
 * пока не локализуется — она диагностическая, и придумывать ей перевод на
 * клиенте значило бы пересказывать правило движка своими словами, рискуя
 * разойтись с ним.
 */
function OrderResult({ result }: { result: ApplyPrimitivesResult }) {
  const { t } = useTranslation("primitiveOrders");
  const outcomeText = usePrimitiveOutcomeText();

  if (result.duplicate) return <p role="status">{t("result.duplicate")}</p>;

  return (
    <div role="status">
      {result.outcomes.length > 0 && (
        <section aria-label={t("result.applied")}>
          <h4>{t("result.applied")}</h4>
          <ul>
            {result.outcomes.map((record, index) => (
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

      {result.rejected.length > 0 && (
        <section aria-label={t("result.rejected")}>
          <h4>{t("result.rejected")}</h4>
          <ul>
            {result.rejected.map((rejection, index) => (
              <li key={index}>
                {t("result.rejected")}: {t(`verb.${rejection.verb ?? "unknown"}`, {
                  defaultValue: t("verb.unknown"),
                })}
                <br />
                <small>{rejection.reason}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.outcomes.length === 0 && result.rejected.length === 0 && (
        <p>{t("result.nothingHappened")}</p>
      )}
    </div>
  );
}
