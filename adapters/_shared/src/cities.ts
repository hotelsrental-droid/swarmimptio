/**
 * IMPT Swarm — canonical city list.
 *
 * Memory-rule conformance:
 *   - destination is CITY, never country
 *   - currency is destination-driven, never user-locale
 *   - no request-time external API on landing pages — this list is the source of truth
 *
 * Synced with src/widget.js STATIC_CITIES (24 cities). Extend this file to grow coverage;
 * widget.js will be regenerated from it during build.
 */

export interface City {
  /** Canonical display name. Matches IMPT find-hotel-input destination input. */
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Latitude (geocoder triple). */
  lat: number;
  /** Longitude (geocoder triple). */
  lon: number;
  /** ISO 4217 currency code for destination. */
  currency: string;
}

export const CITIES: readonly City[] = [
  // Ireland
  { name: 'Dublin',     country: 'IE', lat: 53.3498, lon: -6.2603, currency: 'EUR' },
  { name: 'Cork',       country: 'IE', lat: 51.8985, lon: -8.4756, currency: 'EUR' },
  { name: 'Galway',     country: 'IE', lat: 53.2707, lon: -9.0568, currency: 'EUR' },
  { name: 'Limerick',   country: 'IE', lat: 52.6638, lon: -8.6267, currency: 'EUR' },
  // UK
  { name: 'Belfast',    country: 'GB', lat: 54.5973, lon: -5.9301, currency: 'GBP' },
  { name: 'London',     country: 'GB', lat: 51.5074, lon: -0.1278, currency: 'GBP' },
  { name: 'Edinburgh',  country: 'GB', lat: 55.9533, lon: -3.1883, currency: 'GBP' },
  { name: 'Manchester', country: 'GB', lat: 53.4808, lon: -2.2426, currency: 'GBP' },
  // EU
  { name: 'Paris',      country: 'FR', lat: 48.8566, lon:  2.3522, currency: 'EUR' },
  { name: 'Barcelona',  country: 'ES', lat: 41.3851, lon:  2.1734, currency: 'EUR' },
  { name: 'Madrid',     country: 'ES', lat: 40.4168, lon: -3.7038, currency: 'EUR' },
  { name: 'Rome',       country: 'IT', lat: 41.9028, lon: 12.4964, currency: 'EUR' },
  { name: 'Milan',      country: 'IT', lat: 45.4642, lon:  9.1900, currency: 'EUR' },
  { name: 'Amsterdam',  country: 'NL', lat: 52.3676, lon:  4.9041, currency: 'EUR' },
  { name: 'Berlin',     country: 'DE', lat: 52.5200, lon: 13.4050, currency: 'EUR' },
  { name: 'Lisbon',     country: 'PT', lat: 38.7223, lon: -9.1393, currency: 'EUR' },
  // Americas
  { name: 'New York',   country: 'US', lat: 40.7128, lon:-74.0060, currency: 'USD' },
  { name: 'Los Angeles',country: 'US', lat: 34.0522, lon:-118.2437,currency: 'USD' },
  { name: 'Miami',      country: 'US', lat: 25.7617, lon:-80.1918, currency: 'USD' },
  // APAC + ME
  { name: 'Tokyo',      country: 'JP', lat: 35.6762, lon: 139.6503,currency: 'JPY' },
  { name: 'Singapore',  country: 'SG', lat:  1.3521, lon: 103.8198,currency: 'SGD' },
  { name: 'Dubai',      country: 'AE', lat: 25.2048, lon:  55.2708,currency: 'AED' },
  { name: 'Sydney',     country: 'AU', lat:-33.8688, lon: 151.2093,currency: 'AUD' },
  { name: 'Bangkok',    country: 'TH', lat: 13.7563, lon: 100.5018,currency: 'THB' }
] as const;

const BY_NAME = new Map<string, City>(CITIES.map((c) => [c.name.toLowerCase(), c]));

/** Case-insensitive city lookup. Returns `undefined` for unknown cities (caller decides fallback). */
export function findCity(name: string | null | undefined): City | undefined {
  if (!name) return undefined;
  return BY_NAME.get(name.toLowerCase());
}

/** Currency for a destination. Defaults to USD when destination is unknown. */
export function currencyFor(name: string | null | undefined): string {
  return findCity(name)?.currency ?? 'USD';
}
