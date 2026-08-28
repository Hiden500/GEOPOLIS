/**
 * Машинные метрики интерфейса. Вставить в консоль браузера на открытой странице
 * приложения (или выполнить через браузер сессии Claude Desktop).
 *
 * ЗАЧЕМ. Субагент `ui-reviewer` браузера не имеет и судит о картинке по коду —
 * отсюда вердикты «выглядит хорошо» при нечитаемом тексте. Юнит-тесты тоже не
 * помогают: happy-dom не считает раскладку, `getBoundingClientRect` там нули
 * (см. client/vitest.config.ts).
 *
 * КАЛИБРОВКА 2026-08-21. Первая версия давала 6 ложных срабатываний из 7 на
 * игровом экране: под «обрезанный текст» попадали визуально скрытые подписи для
 * скринридеров (clientWidth = 1). Фильтр isVisuallyHidden их снимает, при этом
 * на экране выбора страны все 7 реальных дефектов остались на месте.
 */
(() => {
  const isVisuallyHidden = (el) => {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return true;
    if (st.clip && st.clip !== "auto") return true;
    if (st.clipPath && st.clipPath !== "none" && /inset\(\s*50%/.test(st.clipPath)) return true;
    if (el.clientWidth <= 1 || el.clientHeight <= 1) return true;
    return false;
  };

  const lum = (c) => {
    const [r, g, b] = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    if (p.length > 3 && p[3] === 0) return null;
    return [p[0], p[1], p[2]];
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c) return c;
      n = n.parentElement;
    }
    return [0, 0, 0];
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const visible = [...document.querySelectorAll("*")].filter((el) => {
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && parseFloat(st.opacity) > 0.05;
  });

  // 1. Контраст. Порог WCAG: 4.5 обычный текст, 3.0 крупный.
  const lowContrast = [];
  for (const el of visible) {
    if (isVisuallyHidden(el)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const st = getComputedStyle(el);
    const fg = parse(st.color);
    if (!fg) continue;
    const r = ratio(fg, bgOf(el));
    const size = parseFloat(st.fontSize);
    const need = size >= 24 || (size >= 18.66 && parseInt(st.fontWeight) >= 700) ? 3 : 4.5;
    if (r < need) {
      lowContrast.push({ text: el.textContent.trim().slice(0, 40), ratio: +r.toFixed(2), need, size, color: st.color });
    }
  }

  // 2. Обрезанный текст.
  //
  // КАЛИБРОВКА 2. Обрезка бывает намеренной: `text-overflow: ellipsis` плюс
  // `title` с полным текстом — это спроектированный фолбэк, а не дефект.
  // Проверено 2026-08-21 на списке стран: все семь срабатываний оказались
  // такими. Дефектом считаем обрезку БЕЗ многоточия или БЕЗ подсказки —
  // тогда часть текста пропадает молча.
  const hasFallback = (el) => {
    const st = getComputedStyle(el);
    const ellipsis = st.textOverflow === "ellipsis";
    const hint = el.getAttribute("title") || el.getAttribute("aria-label") ||
      el.closest("[title]") || el.closest("[aria-label]");
    return ellipsis && Boolean(hint);
  };
  const clippedAll = visible
    .filter((el) => {
      const st = getComputedStyle(el);
      if (st.overflow === "visible" && st.overflowX === "visible") return false;
      return el.scrollWidth > el.clientWidth + 2 && el.textContent.trim().length > 0;
    })
    .filter((el) => !isVisuallyHidden(el));
  const clipped = clippedAll
    .filter((el) => !hasFallback(el))
    .map((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, text: el.textContent.trim().slice(0, 40) }));
  const clippedByDesign = clippedAll.length - clipped.length;

  // 3. Наложения элементов с собственным текстом.
  const leaves = visible.filter(
    (el) =>
      !isVisuallyHidden(el) &&
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1) &&
      getComputedStyle(el).position !== "fixed"
  );
  const overlaps = [];
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i], b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) {
        overlaps.push({ a: a.textContent.trim().slice(0, 25), b: b.textContent.trim().slice(0, 25), area: Math.round(ox * oy) });
      }
    }
  }

  // 4. Горизонтальное переполнение окна.
  const pageOverflow = document.documentElement.scrollWidth > innerWidth + 2;

  return {
    viewport: innerWidth + "x" + innerHeight,
    scanned: visible.length,
    lowContrastCount: lowContrast.length,
    lowContrast: lowContrast.slice(0, 10),
    clippedCount: clipped.length,
    clippedByDesign,
    clipped: clipped.slice(0, 10),
    overlapsCount: overlaps.length,
    overlaps: overlaps.slice(0, 10),
    pageOverflow,
  };
})();
