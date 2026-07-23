# Chrome Web Store listing copy

Paste these into the Developer Dashboard when submitting. Nothing here is published automatically —
submission itself is a manual step (requires a one-time $5 Chrome Web Store developer registration
fee and review, both human/account actions).

## Title (max 75 chars)

```
Google Ads Grader — Free Headline & Ad Copy Checker
```

## Summary / short description (max 132 chars)

```
Grade any Google Ads headline against real Google Ads factors. Right-click any ad or text — free, no sign-in. By Improve My Ads.
```

## Category

Productivity (secondary fit: Business tools / Marketing)

## Full description

```
Grade any Google Ads headline instantly — without leaving the page.

Improve My Ads' Google Ads Grader scores a headline 0-100 against real Google Ads factors: does
it mirror likely search-query intent, is the value proposition immediate, is the CTA
action-oriented, does it avoid generic filler that tanks Quality Score — not grammar or SEO
checkers in disguise.

FREE, NO SIGN-IN
Every feature below works with zero account, zero credit card. Rate-limited (a handful of checks
per hour) to keep it sustainable, nothing more.

RIGHT-CLICK ANY TEXT, ANYWHERE
Select a headline — a competitor's ad, your own draft copy, a landing page hero — on any website,
right-click, and choose "Check this Google ad." A card appears right there with your score, the
Google Ads factor at play, and three rewritten alternatives you can copy in one click.

AUTOMATIC AD DETECTION ON GOOGLE SEARCH
On Google Search results pages, a small "Grade this ad" button appears directly on ads the
extension recognizes — no selecting required. Click it for a free preview: up to two sample
findings pulled from the ad's own real text (headline, description, advertiser, sitelinks/
callouts), across different angles (query relevance, extensions usage, copywriting, offer
clarity, and more) — fewer, or none, if the ad is already solid; findings are never padded to
hit a quota. This is best-effort heuristic detection — it may occasionally miss an ad, and the
manual right-click flow above always works as a fallback everywhere else.

TOOLBAR POPUP
Click the icon any time for a quick reminder of how the extension works, and a one-click shortcut
into the full audit tool.

GO DEEPER WHEN YOU WANT TO
Every result links straight into Improve My Ads' full Google Ads audit (behavioral psychology,
platform & media buying, copywriting, offer, visual design, conversion/CRO) — your ad's text
carries over automatically, so you're not retyping anything.

PRIVACY, PLAIN AND SIMPLE
A right-click check sends only the exact text you select. The auto-detection scans locally on
Google Search and sends nothing unless you click the button. On every other site, the extension
does not read the page at all. Full policy: https://improve-my-ads.com/privacy

Built by Improve My Ads (https://improve-my-ads.com), a behavioral-science ad audit tool.
```

## Privacy practices tab (single purpose + justifications)

**Single purpose**: Grade Google Ads headlines and ad copy for real Google Ads performance
factors, either from user-selected text anywhere on the web, or from ads automatically recognized
on Google Search results pages.

**Permission justifications**:
- `contextMenus` — adds the "Check this Google ad" right-click menu item.
- `scripting` + `activeTab` — injects the floating result card into the active tab after a
  context-menu check action (a user gesture), and nothing else.
- `host_permissions` (`fmuaeuzxpxhqociziebs.supabase.co`) — the only network endpoint the
  extension talks to: its own dedicated Google Ads grading API.

**Remote code**: none. All JS ships in the extension package; the only network calls are JSON
requests to the declared Supabase functions host.

**Data usage disclosure**: the extension does not sell or share user data with third parties; ad
text submitted for grading is processed by an AI model (via OpenRouter) to generate the score/
findings and is not used to train any model, per the linked privacy policy.

## Privacy policy URL

```
https://improve-my-ads.com/privacy
```

## Homepage URL (the actual backlink target)

```
https://improve-my-ads.com/extension
```

## Icons / screenshots needed before submission

- Store icon: `icons/icon128.png` (already generated — matches the site's own favicon).
- Screenshots (1280x800 or 640x400, at least 1, up to 5): real screenshots of the on-page result
  card on a real Google Search results page, and the right-click result card — capture these
  directly from `chrome://extensions` → "Load unpacked" once you've clicked through the flows
  yourself; not something generatable without a live browser session.
- Small promo tile (440x280) and marquee (1400x560): optional but improve click-through from
  Chrome Web Store search/category browsing.

## After publishing

Once the listing is live, copy its real `https://chromewebstore.google.com/detail/...` URL into:
- `improve-my-ads-extension/manifest.json` → not needed (homepage_url already points at the
  website, which is the actual backlink direction that matters for DR).
- `improve-my-ads/src/routes/extension.tsx` → set `CHROME_STORE_URL` (currently `null`, which
  shows a "Coming soon" badge instead of a broken/fake "Add to Chrome" button).
