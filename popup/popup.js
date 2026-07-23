import { gradeGoogleAd, fullAuditHandoffUrl, saveHistoryEntry, getHistory } from "../lib/api.js";

const form = document.getElementById("grade-form");
const headlineEl = document.getElementById("headline");
const charCountEl = document.getElementById("char-count");
const gradeBtn = document.getElementById("grade-btn");
const gradeBtnLabel = document.getElementById("grade-btn-label");
const errorBanner = document.getElementById("error-banner");
const resultEl = document.getElementById("result");
const scoreEl = document.getElementById("score");
const principleEl = document.getElementById("principle");
const diagnosisEl = document.getElementById("diagnosis");
const fixesLabelEl = document.getElementById("fixes-label");
const fixesEl = document.getElementById("fixes");
const fullAuditLink = document.getElementById("full-audit-link");
const historyToggle = document.getElementById("history-toggle");
const historyChevron = document.getElementById("history-chevron");
const historyList = document.getElementById("history-list");

headlineEl.addEventListener("input", () => {
  charCountEl.textContent = `${headlineEl.value.length} / 300`;
});

function scoreColor(score) {
  if (score >= 70) return "#1F7A4D";
  if (score >= 40) return "#9C4708";
  return "#B0362E";
}

function renderResult({ headline, score, principle, diagnosis, fixes }) {
  const color = scoreColor(score);
  scoreEl.textContent = String(score);
  scoreEl.style.color = color;
  principleEl.textContent = principle || "Google Ads score";
  principleEl.style.color = color;
  principleEl.style.background = `${color}1A`;
  diagnosisEl.textContent = diagnosis || "";

  fixesEl.innerHTML = "";
  if (Array.isArray(fixes) && fixes.length) {
    fixesLabelEl.classList.remove("hidden");
    for (const fix of fixes) {
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
      fixesEl.appendChild(div);
    }
  } else {
    fixesLabelEl.classList.add("hidden");
  }

  fullAuditLink.href = fullAuditHandoffUrl([{ label: "Headline", body: headline }]);
  resultEl.classList.remove("hidden");
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const headline = headlineEl.value.trim();
  if (!headline || gradeBtn.disabled) return;

  errorBanner.classList.add("hidden");
  resultEl.classList.add("hidden");
  gradeBtn.disabled = true;
  gradeBtnLabel.textContent = "Checking…";

  const result = await gradeGoogleAd(headline);

  gradeBtn.disabled = false;
  gradeBtnLabel.textContent = "Check this ad";

  if (!result.ok) {
    showError(result.error);
    return;
  }

  renderResult({ headline, ...result.data });
  const history = await saveHistoryEntry({ headline, ...result.data });
  renderHistory(history);
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
    scoreSpan.textContent = String(entry.score);
    scoreSpan.style.color = scoreColor(entry.score);
    const textSpan = document.createElement("span");
    textSpan.className = "h-text";
    textSpan.textContent = entry.headline;
    textSpan.title = `${entry.headline} — ${timeAgo(entry.ts)}`;
    row.appendChild(scoreSpan);
    row.appendChild(textSpan);
    row.addEventListener("click", () => {
      headlineEl.value = entry.headline;
      charCountEl.textContent = `${entry.headline.length} / 300`;
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
