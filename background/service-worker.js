import { gradeGoogleAd, fullAuditHandoffUrl } from "../lib/api.js";

const MENU_ID = "check-google-ad";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Check this Google ad — "%s"',
    contexts: ["selection"],
  });

  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome/welcome.html") });
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id === undefined) return;

  // On Google Search, defer first to the in-page ad detector so a right-click
  // on an ad grades its full extracted content (headline, description,
  // advertiser, callouts) exactly like clicking "Grade this ad" would —
  // instead of the raw text selection below, which can come out as a messy,
  // out-of-order concatenation when a selection spans a whole ad card
  // (reported live 2026-07-23: selecting across an Outrank ad produced
  // "Outrank  Outrank https://www.outrank.so"). Falls through to the
  // selection-based flow whenever there's no content script on this page
  // (anywhere but Google Search), or the right-click wasn't inside a
  // detected ad.
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "IMA_GRADE_CONTEXT_AD" });
    if (response?.handled) return;
  } catch (e) {
    /* no content script on this page — fall through to selection-based grading */
  }

  const selection = (info.selectionText || "").trim();

  // Truncate rather than reject — a real selection is often a whole ad's
  // body copy, not just the headline; grading the first 300 chars (the
  // server's own cap) still gives a useful read instead of a dead end.
  const headline = selection.slice(0, 300);
  if (headline.trim().length < 3) {
    await injectToast(tab.id, "Select at least 3 characters of text first.");
    return;
  }

  await injectLoading(tab.id);
  const result = await gradeGoogleAd(headline);
  if (!result.ok) {
    await injectToast(tab.id, result.error);
    return;
  }
  await injectResultCard(tab.id, {
    headline,
    ...result.data,
    fullAuditUrl: fullAuditHandoffUrl([{ label: "Headline", body: headline }]),
  });
});

async function injectLoading(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: showLoadingCard });
  } catch (e) {
    // Restricted page (chrome://, Web Store, PDF viewer, etc.) — nothing we can do.
  }
}

async function injectToast(tabId, message) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: showToastCard, args: [message] });
  } catch (e) {
    /* restricted page */
  }
}

async function injectResultCard(tabId, payload) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: showResultCardImpl, args: [payload] });
  } catch (e) {
    /* restricted page */
  }
}

// Everything below runs INSIDE the target page (injected via
// chrome.scripting.executeScript with `func:`), and each function is
// injected ON ITS OWN — Chrome serializes only that single function's
// source, so it CANNOT call any other top-level helper in this file (they
// simply won't exist in the injected context, causing a silent
// "X is not defined" runtime error). Every function below must therefore
// be fully self-contained end-to-end: its own host/shadow-root setup, its
// own styles, its own HTML-escaping. Duplication here is deliberate, not
// an oversight — do not "DRY" this into shared helpers.

