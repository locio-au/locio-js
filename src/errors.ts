/** What the API said when it refused. */

/** The allowance a key's account has left, as the service reported it. */
export interface Quota {
  /** Units the plan allows in the period. */
  limit: number;
  /** Units left in the period. */
  remaining: number;
  /** When the period ends and the count starts again. */
  reset: Date;
}

/**
 * The service answers RFC 7807 problem documents: a title and a detail written
 * for a person to read and act on, such as which key is wrong or what a public
 * key may call. Collapsing that into "HTTP 403" throws away the only part of
 * the answer that says what to do about it.
 */
export class LocioError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;

  constructor(status: number, title = "", detail = "") {
    super([title || `HTTP ${status}`, detail].filter(Boolean).join(": "));
    this.name = "LocioError";
    this.status = status;
    this.title = title;
    this.detail = detail;
  }
}

/** Nothing is filed under that id. */
export class NotFound extends LocioError {
  constructor(status: number, title = "", detail = "") {
    super(status, title, detail);
    this.name = "NotFound";
  }
}

/** The request could not be served as written. */
export class BadRequest extends LocioError {
  constructor(status: number, title = "", detail = "") {
    super(status, title, detail);
    this.name = "BadRequest";
  }
}

/**
 * The key was refused: missing, revoked, or a public key used from an origin
 * its allow list does not name. The detail says which.
 */
export class Unauthorized extends LocioError {
  constructor(status: number, title = "", detail = "") {
    super(status, title, detail);
    this.name = "Unauthorized";
  }
}

/**
 * Too many requests a second. Slow down and try again: nothing is spent.
 *
 * A different problem from {@link QuotaExhausted}, with a different fix, which
 * is why the service answers 429 for one and 402 for the other.
 */
export class RateLimited extends LocioError {
  /** Seconds the service asked for, when it said. */
  readonly retryAfter?: number;

  constructor(status: number, title = "", detail = "", retryAfter?: number) {
    super(status, title, detail);
    this.name = "RateLimited";
    this.retryAfter = retryAfter;
  }
}

/**
 * Every unit in the period is spent. Retrying before `reset` gets the same
 * answer; a larger plan at locio.com.au/account/ is the other way through.
 */
export class QuotaExhausted extends LocioError {
  /** The allowance as the service reported it with the refusal. */
  readonly quota?: Quota;
  /** When the allowance starts again. */
  readonly reset?: Date;

  constructor(status: number, title = "", detail = "", quota?: Quota) {
    super(status, title, detail);
    this.name = "QuotaExhausted";
    this.quota = quota;
    this.reset = quota?.reset;
  }
}

export function errorFor(
  status: number,
  title: string,
  detail: string,
  retryAfter: number | undefined,
  quota: Quota | undefined,
): LocioError {
  if (status === 401 || status === 403) return new Unauthorized(status, title, detail);
  if (status === 402) return new QuotaExhausted(status, title, detail, quota);
  if (status === 404) return new NotFound(status, title, detail);
  if (status === 429) return new RateLimited(status, title, detail, retryAfter);
  if (status >= 400 && status < 500) return new BadRequest(status, title, detail);
  return new LocioError(status, title, detail);
}
