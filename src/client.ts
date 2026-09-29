import { LocioError, errorFor, type Quota } from "./errors";
import type { Address, Resolution } from "./types";

export const VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://api.locio.com.au";

export interface ClientOptions {
  /**
   * A secret key (`lc_live_...`) on a server, or a public key (`lc_pub_...`)
   * in a page. A secret key is refused in a browser: anyone who opens the page
   * could read it and spend your quota.
   */
  key: string;
  /**
   * Which country's addresses to search, as a two letter ISO 3166-1 code.
   *
   * A secret key should say, because its requests come from your server and the
   * service cannot tell from that where the address is. Left out, the service's
   * own default applies, which is AU. A public key is scoped to where the
   * visitor is, whatever this says.
   */
  country?: string;
  /** Point somewhere else: a proxy of your own, or a test server. */
  baseUrl?: string;
  /** Your own fetch, for a custom transport or for testing. */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  /** Cancel a request whose answer is no longer wanted. */
  signal?: AbortSignal;
}

export interface SearchOptions extends RequestOptions {
  /** How many addresses. Left out or zero, the service's default applies. */
  limit?: number;
}

/**
 * Addresses, and what the service said about the country it searched.
 *
 * A country the service holds no addresses for answers no results and a
 * `note` saying why, as an ordinary answer that costs nothing.
 */
export interface ScopedAddresses {
  addresses: Address[];
  /** Which country was searched, as a two letter ISO 3166-1 code. */
  countryCode?: string;
  /** Why the list is empty, when empty is the right answer. */
  note?: string;
}

interface ListBody {
  data?: Address[];
  country_code?: string;
  note?: string;
}

/**
 * Secret key prefixes, refused in a browser.
 *
 * `_live_` is the shape every tenant's secret keys share, so a tenant added
 * later is covered without editing this.
 */
const SECRET_KEY = /^[a-z]{2,}_live_/i;

function inBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * A client for the Locio address API: G-NAF, as autocomplete, validation and
 * geocoding.
 *
 * ```ts
 * const locio = new Locio({ key: process.env.LOCIO_KEY!, country: "AU" });
 * const { matched, address } = await locio.resolve("1 george st sydney nsw 2000");
 * ```
 *
 * Runs anywhere there is `fetch`: Node, Bun, Deno, a worker, a browser. Make
 * one and keep it.
 *
 * Addresses come from G-NAF, © Geoscape Australia, under CC BY 4.0. Publishing
 * what you get back means carrying that credit: locio.com.au/legal/.
 */
export class Locio {
  readonly #key: string;
  readonly #country?: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  #quota?: Quota;

  constructor(options: ClientOptions) {
    this.#key = checkKey(options.key);
    this.#baseUrl = checkBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);

    if (options.country !== undefined) {
      const country = options.country.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) {
        throw new Error(`locio: country ${options.country} is not a two letter ISO 3166-1 code`);
      }
      this.#country = country;
    }

