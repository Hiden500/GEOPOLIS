import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { markOnboardingComplete } from "./onboardingState";
import styles from "./Onboarding.module.css";

const STEPS = ["stats", "books", "llm", "orders", "turn"] as const;

interface OnboardingProps {
  open: boolean;
  onClose: () => void;
}

export function Onboarding({ open, onClose }: OnboardingProps) {
  const { t } = useTranslation("onboarding");
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const step = STEPS[stepIndex];

  useLayoutEffect(() => {
    if (!open) return;

    const updateTarget = () => {
      const target = document.querySelector<HTMLElement>(`[data-onboarding="${step}"]`);
      setTargetRect(target?.getBoundingClientRect() ?? null);
    };

    const frame = window.requestAnimationFrame(updateTarget);
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);
    return () => {
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
      window.cancelAnimationFrame(frame);
    };
  }, [open, step]);

  useEffect(() => {
    if (!open) return;
    headingRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      if (event.key === "ArrowRight" && stepIndex < STEPS.length - 1) setStepIndex(index => index + 1);
      if (event.key === "ArrowLeft" && stepIndex > 0) setStepIndex(index => index - 1);
      if (event.key === "Tab") {
        const focusable = [headingRef.current, ...Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button") ?? [])]
          .filter((item): item is HTMLElement => item !== null);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!open) return null;

  function finish() {
    markOnboardingComplete();
    setStepIndex(0);
    onClose();
  }

  const highlightStyle: CSSProperties | undefined = targetRect
    ? {
        left: Math.max(4, targetRect.left - 6),
        top: Math.max(4, targetRect.top - 6),
        width: targetRect.width + 12,
        height: targetRect.height + 12,
      }
    : undefined;

  const cardStyle = getCardStyle(targetRect);

  return (
    <div className={styles.layer} aria-live="polite">
      <div className={styles.shade} aria-hidden="true" />
      {highlightStyle && <div className={styles.highlight} style={highlightStyle} aria-hidden="true" />}
      <section ref={cardRef} className={`${styles.card} ${targetRect ? styles.positioned : ""}`} style={cardStyle} role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className={styles.eyebrow}>{t("progress", { current: stepIndex + 1, total: STEPS.length })}</div>
        <h2 id="onboarding-title" ref={headingRef} tabIndex={-1}>{t(`steps.${step}.title`)}</h2>
        <p>{t(`steps.${step}.body`)}</p>

        {step === "stats" && (
          <dl className={styles.statLegend}>
            {(["gdp", "treasury", "population", "military", "stability", "legitimacy"] as const).map(stat => (
              <div key={stat}>
                <dt>{t(`stats.${stat}.label`)}</dt>
                <dd>{t(`stats.${stat}.hint`)}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className={styles.dots} aria-label={t("stepsLabel")}>
          {STEPS.map((item, index) => (
            <button
              key={item}
              type="button"
              className={index === stepIndex ? styles.activeDot : ""}
              aria-label={t("goToStep", { step: index + 1 })}
              aria-current={index === stepIndex ? "step" : undefined}
              onClick={() => setStepIndex(index)}
            />
          ))}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.skip} onClick={finish}>{t("skip")}</button>
          <div>
            {stepIndex > 0 && (
              <button type="button" className={styles.back} onClick={() => setStepIndex(index => index - 1)}>
                {t("back")}
              </button>
            )}
            {stepIndex < STEPS.length - 1 ? (
              <button type="button" className={styles.next} onClick={() => setStepIndex(index => index + 1)}>
                {t("next")}
              </button>
            ) : (
              <button type="button" className={styles.next} onClick={finish}>{t("finish")}</button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function getCardStyle(target: DOMRect | null): CSSProperties {
  if (!target || typeof window === "undefined") return {};
  const width = Math.min(420, window.innerWidth - 24);
  const estimatedHeight = 360;
  const left = Math.min(Math.max(12, target.left), Math.max(12, window.innerWidth - width - 12));
  const fitsBelow = target.bottom + 16 + estimatedHeight <= window.innerHeight;
  const top = fitsBelow ? target.bottom + 16 : Math.max(12, target.top - estimatedHeight - 16);
  return { left, top, width };
}
