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

// Google wraps its ad link's real destination inside a "adurl=" query param
// on a google.com/aclk tracking redirect. Confirmed live (2026-07-23) across
// two real ads that a `data-rw` attribute — when present — always carries
// this full redirect+adurl, even for an ad whose actual `href` is already a
// clean, direct, non-redirect link (one ad's headline anchor: href goes
// straight to the advertiser, but data-rw still has the fuller UTM-tagged
// version) — so data-rw is preferred when available, falling back to
// href's own adurl, falling back to href itself. One pass of
// URLSearchParams decoding recovers the real, fully UTM-tagged landing page
// URL exactly as Google would send the visitor.
export function extractRealDestinationUrl(anchorEl, baseUrl) {
  if (!anchorEl) return "";
  const raw = (anchorEl.getAttribute && anchorEl.getAttribute("data-rw")) || anchorEl.href;
  if (!raw) return "";
  try {
    const url = new URL(raw, baseUrl);
    const adurl = url.searchParams.get("adurl");
    return adurl || anchorEl.href || raw;
  } catch {
    return anchorEl.href || raw || "";
  }
}

/**
 * Google-specific extractor: Google's ad cards have real internal structure
 * worth pulling apart deliberately (real landing page URL, headline,
 * description, and up to a handful of sitelink/callout extensions) rather
 * than treating the whole thing as one generic blob. Returns
 * { items, landingPage } — landingPage is surfaced separately (not as a
 * generic text item) so it can populate the full audit's own dedicated
 * "Landing page link" field.
 * @param {Element} container
 * @param {string} [baseUrl] location.href in the real browser context; only needed for resolving a relative anchor href (defaults to container.ownerDocument's URL)
 * @returns {{items: Array<{label: string, body: string}>, landingPage: string}}
 */
export function extractGoogleAdText(container, baseUrl) {
  const items = [];
  const used = new Set();
  let landingPage = "";
  const resolveBase = baseUrl || (container.ownerDocument && container.ownerDocument.location && container.ownerDocument.location.href);

  // Headline: prefer an explicit heading element (role="heading" or h3) —
  // Google (like Facebook) marks the ad title this way when present, and
  // its own textContent isn't contaminated by sibling advertiser/URL text
  // the way a whole-card wrapping <a> can be (the real bug this guards
  // against: a single anchor wrapping the heading AND the advertiser name
  // AND the URL, with no whitespace between them in the source). Falls
  // back to scanning anchors directly only if no heading element exists.
  let headlineText = "";
  let headlineEl = null;
  let headlineAnchor = null;
  const headingEl = container.querySelector('[role="heading"], h3');
  if (headingEl && !isOwnUi(headingEl)) {
    const t = cleanText(headingEl.textContent);
    if (t && !isBreadcrumb(t)) {
      headlineText = t;
      headlineEl = headingEl;
      headlineAnchor = headingEl.closest("a");
    }
  }
  if (!headlineText) {
    for (const a of container.querySelectorAll("a")) {
      if (isOwnUi(a) || used.has(a)) continue;
      const t = cleanText(a.textContent);
      if (t.length >= 8 && t.length <= 90 && !isBreadcrumb(t)) {
        headlineText = t;
        headlineEl = a;
        headlineAnchor = a;
        break;
      }
    }
  }
  if (headlineText) {
    items.push({ label: "Headline", body: headlineText });
    used.add(headlineEl);
  }

  // Landing page: the ad's real destination, decoded from the headline's
  // own wrapping anchor. Falls back to the visible bare-URL breadcrumb text
  // if no anchor/href is found at all.
  const urlLeaf = findLeafTextElements(container, /^https?:\/\//)[0];
  if (headlineAnchor) {
    landingPage = extractRealDestinationUrl(headlineAnchor, resolveBase);
    if (urlLeaf) used.add(urlLeaf); // still exclude the breadcrumb from description candidates
  } else if (urlLeaf) {
    landingPage = cleanText(urlLeaf.textContent);
    used.add(urlLeaf);
  }

  // Callouts / sitelinks: Google wraps each sitelink's title AND its own
  // one-line description as the first two direct children of a single <a>
  // (confirmed live) — NOT as separate elements. Detecting by that exact
  // shape (short first child, longer second child) avoids both false
  // negatives (an earlier version filtered by whole-anchor text length,
  // which rejected every real sitelink since title+description together
  // exceeded the cutoff) and false positives (explicitly excludes the
  // headline's own anchor, which also has 2 children — heading + advertiser
  // info — and would otherwise look like a callout).
  const callouts = [];
  container.querySelectorAll("a").forEach((a) => {
    if (isOwnUi(a)) return;
    if (headlineAnchor && (a === headlineAnchor || headlineAnchor.contains(a) || a.contains(headlineAnchor))) return;
    const blockChildren = Array.from(a.children).filter((c) => cleanText(c.textContent).length > 0);
    if (blockChildren.length < 2) return;
    const titleText = cleanText(blockChildren[0].textContent);
    if (!titleText || titleText.length > 60 || isBreadcrumb(titleText)) return;
    let descText = "";
    for (let i = 1; i < blockChildren.length; i++) {
      const t = cleanText(blockChildren[i].textContent);
      if (t && t !== titleText && t.length > 10 && !isBreadcrumb(t)) {
        descText = t;
        break;
      }
    }
    if (!descText || callouts.some((c) => c.title === titleText)) return;
    callouts.push({ el: a, title: titleText, desc: descText });
  });

  // Second callout shape: compact inline text links with NO per-item
  // description at all — Google also renders sitelinks as a single row of
  // short links separated by "·" (confirmed live, 2026-07-23: "SaaS
  // Pricing · Download Your SaaS Playbook · ..."). These are leaf anchors
  // (no element children), unlike the boxed title+description shape above,
  // so they need their own pass. Only fills remaining slots up to the
  // 5-callout cap, after the richer boxed callouts (if any).
  if (callouts.length < 5) {
    container.querySelectorAll("a").forEach((a) => {
      if (callouts.length >= 5) return;
      if (isOwnUi(a) || a.children.length > 0) return;
      if (headlineAnchor && (a === headlineAnchor || headlineAnchor.contains(a) || a.contains(headlineAnchor))) return;
      if (callouts.some((c) => c.el === a)) return;
      const t = cleanText(a.textContent);
      if (!t || t.length < 2 || t.length > 60 || isBreadcrumb(t)) return;
      if (callouts.some((c) => c.title === t)) return;
      callouts.push({ el: a, title: t, desc: "" });
    });
  }

  callouts.slice(0, 5).forEach((c, i) => {
    items.push({ label: `Callout ${i + 1}`, body: c.desc ? `${c.title}: ${c.desc}` : c.title });
    used.add(c.el);
  });

  // Description: the longest remaining leaf-ish text block that isn't the
  // headline, landing page breadcrumb, or a callout's own text.
  const candidates = [];
  container.querySelectorAll("div, span, p").forEach((el) => {
    if (isOwnUi(el) || isBlockish(el)) return;
    if ([...used].some((u) => u === el || (u.contains && u.contains(el)) || (el.contains && el.contains(u)))) return;
    const t = cleanText(el.textContent);
    if (!t || t === headlineText || isBreadcrumb(t)) return;
    candidates.push({ el, text: t });
  });
  candidates.sort((a, b) => b.text.length - a.text.length);
  const description = candidates.find((c) => c.text.length > 25);
  if (description) {
    items.push({ label: "Description", body: description.text });
  }

  return { items, landingPage };
}