    const impl = options.fetch ?? globalThis.fetch;
    if (typeof impl !== "function") {
      throw new Error("locio: no fetch in this runtime. Pass one: new Locio({ key, fetch })");
    }
    // Bound, so a fetch read off globalThis is not called with the wrong this.
    this.#fetch = options.fetch ? impl : impl.bind(globalThis);
  }

  /**
   * The allowance as the most recent answer reported it: units in the period,
   * units left, and when it resets. Undefined until a metered call answers.
   */
  get quota(): Quota | undefined {
    return this.#quota;
  }

  /**
   * Candidate addresses for what somebody has typed: address autocomplete.
   *
   * One unit a call. Debounce keystrokes and pass a `signal`, so a superseded
   * keystroke is cancelled rather than raced. An empty term answers an empty
   * array without a request, and without spending a unit.
   */
  async search(term: string, options: SearchOptions = {}): Promise<Address[]> {
    return (await this.searchScoped(term, options)).addresses;
  }

  /** The same call, with the country it searched and any note about it. */
  async searchScoped(term: string, options: SearchOptions = {}): Promise<ScopedAddresses> {
    return this.list("/v1/addresses", term, options);
  }

  /**
   * One address by its id: the `id` of a record you stored, which in
   * Australia is the G-NAF Address Detail PID.
   *
   * Null when the id is not in the current release. G-NAF retires ids between
   * quarterly releases, so a caller storing them will meet this and should
   * tell it apart from an outage.
   */
  async get(id: string, options: RequestOptions = {}): Promise<Address | null> {
    const text = String(id ?? "").trim();
    // encodeURIComponent leaves dots alone, and "." or ".." as a path segment
    // is the collection or its parent, not an address.
    if (!text || text === "." || text === "..") {
      throw new Error(`locio: ${JSON.stringify(id)} is not an address id`);
    }
    try {
      const body = await this.call<{ data?: Address }>(
        `/v1/addresses/${encodeURIComponent(text)}`,
        {},
        options,
      );
      return body.data ?? null;
    } catch (err) {
      if (err instanceof LocioError && err.status === 404) return null;
      throw err;
    }
  }

  /**
   * A whole address string to one record: address validation, geocoding and
   * parsing in the same answer.
   *
   * `matched: false` is an ordinary answer, not an error: the address as
   * written is not in the register. Try {@link similar} when a typo is likely.
   */
  async resolve(address: string, options: RequestOptions = {}): Promise<Resolution> {
    const body = await this.call<{ data?: Resolution }>(
      "/v1/addresses/resolve",
      { q: address },
      options,
    );
    return body.data ?? { matched: false, address: null };
  }

  /**
   * Near misses for an address that did not resolve: "1 gorge rd sydenhum" is
   * one address, and this says which. Three units, so call it once on a
   * failed resolve, never on a keystroke.
   */
  async similar(address: string, options: SearchOptions = {}): Promise<Address[]> {
    return (await this.similarScoped(address, options)).addresses;
  }

  /** The same call, with the country it searched and any note about it. */
  async similarScoped(address: string, options: SearchOptions = {}): Promise<ScopedAddresses> {
    return this.list("/v1/addresses/similar", address, options);
  }

  private async list(path: string, term: string, options: SearchOptions): Promise<ScopedAddresses> {
    const q = String(term ?? "").trim();
    if (!q) return { addresses: [] };
    const body = await this.call<ListBody>(path, { q, limit: options.limit }, options);
    return {
      addresses: Array.isArray(body.data) ? body.data : [],
      countryCode: body.country_code,
      note: body.note,
    };
  }

  private async call<T>(
    path: string,
    params: Record<string, string | number | undefined>,
    options: RequestOptions,
  ): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") continue;
      if (key === "limit") {
        // A NaN reaches a URL as the word "NaN" and comes back as a 400 that
        // reads like the service's fault.
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          throw new Error(`locio: limit must be a whole number, not ${value}`);
        }
        // Zero is not a limit: leave it off so the service's default applies.
        if (value === 0) continue;
      }
      query.set(key, String(value));
    }
    // Every address call is scoped to one country.
    if (this.#country) query.set("country", this.#country);
    const url = this.#baseUrl + path + (query.size ? `?${query}` : "");

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#key}`,
      Accept: "application/json",
    };
    // Browsers refuse to set it, and a server should say what it is running.
    if (!inBrowser()) headers["User-Agent"] = `locio-js/${VERSION}`;

    const response = await this.#fetch(url, {
      method: "GET",
      headers,
      signal: options.signal,
      // A page that happens to hold a cookie for this domain does not send it.
      credentials: "omit",
      // A redirect would carry the Authorization header to wherever it points.
      // The API does not redirect, so one is a proxy or a hijack, not an answer.
      redirect: "error",
    });

    const quota = readQuota(response.headers);
    if (quota) this.#quota = quota;

    // A problem document is JSON; a proxy having a bad day is not. Either way
    // the status is the part a caller can act on, so parsing never decides
    // whether an error is raised.
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    const body = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw errorFor(
        response.status,
        typeof body.title === "string" ? body.title : "",
        typeof body.detail === "string" ? body.detail : "",
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
        quota,
      );
    }
    return body as T;
  }
}

/** Shorthand for `new Locio(options)`, for code that prefers a factory. */
export function createClient(options: ClientOptions): Locio {
  return new Locio(options);
}

function checkKey(raw: string): string {
  const key = String(raw ?? "");
  if (!key.trim()) {
    throw new Error(
      "locio: no key. Create one at https://locio.com.au/account/api: a secret key " +
        "(lc_live_...) for a server, a public key (lc_pub_...) for a page.",
    );
  }
  // A header value, so a newline in it would be a header the caller did not
  // write. Keys never contain whitespace, so any is a paste gone wrong.
  if (/[\s\0]/.test(key)) {
    throw new Error("locio: the key contains whitespace or a control character; check how it was pasted");
  }
  // Never echo the key: this message ends up in logs and error trackers.
  if (inBrowser() && SECRET_KEY.test(key)) {
    throw new Error(
      "locio: that is a secret key, and this code runs in a browser. Anyone who opens " +
        "the page can read it and spend your quota. Use a public key (lc_pub_...) " +
        "instead: it carries an origin allow list, so a copy lifted from your page " +
        "does nothing anywhere else. Create one at https://locio.com.au/account/api",
    );
  }
  return key;
}

/**
 * Refuse a base URL that would send the key somewhere it should not go.
 *
 * https always, and plaintext http only to loopback, which is what a local
 * proxy and a test server need.
 */
function checkBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`locio: base URL ${raw} is not absolute`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      `locio: base URL ${raw} carries credentials, and the host it would reach is not the one it reads as`,
    );
  }
  if (/[?#]/.test(raw)) {
    throw new Error(`locio: base URL ${raw} has a query or a fragment, which would swallow the path`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback)) {
    return raw.replace(/\/+$/, "");
  }
  if (parsed.protocol === "http:") {
    throw new Error(
      `locio: base URL ${raw} is plaintext http to a public host, which would send the key in the clear`,
    );
  }
  throw new Error(`locio: base URL ${raw} has scheme ${parsed.protocol}, want https`);
}

/** The allowance from the X-Quota-* headers, or undefined when any is missing or malformed. */
function readQuota(headers: Headers): Quota | undefined {
  const limit = headers.get("X-Quota-Limit");
  const remaining = headers.get("X-Quota-Remaining");
  const reset = headers.get("X-Quota-Reset");
  if (limit === null || remaining === null || reset === null) return undefined;
  const quota = { limit: Number(limit), remaining: Number(remaining), reset: new Date(reset) };
  if (
    !Number.isInteger(quota.limit) ||
    !Number.isInteger(quota.remaining) ||
    Number.isNaN(quota.reset.getTime())
  ) {
    return undefined;
  }
  return quota;
}
