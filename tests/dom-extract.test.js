// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  cleanText,
  extractGenericAdText,
  extractGoogleAdText,
  extractRealDestinationUrl,
  findLeafTextElements,
  climbToContainer,
} from "../lib/dom-extract.js";

function setBody(html) {
  document.body.innerHTML = html;
}

describe("cleanText", () => {
  it("collapses whitespace and trims", () => {
    expect(cleanText("  hello   \n world  ")).toBe("hello world");
  });
  it("handles null/undefined", () => {
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
  });
});

describe("extractGenericAdText", () => {
  it("extracts headline and description from a Google-style grouped 'Sponsored results' card (2026-07-23 markup, no per-item Ad badge)", () => {
    setBody(`
      <div id="container">
        <div>
          <span>Capterra</span>
          <span>https://www.capterra.com › human-resource › free-list</span>
          <button data-ima-button="1">Grade this ad</button>
        </div>
        <a href="https://capterra.com/x">Free List of the Top Products</a>
        <div>Consolidated List of Solutions — Find the Best Human Resource Software That Will Help You Do, What You Do, Better.</div>
      </div>
    `);
    const container = document.getElementById("container");
    const items = extractGenericAdText(container);
    expect(items).toEqual([
      { label: "Headline", body: "Free List of the Top Products" },
      {
        label: "Description",
        body: "Consolidated List of Solutions — Find the Best Human Resource Software That Will Help You Do, What You Do, Better.",
      },
    ]);
  });

  it("never leaks the injected 'Grade this ad' button text into the extracted items", () => {
    setBody(`
      <div id="container">
        <button data-ima-button="1">Grade this ad</button>
        <a href="#">A perfectly good headline right here</a>
        <div>A perfectly good description that is definitely long enough to qualify as one.</div>
      </div>
    `);
    const items = extractGenericAdText(document.getElementById("container"));
    const bodies = items.map((i) => i.body);
    expect(bodies.join(" ")).not.toMatch(/Grade this ad/);
  });

  it("excludes breadcrumb-looking text (contains '›' or is a bare URL)", () => {
    setBody(`
      <div id="container">
        <span>https://www.example.com › a › b</span>
        <a href="https://example.com">https://example.com</a>
        <a href="#">Real headline text goes here</a>
        <div>A real description block that is long enough to be picked up by the heuristic.</div>
      </div>
    `);
    const items = extractGenericAdText(document.getElementById("container"));
    expect(items.find((i) => i.label === "Headline")?.body).toBe("Real headline text goes here");
    expect(items.some((i) => i.body.includes("›"))).toBe(false);
  });

  it("returns an empty array when there's nothing substantial to extract", () => {
    setBody(`<div id="container"><span>Hi</span></div>`);
    expect(extractGenericAdText(document.getElementById("container"))).toEqual([]);
  });
});

// Builds markup faithful to the real live DOM a user pasted in full
// (2026-07-23): the headline anchor wraps a role="heading" div PLUS an
// advertiser-info div (name + bare-URL breadcrumb) as its two direct
// children — the real source of the concatenation bug, since a naive
// "whole anchor textContent" read glues all three together with no
// separator. The anchor's href is a google.com/aclk redirect with the real
// destination double-encoded in its own "adurl" param. Each sitelink/
// callout anchor wraps ITS OWN title + description as two direct children
// too (not as a separate element pair) — the real reason the previous
// callout detection (filtering by whole-anchor text length) found nothing.
function buildRealisticGoogleAdHtml({ calloutCount = 5 } = {}) {
  const adurl =
    "https://productfruits.com/lp/user-onboarding-2?utm_term%3Dproduct%2520adoption%2520saas%26utm_campaign%3DEurope%26gclid%3Dabc123";
  const sitelinkDefs = [
    ["Fair pricing", "Find a plan that works for you Unbeatable price-value ratio", "https://productfruits.com/pricing"],
    ["Product adoption", "Spotlight new releases in-app Drive adoption of unused features", "https://productfruits.com/use-cases/feature-adoption"],
    ["No-Code App Onboarding Screens", "Boost conversions and retention with AI-powered onboarding that keeps users engaged.", "https://productfruits.com/lp/user-onboarding-2"],
    ["User onboarding", "Guide new users to their first win Turn signups into active users", "https://productfruits.com/use-cases/user-onboarding"],
    ["Trial conversion", "Turn trials into paying customers Stop losing trials to inaction", "https://productfruits.com/use-cases/trial-conversion"],
    ["Extra sixth sitelink", "This one should be dropped by the cap.", "https://productfruits.com/extra"],
  ].slice(0, calloutCount);

  const sitelinksHtml = sitelinkDefs
    .map(
      ([title, desc, href]) =>
        `<div class="iCzAIb"><div class="hiPqL"><a class="aphJLc" href="${href}">` +
        `<div class="aFn4tc">${title}</div><div class="wHYlTd">${desc}</div>` +
        `</a></div></div>`,
    )
    .join("");

  return (
    '<div id="container" data-text-ad="1">' +
    `<a class="sVXRqc" href="https://www.google.com/aclk?sa=L&amp;gclid=abc123&amp;adurl=${adurl}">` +
    '<div class="CCgQ5" aria-level="3" role="heading"><span>Product Adoption SaaS</span></div>' +
    '<div class="d8lRkd"><span class="OSrXXb">Product Fruits</span><span class="x2VHCd OSrXXb" role="text">https://www.productfruits.com</span></div>' +
    "</a>" +
    '<div class="Ktlw8e">' +
    '<div class="Va3FIb"><div class="p4wth"><span>#1 <em>SaaS</em> Onboarding Platform — Stop losing users! Fix poor onboarding &amp; retention with the #1 product onboarding tool. Get the...</span></div></div>' +
    sitelinksHtml +
    "</div>" +
    "</div>"
  );
}

