# Chrome Web Store listing copy

Paste these into the Developer Dashboard when submitting. Nothing here is published automatically —
submission itself is a manual step (requires a one-time $5 Chrome Web Store developer registration
fee and review, both human/account actions). Organized below by the Dashboard's own tabs, in the
order the fields actually appear, based on the real dashboard screens.

## Tab: Store listing

**Title / Summary** — shown as **"Title from package"** / **"Summary from package"**, read-only
mirrors of `manifest.json`'s `name` and `description`. There is no separate field to type a
different title/summary into — edit `manifest.json` directly, not this file. Current values (keep
in sync):
```
Google Ads Grader — Free Headline & Ad Copy Checker
```
```
Grade Google Ads headlines & ad copy instantly for query intent, CTAs, and extensions — free, no sign-in.
```

**Description\*** (the long free-text box — replace what's currently pasted with this):
```
Instantly grade your Google Ads headlines and ad copy — without leaving the page.

Improve My Ads' Google Ads Grader scores any headline or ad copy 0-100 against real Google Ads
performance factors: does it match likely search-query intent, is the value proposition
immediate, is the CTA action-oriented, does it avoid the generic filler that quietly tanks
Quality Score. Not a grammar checker or a generic SEO tool in disguise — built specifically for
Google Ads copy.

FREE, NO SIGN-IN
Every feature below works with zero account and zero credit card. Rate-limited to a handful of
checks per hour — just enough to keep it sustainable.

RIGHT-CLICK ANY HEADLINE OR AD COPY, ANYWHERE
Select any text — a competitor's ad, your own draft headline or description, a landing page
hero — on any website. Right-click, choose "Check this Google ad," and a card appears instantly
with your score, the Google Ads factor at play, and three rewritten alternatives you can copy in
one click.

AUTOMATIC AD DETECTION ON GOOGLE SEARCH
On Google Search results, a "Grade this ad" button appears directly on ads the extension
recognizes — no selecting required. One click previews the ad's real headline, description,
advertiser, and sitelinks/callouts across multiple angles: query relevance, extensions usage,
copywriting, and offer clarity. Findings are never padded to hit a quota — a strong ad gets fewer
notes, or none. This is best-effort detection; if it ever misses an ad, the right-click flow
above always works as a fallback.

TOOLBAR POPUP
Click the icon anytime for a quick reminder of how the extension works, plus a one-click shortcut
into the full audit tool.

GO DEEPER WHEN YOU WANT TO
Every result links straight into Improve My Ads' full Google Ads audit — behavioral psychology,
platform & media buying, copywriting, offer, visual design, and conversion/CRO — with your ad
copy carried over automatically, so there's nothing to retype.

PRIVACY, PLAIN AND SIMPLE
A right-click check sends only the exact text you select. Auto-detection scans locally on Google
Search and sends nothing unless you click the button. On every other site, the extension doesn't
read the page at all. Full policy: https://improve-my-ads.com/privacy

Built by Improve My Ads (https://improve-my-ads.com) — a behavioral-science ad audit tool.
```

**Category\*** — dashboard currently shows **"Communication"**, which doesn't fit; change it.
Pick the closest match available in the actual dropdown, in this priority order: `Productivity` >
`Tools` / `Developer Tools` > `Marketing`. (The exact category list wasn't visible in the
screenshots — open the dropdown and match against this priority list.)

**Language\*** — English. Already correct, no change needed.

**Graphic assets**:
- Store icon (128x128) — auto-pulled from `manifest.json`, already correct.
- Global promo video — optional, skip.
- Screenshots (1280x800, up to 5) — already uploaded (5 present in the dashboard).
- Small promo tile (440x280) / Marquee (1400x560) — optional, improve click-through from
  search/category browsing but not required to submit. Skip unless you want to invest in these.

**Additional fields**:
- Official URL — already set to `https://improve-my-ads.com/`.
- Homepage URL — already set to `https://improve-my-ads.com/extension`.
- Support URL — optional. Leave blank, or add a contact/support page URL if one exists.
- Mature content — off (correct, leave as-is).

## Tab: Privacy

This tab is the one most likely to block submission — every field below is required (\*) except
where noted, and the dashboard already warns that the `host_permissions` entry may trigger a
slower, in-depth review. That's expected for any extension that talks to a network endpoint at
all, not a sign something's wrong.

**Single purpose description\*** (≤1000 chars):
```
Grade Google Ads headlines and ad copy against real Google Ads performance factors — query-intent
match, CTA strength, extensions/social proof, offer clarity — either from text the user selects
and right-clicks anywhere on the web, or from ads the extension automatically recognizes on
Google Search results pages. Every feature in the extension serves this one purpose: helping
advertisers and marketers improve Google Ads copy before or after it runs.
```

**contextMenus justification\*** (≤1000 chars):
```
Adds a single right-click context menu item, "Check this Google ad," that appears only when the
user has selected text on a page. Clicking it sends that selected text to our grading API and
shows the score inline via an injected card. This is the extension's primary, user-initiated
entry point for grading ad copy on any website, not just Google Search.
```

**scripting justification\*** (≤1000 chars):
```
Used together with activeTab to inject a small floating result/loading card into the active tab
immediately after a user-initiated action — either the right-click "Check this Google ad" menu
item, or clicking the in-page "Grade this ad" button on a detected Google Search ad. No script is
injected proactively, in the background, or into any tab the user hasn't just acted on.
```

**activeTab justification\*** (≤1000 chars):
```
Grants temporary access to the current tab only after the user explicitly invokes the right-click
"Check this Google ad" menu item on selected text. Used solely to inject the small result card
showing the grading score into that same tab. No tab is accessed before or without that direct
user gesture.
```

**Host permission justification\*** (`fmuaeuzxpxhqociziebs.supabase.co`, ≤1000 chars):
```
This is the only network endpoint the extension ever contacts: our own dedicated Supabase Edge
Functions backend (grade-google-ad / preview-google-ad) that powers the grading feature. It
receives only the ad text submitted for grading and returns a score plus findings as JSON — no
other host is contacted, and no third-party analytics or tracking scripts are loaded anywhere in
the extension.
```

**Are you using remote code?** — select **"No, I am not using remote code."** All JS ships inside
the extension package; the only network calls are POST requests to the Supabase host above, which
return JSON data (score/findings) — never executable script — and nothing is loaded via
`<script src>`, dynamic `import()`, or `eval()`. (No justification field needed once "No" is
selected.)

**Data usage — check exactly one box: "Website content."** The extension reads and submits the
visible text of an ad (headline, description, advertiser name, sitelinks) or user-selected text to
the grading API — that's "Website content" (text/images/hyperlinks). Leave every other category
unchecked (no PII, health, financial, auth, personal comms, location, web history, or user
activity is ever collected).

**Certifications — check all three** (all true for this extension):
- I do not sell or transfer user data to third parties, apart from the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy Policy URL** — already set to `https://improve-my-ads.com/privacy`, correct.

## Tab: Distribution

All already correct as shown in the dashboard — no changes needed:
- Payments: **Free of charge**.
- Visibility: **Public**.
- Distribution: **All regions** (all countries checked).

## Tab: Access → Test instructions

No login or account exists anywhere in this extension, so:
- Credentials (Username / Password) — leave both blank.
- Additional instructions — optional, but worth a one-liner so reviewers don't wonder if
  something's missing:
```
No account or login required. Every feature — right-click "Check this Google ad" on selected
text, and the automatic "Grade this ad" button on Google Search results — works immediately after
installation with zero sign-in.
```

## After publishing

Once the listing is live, copy its real `https://chromewebstore.google.com/detail/...` URL into:
- `improve-my-ads-extension/manifest.json` → not needed (homepage_url already points at the
  website, which is the actual backlink direction that matters for DR).
- `improve-my-ads/src/routes/extension.tsx` → set `CHROME_STORE_URL` (currently `null`, which
  shows a "Coming soon" badge instead of a broken/fake "Add to Chrome" button).
