import type { DistanceCacheEntry, DistanceMatrixResult } from "../types";
import { fetchDistanceMatrix, isGoogleMapsConfigured } from "./googleMapsClient";
import { loadDistanceCache, saveDistanceCache } from "./storage";

// In-memory cache mirrors localStorage for fast lookups within the session.
let memoryCache: Record<string, DistanceCacheEntry> = loadDistanceCache();

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — traffic patterns for a given hour-of-day are reused within a day

/** Rough straight-line-ish static fallback (minutes) for common Mauritius airport <-> hotel
 *  belt routes, used only when the live API call fails or an address won't geocode.
 *  These are deliberately conservative (on the high side) since dispatch should
 *  prefer slack over an optimistic, unsafe estimate. */
const STATIC_FALLBACK_MINUTES = 45;

function normalizeLocation(loc: string): string {
  return loc.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(origin: string, destination: string, departureTime: Date): string {
  const hour = departureTime.getHours();
  return `${normalizeLocation(origin)}|${normalizeLocation(destination)}|h${hour}`;
}

function persistCache(): void {
  saveDistanceCache(memoryCache);
}

/** Resolves the travel time (minutes) between two full address strings, using the
 *  Google Maps Distance Matrix (traffic-aware) with an in-memory + localStorage cache
 *  keyed by origin+destination+hour-of-day. Falls back to a static estimate — flagged
 *  as `estimated: true` — if the API call fails, isn't configured, or the address
 *  won't geocode. */
export async function getTravelTime(
  origin: string,
  destination: string,
  departureTime: Date
): Promise<DistanceMatrixResult> {
  const trimmedOrigin = origin.trim();
  const trimmedDestination = destination.trim();

  if (!trimmedOrigin || !trimmedDestination) {
    return { durationMinutes: STATIC_FALLBACK_MINUTES, estimated: true };
  }
  if (normalizeLocation(trimmedOrigin) === normalizeLocation(trimmedDestination)) {
    return { durationMinutes: 5, estimated: false };
  }

  const key = cacheKey(trimmedOrigin, trimmedDestination, departureTime);
  const cached = memoryCache[key];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return { durationMinutes: cached.durationMinutes, estimated: cached.estimated };
  }

  if (!isGoogleMapsConfigured()) {
    const result: DistanceMatrixResult = {
      durationMinutes: STATIC_FALLBACK_MINUTES,
      estimated: true,
    };
    memoryCache[key] = { ...result, cachedAt: Date.now() };
    persistCache();
    return result;
  }

  try {
    const raw = await fetchDistanceMatrix(trimmedOrigin, trimmedDestination, departureTime);
    let result: DistanceMatrixResult;
    if (raw.statusOk && (raw.durationInTrafficMinutes ?? raw.durationMinutes) != null) {
      result = {
        durationMinutes: Math.round(
          (raw.durationInTrafficMinutes ?? raw.durationMinutes) as number
        ),
        estimated: false,
      };
    } else {
      result = { durationMinutes: STATIC_FALLBACK_MINUTES, estimated: true };
    }
    memoryCache[key] = { ...result, cachedAt: Date.now() };
    persistCache();
    return result;
  } catch {
    const result: DistanceMatrixResult = {
      durationMinutes: STATIC_FALLBACK_MINUTES,
      estimated: true,
    };
    memoryCache[key] = { ...result, cachedAt: Date.now() };
    persistCache();
    return result;
  }
}

export function clearDistanceCache(): void {
  memoryCache = {};
  persistCache();
}

export function getDistanceCacheSize(): number {
  return Object.keys(memoryCache).length;
}