describe("extractGoogleAdText", () => {
  it("does not contaminate the headline with the advertiser name + URL glued into the same anchor (real bug, 2026-07-23 live report)", () => {
    // The live report's wrong headline was literally
    // "Product Adoption SaaSProduct Fruitshttps://www.productfruits.com".
    setBody(buildRealisticGoogleAdHtml());
    const { items } = extractGoogleAdText(document.getElementById("container"));
    const headline = items.find((i) => i.label === "Headline");
    expect(headline?.body).toBe("Product Adoption SaaS");
    expect(headline?.body).not.toMatch(/productfruits\.com/);
    expect(headline?.body).not.toMatch(/Product Fruits/);
  });

  it("decodes the real, fully UTM-tagged destination URL from the adurl= redirect param, as landingPage (not a generic item)", () => {
    setBody(buildRealisticGoogleAdHtml());
    const { items, landingPage } = extractGoogleAdText(document.getElementById("container"));
    expect(landingPage).toBe(
      "https://productfruits.com/lp/user-onboarding-2?utm_term=product%20adoption%20saas&utm_campaign=Europe&gclid=abc123",
    );
    expect(items.some((i) => i.label === "Landing page")).toBe(false);
  });

  it("falls back to the visible URL breadcrumb text as landingPage when there's no anchor href at all", () => {
    setBody(
      '<div id="container">' +
        '<div role="heading">Product Adoption SaaS</div>' +
        "<span>https://www.productfruits.com</span>" +
        "<div>#1 SaaS Onboarding Platform for growing teams everywhere.</div>" +
        "</div>",
    );
    const { landingPage } = extractGoogleAdText(document.getElementById("container"));
    expect(landingPage).toBe("https://www.productfruits.com");
  });

  it("picks the ad's own description over a shorter sitelink description, even with inline formatting (<em>)", () => {
    setBody(buildRealisticGoogleAdHtml());
    const { items } = extractGoogleAdText(document.getElementById("container"));
    const description = items.find((i) => i.label === "Description");
    expect(description?.body).toMatch(/^#1 SaaS Onboarding Platform/);
    expect(description?.body).not.toMatch(/Boost conversions/);
  });

  it("extracts sitelink/callout title+description pairs from anchors that wrap BOTH as direct children, capped at 5", () => {
    setBody(buildRealisticGoogleAdHtml({ calloutCount: 6 }));
    const { items } = extractGoogleAdText(document.getElementById("container"));
    const callouts = items.filter((i) => i.label.startsWith("Callout"));
    expect(callouts).toHaveLength(5);
    expect(callouts[0].body).toBe("Fair pricing: Find a plan that works for you Unbeatable price-value ratio");
    expect(callouts[2].body).toBe(
      "No-Code App Onboarding Screens: Boost conversions and retention with AI-powered onboarding that keeps users engaged.",
    );
    expect(callouts.some((c) => c.body.includes("Extra sixth sitelink"))).toBe(false);
  });

  it("does not mistake the headline's own anchor (heading + advertiser info, also 2 children) for a callout", () => {
    setBody(buildRealisticGoogleAdHtml({ calloutCount: 0 }));
    const { items } = extractGoogleAdText(document.getElementById("container"));
    const callouts = items.filter((i) => i.label.startsWith("Callout"));
    expect(callouts).toHaveLength(0);
  });

  it("never leaks the injected 'Grade this ad' button text into any extracted item", () => {
    const html = buildRealisticGoogleAdHtml().replace(
      "</div></div>",
      '</div></div><button data-ima-button="1">Grade this ad</button>',
    );
    setBody(html);
    const { items } = extractGoogleAdText(document.getElementById("container"));
    expect(items.some((i) => i.body.includes("Grade this ad"))).toBe(false);
  });

  it("returns an empty items array and empty landingPage when the container has nothing recognizable", () => {
    setBody(`<div id="container"><span>Hi</span></div>`);
    expect(extractGoogleAdText(document.getElementById("container"))).toEqual({ items: [], landingPage: "" });
  });

  it("detects compact inline-link callouts (leaf anchors, no per-item description) — a second real ad ('SaaS Growth Playbook', 2026-07-23) used this shape instead of boxed sitelinks", () => {
    setBody(
      '<div id="container" data-text-ad="1">' +
        '<a class="sVXRqc" href="https://info.revenera.com/SWM-WP-SaaS-Growth-Playbook?lead_source=Organic%20Search">' +
        '<div role="heading"><span>SaaS Growth Playbook</span></div>' +
        '<div class="d8lRkd"><span>Revenera</span><span>https://info.revenera.com › saas › playbook</span></div>' +
        "</a>" +
        '<div class="p4wth"><span><em>SaaS</em> Pricing Models — Allow your <em>SaaS</em> business to thrive. This playbook is your guide to making smart product decisions that fuel revenue.</span></div>' +
        '<div class="qmaLCb"><div class="dcuivd">' +
        '<a href="https://info.revenera.com/pricing">SaaS Pricing</a> · ' +
        '<a href="https://info.revenera.com/download">Download Your SaaS Playbook</a> · ' +
        '<a href="https://info.revenera.com/cfo-ebook">Download The CFO’s eBook</a>' +
        "</div></div>" +
        "</div>",
    );
    const { items, landingPage } = extractGoogleAdText(document.getElementById("container"));

    expect(items.find((i) => i.label === "Headline")?.body).toBe("SaaS Growth Playbook");
    expect(landingPage).toBe("https://info.revenera.com/SWM-WP-SaaS-Growth-Playbook?lead_source=Organic%20Search");

    const description = items.find((i) => i.label === "Description");
    expect(description?.body).toMatch(/^SaaS Pricing Models/);
    expect(description?.body).not.toMatch(/Download Your SaaS Playbook/);

    const callouts = items.filter((i) => i.label.startsWith("Callout"));
    expect(callouts.map((c) => c.body)).toEqual(["SaaS Pricing", "Download Your SaaS Playbook", "Download The CFO’s eBook"]);
  });

  it("mixes boxed callouts and compact inline-link callouts in the same ad, filling remaining slots up to 5", () => {
    setBody(
      '<div id="container" data-text-ad="1">' +
        '<a class="sVXRqc" href="https://example.com/lp">' +
        '<div role="heading"><span>Headline Text</span></div>' +
        "<div><span>Advertiser</span><span>https://example.com</span></div>" +
        "</a>" +
        "<div>A real description block that is long enough to be picked up by the heuristic here.</div>" +
        '<div class="iCzAIb"><a href="https://example.com/a"><div>Boxed callout</div><div>Boxed callout description text here</div></a></div>' +
        '<div class="qmaLCb"><div class="dcuivd">' +
        '<a href="https://example.com/b">Compact one</a> · <a href="https://example.com/c">Compact two</a>' +
        "</div></div>" +
        "</div>",
    );
    const { items } = extractGoogleAdText(document.getElementById("container"));
    const callouts = items.filter((i) => i.label.startsWith("Callout"));
    expect(callouts.map((c) => c.body)).toEqual([
      "Boxed callout: Boxed callout description text here",
      "Compact one",
      "Compact two",
    ]);
  });

  it("detects title-only sitelinks that have an empty-text icon sibling (a THIRD real shape — Semrush ad, 2026-07-23: 'SEO Checker' / 'Try for Free' / 'Site Audit' rows with no description)", () => {
    // The icon span renders an inline SVG with no text content at all —
    // it must be filtered out rather than counted as a real child, or a
    // real 1-child title-only sitelink looks like a 2-child boxed one and
    // (title, "") gets treated as (title, description) by mistake, or
    // conversely a naive "children.length === 0" check would reject it
    // outright since it DOES have 2 element children (icon + title div).
    setBody(
      '<div id="container" data-text-ad="1">' +
        '<a class="sVXRqc" href="https://example.com/lp">' +
        '<div role="heading"><span>Headline Text</span></div>' +
        "<div><span>Advertiser</span><span>https://example.com</span></div>" +
        "</a>" +
        "<div>A real description block that is long enough to be picked up by the heuristic here.</div>" +
        '<a class="tNxQIb" href="https://example.com/a"><span class="icon"><svg></svg></span><div class="title"><span>SEO Checker</span></div></a>' +
        '<a class="tNxQIb" href="https://example.com/b"><span class="icon"><svg></svg></span><div class="title"><span>Try for Free</span></div></a>' +
        '<a class="tNxQIb" href="https://example.com/c"><span class="icon"><svg></svg></span><div class="title"><span>Site Audit</span></div></a>' +
        "</div>",
    );
    const { items } = extractGoogleAdText(document.getElementById("container"));
    const callouts = items.filter((i) => i.label.startsWith("Callout"));
    expect(callouts.map((c) => c.body)).toEqual(["SEO Checker", "Try for Free", "Site Audit"]);
  });

  it("ignores an image-grid extension's image-only anchors (a 4th real shape — 2026-07-23: a Product Fruits ad using <w-ad-grid-image>, no per-item text at all)", () => {
    // Each grid-image anchor wraps only an <img> (plus an empty spacer div)
    // — zero text anywhere. Confirms these fall through as empty-title
    // candidates and get rejected, rather than becoming garbage callouts
    // with an empty title, and that the deeply nested wrapper divs don't
    // get mistaken for a "Description" candidate either (they're excluded
    // by isBlockish, since they contain further div descendants).
    setBody(
      '<div id="container" data-text-ad="1">' +
        '<a class="sVXRqc" href="https://productfruits.com/lp/user-onboarding-2" ' +
        'data-rw="https://www.google.com/aclk?sa=L&gclid=x&adurl=https://productfruits.com/lp/user-onboarding-2?utm_term%3Dsoftware%2520adoption%26utm_campaign%3DEurope">' +
        '<div role="heading"><span>#1 SaaS Onboarding Platform - Software Adoption</span></div>' +
        '<div class="d8lRkd"><span>Product Fruits</span><span>https://www.productfruits.com</span></div>' +
        "</a>" +
        '<div class="d8lRkd oVrGyb"><span>Product Fruits</span><span>https://www.productfruits.com</span></div>' +
        "<w-ad-grid-image>" +
        '<div class="CJr3Gf"><div class="KoShGb">' +
        '<a class="Ks5tbe" href="https://www.google.com/aclk?sa=L&adurl=https://productfruits.com/a">' +
        '<div class="q1MG4e ZGomKf"><img alt="Image from productfruits.com"><div class="LLO8yd"></div></div>' +
        "</a>" +
        '<a class="Ks5tbe" href="https://www.google.com/aclk?sa=L&adurl=https://productfruits.com/b">' +
        '<div class="q1MG4e ZGomKf"><img alt="Image from productfruits.com"><div class="LLO8yd"></div></div>' +
        "</a>" +
        "</div></div>" +
        "</w-ad-grid-image>" +
        "</div>",
    );
    const { items, landingPage } = extractGoogleAdText(document.getElementById("container"));

    expect(items.find((i) => i.label === "Headline")?.body).toBe("#1 SaaS Onboarding Platform - Software Adoption");
    expect(landingPage).toBe(
      "https://productfruits.com/lp/user-onboarding-2?utm_term=software%20adoption&utm_campaign=Europe",
    );
    expect(items.filter((i) => i.label.startsWith("Callout"))).toHaveLength(0);
    expect(items.find((i) => i.label === "Description")).toBeUndefined();
  });
});

describe("extractRealDestinationUrl", () => {
  it("decodes a real adurl= redirect param", () => {
    setBody(
      '<a id="link" href="https://www.google.com/aclk?sa=L&gclid=x&adurl=https://example.com/lp?utm_term%3Dfoo%26utm_campaign%3Dbar">text</a>',
    );
    const url = extractRealDestinationUrl(document.getElementById("link"));
    expect(url).toBe("https://example.com/lp?utm_term=foo&utm_campaign=bar");
  });

  it("returns the href as-is when it's already a clean, non-redirect URL", () => {
    setBody('<a id="link" href="https://productfruits.com/pricing">text</a>');
    expect(extractRealDestinationUrl(document.getElementById("link"))).toBe("https://productfruits.com/pricing");
  });

  it("resolves a relative /aclk href against the provided base URL before reading adurl", () => {
    setBody('<a id="link" href="/aclk?sa=L&adurl=https://example.com/lp">text</a>');
    const url = extractRealDestinationUrl(document.getElementById("link"), "https://www.google.com/search?q=x");
    expect(url).toBe("https://example.com/lp");
  });

  it("returns an empty string for a null/missing anchor", () => {
    expect(extractRealDestinationUrl(null)).toBe("");
  });

  it("falls back to href when data-rw's adurl param is present but empty (real ad, 2026-07-23: Shopify's data-rw ends in a bare 'adurl' with no value)", () => {
    setBody(
      '<a id="link" href="https://www.shopify.com/blog/seo-tracking" ' +
        'data-rw="https://www.google.com/aclk?sa=L&nis=4&adurl">text</a>',
    );
    expect(extractRealDestinationUrl(document.getElementById("link"))).toBe("https://www.shopify.com/blog/seo-tracking");
  });

  it("prefers data-rw's fuller UTM-tagged redirect over a clean, direct href (real bug, 2026-07-23: 'SaaS Growth Playbook' ad)", () => {
    // The href itself already goes straight to the advertiser (no
    // redirect), but data-rw still carries Google's own richer adurl with
    // the full UTM set — data-rw should win.
    setBody(
      '<a id="link" ' +
        'href="https://info.revenera.com/SWM-WP-SaaS-Growth-Playbook?lead_source=Organic%20Search" ' +
        'data-rw="https://www.google.com/aclk?sa=L&gclid=x&adurl=https://info.revenera.com/SWM-WP-SaaS-Growth-Playbook?utm_source%3Dgoogle%26utm_medium%3Dcpc">text</a>',
    );
    const url = extractRealDestinationUrl(document.getElementById("link"));
    expect(url).toBe("https://info.revenera.com/SWM-WP-SaaS-Growth-Playbook?utm_source=google&utm_medium=cpc");
  });
});

describe("findLeafTextElements", () => {
  it("finds a leaf span whose text exactly matches the pattern (LinkedIn 'Promoted' label)", () => {
    setBody(`
      <div>
        <span>Modal</span>
        <span>27,712 followers</span>
        <span>Promoted</span>
      </div>
    `);
    const matches = findLeafTextElements(document, /^Promoted$/);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent).toBe("Promoted");
  });

  it("finds a leaf element whose text is exactly 'Ad' (Facebook-style label), ignoring near-matches", () => {
    setBody(`
      <div>
        <span>Wispr Flow and Angel D</span>
        <span>Ad</span>
        <span>Additional text</span>
      </div>
    `);
    const matches = findLeafTextElements(document, /^Ad$/);
    expect(matches).toHaveLength(1);
    expect(matches[0].textContent).toBe("Ad");
  });

  it("does not match a non-leaf element even if its combined text matches", () => {
    setBody(`<div id="wrapper"><span>Pro</span><span>moted</span></div>`);
    // "wrapper" concatenated text is "Promoted" but it has element children, so it must not match.
    const matches = findLeafTextElements(document, /^Promoted$/);
    expect(matches).toHaveLength(0);
  });

  it("returns an empty array when nothing matches", () => {
    setBody(`<div><span>Nothing here</span></div>`);
    expect(findLeafTextElements(document, /^Promoted$/)).toEqual([]);
  });
});

