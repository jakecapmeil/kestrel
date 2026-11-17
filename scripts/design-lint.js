// Kestrel design lint. Paste into the browser console on any Kestrel page (or run it through a
// browser tool). It checks what is on screen now, so run it per screen, width and theme.
//   designLint()                      -> report for the current screen
//   await designSweep(['Today', ...]) -> clicks each nav button by label and reports each screen
// Checks: text overflowing its box, children escaping their parent, radii off the scale,
// font sizes off the type scale, mono outside numbers, contrast below WCAG AA, phone targets under 44px,
// horizontal page scroll, and rows of buttons or chips that wrap onto a second line (scroll or shrink instead).
(() => {
  const RADII = new Set(['0px', '8px', '12px', '16px', '24px', '32px', '999px', '50%']);
  // Type scale (tokens.css --fs-*): 11 13 15 17 20 24, plus fluid display sizes (34 and up).
  const SIZES = new Set([11, 13, 15, 17, 20, 24]);
  const DISPLAY_MIN = 34; // display headlines (fluid clamp) may sit anywhere above this
  const MONO_OK = /^(PR\s*)?[\s\d:.,'’/+\-–—~×x%±✓]*(mi|km|bpm|kcal|g|h|m|s|min|\/mi|\/km|lb|kg|cm|ft|in|wk)?(\s*PR)?[\s\d:.,/+\-–—±%]*$/i;

  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (!(r.width > 1 && r.height > 1)) return false; // also skips 1px visually-hidden (screen reader) text
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05;
  };
  const name = (e) => {
    const id = e.id ? '#' + e.id : '';
    const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (id + cls) || e.tagName.toLowerCase();
  };
  const ownText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const snip = (e) => (e.innerText || e.placeholder || e.value || '').replace(/\s+/g, ' ').trim().slice(0, 28);
  // rgb()/rgba(), or color(srgb r g b / a) with 0-1 channels (what color-mix() computes to)
  const rgba = (c) => {
    const m = c.match(/[\d.]+/g); if (!m) return null;
    const [r, g, b, a = 1] = m.map(Number), k = c.startsWith('color(') ? 255 : 1;
    return { r: r * k, g: g * k, b: b * k, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  // Background behind an element: walk up until an opaque-enough fill.
  const bgOf = (e) => {
    for (let p = e; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.backgroundImage !== 'none') return null; // image or gradient: can't measure, skip
      const c = rgba(s.backgroundColor);
      if (c && c.a >= 0.6) return c;
    }
    return rgba(getComputedStyle(document.body).backgroundColor);
  };

  function designLint({ phone = innerWidth < 600 } = {}) {
    const all = [...document.querySelectorAll('body *')].filter(visible);
    const out = { width: innerWidth, theme: document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'os-dark' : 'os-light'),
      overflow: [], escape: [], radii: {}, sizes: {}, mono: [], contrast: [], targets: [], wrapped: [], hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
    for (const e of all) {
      const s = getComputedStyle(e);
      if (e.closest('svg') || e.closest('[aria-hidden="true"]')) continue;
      const code = !!e.closest('code, pre, kbd, textarea'); // code samples and code editors are meant to be mono
      // 1. text overflowing its own box (ellipsis with a title attribute is allowed)
      if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && !/auto|scroll/.test(s.overflowX) && (ownText(e) || /INPUT|TEXTAREA/.test(e.tagName))) {
        if (!(s.textOverflow === 'ellipsis' && e.title)) out.overflow.push(`${name(e)} ${e.clientWidth}<${e.scrollWidth} "${snip(e)}"${s.textOverflow === 'ellipsis' ? ' [ellipsis, no title]' : ''}`);
      }
      // 2. a child with text sticking out of a parent that does not clip
      const p = e.parentElement;
      if (p && p !== document.body && visible(p) && e.innerText && getComputedStyle(p).overflow === 'visible' && s.position !== 'fixed' && s.position !== 'absolute' && parseFloat(s.marginLeft) >= 0 && parseFloat(s.marginRight) >= 0) { // negative margins are an intentional bleed
        const r = e.getBoundingClientRect(), q = p.getBoundingClientRect();
        const by = Math.round(Math.max(r.right - q.right, q.left - r.left));
        if (by > 1) out.escape.push(`${name(e)} in ${name(p)} by ${by}px "${snip(e)}"`);
      }
      // 3. radius
      const rad = s.borderTopLeftRadius;
      if (!RADII.has(rad) && !(rad.endsWith('px') && parseFloat(rad) >= 999)) (out.radii[rad] ||= new Set()).add(name(e));
      if (ownText(e)) {
        // 4. type scale
        const fs = Math.round(parseFloat(s.fontSize) * 10) / 10;
        if (!SIZES.has(fs) && fs < DISPLAY_MIN) (out.sizes[fs + 'px'] ||= new Set()).add(name(e));
        // 5. mono only for numbers (times, paces, miles)
        if (!code && /JetBrains|mono/i.test(s.fontFamily.split(',')[0]) && !MONO_OK.test(e.innerText.trim())) out.mono.push(`${name(e)} "${snip(e)}"`);
        // 6. contrast
        const fg = rgba(s.color), bg = bgOf(e);
        if (fg && bg && fg.a > 0.5 && !e.closest('button:disabled,[aria-disabled="true"]')) {
          const a = lum(fg), b = lum(bg), cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          const large = parseFloat(s.fontSize) >= 18 || (parseFloat(s.fontSize) >= 14 && +s.fontWeight >= 700);
          if (cr < (large ? 3 : 4.5)) out.contrast.push(`${name(e)} "${snip(e)}" ${cr.toFixed(2)}:1`);
        }
      }
      // 7. a flex row of controls that wrapped: two or more buttons/links/chips whose tops differ by more than half a row
      if (s.display.includes('flex') && s.flexWrap === 'wrap' && !s.flexDirection.startsWith('column')) {
        const kids = [...e.children].filter((c) => visible(c) && c.matches('button, a[href], [role=button], .chip, .kv-chip, .k-chip, label'));
        if (kids.length >= 2) {
          const tops = kids.map((c) => c.getBoundingClientRect().top), h = Math.min(...kids.map((c) => c.getBoundingClientRect().height));
          if (Math.max(...tops) - Math.min(...tops) > h / 2) out.wrapped.push(`${name(e)} "${kids.map(snip).join(' | ').slice(0, 60)}"`);
        }
      }
      // 8. targets (phone only)
      // inline text links inside a sentence are exempt (WCAG 2.5.8 inline exception)
      if (phone && e.matches('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, [role=button], [role=tab]') && !(e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.parentElement && ownText(e.parentElement))) {
        const r = e.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) {
          // allow a smaller visual if a ::before/::after or padding extends the hit area to 44
          out.targets.push(`${name(e)} ${Math.round(r.width)}x${Math.round(r.height)} "${snip(e)}"`);
        }
      }
    }
    for (const k of ['radii', 'sizes']) for (const v in out[k]) out[k][v] = [...out[k][v]].slice(0, 4).join(' ');
    out.summary = `overflow ${out.overflow.length} · escape ${out.escape.length} · radii ${Object.keys(out.radii).length} · sizes ${Object.keys(out.sizes).length} · mono ${out.mono.length} · contrast ${out.contrast.length} · targets ${out.targets.length} · wrapped ${out.wrapped.length} · hscroll ${out.hscroll}`;
    return out;
  }

  async function designSweep(labels, wait = 1800) {
    const res = {};
    for (const label of labels) {
      const b = [...document.querySelectorAll('button, [role=tab]')].find((e) => e.innerText.trim() === label && visible(e));
      if (!b) { res[label] = 'no nav button'; continue; }
      b.click();
      await new Promise((r) => setTimeout(r, wait));
      res[label] = designLint();
    }
    return res;
  }

  window.designLint = designLint;
  window.designSweep = designSweep;
})();
