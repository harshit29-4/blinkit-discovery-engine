// In-page UI and accessibility audit (tests C1, C4, C6, D1, D2, D4 in TESTING.md). Paste into the browser console
// on any screen, or run through a browser tool; returns a summary object. Only visible elements are checked
// (Next keeps earlier screens mounted but hidden).
(() => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    for (let n = e; n; n = n.parentElement) if (n.hidden || getComputedStyle(n).display === "none" || getComputedStyle(n).visibility === "hidden") return false;
    return !e.closest(".sr-only");
  };
  const scroller = document.getElementById("app-scroll") || document.documentElement;
  const all = [...document.querySelectorAll("body *")].filter(vis);
  const name = (e) => (e.getAttribute("aria-label") || e.innerText || e.title || e.getAttribute("alt") || "").trim();
  const ids = all.map((e) => e.id).filter(Boolean);
  const textEls = all.filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const interactive = all.filter((e) => e.matches("a[href], button, input:not([type=hidden]), select, textarea, summary"));
  const inputs = all.filter((e) => e.matches("input:not([type=hidden]):not([type=radio]), select, textarea"));
  return {
    path: location.pathname + location.search,
    width: innerWidth,
    overflowX: Math.max(document.documentElement.scrollWidth, scroller.scrollWidth) > innerWidth + 1,
    smallText: [...new Set(textEls.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14).map((e) => `${e.tagName}:${e.innerText.trim().slice(0, 20)}`))].slice(0, 5),
    duplicateIds: [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))],
    unlabelledInputs: inputs.filter((e) => !(e.labels && e.labels.length) && !e.getAttribute("aria-label")).map((e) => e.name || e.type),
    unnamedControls: interactive.filter((e) => !name(e) && !e.matches("input, select, textarea")).map((e) => e.outerHTML.slice(0, 60)),
    smallTargets: [...new Set(interactive.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 24 || r.height < 24; })
      .map((e) => `${e.tagName}:${name(e).slice(0, 20)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`))].slice(0, 6),
    lang: document.documentElement.lang,
    h1: all.filter((e) => e.tagName === "H1").length,
    main: !!document.querySelector("main"),
  };
})();
