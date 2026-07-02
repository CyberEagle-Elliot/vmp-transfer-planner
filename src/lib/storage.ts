import type {
  AppState,
  Driver,
  Trip,
  Assignment,
  DistanceCacheEntry,
  TravelOverride,
} from "../types";

const KEYS = {
  roster: "vmp.roster.v1",
  trips: "vmp.trips.v1",
  assignments: "vmp.assignments.v1",
  distanceCache: "vmp.distanceCache.v1",
  travelOverrides: "vmp.travelOverrides.v1",
  clientPreferences: "vmp.clientPreferences.v1",
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
  // Rosters saved before driver priorities existed get "normal" (2)
  return readJSON<Driver[]>(KEYS.roster, []).map((d) => ({
    ...d,
    priority: d.priority === 1 || d.priority === 3 ? d.priority : 2,
  }));
}
export function saveRoster(roster: Driver[]): void {
  writeJSON(KEYS.roster, roster);
}

export function loadTrips(): Trip[] {
  // Trips saved by older versions may miss fields added since; default them
  // so string methods on them don't crash the board.
  return readJSON<Trip[]>(KEYS.trips, []).map((t) => ({
    ...t,
    clientId: t.clientId ?? "",
    presetDriverName: t.presetDriverName ?? "",
    requestedDriverName: t.requestedDriverName ?? "",
  }));
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

export function loadTravelOverrides(): Record<string, TravelOverride> {
  return readJSON<Record<string, TravelOverride>>(KEYS.travelOverrides, {});
}
export function saveTravelOverrides(overrides: Record<string, TravelOverride>): void {
  writeJSON(KEYS.travelOverrides, overrides);
}

export function loadClientPreferences(): Record<string, string> {
  return readJSON<Record<string, string>>(KEYS.clientPreferences, {});
}
export function saveClientPreferences(prefs: Record<string, string>): void {
  writeJSON(KEYS.clientPreferences, prefs);
}

export function loadAppState(): AppState {
  return {
    roster: loadRoster(),
    trips: loadTrips(),
    assignments: loadAssignments(),
    distanceCache: loadDistanceCache(),
    travelOverrides: loadTravelOverrides(),
    clientPreferences: loadClientPreferences(),
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
