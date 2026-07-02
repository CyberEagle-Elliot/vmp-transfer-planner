import type { DistanceCacheEntry, DistanceMatrixResult, TravelOverride } from "../types";
import { fetchDistanceMatrix, isGoogleMapsConfigured, reportLiveLookupOk } from "./googleMapsClient";
import { estimateTravelMinutes, findRegion } from "./mauritiusEstimator";
import {
  loadDistanceCache,
  saveDistanceCache,
  loadTravelOverrides,
  saveTravelOverrides,
} from "./storage";

// In-memory cache mirrors localStorage for fast lookups within the session.
let memoryCache: Record<string, DistanceCacheEntry> = loadDistanceCache();
// Dispatcher-corrected travel times, keyed "origin|destination" (normalized).
// They beat the live API and the static fallback for every hour of the day.
let manualOverrides: Record<string, TravelOverride> = loadTravelOverrides();

/** Route-library lifetime. Mauritius routes don't change much month to month,
 *  and the library is what keeps the planner light on the Google API: known
 *  routes are served from here, only unknown ones are fetched live. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Last-resort flat fallback (minutes), used only when neither the live API nor
 *  the Mauritius region estimator can resolve a route. Deliberately conservative. */
const STATIC_FALLBACK_MINUTES = 45;

/** A live lookup that hasn't answered by then is treated as failed — a broken
 *  key or flaky network must never hang the whole auto-assign run. */
const LIVE_LOOKUP_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("travel-time lookup timed out")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function fallbackEstimate(origin: string, destination: string): DistanceMatrixResult {
  const regional = estimateTravelMinutes(origin, destination);
  return { durationMinutes: regional ?? STATIC_FALLBACK_MINUTES, estimated: true };
}

function normalizeLocation(loc: string): string {
  return loc.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Traffic band: Mauritius has pronounced morning and evening peaks; within a
 *  band, drive times are similar enough to reuse. Three bands per route keeps
 *  the library small and the Google bill low. */
function timeBand(departureTime: Date): string {
  const hour = departureTime.getHours();
  if (hour >= 7 && hour < 10) return "am";
  if (hour >= 15 && hour < 19) return "pm";
  return "off";
}

function cacheKey(origin: string, destination: string, departureTime: Date): string {
  return `${normalizeLocation(origin)}|${normalizeLocation(destination)}|${timeBand(departureTime)}`;
}

function routeKey(origin: string, destination: string): string {
  return `${normalizeLocation(origin)}|${normalizeLocation(destination)}`;
}

function persistCache(): void {
  saveDistanceCache(memoryCache);
}

// One-time migration: entries saved before the route library used per-hour keys
// ("...|h14"). Fold them into their traffic band, keeping the freshest per band.
(function migrateHourKeys() {
  let changed = false;
  for (const [key, entry] of Object.entries(memoryCache)) {
    const match = key.match(/^(.+)\|h(\d{1,2})$/);
    if (!match) continue;
    const bandDate = new Date();
    bandDate.setHours(parseInt(match[2], 10), 0, 0, 0);
    const newKey = `${match[1]}|${timeBand(bandDate)}`;
    const existing = memoryCache[newKey];
    if (!existing || entry.cachedAt > existing.cachedAt) memoryCache[newKey] = entry;
    delete memoryCache[key];
    changed = true;
  }
  if (changed) persistCache();
})();

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

  // A dispatcher correction for this route always wins
  const override = manualOverrides[routeKey(trimmedOrigin, trimmedDestination)];
  if (override) {
    return { durationMinutes: override.durationMinutes, estimated: false };
  }

  const key = cacheKey(trimmedOrigin, trimmedDestination, departureTime);
  const cached = memoryCache[key];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    // A cached fallback estimate must not block a live lookup once the API is
    // available again — only serve it when live lookups aren't possible anyway.
    if (!cached.estimated || !isGoogleMapsConfigured()) {
      if (!cached.estimated) reportLiveLookupOk(); // fresh live data proves Maps works
      return { durationMinutes: cached.durationMinutes, estimated: cached.estimated };
    }
  }

  const writeCache = (result: DistanceMatrixResult): DistanceMatrixResult => {
    memoryCache[key] = {
      ...result,
      cachedAt: Date.now(),
      origin: trimmedOrigin,
      destination: trimmedDestination,
    };
    persistCache();
    return result;
  };

  if (!isGoogleMapsConfigured()) {
    return writeCache(fallbackEstimate(trimmedOrigin, trimmedDestination));
  }

  // Google rejects departure_time in the past (e.g. re-planning a day already
  // under way) — query "now" instead; current traffic is the best proxy anyway.
  const effectiveDeparture = departureTime.getTime() < Date.now() ? new Date() : departureTime;

  const attemptLive = async (o: string, d: string): Promise<DistanceMatrixResult | null> => {
    const raw = await withTimeout(
      fetchDistanceMatrix(o, d, effectiveDeparture),
      LIVE_LOOKUP_TIMEOUT_MS
    );
    if (raw.statusOk && (raw.durationInTrafficMinutes ?? raw.durationMinutes) != null) {
      reportLiveLookupOk();
      return {
        durationMinutes: Math.round(
          (raw.durationInTrafficMinutes ?? raw.durationMinutes) as number
        ),
        estimated: false,
      };
    }
    return null;
  };

  try {
    let result = await attemptLive(trimmedOrigin, trimmedDestination);
    if (!result) {
      // The exact address wouldn't geocode — retry at village level. Still real
      // live traffic, just measured to the locality instead of the gate.
      const originRegion = findRegion(trimmedOrigin);
      const destRegion = findRegion(trimmedDestination);
      const villageOrigin = originRegion ? `${originRegion.name}, Mauritius` : trimmedOrigin;
      const villageDest = destRegion ? `${destRegion.name}, Mauritius` : trimmedDestination;
      if (villageOrigin !== trimmedOrigin || villageDest !== trimmedDestination) {
        result = await attemptLive(villageOrigin, villageDest);
      }
    }
    return writeCache(result ?? fallbackEstimate(trimmedOrigin, trimmedDestination));
  } catch {
    return writeCache(fallbackEstimate(trimmedOrigin, trimmedDestination));
  }
}

