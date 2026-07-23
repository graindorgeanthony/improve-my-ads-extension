# Chrome Web Store listing copy

Paste these into the Developer Dashboard when submitting. Nothing here is published automatically —
submission itself is a manual step (requires a one-time $5 Chrome Web Store developer registration
fee and review, both human/account actions).

## Title (max 75 chars)

```
Ad Hook Grader — Free Ad Headline & Copy Checker
```

## Summary / short description (max 132 chars)

```
Grade any ad headline for scroll-stop psychology. Right-click any ad or text — free, no sign-in. By Improve My Ads.
```

## Category

Productivity (secondary fit: Business tools / Marketing)

## Full description

```
Grade any ad headline or hook for scroll-stop psychology — instantly, without leaving the page.

Improve My Ads' Ad Hook Grader scores a headline or opening line 0-100 on whether it would
actually stop a scrolling stranger, using real behavioral-psychology principles (Loss Aversion,
Specificity, Pattern Interrupt, Curiosity Gap) — not grammar or SEO checkers in disguise.

FREE, NO SIGN-IN
Every feature below works with zero account, zero credit card. Rate-limited (a handful of grades
per hour) to keep it sustainable, nothing more.

RIGHT-CLICK ANY TEXT, ANYWHERE
Select a headline — a competitor's ad, your own draft copy, a landing page hero — on any website,
right-click, and choose "Grade this ad hook." A card appears right there with your score, the
behavioral principle at play, and three rewritten alternatives you can copy in one click.

AUTOMATIC AD DETECTION ON FACEBOOK, LINKEDIN, GOOGLE SEARCH, YOUTUBE, REDDIT, AND TIKTOK
On these sites, a small "Grade this ad" button appears directly on ads the extension
recognizes — no selecting required. Click it for a free preview: two sample findings pulled from
the ad's own real text, across different angles (behavioral psychology, copywriting, offer
clarity, and more). This is best-effort heuristic detection — it may occasionally miss an ad,
and the manual right-click flow above always works as a fallback everywhere else.

TOOLBAR POPUP
Click the icon any time to grade a hook manually, pick a platform (Google, Meta, TikTok,
LinkedIn, YouTube, Reddit) for sharper calibration, and revisit your last 12 grades — stored only
on your device, never uploaded.

GO DEEPER WHEN YOU WANT TO
Every result links straight into Improve My Ads' full 6-lens audit (behavioral psychology,
platform & media buying, copywriting, offer, visual design, conversion/CRO) — your ad's text
carries over automatically, so you're not retyping anything.

PRIVACY, PLAIN AND SIMPLE
Manual grading sends only the exact text you select or paste. The auto-detection scans
locally and sends nothing unless you click the button. On every other site, the extension does
not read the page at all. Full policy: https://improve-my-ads.com/privacy

Built by Improve My Ads (https://improve-my-ads.com), a behavioral-science ad audit tool.
```

## Privacy practices tab (single purpose + justifications)

**Single purpose**: Grade ad headlines and ad copy for behavioral/scroll-stop effectiveness,
either from user-selected text or from ads automatically recognized on a small set of named ad
platforms.

**Permission justifications**:
- `contextMenus` — adds the "Grade this ad hook" right-click menu item.
- `storage` — stores the user's recent grading history locally (`chrome.storage.local`); never
  synced or uploaded.
- `scripting` + `activeTab` — injects the floating result card into the active tab after a
  context-menu grade action (a user gesture), and nothing else.
- `host_permissions` (`fmuaeuzxpxhqociziebs.supabase.co`) — the only network endpoint the
  extension talks to: the same public grading API improve-my-ads.com's own website uses.

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

- Store icon: `icons/icon128.png` (already generated, brand monogram — consider a more
  distinctive/illustrated icon before launch if the letter-mark feels too plain at scale).
- Screenshots (1280x800 or 640x400, at least 1, up to 5): real screenshots of the popup with a
  graded result, and the on-page result card on a real site — capture these directly from
  `chrome://extensions` → "Load unpacked" once you've clicked through the flows yourself; not
  something generatable without a live browser session.
- Small promo tile (440x280) and marquee (1400x560): optional but improve click-through from
  Chrome Web Store search/category browsing.

## After publishing

Once the listing is live, copy its real `https://chromewebstore.google.com/detail/...` URL into:
- `improve-my-ads-extension/manifest.json` → not needed (homepage_url already points at the
  website, which is the actual backlink direction that matters for DR).
- `improve-my-ads/src/routes/extension.tsx` → set `CHROME_STORE_URL` (currently `null`, which
  shows a "Coming soon" badge instead of a broken/fake "Add to Chrome" button).
