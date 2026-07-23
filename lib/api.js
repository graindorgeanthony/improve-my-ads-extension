// Shared client for the same public `grade-hook` edge function that backs
// improve-my-ads.com's free Ad Hook Grader tool (/tools/ad-hook-grader).
// This is the identical endpoint, key, and request shape the website's own
// supabase-js client uses — verified live (2026-07-23) that it responds
// correctly to a chrome-extension:// origin since the function's CORS is
// wide open ("*"), same as the website's own frontend calls.
//
// The anon/publishable key below is a public, client-safe key (not a
// secret) — the same one already shipped in the website's own JS bundle.
export const SUPABASE_URL = "https://fmuaeuzxpxhqociziebs.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_mgY_wxt_HN-mnoq7PWV9TA_q-jWgdgG";
export const SITE_URL = "https://improve-my-ads.com";

export const PLATFORMS = [
  { value: "", label: "Not sure / other" },
  { value: "google", label: "Google Search" },
  { value: "meta", label: "Meta (Facebook / Instagram)" },
  { value: "tiktok", label: "TikTok / Reels" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "reddit", label: "Reddit" },
];

/**
 * @param {string} headline
 * @param {string} [platform]
 * @returns {Promise<{ok: true, data: {score:number, principle:string, diagnosis:string, fixes:string[]}} | {ok: false, error: string}>}
 */
export async function gradeHook(headline, platform) {
  const trimmed = (headline || "").trim();
  if (trimmed.length < 3 || trimmed.length > 300) {
    return { ok: false, error: "Paste a headline or opening line between 3 and 300 characters." };
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/grade-hook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ headline: trimmed, ...(platform ? { platform } : {}) }),
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok) {
      return { ok: false, error: (body && body.error) || "The grader is temporarily unavailable — try again in a moment." };
    }
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, error: "Couldn't reach the grader — check your connection and try again." };
  }
}

/**
 * Full-ad teaser: reads the ad's extracted copy (headline/primary text/
 * description) across 2 lenses instead of grading one line in isolation.
 * Backs the on-page ad detector (see content/ad-detector.js).
 * @param {string} text
 * @param {string} [platform]
 * @param {string} [sourceUrl]
 */
export async function previewAd(text, platform, sourceUrl) {
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
    if (!resp.ok) {
      return { ok: false, error: (body && body.error) || "The previewer is temporarily unavailable — try again in a moment." };
    }
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, error: "Couldn't reach the previewer — check your connection and try again." };
  }
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Maps a detected platform to the full-audit tool that actually accepts
 * typed/extracted text — mirrors the website's own tools.ad-hook-grader.tsx
 * PLATFORM_TO_SLUG map (Meta/TikTok/LinkedIn/YouTube require an image or
 * video upload for their dedicated tool, so a text-only extraction falls
 * back to the generic "any other ad" tool instead of an invalid state). */
const PLATFORM_TO_FULL_AUDIT_SLUG = {
  google: "google-ads-optimization",
  reddit: "reddit-ads-optimization",
};
const GENERIC_AUDIT_SLUG = "ads-optimization";

/** Builds a link to the /extension-handoff bridge route, carrying a full
 * ad's labeled text items (headline/primary text/description) through to
 * the matching full-audit tool page, prefilled. */
export function fullAuditHandoffUrl(items, platform) {
  const slug = PLATFORM_TO_FULL_AUDIT_SLUG[platform] || GENERIC_AUDIT_SLUG;
  const params = new URLSearchParams();
  params.set("slug", slug);
  params.set("items", toBase64Url(JSON.stringify(items)));
  if (platform) params.set("platform", platform);
  return `${SITE_URL}/extension-handoff?${params.toString()}`;
}

/** Builds a link to the website's free tool, prefilled with the graded hook
 * so a visitor can one-click continue into the full 6-lens audit there
 * (that handoff already exists site-side via IndexedDB and only works
 * same-origin, hence linking through the tool page rather than trying to
 * write the site's storage directly from the extension). */
export function fullToolUrl(headline, platform) {
  const params = new URLSearchParams();
  if (headline) params.set("h", headline);
  if (platform) params.set("p", platform);
  const qs = params.toString();
  return `${SITE_URL}/tools/ad-hook-grader${qs ? `?${qs}` : ""}`;
}

const HISTORY_KEY = "gradeHistory";
const MAX_HISTORY = 12;

/** @param {{headline:string, platform:string, score:number, principle:string, diagnosis:string, fixes:string[]}} entry */
export async function saveHistoryEntry(entry) {
  const { [HISTORY_KEY]: existing = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const next = [{ ...entry, ts: Date.now() }, ...existing].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

export async function getHistory() {
  const { [HISTORY_KEY]: existing = [] } = await chrome.storage.local.get(HISTORY_KEY);
  return existing;
}

export async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}