export type RouteSource = "manual" | "live" | "estimated";

export interface KnownRoute {
  key: string; // normalized "origin|destination"
  origin: string;
  destination: string;
  durationMinutes: number;
  source: RouteSource;
}

/** All routes the planner knows about — dispatcher overrides plus every cached
 *  lookup (deduped per origin→destination; the freshest cache entry wins). Feeds
 *  the travel-times editor on the dispatch board. */
export function listKnownRoutes(): KnownRoute[] {
  const routes = new Map<string, KnownRoute>();

  const freshest = new Map<string, DistanceCacheEntry>();
  for (const [key, entry] of Object.entries(memoryCache)) {
    const rKey = key.split("|").slice(0, 2).join("|");
    const existing = freshest.get(rKey);
    if (!existing || entry.cachedAt > existing.cachedAt) freshest.set(rKey, entry);
  }
  for (const [rKey, entry] of freshest) {
    const [normOrigin, normDest] = rKey.split("|");
    routes.set(rKey, {
      key: rKey,
      origin: entry.origin ?? normOrigin,
      destination: entry.destination ?? normDest,
      durationMinutes: entry.durationMinutes,
      source: entry.estimated ? "estimated" : "live",
    });
  }

  for (const [rKey, override] of Object.entries(manualOverrides)) {
    routes.set(rKey, {
      key: rKey,
      origin: override.origin,
      destination: override.destination,
      durationMinutes: override.durationMinutes,
      source: "manual",
    });
  }

  return [...routes.values()].sort(
    (a, b) => a.origin.localeCompare(b.origin) || a.destination.localeCompare(b.destination)
  );
}

/** Records a dispatcher correction for a route's travel time. */
export function setTravelOverride(origin: string, destination: string, minutes: number): void {
  const safe = Math.max(1, Math.round(minutes));
  manualOverrides[routeKey(origin, destination)] = {
    origin: origin.trim(),
    destination: destination.trim(),
    durationMinutes: safe,
  };
  saveTravelOverrides(manualOverrides);
}

/** Removes a correction so the route goes back to live/estimated lookups. */
export function clearTravelOverride(key: string): void {
  delete manualOverrides[key];
  saveTravelOverrides(manualOverrides);
}

export function getTravelOverrides(): Record<string, TravelOverride> {
  return { ...manualOverrides };
}

export function clearDistanceCache(): void {
  memoryCache = {};
  persistCache();
}

export function getDistanceCacheSize(): number {
  return Object.keys(memoryCache).length;
}
