// Shared client for the "Google Ads Grader" extension's own dedicated
// edge functions (grade-google-ad / preview-google-ad) — deliberately
// separate from grade-hook/preview-ad, which back the website's own
// generic, multi-platform /tools/ad-hook-grader and stay unrelated to this
// extension's single-purpose Google Ads scope. Same anon key, same
// CORS-open pattern verified live for the extension origin previously.
//
// The anon/publishable key below is a public, client-safe key (not a
// secret) — the same one already shipped in the website's own JS bundle.
export const SUPABASE_URL = "https://fmuaeuzxpxhqociziebs.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_mgY_wxt_HN-mnoq7PWV9TA_q-jWgdgG";
export const SITE_URL = "https://improve-my-ads.com";

/**
 * Grades a single Google Ads headline against real Google Ads factors
 * (query-intent match, extensions/social proof, CTA strength, cost-of-
 * inaction framing) — used by the right-click flow (background/
 * service-worker.js). The popup is a static explainer with no form of its
 * own; it doesn't call this.
 * @param {string} headline
 * @returns {Promise<{ok: true, data: {score:number, principle:string, diagnosis:string, fixes:string[]}} | {ok: false, error: string}>}
 */
export async function gradeGoogleAd(headline) {
  const trimmed = (headline || "").trim();
  if (trimmed.length < 3 || trimmed.length > 300) {
    return { ok: false, error: "Paste a headline between 3 and 300 characters." };
  }
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/grade-google-ad`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ headline: trimmed }),
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
 * Full-ad teaser: reads a real extracted Google ad's copy (headline,
 * description, advertiser, callouts/sitelinks — whatever the page
 * exposed) across 2 lenses instead of grading one line in isolation. Also
 * returns a holistic 0-100 score, but from this single lightweight call —
 * NOT the same pipeline as the full paid audit's 6-lens + synthesis score
 * (see run-audit), so the two can legitimately disagree. The UI must
 * present this as an estimate, never as equivalent to the full audit's score.
 * Backs the on-page ad detector (see content/ad-detector.js).
 * @param {string} text
 * @param {string} [sourceUrl]
 * @returns {Promise<{ok: true, data: {score?: number, findings: {lens:string, issue:string, recommendation:string}[], remaining?: number, limit?: number}} | {ok: false, error: string}>}
 */
export async function previewGoogleAd(text, sourceUrl) {
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

/** Builds a link to the /extension-handoff bridge route, carrying a Google
 * ad's labeled text items (headline/description/advertiser/callouts)
 * through to the full Google Ads audit tool, prefilled. Always targets
 * google-ads-optimization — the extension is Google-only now, so there's
 * no platform branching left to do. */
export function fullAuditHandoffUrl(items) {
  const params = new URLSearchParams();
  params.set("slug", "google-ads-optimization");
  params.set("items", toBase64Url(JSON.stringify(items)));
  params.set("platform", "google");
  return `${SITE_URL}/extension-handoff?${params.toString()}`;
}
