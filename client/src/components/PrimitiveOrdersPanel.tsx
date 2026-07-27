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
import { usePrimitiveRejectionText } from "./primitiveRejectionText";

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
 * намерения (до) и фактических последствий (после).
 *
 * Граница названа точно (уточнено ревью 2026-07-26; прежняя формулировка «ни на
 * одном экране панели не появляется ни имя глагола, ни магнитуда» была сильнее
 * кода — под неё не подходил ни один экран после применения). Правило про
 * величины двустороннее:
 *   - ДО применения (распознанное, подтверждение) величины нет вовсе: её ещё не
 *     существует, движок её не считал, и показывать нечего;
 *   - ПОСЛЕ применения фактические числа движка показываются НАМЕРЕННО
 *     («Подавление: +0.420 … 0.000 → 0.420») — это и есть требование
 *     docs/PRIMITIVES.md §4 «числа в описании правдивые, от движка».
 *
 * Одно место выпадает из первой половины — техническая причина ОТКАЗА: она
 * приходит с движка сырым английским текстом и несёт и имя глагола, и числа
 * бюджета хода («…would total 0.238 (max 0.45 per turn)»), то есть величину
 * действия, которое НЕ произошло. Это не отдельное решение показать величину, а
 * видимая часть уже зафиксированного хвоста «причина отказа не локализована»
 * (docs/TODO.md): одна и та же строка обслуживает и игрока, и диагностику
 * модели, и разделить их можно только структурным кодом отказа в ядре. Пока
 * хвост открыт, строка остаётся диагностической и стоит рядом со словом
 * «Не удалось».
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
  /**
   * Текущая игровая дата. Нужна не для показа, а как граница жизни ключей
   * быстрых кнопок: ключ — защита от ретрая, а ретрай живёт секунды, не месяцы
   * (см. `quickOrder`).
   */
  currentDate: string;
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
  currentDate,
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

  /** Ход, которому принадлежат накопленные ключи (см. `quickOrder`). */
  const quickOrderKeysDate = useRef(currentDate);

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

  /**
   * @returns вернул ли сервер УСПЕШНЫЙ ответ (2xx).
   *
   * Названо точно, а не «дошёл ли запрос»: `applyPrimitives` бросает на любом
   * не-2xx, поэтому отказ движка (HTTP 200 с непустым `rejected` — приказ дошёл
   * и был честно рассмотрен) считается доставкой, а HTTP 400/500 — нет. Разница
   * видна на ключе быстрой кнопки: после 400 он сохраняется и повтор уходит
   * ретраем. Это безопасная сторона (хуже проглотить повтор, чем применить
   * приказ дважды), но обещание в коде обязано совпадать с кодом.
   */
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
   * этой сигнатуре не завершился успехом, ключ переиспользуется: сценарий
   * «применилось, но ответ потерялся в сети» игрок видит как «Не удалось» и
   * жмёт ту же кнопку снова, и с новым ключом это был бы ВТОРОЙ приказ.
   * Успешный ответ ключ освобождает: осознанный второй приказ того же вида —
   * не ретрай, он обязан честно дойти до движка и упереться в кап хода
   * (docs/PRIMITIVES.md §4), а не быть проглоченным как дубль.
   *
   * Ключи живут ровно один ход. Ключ, удержанный после сетевого сбоя в феврале,
   * в марте относится к другому приказу, а журнал ключей на сервере кольцевой
   * (32 записи, `MAX_PRIMITIVE_BATCH_KEYS`) — февральский ключ там ещё лежит, и
   * законный мартовский приказ был бы проглочен как дубль с сообщением «уже
   * отдан». Панель не перемонтируется при смене месяца, поэтому чистка сделана
   * здесь, лениво, а не эффектом: лишней перерисовки не нужно, а прочитать дату
   * раньше первого клика всё равно некому (найдено ревью 2026-07-26).
   */
  const quickOrder = async (signature: string, primitive: Record<string, unknown>) => {
    reset();
    if (quickOrderKeysDate.current !== currentDate) {
      quickOrderKeys.current.clear();
      quickOrderKeysDate.current = currentDate;
    }
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
 * глагола и сама причина локализуются: с Милстоуна 1 движок присылает код
 * отказа и параметры, а не английскую строку. Величин несостоявшегося действия
 * в причине нет по построению — они остаются в английском рендере для промта
 * (docs/PRIMITIVES.md §3).
 */
function OrderResult({ result }: { result: ApplyPrimitivesResult }) {
  const { t } = useTranslation("primitiveOrders");
  const outcomeText = usePrimitiveOutcomeText();
  const rejectionText = usePrimitiveRejectionText();

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
                <small>{rejectionText(rejection)}</small>
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
