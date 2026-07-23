// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { cleanText, extractGenericAdText, findLeafTextElements, climbToContainer } from "../lib/dom-extract.js";

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
