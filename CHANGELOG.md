# Changelog

## 0.1.0

First release.

- `search`, `searchScoped`, `resolve`, `similar`, `similarScoped` and `get`,
  covering the Locio address API.
- Typed errors that tell a spent quota (`QuotaExhausted`, 402, with `reset`) from
  a rate limit (`RateLimited`, 429, with `retryAfter`).
- `quota` reports the allowance from the most recent answer.
- Refuses a secret key in a browser, refuses a base URL off https, never follows
  a redirect with the key attached and never sends cookies.
- No dependencies.
