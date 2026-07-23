# Google Ads Grader — Chrome Extension

Free companion extension to [improve-my-ads.com](https://improve-my-ads.com). Grades Google Ads
headlines against real Google Ads factors — query-intent match, extensions, CTA strength — and
previews sample findings on Google Search ads it detects automatically while you browse.

## Features

- **Right-click, anywhere**: select any text on any page → "Check this Google ad" → a score, the
  Google Ads factor at play, and three rewritten alternatives, shown right on the page.
- **Toolbar popup**: paste a headline manually, revisit your last 12 checks (stored locally only).
- **On-page ad detection (Google Search only)**: a best-effort heuristic scanner adds a "Grade
  this ad" button directly on Google Search ads it recognizes, pulling a free 2-finding preview
  across different lenses (behavioral psychology, platform & media buying, copywriting, offer,
  etc.) from the ad's own extracted text (headline, description, advertiser, sitelinks/callouts)
  — no screenshotting, no manual selection needed.
- **Full-report handoff**: any result links straight into improve-my-ads.com's full Google Ads
  audit, with the ad's text prefilled via `/extension-handoff` → `/audit/google-ads-optimization`.

## Architecture

- `manifest.json` — Manifest V3. Permissions: `contextMenus`, `storage`, `scripting`, `activeTab`;
  `host_permissions` scoped to the Supabase functions domain only. `content_scripts.matches` is
  Google Search results pages only (across locales) — this extension is deliberately single-site
  now, not a generic multi-platform ad grader.
- `lib/api.js` — shared client for this extension's own dedicated `grade-google-ad` /
  `preview-google-ad` edge functions (separate from the website's generic `grade-hook` — see
  Backend below).
- `background/service-worker.js` — context menu registration + injected result card for the
  right-click flow.
- `content/ad-detector.js` — Google Search heuristic ad detection (see file header for the
  specific markers relied on, and the "best-effort, may need updates" caveat — Google doesn't
  expose a stable public "this is an ad" signal).
- `popup/` — toolbar popup UI + local check history.
- `welcome/welcome.html` — opened once on install.

## Backend

Two Supabase edge functions in the main `improve-my-ads` repo back this extension, both dedicated
to this extension and Google-only (separate from `grade-hook`, which backs the website's own
generic, multi-platform `/tools/ad-hook-grader` and is untouched by this):

- `grade-google-ad` — grades a single Google Ads headline against real Google Ads factors
  (query-intent match, extensions-as-social-proof, action-oriented CTAs, cost-of-inaction
  framing, CTR calibration) — the same vocabulary as the `google-ads-optimization` audit type's
  own system prompt.
- `preview-google-ad` — multi-field Google ad teaser (headline/description/advertiser/callouts),
  2 capped findings, using the same Google-specific criteria.

Both need `supabase functions deploy grade-google-ad preview-google-ad` before they're live (no
linked CLI session available when this was written — same recurring blocker as every prior change
in this project).

The website also has `/extension`, `/privacy`, and `/extension-handoff` routes in the
`improve-my-ads` repo.

## Local development

Load unpacked: `chrome://extensions` → Developer mode → "Load unpacked" → select this folder.

## Tests

```
npm install
npm test
```

Covers `lib/api.js`'s pure logic: request validation, URL building (including the base64url items
encoding used by the full-audit handoff), and the local history store. `lib/dom-extract.js`'s
Google ad extraction logic is separately unit-tested in `tests/dom-extract.test.js`. The injected-
card rendering in `background/service-worker.js` and the live DOM scanning in
`content/ad-detector.js` are not unit-tested (they need a real page/DOM to verify meaningfully) —
reload-and-click-through in `chrome://extensions` is the practical way to check those.

## Store listing

See `STORE_LISTING.md` for the Chrome Web Store submission copy (title, summary, description,
category, privacy justification).
