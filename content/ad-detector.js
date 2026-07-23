// On-page ad detector for Facebook, Instagram, LinkedIn, Google Search, and
// YouTube (see manifest.json's content_scripts.matches). Best-effort
// heuristic detection — these platforms don't publish a stable "this is an
// ad" API, so this relies on markup patterns observed in practice (label
// text like "Sponsored"/"Promoted"/"Ad", and a couple of long-standing
// attributes). It WILL occasionally miss ads or need updating when a
// platform changes its markup — the right-click "grade selected text" path
// (background/service-worker.js) always works regardless, as a reliable
// fallback that doesn't depend on any of this.
//
// This file is a plain content script (not a module — see manifest.json),
// so everything is wrapped in an IIFE to avoid leaking globals into the
// host page.
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
    if (h.includes("instagram.com")) return "instagram";
    if (h.includes("linkedin.com")) return "linkedin";
    if (h.includes("youtube.com")) return "youtube";
    if (h.includes("google.")) return "google";
    return "";
  }

  function cleanText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // Each finder returns an array of { container: HTMLElement, extract: () => {label, body}[] }
  function findFacebookAds() {
    const results = [];
    // data-ad-preview="message" marks an ad's primary text in Meta's feed
    // markup — a long-standing attribute widely relied on by third-party ad
    // tooling. We climb a few ancestors to find a reasonably-bounded "card"
    // container to attach the button to.
    document.querySelectorAll('[data-ad-preview="message"]').forEach((el) => {
      const container = el.closest('[role="article"]') || el.parentElement?.parentElement || el.parentElement || el;
      if (!container || container.hasAttribute(PROCESSED_ATTR)) return;
      results.push({
        container,
        extract: () => {
          const items = [];
          const primary = cleanText(el.textContent);
          if (primary) items.push({ label: "Primary text", body: primary });
          const heading = container.querySelector('[role="heading"]');
          const headingText = heading ? cleanText(heading.textContent) : "";
          if (headingText && headingText !== primary) items.push({ label: "Headline", body: headingText });
          return items;
        },
      });
    });
    return results;
  }

  function findLinkedInAds() {
    const results = [];
    document.querySelectorAll(".feed-shared-update-v2").forEach((container) => {
      if (container.hasAttribute(PROCESSED_ATTR)) return;
      const promotedLabel = Array.from(container.querySelectorAll("span")).find((s) => /\bPromoted\b/.test(s.textContent || ""));
      if (!promotedLabel) return;
      results.push({
        container,
        extract: () => {
          const items = [];
          const commentary = container.querySelector(".feed-shared-inline-show-more-text, .feed-shared-text");
          const body = commentary ? cleanText(commentary.textContent) : "";
          if (body) items.push({ label: "Primary text", body });
          return items;
        },
      });
    });
    return results;
  }

  function findGoogleSearchAds() {
    const results = [];
    // data-text-ad is a commonly-observed marker on Google Search text-ad
    // result blocks. Falls back to a discrete "Ad" label span as a second
    // signal since Google's markup rotates.
    const candidates = new Set();
    document.querySelectorAll("[data-text-ad]").forEach((el) => candidates.add(el));
    document.querySelectorAll("span, div").forEach((el) => {
      if (el.children.length === 0 && cleanText(el.textContent) === "Ad") {
        const block = el.closest("div[data-hveid], div.g, div.uEierd") || el.parentElement;
        if (block) candidates.add(block);
      }
    });
    candidates.forEach((container) => {
      if (!container || container.hasAttribute(PROCESSED_ATTR)) return;
      results.push({
        container,
        extract: () => {
          const items = [];
          const heading = container.querySelector("h3");
          const headingText = heading ? cleanText(heading.textContent) : "";
          if (headingText) items.push({ label: "Headline", body: headingText });
          const desc = container.querySelector('[data-content-feature="1"], .VwiC3b, .MUxGbd');
          const descText = desc ? cleanText(desc.textContent) : "";
          if (descText) items.push({ label: "Description", body: descText });
          return items;
        },
      });
    });
    return results;
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
          return items;
        },
      });
    });
    return results;
  }

  function findAds() {
    switch (platformForHost()) {
      case "meta":
        return findFacebookAds();
      case "instagram":
        return []; // Instagram's ad markup on web is heavily obfuscated/rotated; not reliably detectable today.
      case "linkedin":
        return findLinkedInAds();
      case "google":
        return findGoogleSearchAds();
      case "youtube":
        return findYouTubeAds();
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

  function showFindings(findings, items, platform) {
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

  async function handleGradeClick(items, platform) {
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
    showFindings(result.data.findings || [], items, platform);
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
