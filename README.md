# @locio-au/client

**Australian address autocomplete, validation and geocoding**, from G-NAF, the
national address register. Turn whatever somebody typed into one address with a
stable id, a coordinate, an ABS mesh block and the components a form has boxes
for.

- Runs anywhere there is `fetch`: Node, Bun, Deno, Cloudflare Workers, an SSR
  loader, a browser
- Typed against the wire, with field names as the API sends them
- Tells a spent quota apart from a rate limit, so a caller knows whether to wait
  or to upgrade
- No dependencies

```sh
npm install @locio-au/client
```

Get a key at [locio.com.au](https://locio.com.au/account/api).

## Quick start

```ts
import { Locio } from "@locio-au/client";

const locio = new Locio({ key: process.env.LOCIO_KEY!, country: "AU" });

const { matched, address } = await locio.resolve("1 george st sydney nsw 2000");
if (matched && address) {
  console.log(address.id, address.formatted, address.lat, address.lng, address.mesh_block);
}
```

Write the address however you hold it. Abbreviations, missing commas and a
missing state are all fine.

## The calls

| Call | Answers | Units |
|---|---|---|
| `search(term, { limit })` | candidates for what somebody is typing: autocomplete | 1 |
| `resolve(address)` | one address, or `matched: false`: validation and geocoding | 1 |
| `similar(address, { limit })` | near misses for an address that did not resolve | 3 |
| `get(id)` | the address you stored, read back; `null` once it has retired | 1 |

`searchScoped` and `similarScoped` return the same addresses with the country
the service searched and, when the list is empty because that country is not
covered, a `note` saying so.

`matched: false` is an answer, not an error. It means the address as written is
not in the register, which is exactly what a validation call is asking. Try
`similar` once when a typo is likely:

```ts
const res = await locio.resolve("1 gorge rd sydenhum");
const suggestions = res.matched ? [] : await locio.similar("1 gorge rd sydenhum", { limit: 3 });
```

## Which id to store

Store `id` beside `country_code`, and read it through `addressId`, which also
works against older responses. In Australia `id` is the G-NAF Address Detail
PID, stable across quarterly releases for an address that has not changed.

```ts
import { addressId, isUnit } from "@locio-au/client";

const id = addressId(address);
if (isUnit(address)) {
  // address.gnaf.primary_pid is the parcel the unit sits on, not this door.
}
```

G-NAF retires ids between releases, so `get` answers `null` for one that has
gone rather than throwing. Code walking stored ids should expect it.

## Quota and rate limits

Two different problems, with different fixes:

```ts
import { QuotaExhausted, RateLimited } from "@locio-au/client";

try {
  await locio.search(term);
} catch (err) {
  if (err instanceof RateLimited) {
    // Too many a second. Wait err.retryAfter seconds and try again.
  } else if (err instanceof QuotaExhausted) {
    // Every unit in the period is spent until err.reset.
  } else {
    throw err;
  }
}
```

`locio.quota` holds what the most recent answer said about the allowance:
`{ limit, remaining, reset }`. A queue worker can read it to slow down before
the quota runs out rather than after.

Every error is a `LocioError` carrying the service's own `title` and `detail`,
which say what to do: which key is wrong, what a public key may call. The
subclasses are `Unauthorized` (401, 403), `QuotaExhausted` (402), `NotFound`,
`RateLimited` (429) and `BadRequest`.

## Keys

- **Secret key** (`lc_live_...`) on a server. Pass `country`, because a request
  from your server says nothing about where the address is.
- **Public key** (`lc_pub_...`) in a page. It carries an origin allow list, so a
  copy lifted from your page does nothing anywhere else, and it is scoped to
  the country the visitor is in.

This package **throws at construction** if it sees a secret key in a browser,
rather than letting it reach production working perfectly. It sends the key
only over https (or plain http to localhost, for a test server), never follows
a redirect with it attached, and never sends cookies.

## Typeahead

Debounce keystrokes and cancel the one a newer keystroke replaced:

```ts
let controller: AbortController | undefined;

async function onInput(term: string) {
  controller?.abort();
  controller = new AbortController();
  return locio.search(term, { limit: 8, signal: controller.signal });
}
```

For a ready made combobox, use the React or Vue package below.

## The other packages

| | |
|---|---|
| [`@locio-au/react`](https://www.npmjs.com/package/@locio-au/react) | address autocomplete component and hook |
| [`@locio-au/vue`](https://www.npmjs.com/package/@locio-au/vue) | address autocomplete component and composable |
| [`locio`](https://pypi.org/project/locio/) | Python |
| [`locio-go`](https://github.com/locio-au/locio-go) | Go |

API reference: [locio.com.au/docs](https://locio.com.au/docs/).

## Licence

MIT. Address data is G-NAF, published by Geoscape Australia under CC BY 4.0;
attribution belongs wherever you show it. See
[locio.com.au/legal](https://locio.com.au/legal/).
