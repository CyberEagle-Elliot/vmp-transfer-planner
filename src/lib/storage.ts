import type { AppState, Driver, Trip, Assignment, DistanceCacheEntry } from "../types";

const KEYS = {
  roster: "vmp.roster.v1",
  trips: "vmp.trips.v1",
  assignments: "vmp.assignments.v1",
  distanceCache: "vmp.distanceCache.v1",
} as const;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage full or unavailable — fail silently, app still works in-memory
  }
}

export function loadRoster(): Driver[] {
  return readJSON<Driver[]>(KEYS.roster, []);
}
export function saveRoster(roster: Driver[]): void {
  writeJSON(KEYS.roster, roster);
}

export function loadTrips(): Trip[] {
  return readJSON<Trip[]>(KEYS.trips, []);
}
export function saveTrips(trips: Trip[]): void {
  writeJSON(KEYS.trips, trips);
}

export function loadAssignments(): Record<string, Assignment> {
  return readJSON<Record<string, Assignment>>(KEYS.assignments, {});
}
export function saveAssignments(assignments: Record<string, Assignment>): void {
  writeJSON(KEYS.assignments, assignments);
}

export function loadDistanceCache(): Record<string, DistanceCacheEntry> {
  return readJSON<Record<string, DistanceCacheEntry>>(KEYS.distanceCache, {});
}
export function saveDistanceCache(cache: Record<string, DistanceCacheEntry>): void {
  writeJSON(KEYS.distanceCache, cache);
}

export function loadAppState(): AppState {
  return {
    roster: loadRoster(),
    trips: loadTrips(),
    assignments: loadAssignments(),
    distanceCache: loadDistanceCache(),
  };
}

export function clearTripsOnly(): void {
  localStorage.removeItem(KEYS.trips);
  localStorage.removeItem(KEYS.assignments);
  // distance cache and roster intentionally kept
}

export function clearAll(): void {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
}

export function hasSavedRoster(): boolean {
  return loadRoster().length > 0;
}
