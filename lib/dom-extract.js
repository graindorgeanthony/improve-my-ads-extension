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
// NOTE: this is the tested, canonical reference copy. content/ad-detector.js
// is a plain (non-module) content script and inlines its own copy of this
// logic rather than importing it — an earlier attempt at a module content
// script importing this file appears to have failed silently in practice
// (reported live 2026-07-23: every platform's detection stopped at once).
// Keep the two in sync by hand when either changes.
//
// Kept in its own pure, DOM-only module (no chrome.* APIs) so it's
// unit-testable with jsdom — see tests/dom-extract.test.js.

export function cleanText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function isOwnUi(el) {
  return el.hasAttribute && el.hasAttribute("data-ima-button");
}

// Deliberately checks anywhere in the string, not just an anchored "starts
// with http" — a real bug seen live (2026-07-23): a Google ad's whole-card
// <a> concatenated its headline, advertiser name, and URL with no separator
// ("Product Adoption SaaSProduct Fruitshttps://www.productfruits.com"). An
// anchored check misses the embedded URL/breadcrumb since it doesn't start
// the string.
function isBreadcrumb(t) {
  return t.includes("›") || t.includes("http://") || t.includes("https://");
}

// "Leaf-ish": no BLOCK-level descendants, though inline formatting
// (b/strong/em/span/br) is fine — lets a paragraph with a bolded keyword
// ("#1 <b>SaaS</b> Onboarding Platform...") count as one text block instead
// of fragmenting into pieces too short to win the "longest text" heuristic
// against an unrelated, cleanly-single-node sitelink description.
function isBlockish(el) {
  return !!el.querySelector("div, p, li, ul, ol, table, h1, h2, h3, h4, h5, h6");
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
    if (isBlockish(el)) return; // only text-only-ish nodes (inline formatting is fine)
    if (isOwnUi(el) || (headlineEl && headlineEl.contains(el))) return;
    const t = cleanText(el.textContent);
    if (!t || t === headlineText || isBreadcrumb(t)) return;
    if (t.length > bestText.length && t.length > 20) bestText = t;
  });
  if (bestText) items.push({ label: "Description", body: bestText });

  return items;
}

/**
 * Google-specific extractor: Google's ad cards have real internal structure
 * worth pulling apart deliberately (landing page breadcrumb, headline,
 * description, and up to a handful of sitelink/callout extensions) rather
 * than treating the whole thing as one generic blob.
 * @param {Element} container
 * @returns {Array<{label: string, body: string}>}
 */
export function extractGoogleAdText(container) {
  const items = [];
  const used = new Set();

  // Landing page: the visible bare-URL breadcrumb text under the
  // advertiser name — more reliable than reading an <a href>, which on a
  // Google SERP ad is usually a google.com/aclk tracking redirect, not the
  // real destination.
  const urlLeaf = findLeafTextElements(container, /^https?:\/\//)[0];
  if (urlLeaf) {
    const landingPage = cleanText(urlLeaf.textContent);
    if (landingPage) {
      items.push({ label: "Landing page", body: landingPage });
      used.add(urlLeaf);
    }
  }

  // Headline: prefer an explicit heading element (role="heading" or h3) —
  // Google (like Facebook) marks the ad title this way when present, and
  // its own textContent isn't contaminated by sibling advertiser/URL text
  // the way a whole-card wrapping <a> can be (the real bug this guards
  // against: a single anchor wrapping the heading AND the advertiser name
  // AND the URL, with no whitespace between them in the source). Falls
  // back to scanning anchors directly only if no heading element exists.
  let headlineText = "";
  let headlineEl = null;
  const headingEl = container.querySelector('[role="heading"], h3');
  if (headingEl && !isOwnUi(headingEl)) {
    const t = cleanText(headingEl.textContent);
    if (t && !isBreadcrumb(t)) {
      headlineText = t;
      headlineEl = headingEl;
    }
  }
  if (!headlineText) {
    for (const a of container.querySelectorAll("a")) {
      if (isOwnUi(a) || used.has(a)) continue;
      const t = cleanText(a.textContent);
      if (t.length >= 8 && t.length <= 90 && !isBreadcrumb(t)) {
        headlineText = t;
        headlineEl = a;
        break;
      }
    }
  }
  if (headlineText) {
    items.push({ label: "Headline", body: headlineText });
    used.add(headlineEl);
  }

  // Description: the longest leaf-ish text block that isn't the
  // headline/landing page and isn't a short callout/sitelink title.
  const candidates = [];
  container.querySelectorAll("div, span, p").forEach((el) => {
    if (isOwnUi(el) || isBlockish(el)) return;
    if (headlineEl && headlineEl.contains(el)) return;
    if (urlLeaf && (el === urlLeaf || el.contains(urlLeaf))) return;
    const t = cleanText(el.textContent);
    if (!t || t === headlineText || isBreadcrumb(t)) return;
    candidates.push({ el, text: t });
  });
  candidates.sort((a, b) => b.text.length - a.text.length);
  const description = candidates.find((c) => c.text.length > 25);
  if (description) {
    items.push({ label: "Description", body: description.text });
    used.add(description.el);
  }

  // Callouts / sitelinks: additional short anchor texts beyond the
  // headline (Google's sitelink-extension titles), each paired with its
  // own short nearby description if one is findable. Capped at 5, the real
  // max Google typically shows.
  const callouts = [];
  container.querySelectorAll("a").forEach((a) => {
    if (isOwnUi(a) || a === headlineEl || used.has(a)) return;
    const t = cleanText(a.textContent);
    if (t.length >= 3 && t.length <= 45 && !isBreadcrumb(t) && !callouts.some((c) => c.title === t)) {
      callouts.push({ el: a, title: t });
    }
  });
  callouts.slice(0, 5).forEach((c, i) => {
    const wrapper = c.el.closest("div") || c.el.parentElement;
    let descText = "";
    if (wrapper) {
      const leaf = Array.from(wrapper.querySelectorAll("div, span, p")).find(
        (el) =>
          !isBlockish(el) &&
          el !== c.el &&
          !el.contains(c.el) &&
          cleanText(el.textContent) !== c.title &&
          cleanText(el.textContent).length > 10,
      );
      if (leaf) descText = cleanText(leaf.textContent);
    }
    items.push({ label: `Callout ${i + 1}`, body: descText ? `${c.title} — ${descText}` : c.title });
  });

  return items;
}
