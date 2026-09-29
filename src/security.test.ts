import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_BASE_URL, Locio } from "./index";

/**
 * The controls that stop this client leaking the key it carries.
 *
 * A Locio key is a bearer credential: whoever holds a secret key can spend its
 * quota. So a secret key never runs in a page, the key only ever travels over
 * https to the host the caller named, nothing a caller hands in can reach a
 * header or walk out of its path, and a page's cookies never ride along.
 */

const SECRET = "lc_live_0123456789abcdef";
const PUBLIC = "lc_pub_0123456789abcdef";

function recorder(body: unknown = { data: [] }, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  });
  return {
    calls,
    fetchImpl: fetchImpl as unknown as typeof globalThis.fetch,
    get url() {
      return calls[calls.length - 1]!.url;
    },
    get init() {
      return calls[calls.length - 1]!.init;
    },
  };
}

function inABrowser() {
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {});
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("which key may run where", () => {
  it("refuses to start without a key", () => {
    expect(() => new Locio({ key: "" })).toThrow(/no key/);
    expect(() => new Locio({ key: "   " })).toThrow(/no key/);
  });

  it("refuses a secret key in a browser", () => {
    inABrowser();
    expect(() => new Locio({ key: SECRET })).toThrow(/secret key/);
  });

  it("refuses a secret key of any tenant in a browser, whatever its case", () => {
    inABrowser();
    for (const key of ["pf_live_abc", "LC_LIVE_abc", "xyz_live_abc"]) {
      expect(() => new Locio({ key })).toThrow(/secret key/);
    }
  });

  it("allows a public key in a browser", () => {
    inABrowser();
    expect(() => new Locio({ key: PUBLIC, fetch: recorder().fetchImpl })).not.toThrow();
  });

  it("allows a secret key on a server", () => {
    expect(() => new Locio({ key: SECRET, fetch: recorder().fetchImpl })).not.toThrow();
  });

  it("does not echo the key in the error that refuses it", () => {
    inABrowser();
    try {
      new Locio({ key: SECRET });
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(SECRET);
    }
  });

  it("refuses a key with a newline or a space in it, rather than send a header nobody wrote", () => {
    for (const key of ["lc_live_abc\r\nX-Evil: 1", "lc_live_abc\n", "lc_live abc", "lc_live_abc\0"]) {
      expect(() => new Locio({ key })).toThrow(/key/);
    }
  });

  it("does not show the key when the client is logged", () => {
    const locio = new Locio({ key: SECRET, fetch: recorder().fetchImpl });
    expect(JSON.stringify(locio)).not.toContain(SECRET);
    expect(Object.values(locio).map(String).join(" ")).not.toContain(SECRET);
  });
});

describe("where the key may go", () => {
  it("defaults to https", () => {
    expect(DEFAULT_BASE_URL).toBe("https://api.locio.com.au");
  });

  it("refuses plaintext http to a public host", () => {
    expect(() => new Locio({ key: SECRET, baseUrl: "http://api.locio.com.au" })).toThrow(/clear/);
  });

  it("allows loopback over http, for a test server or a local proxy", () => {
    for (const baseUrl of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"]) {
      expect(() => new Locio({ key: SECRET, baseUrl, fetch: recorder().fetchImpl })).not.toThrow();
    }
  });

  it("does not take a host that only starts like loopback", () => {
    for (const baseUrl of ["http://localhost.evil.example", "http://127.0.0.1.evil.example"]) {
      expect(() => new Locio({ key: SECRET, baseUrl })).toThrow();
    }
  });

  it("refuses another scheme", () => {
    for (const baseUrl of ["ftp://api.locio.com.au", "file:///etc/passwd", "javascript:alert(1)"]) {
      expect(() => new Locio({ key: SECRET, baseUrl })).toThrow();
    }
  });

  it("refuses a base URL that is not absolute", () => {
    for (const baseUrl of ["", "api.locio.com.au", "/v1"]) {
      expect(() => new Locio({ key: SECRET, baseUrl })).toThrow();
    }
  });

  it("refuses a base URL carrying credentials", () => {
    expect(() => new Locio({ key: SECRET, baseUrl: "https://api.locio.com.au@evil.example" })).toThrow(
      /credentials/,
    );
  });

  it("refuses a base URL with a query or a fragment, which would move the path", () => {
    for (const baseUrl of ["https://api.locio.com.au?x=1", "https://api.locio.com.au#x"]) {
      expect(() => new Locio({ key: SECRET, baseUrl })).toThrow();
    }
  });

  it("sends every request to the host it was given", async () => {
    const r = recorder({ data: null });
    const locio = new Locio({ key: SECRET, baseUrl: "https://proxy.example.com/locio/", fetch: r.fetchImpl });
    await locio.search("1 george");
    await locio.get("GANSW705023327");
    await locio.resolve("1 george st");
    await locio.similar("1 gorge st");
    for (const call of r.calls) {
      expect(new URL(call.url).host).toBe("proxy.example.com");
      expect(new URL(call.url).pathname.startsWith("/locio/v1/addresses")).toBe(true);
    }
  });
});

