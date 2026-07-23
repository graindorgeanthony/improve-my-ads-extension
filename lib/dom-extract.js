// Structure-based fallback extractor for the on-page ad detector (see
// content/ad-detector.js). Used whenever a platform's specific selectors
// (class names, data-attributes) come up empty — those rotate often (e.g.
// Google's SERP ad markup has changed multiple times, most recently to a
// grouped "Sponsored results" header with no per-item "Ad" text label,
// which broke the earlier class-name-based headline/description
// selectors), while "biggest substantial link text = headline" / "longest
// remaining leaf text block = description" holds up more often across
// redesigns.
//
// Kept in its own pure, DOM-only module (no chrome.* APIs) so it's
// unit-testable with jsdom — see tests/dom-extract.test.js.

export function cleanText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

/**
 * Finds leaf elements (no element children) within `root` whose cleaned
 * text exactly matches `pattern` — used to locate a platform's own ad
 * label ("Ad", "Sponsored", "Promoted") when a more specific attribute or
 * class name isn't present/known (these rotate; the label text itself is
 * the most stable signal a platform exposes, since it's user-visible).
 * @param {ParentNode} root
 * @param {RegExp} pattern
 * @returns {Element[]}
 */
export function findLeafTextElements(root, pattern) {
  const matches = [];
  root.querySelectorAll("span, a, div, td, li").forEach((el) => {
    if (el.children.length > 0) return;
    const t = cleanText(el.textContent);
    if (t && pattern.test(t)) matches.push(el);
  });
  return matches;
}

/**
 * Climbs from a label element (e.g. a leaf "Promoted" span) up through
 * ancestors looking for one whose total text length falls in a plausible
 * "single post/card" range — stops as soon as one qualifies, so it doesn't
 * grab the entire feed. Falls back to the immediate parent if nothing in
 * range is found within maxClimb levels (best-effort; still lets the
 * caller's own text extraction attempt something rather than nothing).
 * @param {Element} el
 * @param {{minChars?: number, maxChars?: number, maxClimb?: number}} [opts]
 */
export function climbToContainer(el, opts = {}) {
  const { minChars = 60, maxChars = 4000, maxClimb = 10 } = opts;
  let container = el.parentElement;
  let steps = 0;
  while (container && steps < maxClimb) {
    const len = cleanText(container.textContent).length;
    if (len >= minChars && len <= maxChars) return container;
    container = container.parentElement;
    steps++;
  }
  return el.parentElement;
}

function isOwnUi(el) {
  return el.hasAttribute && el.hasAttribute("data-ima-button");
}

function isBreadcrumb(t) {
  return t.includes("›") || /^https?:\/\//.test(t);
}

/**
 * @param {Element} container
 * @returns {Array<{label: string, body: string}>}
 */
export function extractGenericAdText(container) {
  const items = [];

  let headlineEl = null;
  let headlineText = "";
  for (const a of container.querySelectorAll("a")) {
    if (isOwnUi(a)) continue;
    const t = cleanText(a.textContent);
    if (t.length > 15 && !isBreadcrumb(t)) {
      headlineEl = a;
      headlineText = t;
      break;
    }
  }
  if (headlineText) items.push({ label: "Headline", body: headlineText });

  let bestText = "";
  container.querySelectorAll("div, span, p").forEach((el) => {
    if (el.children.length > 0) return; // leaf nodes only
    if (isOwnUi(el) || (headlineEl && headlineEl.contains(el))) return;
    const t = cleanText(el.textContent);
    if (!t || t === headlineText || isBreadcrumb(t)) return;
    if (t.length > bestText.length && t.length > 20) bestText = t;
  });
  if (bestText) items.push({ label: "Description", body: bestText });

  return items;
}
