# Ad Hook Grader — Chrome Extension

Free companion extension to [improve-my-ads.com](https://improve-my-ads.com). Grades any ad
headline or hook 0-100 on scroll-stop psychology, and previews sample findings on ads it
detects automatically while you browse.

## Features

- **Right-click, anywhere**: select any text on any page → "Grade this ad hook" → a score,
  the behavioral principle at play, and three rewritten alternatives, shown right on the page.
- **Toolbar popup**: paste a hook manually, pick a platform for sharper calibration, revisit
  your last 12 grades (stored locally only).
- **On-page ad detection** (Facebook, LinkedIn, Google Search, YouTube, Reddit, TikTok): a best-effort heuristic
  scanner adds a "Grade this ad" button directly on ads it recognizes, pulling a free 2-finding
  preview across different lenses (behavioral psychology, copywriting, offer, etc.) from the
  ad's own extracted text — no screenshotting, no manual selection needed on these sites.
- **Full-report handoff**: any result links straight into improve-my-ads.com's full 6-lens audit,
  with the ad's text prefilled via `/extension-handoff` → `/audit/$slug`.

## Architecture

- `manifest.json` — Manifest V3. Permissions: `contextMenus`, `storage`, `scripting`, `activeTab`;
  `host_permissions` scoped to the Supabase functions domain only.
- `lib/api.js` — shared client for the same public `grade-hook` / `preview-ad` edge functions the
  website itself uses (same anon key, same CORS-open endpoints — verified live).
- `background/service-worker.js` — context menu registration + injected result card for the
  right-click flow.
- `content/ad-detector.js` — per-site heuristic ad detection (see file header for the specific
  markers relied on per platform, and the "best-effort, may need updates" caveat — none of these
  platforms expose a stable public "this is an ad" signal).
- `popup/` — toolbar popup UI + local grading history.
- `welcome/welcome.html` — opened once on install.

## Backend

Two Supabase edge functions in the main `improve-my-ads` repo back this extension:

- `grade-hook` (already live) — single-hook grading.
- `preview-ad` (added alongside this extension) — multi-field ad-copy teaser, 2 capped findings.
  Needs `supabase db push` (migration `20260723120000_ad_previews.sql`) and a function deploy
  before it's live.

The website also gained `/extension`, `/privacy`, and `/extension-handoff` routes, plus optional
`?h=`/`?p=` prefill params on `/tools/ad-hook-grader` — all in the `improve-my-ads` repo.

## Local development

Load unpacked: `chrome://extensions` → Developer mode → "Load unpacked" → select this folder.

## Tests

```
npm install
npm test
```

Covers `lib/api.js`'s pure logic: request validation, URL building (including the base64url
items encoding used by the full-audit handoff), and the local history store. The per-site DOM
heuristics in `content/ad-detector.js` and the injected-card rendering in
`background/service-worker.js` are not unit-tested (they need a real page/DOM per platform to
verify meaningfully) — reload-and-click-through in `chrome://extensions` is the practical way to
check those.

## Store listing

See `STORE_LISTING.md` for the Chrome Web Store submission copy (title, summary, description,
category, privacy justification).