describe("what reaches the wire", () => {
  it("carries the key as a bearer credential and in nothing else", async () => {
    const r = recorder();
    await new Locio({ key: SECRET, fetch: r.fetchImpl }).search("1 george");
    expect(new Headers(r.init.headers).get("Authorization")).toBe(`Bearer ${SECRET}`);
    expect(r.url).not.toContain(SECRET);
  });

  it("sends no cookies", async () => {
    const r = recorder();
    await new Locio({ key: SECRET, fetch: r.fetchImpl }).search("1 george");
    expect(r.init.credentials).toBe("omit");
  });

  it("does not follow a redirect with the key attached", async () => {
    const r = recorder();
    await new Locio({ key: SECRET, fetch: r.fetchImpl }).search("1 george");
    expect(r.init.redirect).toBe("error");
  });

  it("does not let an id walk out of its path", async () => {
    const r = recorder({ data: null });
    const locio = new Locio({ key: SECRET, fetch: r.fetchImpl });
    for (const id of ["../keys", "..%2Fkeys", "a/b", "x?limit=1000", "x#frag"]) {
      await locio.get(id);
      const url = new URL(r.url);
      expect(url.pathname.split("/").slice(0, 3).join("/")).toBe("/v1/addresses");
      expect(url.pathname.split("/")).toHaveLength(4);
      expect(url.search).toBe("");
    }
  });

  it("refuses an id that would name the collection or its parent", async () => {
    const locio = new Locio({ key: SECRET, fetch: recorder().fetchImpl });
    for (const id of ["", "  ", ".", ".."]) {
      await expect(locio.get(id)).rejects.toThrow(/id/);
    }
  });

  it("does not let a term inject another parameter", async () => {
    const r = recorder();
    await new Locio({ key: SECRET, fetch: r.fetchImpl }).search("1 george&country=NZ&limit=1000");
    const url = new URL(r.url);
    expect(url.searchParams.get("q")).toBe("1 george&country=NZ&limit=1000");
    expect(url.searchParams.has("country")).toBe(false);
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("refuses a limit that is not a whole number, rather than sending the word NaN", async () => {
    const locio = new Locio({ key: SECRET, fetch: recorder().fetchImpl });
    for (const limit of [Number.NaN, -1, 2.5, Number.POSITIVE_INFINITY]) {
      await expect(locio.search("1 george", { limit })).rejects.toThrow(/limit/);
    }
  });

  it("does not send a User-Agent from a browser, which refuses it", async () => {
    inABrowser();
    const r = recorder();
    await new Locio({ key: PUBLIC, fetch: r.fetchImpl }).search("1 george");
    expect(new Headers(r.init.headers).has("User-Agent")).toBe(false);
  });
});

describe("what comes back", () => {
  it("survives a body that is not an object", async () => {
    for (const body of [null, 42, "text", [1, 2]]) {
      const r = recorder(body);
      await expect(new Locio({ key: SECRET, fetch: r.fetchImpl }).search("1 george")).resolves.toEqual([]);
    }
  });

  it("does not let a problem document decide whether it failed", async () => {
    const r = recorder({ data: [], title: "error", status: 500 }, 200);
    await expect(new Locio({ key: SECRET, fetch: r.fetchImpl }).search("1 george")).resolves.toEqual([]);
  });

  it("does not repeat the key in an error", async () => {
    const r = recorder({ title: "bad key" }, 401);
    const err = await new Locio({ key: SECRET, fetch: r.fetchImpl }).search("1 george").catch((e) => e);
    expect(String(err.message)).not.toContain(SECRET);
    expect(JSON.stringify(err)).not.toContain(SECRET);
  });
});