describe("climbToContainer", () => {
  it("climbs past thin wrapper divs to an ancestor whose text length is in the plausible post range", () => {
    setBody(`
      <div id="card">
        <div><div><div>
          <span id="label">Promoted</span>
        </div></div></div>
        <div>Your texts, your emails, your team updates. Why type any of them? Same mouth, ten seconds each.</div>
      </div>
    `);
    const label = document.getElementById("label");
    const container = climbToContainer(label, { minChars: 40, maxChars: 3000 });
    expect(container.id).toBe("card");
  });

  it("falls back to the immediate parent when no ancestor within maxClimb satisfies the range", () => {
    setBody(`<div id="parent"><span id="label">Ad</span></div>`);
    const label = document.getElementById("label");
    const container = climbToContainer(label, { minChars: 500, maxChars: 1000, maxClimb: 3 });
    expect(container.id).toBe("parent");
  });

  it("stops climbing as soon as a qualifying ancestor is found, not the topmost one", () => {
    setBody(`
      <div id="too-big">
        <div id="just-right">
          <span id="label">Ad</span>
          <div>0123456789012345678901234567890123456789012345678901234567890</div>
        </div>
        <div>${"x".repeat(5000)}</div>
      </div>
    `);
    const label = document.getElementById("label");
    const container = climbToContainer(label, { minChars: 40, maxChars: 200 });
    expect(container.id).toBe("just-right");
  });
});
