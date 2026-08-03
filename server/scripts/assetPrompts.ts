/**
 * Промты генерации игровых ассетов — отдельно от обвязки, потому что правят их
 * чаще, чем код: стиль набора подбирается прогонами, а не пишется с первого раза.
 *
 * ЧТО СЮДА НЕ ВХОДИТ И ПОЧЕМУ.
 *
 * **Иконки интерфейса.** В клиенте они inline SVG со `stroke="currentColor"`
 * (`client/src/hud/icons.tsx`, 31 штука, контуры из утверждённого эталона
 * `docs/plans/assets/geopolis-1946-hud.html`): наследуют цвет темы, тянутся без
 * потери, весят байты. Модель отдаёт ТОЛЬКО JPEG — проверено 2026-08-02, просьба
 * «PNG with alpha channel» игнорируется, — а JPEG не несёт прозрачности вовсе.
 * Растровая иконка на непрозрачном фоне в этом HUD не годится, поэтому её здесь
 * нет: генерация ей не альтернатива, а ухудшение.
 *
 * **Флаги реальных стран.** Замер того же дня: у флага СССР модель дала
 * контурную звезду вместо сплошной и пропорции 3:2 вместо исторических 1:2 —
 * узнаваемо, но неверно, и чем менее известна страна, тем хуже. Реальные флаги
 * берутся датасетом с провенансом (отдельная сессия), генерация остаётся для
 * стран, которых в реальности не было, — тех, что возникли в партии.
 */

/** Тип ассета: задаёт стилевой шаблон и пропорции. */
export type AssetKind = "portrait" | "flag" | "texture" | "illustration";

export const ASSET_KINDS: AssetKind[] = ["portrait", "flag", "texture", "illustration"];

/**
 * Общий якорь стиля для ВСЕГО набора.
 *
 * Он один на все виды ассетов намеренно: разные тексты дали бы разный «мир» на
 * соседних экранах. Консистентность набора — главная проблема генерации пачками,
 * и держится она общей приставкой, а не аккуратностью автора каждого промта.
 */
const STYLE_ANCHOR =
  "Visual style: mid-20th-century printed matter of the late 1940s — muted, " +
  "slightly desaturated palette, subtle paper grain, no digital gloss, no neon, " +
  "no modern typography or branding.";

/**
 * Запрет надписей — в каждом шаблоне.
 *
 * Не вкусовое: генеративные модели пишут буквы, похожие на буквы, и текст на
 * ассете нельзя ни прочитать, ни локализовать. Всё, что должно быть словом,
 * рисует интерфейс через `react-i18next` (`docs/LOCALIZATION.md`).
 */
const NO_TEXT = "No text, no letters, no numbers, no watermark, no signature.";

interface KindTemplate {
  /** Как собрать промт из предметного описания. */
  build(subject: string): string;
  /** Подсказка модели о форме кадра — она НЕ гарантирована, см. verifyAspect. */
  aspect: string;
  /** Ожидаемое отношение сторон для проверки результата (ширина / высота). */
  expectedRatio: number;
}

export const ASSET_TEMPLATES: Record<AssetKind, KindTemplate> = {
  /**
   * Портрет исторического деятеля или вымышленного лидера.
   *
   * Погрудный и фронтальный — чтобы лица разных стран были сопоставимы в одном
   * списке; без рук и предметов, иначе модель добавляет реквизит, который на
   * миниатюре превращается в кашу.
   */
  portrait: {
    build: subject =>
      `Head-and-shoulders portrait, front-facing, neutral expression: ${subject}. ` +
      `Painted official portrait of the period, plain dark background, even studio light, ` +
      `no hands, no props, no medals invented. ${STYLE_ANCHOR} ${NO_TEXT}`,
    aspect: "Square canvas, 1:1.",
    expectedRatio: 1,
  },

  /**
   * Флаг страны, которой в реальности не было (возникла в партии).
   *
   * «Filling the entire frame edge to edge» — обязательная часть: без неё модель
   * рисует флаг НА ДРЕВКЕ или развевающимся, и полотно перестаёт быть плашкой,
   * которую можно положить в интерфейс.
   */
  flag: {
    build: subject =>
      `A national flag: ${subject}. Flat vector heraldry, solid colours, sharp edges, ` +
      `the cloth fills the entire frame edge to edge — not on a pole, not waving, ` +
      `no folds, no shadow, no border. ${NO_TEXT}`,
    aspect: "Aspect ratio 3:2, landscape.",
    expectedRatio: 3 / 2,
  },

  /**
   * Бесшовная текстура (бумага карты, сукно, море).
   *
   * Просит отсутствие сюжета: любой узнаваемый объект на плитке выдаёт стык при
   * повторении.
   */
  texture: {
    build: subject =>
      `A seamless tileable texture: ${subject}. Uniform across the whole frame, ` +
      `no focal point, no recognisable objects, no vignette, edges that repeat cleanly. ` +
      `${STYLE_ANCHOR} ${NO_TEXT}`,
    aspect: "Square canvas, 1:1.",
    expectedRatio: 1,
  },

  /**
   * Иллюстрация к событию или экрану — единственный вид, где сюжет уместен.
   */
  illustration: {
    build: subject =>
      `An illustration for a historical strategy game: ${subject}. ` +
      `Poster-like composition, readable at small size, one clear subject. ` +
      `${STYLE_ANCHOR} ${NO_TEXT}`,
    aspect: "Aspect ratio 16:9, landscape.",
    expectedRatio: 16 / 9,
  },
};

/** Полный промт: предмет + стиль вида + форма кадра. */
export function buildAssetPrompt(kind: AssetKind, subject: string): string {
  const template = ASSET_TEMPLATES[kind];
  return `${template.build(subject)} ${template.aspect}`;
}
