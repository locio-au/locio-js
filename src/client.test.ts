import { describe, expect, it, vi } from "vitest";

import {
  BadRequest,
  Locio,
  LocioError,
  NotFound,
  QuotaExhausted,
  RateLimited,
  Unauthorized,
  VERSION,
  addressId,
  isUnit,
} from "./index";

const KEY = "lc_live_0123456789abcdef";

const ADDRESS = {
  id: "GANSW705023327",
  country_code: "AU",
  address_detail_pid: "GANSW705023327",
  formatted: "1 GEORGE STREET, SYDNEY NSW 2000",
  lat: -33.8612,
  lng: 151.2104,
  mesh_block: "11205258900",
  components: { number_first: "1", street_name: "GEORGE", street_type: "STREET" },
  gnaf: { primary_secondary: "PRINCIPAL" },
};

function recorder(body: unknown = { data: [] }, status = 200, headers: Record<string, string> = {}) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(url)), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers });
  });
  return {
    calls,
    fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    get url() {
      return calls[calls.length - 1]!.url;
    },
    get headers() {
      return new Headers(calls[calls.length - 1]!.init.headers);
    },
  };
}

function client(r: ReturnType<typeof recorder>, extra: Partial<ConstructorParameters<typeof Locio>[0]> = {}) {
  return new Locio({ key: KEY, fetch: r.fetchImpl, ...extra });
}

describe("search", () => {
  it("asks /v1/addresses with the term and returns the addresses", async () => {
    const r = recorder({ data: [ADDRESS] });
    const found = await client(r).search("1 george st sydney");
    expect(r.url.pathname).toBe("/v1/addresses");
    expect(r.url.searchParams.get("q")).toBe("1 george st sydney");
    expect(found).toEqual([ADDRESS]);
  });

  it("sends the limit when one is asked for, and leaves a zero off", async () => {
    const r = recorder();
    await client(r).search("1 george", { limit: 5 });
    expect(r.url.searchParams.get("limit")).toBe("5");
    await client(r).search("1 george", { limit: 0 });
    expect(r.url.searchParams.has("limit")).toBe(false);
  });

  it("answers an empty term without spending a unit", async () => {
    const r = recorder();
    expect(await client(r).search("   ")).toEqual([]);
    expect(r.calls).toHaveLength(0);
  });

  it("returns the country and the note beside the addresses when scoped", async () => {
    const r = recorder({ data: [], country_code: "NZ", note: "We hold no addresses for New Zealand yet." });
    const scoped = await client(r).searchScoped("1 queen st auckland");
    expect(scoped).toEqual({
      addresses: [],
      countryCode: "NZ",
      note: "We hold no addresses for New Zealand yet.",
    });
  });

  it("treats a body without data as no addresses", async () => {
    const r = recorder({});
    expect(await client(r).search("1 george")).toEqual([]);
  });
});

describe("country", () => {
  it("sends the chosen country on every call, upper cased", async () => {
    const r = recorder({ data: [] });
    const locio = client(r, { country: "au" });
    await locio.search("1 george");
    expect(r.url.searchParams.get("country")).toBe("AU");
    await locio.resolve("1 george st sydney nsw 2000");
    expect(r.url.searchParams.get("country")).toBe("AU");
  });

  it("sends no country when none was chosen, so the service default applies", async () => {
    const r = recorder();
    await client(r).search("1 george");
    expect(r.url.searchParams.has("country")).toBe(false);
  });

  it("refuses a country that is not a two letter code", () => {
    for (const country of ["AUS", "Australia", "a", "A1"]) {
      expect(() => client(recorder(), { country })).toThrow(/two letter/);
    }
  });
});

describe("get", () => {
  it("reads one address by its id", async () => {
    const r = recorder({ data: ADDRESS });
    expect(await client(r).get("GANSW705023327")).toEqual(ADDRESS);
    expect(r.url.pathname).toBe("/v1/addresses/GANSW705023327");
  });

  it("answers null for an id that has retired, rather than throwing", async () => {
    const r = recorder({ title: "not found" }, 404);
    expect(await client(r).get("GANSW700000000")).toBeNull();
  });

  it("still throws for any other failure", async () => {
    const r = recorder({ title: "server error" }, 500);
    await expect(client(r).get("GANSW705023327")).rejects.toBeInstanceOf(LocioError);
  });
});

describe("resolve", () => {
  it("returns whether the address matched and what it matched", async () => {
    const r = recorder({ data: { matched: true, address: ADDRESS } });
    const res = await client(r).resolve("1 george st sydney nsw 2000");
    expect(r.url.pathname).toBe("/v1/addresses/resolve");
    expect(res).toEqual({ matched: true, address: ADDRESS });
  });

  it("answers not matched for a body without data", async () => {
    const r = recorder({});
    expect(await client(r).resolve("nowhere")).toEqual({ matched: false, address: null });
  });
});

describe("similar", () => {
  it("asks /v1/addresses/similar with the address and the limit", async () => {
    const r = recorder({ data: [ADDRESS] });
    expect(await client(r).similar("1 gorge st sydnee", { limit: 3 })).toEqual([ADDRESS]);
    expect(r.url.pathname).toBe("/v1/addresses/similar");
    expect(r.url.searchParams.get("limit")).toBe("3");
  });

  it("returns the country and the note when scoped", async () => {
    const r = recorder({ data: [ADDRESS], country_code: "AU" });
    expect(await client(r).similarScoped("1 gorge st")).toEqual({
      addresses: [ADDRESS],
      countryCode: "AU",
      note: undefined,
    });
  });
});

