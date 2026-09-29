/**
 * Locio: Australian addresses from G-NAF, as autocomplete, validation and
 * geocoding.
 *
 * ```ts
 * import { Locio } from "@locio-au/client";
 *
 * const locio = new Locio({ key: process.env.LOCIO_KEY!, country: "AU" });
 * const { matched, address } = await locio.resolve("1 george st sydney nsw 2000");
 * ```
 *
 * Addresses from G-NAF, © Geoscape Australia, CC BY 4.0. Publishing what you
 * get back means carrying that credit: locio.com.au/legal/.
 */

export {
  DEFAULT_BASE_URL,
  Locio,
  VERSION,
  createClient,
  type ClientOptions,
  type RequestOptions,
  type ScopedAddresses,
  type SearchOptions,
} from "./client";

export {
  BadRequest,
  LocioError,
  NotFound,
  QuotaExhausted,
  RateLimited,
  Unauthorized,
  type Quota,
} from "./errors";

export {
  addressId,
  isUnit,
  type Address,
  type AddressComponents,
  type GnafRecord,
  type Resolution,
} from "./types";
