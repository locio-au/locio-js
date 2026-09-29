/** The address split the way G-NAF splits it, which is what a form has boxes for. */
export interface AddressComponents {
  building_name?: string;
  flat_type?: string;
  flat_number?: string;
  level_type?: string;
  level_number?: string;
  /** The only number an address on a new subdivision has. */
  lot_number?: string;
  number_first?: string;
  number_first_suffix?: string;
  number_last?: string;
  number_last_suffix?: string;
  street_name?: string;
  street_type?: string;
  street_suffix?: string;
  locality_name?: string;
  state?: string;
  postcode?: string;
}

/**
 * The part of a G-NAF row that is not the address itself.
 *
 * Values are carried as G-NAF publishes them, upper case included:
 * `PRINCIPAL`, `SECONDARY`, `PROPERTY ACCESS POINT SETBACK`. They are codes to
 * match on rather than prose to print.
 */
export interface GnafRecord {
  /** When G-NAF first published this address. */
  date_created?: string;
  address_site_name?: string;
  /** The title reference for the parcel, and the join to a land registry. */
  legal_parcel_id?: string;
  /** PRINCIPAL or ALIAS. */
  alias_principal?: string;
  /** PRIMARY or SECONDARY. */
  primary_secondary?: string;
  /**
   * The parcel this address sits on, when this row is a unit under one.
   *
   * Emphatically not the address id: storing this instead of
   * `address_detail_pid` stores the building rather than the door.
   */
  primary_pid?: string;
  /** How the coordinate was derived: a pin on the door, or in a paddock. */
  geocode_type?: string;
}

/**
 * One resolved address, from whichever register covers it.
 *
 * The G-NAF fields below the components are Australian. G-NAF publishes a
 * pid, an ABS mesh block and a parcel, and another country's register
 * publishes none of them: they are absent on an address outside Australia
 * rather than empty, and `country_code` says which case you are in.
 */
export interface Address {
  /**
   * This address in its country's register, and the id to store against your
   * own record. Stable across releases for an address that has not changed.
   *
   * In Australia it is the G-NAF Address Detail PID, and
   * `address_detail_pid` holds the same value. Elsewhere it is whatever that
   * register issues. Ids are unique within a country, so store
   * `country_code` beside it, and read this through `addressId`.
   */
  id?: string;
  /** Which register this came from, as a two letter ISO 3166-1 code. Absent
   *  means Australia. */
  country_code?: string;
  /**
   * The G-NAF Address Detail PID, for an Australian address. Absent for any
   * other, where there is no such thing.
   */
  address_detail_pid?: string;
  /** The address on one line, as an envelope would write it. */
  formatted: string;
  lat: number;
  lng: number;
  /** The ABS mesh block: the join key to every census statistic about the
   *  area. Australian addresses only. */
  mesh_block?: string;
  components?: AddressComponents;
  gnaf?: GnafRecord;
  /** Where it sits, as names rather than URL slugs. */
  country?: string;
  region?: string;
  locality?: string;
  /** @deprecated Former name for `address_detail_pid`, same value. */
  gnaf_pid?: string;
}

/** The answer to a validation call. */
export interface Resolution {
  matched: boolean;
  address: Address | null;
}

/** Whether a record is a unit under a parcel, in which case `gnaf.primary_pid`
 *  names the parcel rather than this address. */
export function isUnit(address: Address): boolean {
  return (address.gnaf?.primary_secondary ?? "").toUpperCase() === "SECONDARY";
}

/** The address id, under whichever name the API used.
 *
 *  `id` is the one every address carries, whichever country it is in. The two
 *  after it are what an Australian record also carries, and what a service
 *  too old to send `id` carries instead, so reading through this works
 *  against every version. */
export function addressId(address: Address): string {
  return address.id || address.address_detail_pid || address.gnaf_pid || "";
}
