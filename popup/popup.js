import { previewGoogleAd, fullAuditHandoffUrl, saveHistoryEntry, getHistory } from "../lib/api.js";

const form = document.getElementById("grade-form");
const headlineEl = document.getElementById("headline");
const descriptionEl = document.getElementById("description");
const charCountEl = document.getElementById("char-count");
const gradeBtn = document.getElementById("grade-btn");
const gradeBtnLabel = document.getElementById("grade-btn-label");
const errorBanner = document.getElementById("error-banner");
const resultEl = document.getElementById("result");
const resultHeadlineEl = document.getElementById("result-headline");
const scoreEl = document.getElementById("score");
const findingsEl = document.getElementById("findings");
const fullAuditLink = document.getElementById("full-audit-link");
const remainingEl = document.getElementById("remaining");
const historyToggle = document.getElementById("history-toggle");
const historyChevron = document.getElementById("history-chevron");
const historyList = document.getElementById("history-list");

// previewGoogleAd's own cap (see preview-google-ad/index.ts MAX_TEXT_LENGTH)
// — shown here so the counter means something instead of an arbitrary number.
const MAX_TEXT_LENGTH = 2000;

function updateCharCount() {
  const combined = headlineEl.value.length + descriptionEl.value.length;
  charCountEl.textContent = `${combined} / ${MAX_TEXT_LENGTH}`;
}
headlineEl.addEventListener("input", updateCharCount);
descriptionEl.addEventListener("input", updateCharCount);

function scoreColor(score) {
  if (score >= 70) return "#1F7A4D";
  if (score >= 40) return "#9C4708";
  return "#B0362E";
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Renders either shape a saved history entry (or a fresh check) can carry:
// the current previewGoogleAd shape ({findings: [{lens,issue,recommendation}]}),
// used by this form now, OR the older grade-google-ad shape
// ({principle, diagnosis, fixes}) still produced by the right-click flow
// (background/service-worker.js) — an entry saved by THAT flow before or
// after this change must still render correctly when clicked from history.
function renderResult(entry) {
  const { headline, score } = entry;
  resultHeadlineEl.textContent = headline ? `"${truncate(headline, 100)}"` : "";
  resultHeadlineEl.classList.toggle("hidden", !headline);

  scoreEl.textContent = typeof score === "number" ? String(score) : "–";
  scoreEl.style.color = typeof score === "number" ? scoreColor(score) : "var(--ink-soft)";

  findingsEl.innerHTML = "";
  if (Array.isArray(entry.findings) && entry.findings.length) {
    for (const f of entry.findings) {
      const div = document.createElement("div");
      div.className = "finding";
      div.innerHTML = `<span class="lens">${escapeHtml(f.lens || "Finding")}</span><p class="issue">${escapeHtml(f.issue || "")}</p><p class="rec">→ ${escapeHtml(f.recommendation || "")}</p>`;
      findingsEl.appendChild(div);
    }
  } else if (entry.diagnosis || (Array.isArray(entry.fixes) && entry.fixes.length)) {
    const card = document.createElement("div");
    card.className = "finding";
    const principleHtml = entry.principle ? `<span class="lens">${escapeHtml(entry.principle)}</span>` : "";
    card.innerHTML = `${principleHtml}<p class="issue">${escapeHtml(entry.diagnosis || "")}</p>`;
    findingsEl.appendChild(card);
    if (Array.isArray(entry.fixes) && entry.fixes.length) {
      const label = document.createElement("div");
      label.className = "fixes-label";
      label.textContent = "Try instead (click to copy)";
      findingsEl.appendChild(label);
      for (const fix of entry.fixes) {
        const div = document.createElement("div");
        div.className = "fix";
        div.textContent = fix;
        div.title = "Click to copy";
        div.addEventListener("click", () => {
          navigator.clipboard.writeText(fix);
          const original = div.textContent;
          div.textContent = "Copied ✓";
          setTimeout(() => { div.textContent = original; }, 1200);
        });
        findingsEl.appendChild(div);
      }
    }
  }

  fullAuditLink.href = fullAuditHandoffUrl(entry.items || [{ label: "Headline", body: headline || "" }]);

  if (typeof entry.remaining === "number" && typeof entry.limit === "number") {
    remainingEl.textContent = `${entry.remaining} free check${entry.remaining === 1 ? "" : "s"} left this hour`;
    remainingEl.classList.remove("hidden");
    remainingEl.classList.toggle("remaining-low", entry.remaining <= 1);
  } else {
    remainingEl.classList.add("hidden");
  }

  resultEl.classList.remove("hidden");
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const headline = headlineEl.value.trim();
  const description = descriptionEl.value.trim();
  if (!headline || gradeBtn.disabled) return;

  // Structured ad copy (headline + optional description), same items shape
  // the on-page detector extracts and the same handoff format the full
  // audit tool understands — not a single freeform line, so this reads as
  // one field per ad element instead of a raw textarea.
  const items = [{ label: "Headline", body: headline }];
  if (description) items.push({ label: "Description", body: description });
  const text = items.map((it) => `${it.label}: ${it.body}`).join("\n\n");

  errorBanner.classList.add("hidden");
  resultEl.classList.add("hidden");
  gradeBtn.disabled = true;
  gradeBtnLabel.textContent = "Checking…";

  const result = await previewGoogleAd(text);

  gradeBtn.disabled = false;
  gradeBtnLabel.textContent = "Check this ad";

  if (!result.ok) {
    showError(result.error);
    return;
  }

  const entry = {
    headline,
    items,
    score: result.data.score,
    findings: result.data.findings,
    remaining: result.data.remaining,
    limit: result.data.limit,
  };
  renderResult(entry);

  // Only worth remembering with a real score to show — an entry with none
  // would just render as a blank "–" in the history list.
  if (typeof entry.score === "number") {
    const history = await saveHistoryEntry(entry);
    renderHistory(history);
  }
});

function timeAgo(ts) {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function renderHistory(history) {
  historyList.innerHTML = "";
  if (!history.length) {
    historyList.innerHTML = `<div class="history-empty">No checks yet — try one above.</div>`;
    return;
  }
  for (const entry of history) {
    const row = document.createElement("div");
    row.className = "history-item";
    const scoreSpan = document.createElement("span");
    scoreSpan.className = "h-score";
    scoreSpan.textContent = typeof entry.score === "number" ? String(entry.score) : "–";
    scoreSpan.style.color = typeof entry.score === "number" ? scoreColor(entry.score) : "var(--ink-soft)";
    const textSpan = document.createElement("span");
    textSpan.className = "h-text";
    textSpan.textContent = entry.headline;
    textSpan.title = `${entry.headline} — ${timeAgo(entry.ts)}`;
    row.appendChild(scoreSpan);
    row.appendChild(textSpan);
    row.addEventListener("click", () => {
      headlineEl.value = entry.headline;
      descriptionEl.value = (entry.items || []).find((it) => it.label === "Description")?.body || "";
      updateCharCount();
      errorBanner.classList.add("hidden");
      renderResult(entry);
    });
    historyList.appendChild(row);
  }
}

historyToggle.addEventListener("click", () => {
  const isHidden = historyList.classList.toggle("hidden");
  historyChevron.textContent = isHidden ? "▾" : "▴";
});

(async function init() {
  const history = await getHistory();
  renderHistory(history);
})();
