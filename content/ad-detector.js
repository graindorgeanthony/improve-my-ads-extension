// On-page ad detector for Facebook, LinkedIn, Google Search, YouTube,
// Reddit, and TikTok (see manifest.json's content_scripts.matches).
// Best-effort heuristic detection — these platforms don't publish a stable
// "this is an ad" API, so this relies on markup patterns observed in
// practice (label text like "Sponsored"/"Promoted"/"Ad"). It WILL
// occasionally miss ads or need updating when a platform changes its
// markup — the right-click "grade selected text" path
// (background/service-worker.js) always works regardless, as a reliable
// fallback that doesn't depend on any of this.
//
// Deliberately a PLAIN (non-module) content script, not an ES module — an
// earlier version imported lib/dom-extract.js via "type": "module" in
// manifest.json, and that import appears to have failed silently in
// practice (reported live 2026-07-23: detection stopped working on every
// platform at once, including ones that worked before, consistent with the
// whole script never executing rather than a per-platform bug). Everything
// is inlined here instead — see lib/dom-extract.js for the tested,
// canonical (but NOT what actually runs) version of the shared helpers;
// keep the two in sync by hand if either changes.
//
// Wrapped in an IIFE to avoid leaking globals into the host page.
(function () {
  const SUPABASE_URL = "https://fmuaeuzxpxhqociziebs.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_mgY_wxt_HN-mnoq7PWV9TA_q-jWgdgG";
  const SITE_URL = "https://improve-my-ads.com";

  const PROCESSED_ATTR = "data-ima-scanned";
  const SCAN_INTERVAL_MS = 2500;

  function host() {
    return location.hostname;
  }

  function platformForHost() {
    const h = host();
    if (h.includes("facebook.com")) return "meta";
    if (h.includes("linkedin.com")) return "linkedin";
    if (h.includes("youtube.com")) return "youtube";
    if (h.includes("reddit.com")) return "reddit";
    if (h.includes("tiktok.com")) return "tiktok";
    if (h.includes("google.")) return "google";
    return "";
  }

  function cleanText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function isOwnUi(el) {
    return el.hasAttribute && el.hasAttribute("data-ima-button");
  }

  // Deliberately checks anywhere in the string, not just an anchored
  // "starts with http" — a real bug seen live (2026-07-23): a Google ad's
  // whole-card <a> concatenated its headline, advertiser name, and URL with
  // no separator ("Product Adoption SaaSProduct Fruitshttps://www.
  // productfruits.com"). An anchored check misses the embedded URL/
  // breadcrumb entirely since it doesn't start the string.
  function isBreadcrumb(t) {
    return t.includes("›") || t.includes("http://") || t.includes("https://");
  }

  // "Leaf-ish": no BLOCK-level descendants, though inline formatting
  // (b/strong/em/span/br) is fine — lets a paragraph with a bolded keyword
  // ("#1 <b>SaaS</b> Onboarding Platform...") count as one text block
  // instead of fragmenting into pieces too short to win the "longest text"
  // heuristic against an unrelated, cleanly-single-node sitelink description.
  function isBlockish(el) {
    return !!el.querySelector("div, p, li, ul, ol, table, h1, h2, h3, h4, h5, h6");
  }

  // Structure-based fallback extractor, used whenever a platform's specific
  // selectors (class names, data-attributes) come up empty — those rotate
  // often, while "biggest substantial link text = headline" / "longest
  // remaining leaf text block = description" holds up more often across
  // redesigns. Always excludes our own injected button and anything that
  // looks like a URL breadcrumb.
  function extractGenericAdText(container) {
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

  // Google wraps its ad link's real destination inside a "adurl=" query
  // param on a google.com/aclk tracking redirect (confirmed live,
  // 2026-07-23, via real markup: href="https://www.google.com/aclk?...
  // &adurl=https://productfruits.com/lp/...%3Futm_term%3D..."). One pass of
  // URLSearchParams decoding recovers the real, fully UTM-tagged landing
  // page URL exactly as Google itself would send the visitor. Some
  // sitelinks instead have an already-clean, non-redirect href — those are
  // returned as-is.
  function extractRealDestinationUrl(anchorEl) {
    if (!anchorEl || !anchorEl.href) return "";
    try {
      const url = new URL(anchorEl.href, location.href);
      const adurl = url.searchParams.get("adurl");
      return adurl || anchorEl.href;
    } catch {
      return anchorEl.href || "";
    }
  }

  // Google-specific extractor: Google's ad cards have real internal
  // structure worth pulling apart deliberately (real landing page URL,
  // headline, description, and up to a handful of sitelink/callout
  // extensions) rather than treating the whole thing as one generic blob.
  // Returns { items, landingPage } — landingPage is surfaced separately
  // (not as a generic text item) so it can populate the full audit's own
  // dedicated "Landing page link" field.
  function extractGoogleAdText(container) {
    const items = [];
    const used = new Set();
    let landingPage = "";

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
    // own wrapping anchor. Falls back to the visible bare-URL breadcrumb
    // text if no anchor/href is found at all.
    const urlLeaf = findLeafTextElements(container, /^https?:\/\//)[0];
    if (headlineAnchor) {
      landingPage = extractRealDestinationUrl(headlineAnchor);
      if (urlLeaf) used.add(urlLeaf); // still exclude the breadcrumb from description candidates
    } else if (urlLeaf) {
      landingPage = cleanText(urlLeaf.textContent);
      used.add(urlLeaf);
    }

    // Callouts / sitelinks: Google wraps each sitelink's title AND its own
    // one-line description as the first two direct children of a single
    // <a> (confirmed live) — NOT as separate elements. Detecting by that
    // exact shape (short first child, longer second child) avoids both
    // false negatives (the earlier version filtered by whole-anchor text
    // length, which rejected every real sitelink since title+description
    // together exceeded the cutoff) and false positives (explicitly
    // excludes the headline's own anchor, which also has 2 children —
    // heading + advertiser info — and would otherwise look like a callout).
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
    callouts.slice(0, 5).forEach((c, i) => {
      items.push({ label: `Callout ${i + 1}`, body: `${c.title}: ${c.desc}` });
      used.add(c.el);
    });

    // Description: the longest remaining leaf-ish text block that isn't
    // the headline, landing page breadcrumb, or a callout's own text.
    const candidates = [];
    container.querySelectorAll("div, span, p").forEach((el) => {
      if (isOwnUi(el) || isBlockish(el)) return;
      if ([...used].some((u) => u === el || (u.contains && u.contains(el)))) return;
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

  // Finds leaf elements (no element children) whose cleaned text exactly
  // matches `pattern` — used to locate a platform's visible ad label
  // ("Ad"/"Sponsored"/"Promoted") when no reliable attribute/class is known.
  function findLeafTextElements(root, pattern) {
    const matches = [];
    root.querySelectorAll("span, a, div, td, li").forEach((el) => {
      if (el.children.length > 0) return;
      const t = cleanText(el.textContent);
      if (t && pattern.test(t)) matches.push(el);
    });
    return matches;
  }

  // Climbs from a label element up through ancestors looking for one whose
  // total text length falls in a plausible "single post/card" range —
  // stops as soon as one qualifies, so it doesn't grab the entire feed.
  function climbToContainer(el, opts = {}) {
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

  // Each finder returns an array of { container: HTMLElement, extract: () => {label, body}[] }
  function findFacebookAds() {
    const results = [];
    const seen = new Set();

    // Strategy 1: data-ad-preview="message" marks an ad's primary text in
    // Meta's feed markup for text-led ads — a long-standing attribute.
    document.querySelectorAll('[data-ad-preview="message"]').forEach((el) => {
      const container = el.closest('[role="article"]') || el.parentElement?.parentElement || el.parentElement || el;
      if (!container || container.hasAttribute(PROCESSED_ATTR) || seen.has(container)) return;
      seen.add(container);
      results.push({
        container,
        extract: () => {
          const items = [];
          const primary = cleanText(el.textContent);
          if (primary) items.push({ label: "Primary text", body: primary });
          const heading = container.querySelector('[role="heading"]');
          const headingText = heading ? cleanText(heading.textContent) : "";
          if (headingText && headingText !== primary) items.push({ label: "Headline", body: headingText });
          return { items: items.length ? items : extractGenericAdText(container), landingPage: "" };
        },
      });
    });

    // Strategy 2: video/image-led ads (no data-ad-preview text) still show
    // a visible "Sponsored" or "Ad" label — find that leaf label directly
    // and climb to a plausibly-sized post container instead of depending
    // on any specific attribute or class name, which rotate often.
    findLeafTextElements(document, /^(Ad|Sponsored)$/).forEach((label) => {
      const container = label.closest('[role="article"]') || climbToContainer(label);
      if (!container || container.hasAttribute(PROCESSED_ATTR) || seen.has(container)) return;
      seen.add(container);
      results.push({ container, extract: () => ({ items: extractGenericAdText(container), landingPage: "" }) });
    });

    return results;
  }

  function findLinkedInAds() {
    const results = [];
    const seen = new Set();

    // "Promoted" is LinkedIn's own visible label for an ad in-feed — a much
    // more stable signal than any specific component class name (which has
    // changed under us before, e.g. feed-shared-update-v2 not always
    // matching the live post wrapper). Find the label first, then climb.
    findLeafTextElements(document, /^Promoted$/).forEach((label) => {
      const container = label.closest(".feed-shared-update-v2") || climbToContainer(label, { minChars: 40, maxChars: 3000 });
      if (!container || container.hasAttribute(PROCESSED_ATTR) || seen.has(container)) return;
      seen.add(container);
      results.push({
        container,
        extract: () => {
          const commentary = container.querySelector(".feed-shared-inline-show-more-text, .feed-shared-text");
          const body = commentary ? cleanText(commentary.textContent) : "";
          const items = body ? [{ label: "Primary text", body }] : [];
          return { items: items.length ? items : extractGenericAdText(container), landingPage: "" };
        },
      });
    });

    return results;
  }

  function findGoogleSearchAds() {
    const results = [];
    const seen = new Set();

    // Strategy 1: data-text-ad is a commonly-observed marker on Google
    // Search text-ad result blocks.
    document.querySelectorAll("[data-text-ad]").forEach((el) => {
      if (!el || el.hasAttribute(PROCESSED_ATTR) || seen.has(el)) return;
      seen.add(el);
      results.push({ container: el, extract: () => extractGoogleOrFallback(el) });
    });

    // Strategy 2: a discrete "Ad" label, or the grouped "Sponsored
    // result(s)" section header Google also uses (2026-07-23: seen with no
    // per-item "Ad" badge at all under a shared "Sponsored results"
    // heading) — for the grouped case, treat each of the header's
    // following sibling blocks as its own ad candidate.
    findLeafTextElements(document, /^Ad$/).forEach((label) => {
      const block = label.closest("div[data-hveid], div.g, div.uEierd") || climbToContainer(label);
      if (!block || block.hasAttribute(PROCESSED_ATTR) || seen.has(block)) return;
      seen.add(block);
      results.push({ container: block, extract: () => extractGoogleOrFallback(block) });
    });

    findLeafTextElements(document, /^Sponsored results?$/).forEach((heading) => {
      const section = heading.closest("div")?.parentElement || heading.parentElement;
      if (!section) return;
      // Each direct child of the section past the heading's own wrapper is
      // treated as one candidate result block — bounded to a reasonable
      // count so a mis-identified "section" doesn't tag half the page.
      Array.from(section.children)
        .filter((child) => !child.contains(heading) && cleanText(child.textContent).length > 20)
        .slice(0, 8)
        .forEach((block) => {
          if (block.hasAttribute(PROCESSED_ATTR) || seen.has(block)) return;
          seen.add(block);
          results.push({ container: block, extract: () => extractGoogleOrFallback(block) });
        });
    });

    return results;
  }

  // extractGoogleAdText can legitimately come back empty on a layout it
  // doesn't recognize at all — fall back to the platform-agnostic
  // extractor rather than surfacing nothing. Always normalizes to
  // { items, landingPage } so every platform's extract() has one shape.
  function extractGoogleOrFallback(container) {
    const result = extractGoogleAdText(container);
    if (result.items.length) return result;
    return { items: extractGenericAdText(container), landingPage: "" };
  }

  function findYouTubeAds() {
    const results = [];
    // In-stream video ads expose very little accessible text. Best-effort:
    // detect the ad badge, grab whatever text the player overlay exposes
    // (advertiser/CTA text), and let the caller's own "too little text"
    // guard handle the common case where that's not enough to analyze.
    document.querySelectorAll(".ytp-ad-simple-ad-badge, .ad-simple-attributed-string").forEach((badge) => {
      const container = badge.closest(".ytp-ad-player-overlay-layout, .video-ads, ytd-player") || badge.parentElement;
      if (!container || container.hasAttribute(PROCESSED_ATTR)) return;
      results.push({
        container,
        extract: () => {
          const items = [];
          const overlayText = container.querySelector(".ytp-ad-text, .ytp-ad-button-text");
          const text = overlayText ? cleanText(overlayText.textContent) : "";
          if (text) items.push({ label: "Ad text", body: text });
          return { items, landingPage: "" };
        },
      });
    });
    return results;
  }

  function findRedditAds() {
    const results = [];
    const seen = new Set();

    // Reddit labels a promoted post "Promoted" as well, similar to
    // LinkedIn — usually within a post's metadata row.
    findLeafTextElements(document, /^Promoted$/).forEach((label) => {
      const container = label.closest("shreddit-post, article") || climbToContainer(label, { minChars: 40, maxChars: 3000 });
      if (!container || container.hasAttribute(PROCESSED_ATTR) || seen.has(container)) return;
      seen.add(container);
      results.push({
        container,
        extract: () => {
          // shreddit-post exposes the post title as an attribute in
          // Reddit's current web component markup.
          const title = container.getAttribute && container.getAttribute("post-title");
          const items = title ? [{ label: "Headline", body: cleanText(title) }] : [];
          return { items: items.length ? items : extractGenericAdText(container), landingPage: "" };
        },
      });
    });

    return results;
  }

  function findTikTokAds() {
    const results = [];
    const seen = new Set();

    // TikTok in-feed video ads are labeled "Sponsored"; the caption text
    // is usually real accessible DOM text even though the creative itself
    // is video (unlike YouTube's in-stream ads, which expose almost none).
    findLeafTextElements(document, /^Sponsored$/).forEach((label) => {
      const container = climbToContainer(label, { minChars: 30, maxChars: 3000 });
      if (!container || container.hasAttribute(PROCESSED_ATTR) || seen.has(container)) return;
      seen.add(container);
      results.push({
        container,
        extract: () => {
          const caption = container.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
          const text = caption ? cleanText(caption.textContent) : "";
          const items = text ? [{ label: "Caption", body: text }] : [];
          return { items: items.length ? items : extractGenericAdText(container), landingPage: "" };
        },
      });
    });

    return results;
  }

  function findAds() {
    switch (platformForHost()) {
      case "meta":
        return findFacebookAds();
      case "linkedin":
        return findLinkedInAds();
      case "google":
        return findGoogleSearchAds();
      case "youtube":
        return findYouTubeAds();
      case "reddit":
        return findRedditAds();
      case "tiktok":
        return findTikTokAds();
      default:
        return [];
    }
  }

  // ---- UI: injects a small "Grade this ad" pill onto each detected ad ----

  function ensureContainerPositioned(container) {
    const computed = window.getComputedStyle(container);
    if (computed.position === "static") {
      container.style.position = "relative";
    }
  }

  function injectButton(container, onClick) {
    ensureContainerPositioned(container);
    const btn = document.createElement("button");
    btn.textContent = "Grade this ad";
    btn.setAttribute("data-ima-button", "1");
    Object.assign(btn.style, {
      all: "initial",
      position: "absolute",
      top: "6px",
      right: "6px",
      zIndex: "999999",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "11px",
      fontWeight: "600",
      color: "#F1EEE6",
      background: "#181712",
      border: "none",
      borderRadius: "999px",
      padding: "5px 10px",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    });
    btn.addEventListener("mouseenter", () => { btn.style.background = "#33312a"; });
    btn.addEventListener("mouseleave", () => { btn.style.background = "#181712"; });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    container.appendChild(btn);
  }

  // ---- Result card (same Shadow DOM pattern as the context-menu grader) ----

  function ensureHost() {
    const HOST_ID = "__ima-ad-detector-host";
    let hostEl = document.getElementById(HOST_ID);
    if (hostEl) {
      hostEl.shadowRoot.innerHTML = "";
      return hostEl.shadowRoot;
    }
    hostEl = document.createElement("div");
    hostEl.id = HOST_ID;
    hostEl.style.all = "initial";
    hostEl.style.position = "fixed";
    hostEl.style.bottom = "20px";
    hostEl.style.right = "20px";
    hostEl.style.zIndex = "2147483647";
    document.documentElement.appendChild(hostEl);
    return hostEl.attachShadow({ mode: "open" });
  }

  function baseCardStyle() {
    return `
      .card { font-family: system-ui, -apple-system, sans-serif; background: #FFFFFF; color: #181712;
        border: 1px solid #DCD6C6; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.18);
        width: 330px; max-width: calc(100vw - 40px); padding: 16px; }
      .row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom: 10px; }
      .brand { font-size:11px; letter-spacing:.5px; color:#655F52; text-transform:uppercase; font-weight:600; }
      .close { cursor:pointer; border:none; background:none; color:#655F52; font-size:16px; line-height:1; padding:2px 4px; }
      .close:hover { color:#181712; }
      .finding { padding: 8px 0; border-top: 1px solid #DCD6C6; }
      .finding:first-of-type { border-top: none; }
      .lens { display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.3px; text-transform:uppercase;
        color:#B4540A; background:#B4540A1A; border-radius:999px; padding:2px 8px; margin-bottom:5px; }
      .issue { font-size:13px; line-height:1.45; margin: 0 0 3px; }
      .rec { font-size:12.5px; line-height:1.45; color:#655F52; margin:0; }
      .cta { display:block; text-align:center; margin-top:12px; padding:9px; background:#181712; color:#F1EEE6 !important;
        border-radius:8px; font-size:13px; font-weight:600; text-decoration:none; }
      .cta:hover { background:#33312a; }
    `;
  }

  function showLoading() {
    const root = ensureHost();
    const style = document.createElement("style");
    style.textContent = baseCardStyle();
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row"><span class="brand">Improve My Ads</span><button class="close">✕</button></div>
      <div style="font-size:13.5px; color:#655F52;">Reading this ad…</div>
    `;
    card.querySelector(".close").addEventListener("click", () => root.host.remove());
    root.appendChild(style);
    root.appendChild(card);
  }

  function showMessage(message) {
    const root = ensureHost();
    const style = document.createElement("style");
    style.textContent = baseCardStyle();
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row"><span class="brand">Improve My Ads</span><button class="close">✕</button></div>
      <div style="font-size:13.5px;">${message}</div>
    `;
    card.querySelector(".close").addEventListener("click", () => root.host.remove());
    root.appendChild(style);
    root.appendChild(card);
    setTimeout(() => { if (root.host) root.host.remove(); }, 7000);
  }

  function showFindings(findings, items, platform, landingPage) {
    const root = ensureHost();
    const style = document.createElement("style");
    style.textContent = baseCardStyle();
    const card = document.createElement("div");
    card.className = "card";

    const findingsHtml = findings
      .map(
        (f) => `
        <div class="finding">
          <span class="lens">${f.lens || "Finding"}</span>
          <p class="issue">${f.issue || ""}</p>
          <p class="rec">→ ${f.recommendation || ""}</p>
        </div>`,
      )
      .join("");

    const params = new URLSearchParams();
    params.set("slug", mapSlug(platform));
    params.set("items", toBase64Url(JSON.stringify(items)));
    if (platform) params.set("platform", platform);
    if (landingPage) params.set("lp", toBase64Url(landingPage));
    const fullUrl = `${SITE_URL}/extension-handoff?${params.toString()}`;

    card.innerHTML = `
      <div class="row"><span class="brand">Improve My Ads — free preview</span><button class="close">✕</button></div>
      ${findingsHtml || '<p style="font-size:13px;">No issues surfaced — nice work. Run the full audit for the complete picture.</p>'}
      <a class="cta" href="${fullUrl}" target="_blank" rel="noopener">See the full 6-lens report →</a>
    `;
    card.querySelector(".close").addEventListener("click", () => root.host.remove());
    root.appendChild(style);
    root.appendChild(card);
  }

  function mapSlug(platform) {
    if (platform === "google") return "google-ads-optimization";
    if (platform === "reddit") return "reddit-ads-optimization";
    return "ads-optimization";
  }

  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function previewAd(text, platform, sourceUrl) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/preview-ad`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ text, ...(platform ? { platform } : {}), ...(sourceUrl ? { sourceUrl } : {}) }),
      });
      const body = await resp.json().catch(() => null);
      if (!resp.ok) return { ok: false, error: (body && body.error) || "Temporarily unavailable — try again shortly." };
      return { ok: true, data: body };
    } catch (e) {
      return { ok: false, error: "Couldn't reach the previewer — check your connection." };
    }
  }

  async function handleGradeClick(extraction, platform) {
    const { items, landingPage } = extraction;
    const combined = items.map((it) => it.body).join("\n\n");
    if (combined.trim().length < 5) {
      showMessage("Couldn't find enough text in this ad — try selecting its text manually and right-clicking instead.");
      return;
    }
    showLoading();
    const result = await previewAd(combined, platform, location.href);
    if (!result.ok) {
      showMessage(result.error);
      return;
    }
    showFindings(result.data.findings || [], items, platform, landingPage);
  }

  function scan() {
    const platform = platformForHost();
    if (!platform) return;
    const found = findAds();
    for (const { container, extract } of found) {
      if (container.hasAttribute(PROCESSED_ATTR)) continue;
      container.setAttribute(PROCESSED_ATTR, "1");
      injectButton(container, () => handleGradeClick(extract(), platform));
    }
  }

  const debouncedScan = (() => {
    let scheduled = false;
    return () => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => { scheduled = false; scan(); }, 400);
    };
  })();

  scan();
  setInterval(scan, SCAN_INTERVAL_MS);
  const observer = new MutationObserver(debouncedScan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
