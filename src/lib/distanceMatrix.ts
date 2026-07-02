import type { DistanceCacheEntry, DistanceMatrixResult, TravelOverride } from "../types";
import { fetchDistanceMatrix, isGoogleMapsConfigured } from "./googleMapsClient";
import { estimateTravelMinutes } from "./mauritiusEstimator";
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

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — traffic patterns for a given hour-of-day are reused within a day

/** Last-resort flat fallback (minutes), used only when neither the live API nor
 *  the Mauritius region estimator can resolve a route. Deliberately conservative. */
const STATIC_FALLBACK_MINUTES = 45;

/** Safety surplus added on top of every travel time used for planning, so the
 *  schedule absorbs loading, parking, and everyday traffic surprises. Raw times
 *  (as returned by Maps / the estimator / corrections) are what's cached and
 *  shown in the travel-times panel; the surplus is applied at planning time. */
const SAFETY_SURPLUS_MIN = 15;

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

function withSurplus(result: DistanceMatrixResult): DistanceMatrixResult {
  return { ...result, durationMinutes: result.durationMinutes + SAFETY_SURPLUS_MIN };
}

function fallbackEstimate(origin: string, destination: string): DistanceMatrixResult {
  const regional = estimateTravelMinutes(origin, destination);
  return { durationMinutes: regional ?? STATIC_FALLBACK_MINUTES, estimated: true };
}

function normalizeLocation(loc: string): string {
  return loc.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(origin: string, destination: string, departureTime: Date): string {
  const hour = departureTime.getHours();
  return `${normalizeLocation(origin)}|${normalizeLocation(destination)}|h${hour}`;
}

function routeKey(origin: string, destination: string): string {
  return `${normalizeLocation(origin)}|${normalizeLocation(destination)}`;
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
    return withSurplus({ durationMinutes: STATIC_FALLBACK_MINUTES, estimated: true });
  }
  if (normalizeLocation(trimmedOrigin) === normalizeLocation(trimmedDestination)) {
    return withSurplus({ durationMinutes: 5, estimated: false });
  }

  // A dispatcher correction for this route always wins
  const override = manualOverrides[routeKey(trimmedOrigin, trimmedDestination)];
  if (override) {
    return withSurplus({ durationMinutes: override.durationMinutes, estimated: false });
  }

  const key = cacheKey(trimmedOrigin, trimmedDestination, departureTime);
  const cached = memoryCache[key];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    // A cached fallback estimate must not block a live lookup once the API is
    // available again — only serve it when live lookups aren't possible anyway.
    if (!cached.estimated || !isGoogleMapsConfigured()) {
      return withSurplus({ durationMinutes: cached.durationMinutes, estimated: cached.estimated });
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
    return withSurplus(result);
  };

  if (!isGoogleMapsConfigured()) {
    return writeCache(fallbackEstimate(trimmedOrigin, trimmedDestination));
  }

  try {
    const raw = await withTimeout(
      fetchDistanceMatrix(trimmedOrigin, trimmedDestination, departureTime),
      LIVE_LOOKUP_TIMEOUT_MS
    );
    if (raw.statusOk && (raw.durationInTrafficMinutes ?? raw.durationMinutes) != null) {
      return writeCache({
        durationMinutes: Math.round(
          (raw.durationInTrafficMinutes ?? raw.durationMinutes) as number
        ),
        estimated: false,
      });
    }
    return writeCache(fallbackEstimate(trimmedOrigin, trimmedDestination));
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
