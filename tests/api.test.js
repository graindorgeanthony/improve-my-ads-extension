import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  gradeHook,
  previewAd,
  fullToolUrl,
  fullAuditHandoffUrl,
  saveHistoryEntry,
  getHistory,
  clearHistory,
  SUPABASE_URL,
} from "../lib/api.js";

// Minimal chrome.storage.local mock — an in-memory object, mirroring the
// real callback-less Promise-returning API used by lib/api.js.
function installChromeStorageMock() {
  let store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (key) => ({ [key]: store[key] ?? [] })),
        set: vi.fn(async (obj) => {
          store = { ...store, ...obj };
        }),
      },
    },
  };
  return () => store;
}

beforeEach(() => {
  installChromeStorageMock();
  vi.restoreAllMocks();
});

describe("gradeHook", () => {
  it("rejects a too-short headline without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await gradeHook("hi");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a too-long headline without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await gradeHook("a".repeat(301));
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the grade-hook endpoint and returns parsed data on success", async () => {
    const payload = { score: 82, principle: "Specificity", diagnosis: "Sharp.", fixes: ["a", "b", "c"] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const result = await gradeHook("Stop wasting ad spend", "meta");
    expect(result).toEqual({ ok: true, data: payload });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SUPABASE_URL}/functions/v1/grade-hook`,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ headline: "Stop wasting ad spend", platform: "meta" });
  });

  it("omits platform from the request body when not provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ score: 50 }), { status: 200 }));
    await gradeHook("Some headline text");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ headline: "Some headline text" });
  });

  it("surfaces the server's friendly error message on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "You've hit the free limit for this hour" }), { status: 429 }),
    );
    const result = await gradeHook("Some headline text");
    expect(result).toEqual({ ok: false, error: "You've hit the free limit for this hour" });
  });

  it("returns a friendly error when fetch itself throws (offline, etc.)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const result = await gradeHook("Some headline text");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reach the grader/i);
  });
});

describe("previewAd", () => {
  it("calls the preview-ad endpoint with text, platform, and sourceUrl", async () => {
    const payload = { findings: [{ lens: "Copywriting & Messaging", issue: "Vague.", recommendation: "Be specific." }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await previewAd("Some ad copy", "google", "https://example.com/page");
    expect(result).toEqual({ ok: true, data: payload });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ text: "Some ad copy", platform: "google", sourceUrl: "https://example.com/page" });
  });

  it("surfaces a server error message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Couldn't find enough ad text" }), { status: 400 }),
    );
    const result = await previewAd("hi");
    expect(result).toEqual({ ok: false, error: "Couldn't find enough ad text" });
  });
});

describe("fullToolUrl", () => {
  it("includes the headline and platform as query params", () => {
    const url = fullToolUrl("Stop wasting ad spend", "meta");
    expect(url).toBe("https://improve-my-ads.com/tools/ad-hook-grader?h=Stop+wasting+ad+spend&p=meta");
  });

  it("omits the platform param when not provided", () => {
    const url = fullToolUrl("Stop wasting ad spend");
    expect(url).toBe("https://improve-my-ads.com/tools/ad-hook-grader?h=Stop+wasting+ad+spend");
  });
});

describe("fullAuditHandoffUrl", () => {
  it("maps google to the google-ads-optimization slug", () => {
    const url = fullAuditHandoffUrl([{ label: "Headline", body: "Test" }], "google");
    expect(url).toContain("slug=google-ads-optimization");
  });

  it("maps reddit to the reddit-ads-optimization slug", () => {
    const url = fullAuditHandoffUrl([{ label: "Headline", body: "Test" }], "reddit");
    expect(url).toContain("slug=reddit-ads-optimization");
  });

  it("falls back to the generic ads-optimization slug for meta/linkedin/youtube/unset", () => {
    for (const platform of ["meta", "linkedin", "youtube", "", undefined]) {
      const url = fullAuditHandoffUrl([{ label: "Headline", body: "Test" }], platform);
      expect(url).toContain("slug=ads-optimization");
    }
  });

  it("base64url-encodes the items so the payload round-trips", () => {
    const items = [
      { label: "Headline", body: "Stop wasting ad spend" },
      { label: "Description", body: "Free trial today" },
    ];
    const url = fullAuditHandoffUrl(items, "google");
    const encoded = new URL(url).searchParams.get("items");
    expect(encoded).not.toMatch(/[+/=]/); // URL-safe
    const decoded = JSON.parse(
      Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"),
    );
    expect(decoded).toEqual(items);
  });
});

describe("history (chrome.storage.local)", () => {
  it("starts empty", async () => {
    expect(await getHistory()).toEqual([]);
  });

  it("saves an entry and returns it newest-first", async () => {
    await saveHistoryEntry({ headline: "First", platform: "", score: 10, principle: "", diagnosis: "", fixes: [] });
    const history = await saveHistoryEntry({ headline: "Second", platform: "", score: 90, principle: "", diagnosis: "", fixes: [] });
    expect(history.map((h) => h.headline)).toEqual(["Second", "First"]);
    expect(history[0].ts).toEqual(expect.any(Number));
  });

  it("caps history at 12 entries", async () => {
    for (let i = 0; i < 15; i++) {
      await saveHistoryEntry({ headline: `Entry ${i}`, platform: "", score: i, principle: "", diagnosis: "", fixes: [] });
    }
    const history = await getHistory();
    expect(history).toHaveLength(12);
    expect(history[0].headline).toBe("Entry 14");
  });

  it("clearHistory empties the list", async () => {
    await saveHistoryEntry({ headline: "First", platform: "", score: 10, principle: "", diagnosis: "", fixes: [] });
    await clearHistory();
    expect(await getHistory()).toEqual([]);
  });
});
