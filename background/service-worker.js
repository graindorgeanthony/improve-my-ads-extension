import { gradeGoogleAd, saveHistoryEntry, fullAuditHandoffUrl } from "../lib/api.js";

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
  await saveHistoryEntry({ headline, ...result.data });
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
// chrome.scripting.executeScript), so it must be fully self-contained — no
// closures over outer-scope variables, no imports. Renders inside a Shadow
// DOM host so the page's own CSS can never bleed in or be bled onto.

function ensureHost() {
  const HOST_ID = "__ima-google-ads-grader-host";
  let host = document.getElementById(HOST_ID);
  if (host) {
    host.shadowRoot.innerHTML = "";
    return host.shadowRoot;
  }
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.bottom = "20px";
  host.style.right = "20px";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

function baseStyle() {
  return `
    .card { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #FFFFFF;
      color: #181712; border: 1px solid #DCD6C6; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      width: 320px; max-width: calc(100vw - 40px); padding: 16px; animation: ima-in .15s ease-out; }
    @keyframes ima-in { from { opacity:0; transform: translateY(8px);} to {opacity:1; transform:none;} }
    .row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .brand { font-size:11px; letter-spacing:.5px; color:#655F52; text-transform:uppercase; font-weight:600; }
    .close { cursor:pointer; border:none; background:none; color:#655F52; font-size:16px; line-height:1; padding:2px 4px; }
    .close:hover { color:#181712; }
  `;
}

function showLoadingCard() {
  const root = ensureHost();
  const style = document.createElement("style");
  style.textContent = baseStyle();
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
  const root = ensureHost();
  const style = document.createElement("style");
  style.textContent = baseStyle();
  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="row" style="margin-bottom:8px;">
      <span class="brand">Improve My Ads</span>
      <button class="close" aria-label="Close">✕</button>
    </div>
    <div style="font-size:13.5px; color:#181712;">${message}</div>
  `;
  card.querySelector(".close").addEventListener("click", () => root.host.remove());
  root.appendChild(style);
  root.appendChild(card);
  setTimeout(() => { if (root.host) root.host.remove(); }, 6000);
}

function showResultCardImpl(payload) {
  const { headline, score, principle, diagnosis, fixes, fullAuditUrl } = payload;
  const root = ensureHost();
  const color = score >= 70 ? "#1F7A4D" : score >= 40 ? "#9C4708" : "#B0362E";

  const style = document.createElement("style");
  style.textContent = baseStyle() + `
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

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="row">
      <span class="brand">Improve My Ads</span>
      <button class="close" aria-label="Close">✕</button>
    </div>
    <div class="headline-quote">"${headline.length > 140 ? headline.slice(0, 140) + "…" : headline}"</div>
    <div class="score-wrap">
      <div class="score">${score}</div>
      <div>
        <div class="principle">${principle || "Google Ads score"}</div>
      </div>
    </div>
    <div class="diagnosis">${diagnosis || ""}</div>
    ${
      Array.isArray(fixes) && fixes.length
        ? `<div class="fixes-label">Try instead (click to copy)</div>` +
          fixes.map((f) => `<div class="fix" data-fix="${f.replace(/"/g, "&quot;")}">${f}</div>`).join("")
        : ""
    }
    <a class="cta" href="${fullAuditUrl}" target="_blank" rel="noopener">Run the full Google Ads audit →</a>
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