describe("errors", () => {
  it("keeps the service's own words", async () => {
    const r = recorder({ title: "bad key", detail: "That key was revoked on 3 September." }, 401);
    const err = await client(r).search("1 george").catch((e) => e);
    expect(err).toBeInstanceOf(Unauthorized);
    expect(err).toBeInstanceOf(LocioError);
    expect(err.status).toBe(401);
    expect(err.title).toBe("bad key");
    expect(err.detail).toBe("That key was revoked on 3 September.");
    expect(err.message).toBe("bad key: That key was revoked on 3 September.");
  });

  it("reads 403 as a key problem too", async () => {
    const r = recorder({ title: "origin not allowed" }, 403);
    await expect(client(r).search("1 george")).rejects.toBeInstanceOf(Unauthorized);
  });

  it("tells a spent quota from a rate limit: 402 carries when it resets", async () => {
    const r = recorder({ title: "quota exhausted", detail: "10000 of 10000 units used." }, 402, {
      "X-Quota-Limit": "10000",
      "X-Quota-Remaining": "0",
      "X-Quota-Reset": "2026-10-01T00:00:00Z",
    });
    const err = await client(r).search("1 george").catch((e) => e);
    expect(err).toBeInstanceOf(QuotaExhausted);
    expect(err).not.toBeInstanceOf(RateLimited);
    expect(err.reset).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(err.quota).toEqual({ limit: 10000, remaining: 0, reset: new Date("2026-10-01T00:00:00Z") });
  });

  it("tells a rate limit from a spent quota: 429 carries how long to wait", async () => {
    const r = recorder({ title: "too many requests" }, 429, { "Retry-After": "1" });
    const err = await client(r).search("1 george").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimited);
    expect(err).not.toBeInstanceOf(QuotaExhausted);
    expect(err.retryAfter).toBe(1);
  });

  it("leaves retryAfter unset when the service did not say", async () => {
    const r = recorder({}, 429);
    const err = await client(r).search("1 george").catch((e) => e);
    expect(err.retryAfter).toBeUndefined();
  });

  it("names a 404 outside get, and any other 4xx a bad request", async () => {
    await expect(client(recorder({}, 404)).search("1 george")).rejects.toBeInstanceOf(NotFound);
    await expect(client(recorder({}, 400)).search("1 george")).rejects.toBeInstanceOf(BadRequest);
  });

  it("uses the status when the body is not a problem document", async () => {
    const r = recorder("<html>bad gateway</html>", 502);
    const err = await client(r).search("1 george").catch((e) => e);
    expect(err).toBeInstanceOf(LocioError);
    expect(err.status).toBe(502);
    expect(err.message).toBe("HTTP 502");
  });
});

describe("quota", () => {
  it("is unknown until a call has answered", () => {
    expect(client(recorder()).quota).toBeUndefined();
  });

  it("holds what the latest answer said about the allowance", async () => {
    const r = recorder({ data: [] }, 200, {
      "X-Quota-Limit": "10000",
      "X-Quota-Remaining": "9876",
      "X-Quota-Reset": "2026-10-01T00:00:00Z",
    });
    const locio = client(r);
    await locio.search("1 george");
    expect(locio.quota).toEqual({ limit: 10000, remaining: 9876, reset: new Date("2026-10-01T00:00:00Z") });
  });

  it("keeps the last known quota when an answer carries none", async () => {
    let headers: Record<string, string> = {
      "X-Quota-Limit": "100",
      "X-Quota-Remaining": "40",
      "X-Quota-Reset": "2026-10-01T00:00:00Z",
    };
    const fetchImpl = (async () => new Response("{}", { headers })) as unknown as typeof fetch;
    const locio = new Locio({ key: KEY, fetch: fetchImpl });
    await locio.search("1 george");
    headers = {};
    await locio.search("1 george");
    expect(locio.quota?.remaining).toBe(40);
  });

  it("ignores quota headers that do not parse", async () => {
    const r = recorder({ data: [] }, 200, { "X-Quota-Limit": "lots", "X-Quota-Reset": "soon" });
    const locio = client(r);
    await locio.search("1 george");
    expect(locio.quota).toBeUndefined();
  });
});

describe("requests", () => {
  it("identifies the library off the browser", async () => {
    const r = recorder();
    await client(r).search("1 george");
    expect(r.headers.get("User-Agent")).toBe(`locio-js/${VERSION}`);
  });

  it("passes the abort signal through", async () => {
    const r = recorder();
    const controller = new AbortController();
    await client(r).search("1 george", { signal: controller.signal });
    expect(r.calls[0]!.init.signal).toBe(controller.signal);
  });

  it("calls a fetch read off globalThis with the right this", async () => {
    const original = globalThis.fetch;
    const seen: unknown[] = [];
    globalThis.fetch = function (this: unknown) {
      seen.push(this);
      return Promise.resolve(new Response("{}"));
    } as typeof fetch;
    try {
      await new Locio({ key: KEY }).search("1 george");
    } finally {
      globalThis.fetch = original;
    }
    expect(seen[0]).toBe(globalThis);
  });
});

describe("helpers", () => {
  it("reads the id under whichever name the service used", () => {
    expect(addressId({ ...ADDRESS })).toBe("GANSW705023327");
    expect(addressId({ formatted: "", lat: 0, lng: 0, gnaf_pid: "GAVIC1" })).toBe("GAVIC1");
  });

  it("says whether an address is a unit under a parcel", () => {
    expect(isUnit({ ...ADDRESS, gnaf: { primary_secondary: "SECONDARY" } })).toBe(true);
    expect(isUnit(ADDRESS)).toBe(false);
  });
});