function showLoadingCard() {
  const HOST_ID = "__ima-google-ads-grader-host";
  let host = document.getElementById(HOST_ID);
  if (host) {
    host.shadowRoot.innerHTML = "";
  } else {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.bottom = "20px";
    host.style.right = "20px";
    host.style.zIndex = "2147483647";
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: "open" });
  }
  const root = host.shadowRoot;

  const style = document.createElement("style");
  style.textContent = `
    .card { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #FFFFFF;
      color: #181712; border: 1px solid #DCD6C6; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      width: 320px; max-width: calc(100vw - 40px); padding: 16px; animation: ima-in .15s ease-out; }
    @keyframes ima-in { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform:none;} }
    .row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .brand { font-size:11px; letter-spacing:.5px; color:#655F52; text-transform:uppercase; font-weight:600; }
    .close { cursor:pointer; border:none; background:none; color:#655F52; font-size:16px; line-height:1; padding:2px 4px; }
    .close:hover { color:#181712; }
  `;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="row" style="margin-bottom:10px;">
      <span class="brand">Improve My Ads</span>
      <button class="close" aria-label="Close">✕</button>
    </div>
    <div style="font-size:13.5px; color:#655F52;">Checking your ad…</div>
  `;
  card.querySelector(".close").addEventListener("click", () => root.host.remove());
  root.appendChild(style);
  root.appendChild(card);
}

function showToastCard(message) {
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  const HOST_ID = "__ima-google-ads-grader-host";
  let host = document.getElementById(HOST_ID);
  if (host) {
    host.shadowRoot.innerHTML = "";
  } else {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.bottom = "20px";
    host.style.right = "20px";
    host.style.zIndex = "2147483647";
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: "open" });
  }
  const root = host.shadowRoot;

  const style = document.createElement("style");
  style.textContent = `
    .card { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #FFFFFF;
      color: #181712; border: 1px solid #DCD6C6; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      width: 320px; max-width: calc(100vw - 40px); padding: 16px; animation: ima-in .15s ease-out; }
    @keyframes ima-in { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform:none;} }
    .row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .brand { font-size:11px; letter-spacing:.5px; color:#655F52; text-transform:uppercase; font-weight:600; }
    .close { cursor:pointer; border:none; background:none; color:#655F52; font-size:16px; line-height:1; padding:2px 4px; }
    .close:hover { color:#181712; }
  `;
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <span class="brand">Improve My Ads</span>
      <button class="close" aria-label="Close">✕</button>
    </div>
    <div style="font-size:13.5px; color:#181712;">${escapeHtml(message)}</div>
  `;
  card.querySelector(".close").addEventListener("click", () => root.host.remove());
  root.appendChild(style);
  root.appendChild(card);
  setTimeout(() => { if (root.host) root.host.remove(); }, 6000);
}

function showResultCardImpl(payload) {
  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  const { headline, score, principle, diagnosis, fixes, fullAuditUrl } = payload;

  const HOST_ID = "__ima-google-ads-grader-host";
  let host = document.getElementById(HOST_ID);
  if (host) {
    host.shadowRoot.innerHTML = "";
  } else {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.bottom = "20px";
    host.style.right = "20px";
    host.style.zIndex = "2147483647";
    document.documentElement.appendChild(host);
    host.attachShadow({ mode: "open" });
  }
  const root = host.shadowRoot;
  const color = score >= 70 ? "#1F7A4D" : score >= 40 ? "#9C4708" : "#B0362E";

  const style = document.createElement("style");
  style.textContent = `
    .card { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #FFFFFF;
      color: #181712; border: 1px solid #DCD6C6; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      width: 320px; max-width: calc(100vw - 40px); padding: 16px; animation: ima-in .15s ease-out; }
    @keyframes ima-in { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform:none;} }
    .row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .brand { font-size:11px; letter-spacing:.5px; color:#655F52; text-transform:uppercase; font-weight:600; }
    .close { cursor:pointer; border:none; background:none; color:#655F52; font-size:16px; line-height:1; padding:2px 4px; }
    .close:hover { color:#181712; }
    .score-wrap { display:flex; align-items:center; gap:12px; margin: 10px 0; }
    .score { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight:700; font-size:30px; color:${color}; }
    .principle { display:inline-block; font-size:11px; font-weight:600; letter-spacing:.3px; color:${color};
      background:${color}1A; border-radius:999px; padding:3px 9px; margin-bottom:6px; }
    .headline-quote { font-size:12.5px; color:#655F52; font-style:italic; border-left:2px solid #DCD6C6; padding-left:8px; margin-bottom:2px;
      max-height:54px; overflow:hidden; }
    .diagnosis { font-size:13px; line-height:1.5; color:#181712; margin: 8px 0 10px; }
    .fixes-label { font-size:11px; font-weight:600; letter-spacing:.4px; color:#655F52; text-transform:uppercase; margin-bottom:6px; }
    .fix { font-size:12.5px; line-height:1.4; padding:7px 8px; background:#F1EEE6; border-radius:6px; margin-bottom:6px; cursor:pointer; }
    .fix:hover { background:#e7e2d4; }
    .cta { display:block; text-align:center; margin-top:10px; padding:9px; background:#181712; color:#F1EEE6 !important;
      border-radius:8px; font-size:13px; font-weight:600; text-decoration:none; }
    .cta:hover { background:#33312a; }
  `;

  const safeHeadline = escapeHtml(headline.length > 140 ? headline.slice(0, 140) + "…" : headline);

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="row">
      <span class="brand">Improve My Ads</span>
      <button class="close" aria-label="Close">✕</button>
    </div>
    <div class="headline-quote">"${safeHeadline}"</div>
    <div class="score-wrap">
      <div class="score">${escapeHtml(score)}</div>
      <div>
        <div class="principle">${escapeHtml(principle || "Google Ads score")}</div>
      </div>
    </div>
    <div class="diagnosis">${escapeHtml(diagnosis || "")}</div>
    ${
      Array.isArray(fixes) && fixes.length
        ? `<div class="fixes-label">Try instead (click to copy)</div>` +
          fixes.map((f) => `<div class="fix" data-fix="${escapeHtml(f)}">${escapeHtml(f)}</div>`).join("")
        : ""
    }
    <a class="cta" href="${escapeHtml(fullAuditUrl)}" target="_blank" rel="noopener">Run the full Google Ads audit →</a>
  `;
  card.querySelector(".close").addEventListener("click", () => root.host.remove());
  card.querySelectorAll(".fix").forEach((el) => {
    el.addEventListener("click", () => {
      navigator.clipboard.writeText(el.getAttribute("data-fix")).then(() => {
        const original = el.textContent;
        el.textContent = "Copied ✓";
        setTimeout(() => { el.textContent = original; }, 1200);
      });
    });
  });

  root.appendChild(style);
  root.appendChild(card);
}
