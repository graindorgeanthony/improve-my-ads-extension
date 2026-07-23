// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { cleanText, extractGenericAdText, extractGoogleAdText, findLeafTextElements, climbToContainer } from "../lib/dom-extract.js";

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

describe("extractGoogleAdText", () => {
  it("does not contaminate the headline with a glued-together advertiser name + URL (real bug, 2026-07-23 live report)", () => {
    // Reproduces the exact reported bug: a whole-card <a> wraps a
    // role="heading" title, then the advertiser name and URL immediately
    // after with NO whitespace between them in the source — the live
    // report's wrong headline was literally
    // "Product Adoption SaaSProduct Fruitshttps://www.productfruits.com".
    setBody(
      '<div id="container">' +
        '<a href="https://www.google.com/aclk?adurl=x">' +
        '<div role="heading">Product Adoption SaaS</div>' +
        "<span>Product Fruits</span>" +
        "<span>https://www.productfruits.com</span>" +
        "</a>" +
        "<div>#1 <b>SaaS</b> Onboarding Platform — Stop losing users! Fix poor onboarding &amp; retention with the #1 product onboarding tool. Get the...</div>" +
        "</div>",
    );
    const items = extractGoogleAdText(document.getElementById("container"));
    const headline = items.find((i) => i.label === "Headline");
    expect(headline?.body).toBe("Product Adoption SaaS");
    expect(headline?.body).not.toMatch(/productfruits\.com/);
    expect(headline?.body).not.toMatch(/Product Fruits/);
  });

  it("extracts the landing page URL as its own item, separate from the headline", () => {
    setBody(
      '<div id="container">' +
        '<a href="https://www.google.com/aclk?adurl=x">' +
        '<div role="heading">Product Adoption SaaS</div>' +
        "<span>Product Fruits</span>" +
        "<span>https://www.productfruits.com</span>" +
        "</a>" +
        "<div>#1 SaaS Onboarding Platform for growing teams who need real adoption data.</div>" +
        "</div>",
    );
    const items = extractGoogleAdText(document.getElementById("container"));
    expect(items.find((i) => i.label === "Landing page")?.body).toBe("https://www.productfruits.com");
  });

  it("picks the ad's own description over a shorter sitelink description, even with inline bold formatting", () => {
    setBody(
      '<div id="container">' +
        '<a href="https://www.google.com/aclk?adurl=x">' +
        '<div role="heading">Product Adoption SaaS</div>' +
        "<span>Product Fruits</span><span>https://www.productfruits.com</span>" +
        "</a>" +
        "<div>#1 <b>SaaS</b> Onboarding Platform — Stop losing users! Fix poor onboarding &amp; retention with the #1 product onboarding tool.</div>" +
        '<div><a href="#">No-Code Onboarding UI Flows</a><div>Boost conversions and retention with AI-powered onboarding that keeps users engaged.</div></div>' +
        "</div>",
    );
    const items = extractGoogleAdText(document.getElementById("container"));
    const description = items.find((i) => i.label === "Description");
    expect(description?.body).toMatch(/^#1 SaaS Onboarding Platform/);
    expect(description?.body).not.toMatch(/Boost conversions/);
  });

  it("extracts sitelink/callout title+description pairs, capped at 5", () => {
    const sitelinks = [
      ["Fair pricing", "Find a plan that works for you Unbeatable price-value ratio"],
      ["Product adoption", "Spotlight new releases in-app Drive adoption of unused features"],
      ["User onboarding", "Guide new users to their first win Turn signups into active users"],
      ["No-Code Onboarding UI Flows", "Boost conversions and retention with AI-powered onboarding that keeps users engaged."],
      ["Trial conversion", "Turn trials into paying customers Stop losing trials to inaction"],
      ["Extra sixth sitelink", "This one should be dropped by the cap."],
    ]
      .map(([title, desc]) => `<div><a href="#">${title}</a><div>${desc}</div></div>`)
      .join("");
    setBody(
      '<div id="container">' +
        '<a href="https://www.google.com/aclk?adurl=x"><div role="heading">Product Adoption SaaS</div><span>Product Fruits</span><span>https://www.productfruits.com</span></a>' +
        "<div>#1 SaaS Onboarding Platform, built for growing product-led teams everywhere.</div>" +
        sitelinks +
        "</div>",
    );
    const items = extractGoogleAdText(document.getElementById("container"));
    const callouts = items.filter((i) => i.label.startsWith("Callout"));
    expect(callouts).toHaveLength(5);
    expect(callouts[0].body).toBe("Fair pricing — Find a plan that works for you Unbeatable price-value ratio");
    expect(callouts.some((c) => c.body.includes("Extra sixth sitelink"))).toBe(false);
  });

  it("never leaks the injected 'Grade this ad' button text into any extracted item", () => {
    setBody(
      '<div id="container">' +
        '<button data-ima-button="1">Grade this ad</button>' +
        '<a href="https://www.google.com/aclk?adurl=x"><div role="heading">Product Adoption SaaS</div><span>Product Fruits</span><span>https://www.productfruits.com</span></a>' +
        "<div>#1 SaaS Onboarding Platform for growing teams everywhere who need it.</div>" +
        "</div>",
    );
    const items = extractGoogleAdText(document.getElementById("container"));
    expect(items.some((i) => i.body.includes("Grade this ad"))).toBe(false);
  });

  it("returns an empty array when the container has nothing recognizable", () => {
    setBody(`<div id="container"><span>Hi</span></div>`);
    expect(extractGoogleAdText(document.getElementById("container"))).toEqual([]);
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
