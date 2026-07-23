import { describe, it, expect, beforeEach, vi } from "vitest";
import { gradeGoogleAd, previewGoogleAd, fullAuditHandoffUrl, SUPABASE_URL } from "../lib/api.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("gradeGoogleAd", () => {
  it("rejects a too-short headline without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await gradeGoogleAd("hi");
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a too-long headline without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await gradeGoogleAd("a".repeat(301));
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the grade-google-ad endpoint and returns parsed data on success", async () => {
    const payload = { score: 82, principle: "Query Intent Match", diagnosis: "Sharp.", fixes: ["a", "b", "c"] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const result = await gradeGoogleAd("Stop wasting ad spend");
    expect(result).toEqual({ ok: true, data: payload });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${SUPABASE_URL}/functions/v1/grade-google-ad`,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ headline: "Stop wasting ad spend" });
  });

  it("surfaces the server's friendly error message on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "You've hit the free limit for this hour" }), { status: 429 }),
    );
    const result = await gradeGoogleAd("Some headline text");
    expect(result).toEqual({ ok: false, error: "You've hit the free limit for this hour" });
  });

  it("returns a friendly error when fetch itself throws (offline, etc.)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const result = await gradeGoogleAd("Some headline text");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reach the grader/i);
  });
});

describe("previewGoogleAd", () => {
  it("calls the preview-google-ad endpoint with text and sourceUrl", async () => {
    const payload = { findings: [{ lens: "Platform & Media Buying", issue: "No extensions.", recommendation: "Add sitelinks." }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await previewGoogleAd("Some ad copy", "https://example.com/page");
    expect(result).toEqual({ ok: true, data: payload });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({ text: "Some ad copy", sourceUrl: "https://example.com/page" });
  });

  it("surfaces a server error message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Couldn't find enough ad text" }), { status: 400 }),
    );
    const result = await previewGoogleAd("hi");
    expect(result).toEqual({ ok: false, error: "Couldn't find enough ad text" });
  });
});

describe("fullAuditHandoffUrl", () => {
  it("always targets the google-ads-optimization slug", () => {
    const url = fullAuditHandoffUrl([{ label: "Headline", body: "Test" }]);
    expect(url).toContain("slug=google-ads-optimization");
    expect(url).toContain("platform=google");
  });

  it("base64url-encodes the items so the payload round-trips", () => {
    const items = [
      { label: "Headline", body: "Stop wasting ad spend" },
      { label: "Description", body: "Free trial today" },
    ];
    const url = fullAuditHandoffUrl(items);
    const encoded = new URL(url).searchParams.get("items");
    expect(encoded).not.toMatch(/[+/=]/); // URL-safe
    const decoded = JSON.parse(
      Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"),
    );
    expect(decoded).toEqual(items);
  });
});
