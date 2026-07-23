// On-page ad detector for Google Search only (see manifest.json's
// content_scripts.matches). Best-effort heuristic detection — Google
// doesn't publish a stable "this is an ad" API, so this relies on markup
// patterns observed in practice (label text like "Ad"/"Sponsored
// results"). It WILL occasionally miss ads or need updating when Google
// changes its markup — the right-click "check selected text" path
// (background/service-worker.js) always works regardless, on any page, as
// a reliable fallback that doesn't depend on any of this.
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

  function isGoogleSearch() {
    return host().includes("google.");
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
  // param on a google.com/aclk tracking redirect. Confirmed live
  // (2026-07-23) across two real ads that a `data-rw` attribute — when
  // present — always carries this full redirect+adurl, even for an ad
  // whose actual `href` is already a clean, direct, non-redirect link (the
  // second ad's headline anchor: href goes straight to the advertiser, but
  // data-rw still has the fuller UTM-tagged version) — so data-rw is
  // preferred when available, falling back to href's own adurl, falling
  // back to href itself. One pass of URLSearchParams decoding recovers the
  // real, fully UTM-tagged landing page URL exactly as Google would send
  // the visitor.
  function extractRealDestinationUrl(anchorEl) {
    if (!anchorEl) return "";
    const raw = (anchorEl.getAttribute && anchorEl.getAttribute("data-rw")) || anchorEl.href;
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      const adurl = url.searchParams.get("adurl");
      return adurl || anchorEl.href || raw;
    } catch {
      return anchorEl.href || raw || "";
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

    // Advertiser name: confirmed live (2026-07-23) that this is always the
    // leaf-text element immediately preceding the URL breadcrumb in
    // document order (e.g. "Semrush" right before "https://www.semrush.com
    // › on_page › seo_checker"). Worth surfacing as its own item — without
    // it, the website's own downstream AI brand-detection step (which only
    // sees the submitted ad copy text, never the URL/advertiser row) has no
    // genuinely-visible company name or domain to go on and correctly
    // refuses to guess one, leaving its "auditing <brand>'s ad" confirmation
    // blank even though the brand was right there in the source page.
    if (urlLeaf) {
      const leaves = findLeafTextElements(container, /^.+$/);
      const idx = leaves.indexOf(urlLeaf);
      const advertiserLeaf = idx > 0 ? leaves[idx - 1] : null;
      if (advertiserLeaf) {
        const t = cleanText(advertiserLeaf.textContent);
        if (t && t !== headlineText && !isBreadcrumb(t) && t.length >= 2 && t.length <= 60) {
          items.push({ label: "Advertiser", body: t });
          used.add(advertiserLeaf);
        }
      }
    }

    // Callouts / sitelinks: confirmed live (2026-07-23) across three real
    // ads that Google renders these in at least three different shapes,
    // distinguished by how many of an anchor's DIRECT children have any
    // non-empty text (an icon/chevron child, e.g. an inline SVG, has zero
    // text and is filtered out here rather than counted):
    //   0 non-empty children: a compact inline text link, no description
    //     at all (e.g. a "SaaS Pricing · Download Your SaaS Playbook · ..."
    //     row) — the anchor's OWN text is the title.
    //   1 non-empty child: a title-only sitelink with a separate,
    //     empty-text icon sibling (e.g. "SEO Checker" / "Try for Free" /
    //     "Site Audit" rows) — that one child's text is the title.
    //   2+ non-empty children: a boxed sitelink with its own one-line
    //     description as a later child (e.g. "Fair pricing" / "Find a plan
    //     that works for you...") — first child is the title, the first
    //     later child long enough to be a real sentence is the description.
    // Processed in document order, capped at 5. Explicitly excludes the
    // headline's own anchor, which incidentally also has 2 non-empty
    // children (heading + advertiser info) and would otherwise look like a
    // boxed callout.
    const callouts = [];
    container.querySelectorAll("a").forEach((a) => {
      if (callouts.length >= 5) return;
      if (isOwnUi(a)) return;
      if (headlineAnchor && (a === headlineAnchor || headlineAnchor.contains(a) || a.contains(headlineAnchor))) return;

      const blockChildren = Array.from(a.children).filter((c) => cleanText(c.textContent).length > 0);
      let titleText = "";
      let descText = "";
      if (blockChildren.length === 0) {
        titleText = cleanText(a.textContent);
      } else if (blockChildren.length === 1) {
        titleText = cleanText(blockChildren[0].textContent);
      } else {
        titleText = cleanText(blockChildren[0].textContent);
        for (let i = 1; i < blockChildren.length; i++) {
          const t = cleanText(blockChildren[i].textContent);
          if (t && t !== titleText && t.length > 10 && !isBreadcrumb(t)) {
            descText = t;
            break;
          }
        }
      }

      if (!titleText || titleText.length < 2 || titleText.length > 60 || isBreadcrumb(titleText)) return;
      if (callouts.some((c) => c.title === titleText)) return;
      callouts.push({ el: a, title: titleText, desc: descText });
    });

    callouts.slice(0, 5).forEach((c, i) => {
      items.push({ label: `Callout ${i + 1}`, body: c.desc ? `${c.title}: ${c.desc}` : c.title });
      used.add(c.el);
    });

    // Description: the longest remaining leaf-ish text block that isn't
    // the headline, landing page breadcrumb, or a callout's own text.
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

  // Returns an array of { container: HTMLElement, extract: () => {label, body}[] }
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
  // doesn't recognize at all — fall back to the generic extractor rather
  // than surfacing nothing. Always normalizes to { items, landingPage }.
  function extractGoogleOrFallback(container) {
    const result = extractGoogleAdText(container);
    if (result.items.length) return result;
    return { items: extractGenericAdText(container), landingPage: "" };
  }

  function findAds() {
    if (!isGoogleSearch()) return [];
    return findGoogleSearchAds();
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
      .headline-quote { font-size:12.5px; color:#655F52; font-style:italic; border-left:2px solid #DCD6C6;
        padding-left:8px; margin: 0 0 12px; max-height:54px; overflow:hidden; }
      .score-wrap { display:flex; align-items:baseline; gap:10px; margin-bottom:2px; }
      .score { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:700; font-size:30px; line-height:1; }
      .score-label { font-size:11px; color:#655F52; }
      .score-caption { font-size:10.5px; color:#8A8577; margin: 0 0 12px; }
      .finding { padding: 8px 0; border-top: 1px solid #DCD6C6; }
      .finding:first-of-type { border-top: none; }
      .lens { display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.3px; text-transform:uppercase;
        color:#B4540A; background:#B4540A1A; border-radius:999px; padding:2px 8px; margin-bottom:5px; }
      .issue { font-size:13px; line-height:1.45; margin: 0 0 3px; }
      .rec { font-size:12.5px; line-height:1.45; color:#655F52; margin:0; }
      .cta { display:block; text-align:center; margin-top:12px; padding:9px; background:#181712; color:#F1EEE6 !important;
        border-radius:8px; font-size:13px; font-weight:600; text-decoration:none; }
      .cta:hover { background:#33312a; }
      .remaining { margin-top:10px; text-align:center; font-size:11px; color:#655F52; }
      .remaining-low { color:#9C4708; font-weight:600; }
    `;
  }

  function scoreColor(score) {
    if (score >= 70) return "#1F7A4D";
    if (score >= 40) return "#9C4708";
    return "#B0362E";
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

  // `data` is preview-google-ad's full response — { score, findings,
  // remaining, limit } — not just the findings array, so this card can show
  // the same score treatment the extension's OTHER two entry points (the
  // toolbar popup and the right-click menu, both backed by grade-google-ad)
  // already show. `items`/`landingPage` are the raw extraction, used here
  // only to quote the headline and to build the handoff URL.
  function showFindings(data, items, landingPage) {
    const { score, findings = [], remaining, limit } = data;
    const root = ensureHost();
    const style = document.createElement("style");
    style.textContent = baseCardStyle();
    const card = document.createElement("div");
    card.className = "card";

    // Echoes which ad this card is actually about — without it, a card
    // graded from an ad near the top of a long SERP gives no clue what it's
    // describing once the visitor has scrolled away from the button they
    // clicked. Same treatment as the right-click card's own headline quote.
    const headline = items.find((it) => it.label === "Headline")?.body || "";
    const headlineHtml = headline
      ? `<div class="headline-quote">"${headline.length > 140 ? headline.slice(0, 140) + "…" : headline}"</div>`
      : "";

    // Labeled "Estimated" (not just "Google Ads score") deliberately — this
    // comes from one lightweight, 2-lens call, not the full audit's 6-lens
    // + synthesis pipeline (see run-audit's SYNTHESIS_SYSTEM_PROMPT), so it
    // can genuinely land on a different number than the real audit. Framing
    // it as a fast estimate up front avoids that divergence ever reading as
    // the product contradicting itself.
    const scoreHtml =
      typeof score === "number"
        ? `<div class="score-wrap"><div class="score" style="color:${scoreColor(score)}">${score}</div><div class="score-label">Estimated score</div></div>`
        : "";

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
    params.set("slug", "google-ads-optimization");
    params.set("items", toBase64Url(JSON.stringify(items)));
    params.set("platform", "google");
    if (landingPage) params.set("lp", toBase64Url(landingPage));
    const fullUrl = `${SITE_URL}/extension-handoff?${params.toString()}`;

    // Only shown once the server actually reports a count — an infra hiccup
    // that leaves these fields off the response just omits the line instead
    // of showing a wrong or placeholder number.
    const remainingHtml =
      typeof remaining === "number" && typeof limit === "number"
        ? `<div class="remaining${remaining <= 1 ? " remaining-low" : ""}">${remaining} free check${remaining === 1 ? "" : "s"} left this hour</div>`
        : "";

    card.innerHTML = `
      <div class="row"><span class="brand">Improve My Ads — free preview</span><button class="close">✕</button></div>
      ${headlineHtml}
      ${scoreHtml}
      ${findingsHtml || '<p style="font-size:13px;">No issues surfaced — nice work. Run the full audit for the complete picture.</p>'}
      <a class="cta" href="${fullUrl}" target="_blank" rel="noopener">Run the full Google Ads audit →</a>
      ${remainingHtml}
    `;
    card.querySelector(".close").addEventListener("click", () => root.host.remove());
    root.appendChild(style);
    root.appendChild(card);
  }

  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function previewGoogleAd(text, sourceUrl) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/preview-google-ad`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ text, ...(sourceUrl ? { sourceUrl } : {}) }),
      });
      const body = await resp.json().catch(() => null);
      if (!resp.ok) return { ok: false, error: (body && body.error) || "Temporarily unavailable — try again shortly." };
      return { ok: true, data: body };
    } catch (e) {
      return { ok: false, error: "Couldn't reach the previewer — check your connection." };
    }
  }

  async function handleGradeClick(extraction) {
    const { items, landingPage } = extraction;
    const combined = items.map((it) => it.body).join("\n\n");
    if (combined.trim().length < 5) {
      showMessage("Couldn't find enough text in this ad — try selecting its text manually and right-clicking instead.");
      return;
    }
    showLoading();
    const result = await previewGoogleAd(combined, location.href);
    if (!result.ok) {
      showMessage(result.error);
      return;
    }
    showFindings(result.data, items, landingPage);
  }

  function scan() {
    if (!isGoogleSearch()) return;
    const found = findAds();
    for (const { container, extract } of found) {
      if (container.hasAttribute(PROCESSED_ATTR)) continue;
      container.setAttribute(PROCESSED_ATTR, "1");
      injectButton(container, () => handleGradeClick(extract()));
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
