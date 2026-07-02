// Loads the Google Maps JavaScript API once and exposes a promise-based
// Distance Matrix lookup. We use the JS API's DistanceMatrixService (not a
// raw fetch to the REST endpoint) because the REST Distance Matrix endpoint
// does not support browser CORS — the JS library handles that for us.

declare global {
  interface Window {
    google?: typeof google;
    __vmpGoogleMapsCallback?: () => void;
    /** Standard hook Google Maps calls on API-key auth failures (bad key, referrer not allowed) */
    gm_authFailure?: () => void;
  }
}

let loadPromise: Promise<void> | null = null;
let authFailed = false;
let mapsErrorName: string | null = null;
let liveLookupOk = false;

export interface MapsStatus {
  configured: boolean;
  /** Google rejected the key for this page (bad key, referrer blocked, billing off, ...) */
  authFailed: boolean;
  /** The exact Google error name (e.g. "RefererNotAllowedMapError"), when known */
  errorName: string | null;
  /** At least one live traffic lookup succeeded this session */
  liveOk: boolean;
}

let statusSnapshot: MapsStatus = {
  configured: isGoogleMapsConfigured(), // function declarations are hoisted
  authFailed: false,
  errorName: null,
  liveOk: false,
};
const statusListeners = new Set<() => void>();

function emitStatus(): void {
  statusSnapshot = {
    configured: isGoogleMapsConfigured(),
    authFailed,
    errorName: mapsErrorName,
    liveOk: liveLookupOk,
  };
  statusListeners.forEach((cb) => cb());
}

export function getMapsStatus(): MapsStatus {
  return statusSnapshot;
}

export function subscribeMapsStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

/** Called by the travel-time layer when a live lookup returns real data. */
export function reportLiveLookupOk(): void {
  if (liveLookupOk) return;
  liveLookupOk = true;
  emitStatus();
}

if (typeof window !== "undefined") {
  window.gm_authFailure = () => {
    authFailed = true;
    console.warn(
      "Google Maps rejected the API key for this site (check the key's HTTP referrer " +
        "restrictions). Falling back to estimated travel times."
    );
    emitStatus();
  };

  // Google reports the *reason* (RefererNotAllowedMapError, BillingNotEnabledMapError,
  // ApiNotActivatedMapError, ...) only via console.error — intercept it so the UI can
  // show the dispatcher exactly what to fix instead of silently serving estimates.
  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => String(a)).join(" ");
    const match = text.match(/([A-Za-z]+MapError)/);
    if (match && mapsErrorName === null) {
      mapsErrorName = match[1];
      authFailed = true;
      emitStatus();
    }
    originalConsoleError(...args);
  };
}

/** True once Google has rejected the key for this page (e.g. RefererNotAllowedMapError) —
 *  callers should skip live lookups and go straight to estimates. */
export function hasMapsAuthFailed(): boolean {
  return authFailed;
}

function getApiKey(): string {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
}

export function isGoogleMapsConfigured(): boolean {
  return getApiKey().length > 0;
}

export function loadGoogleMaps(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Not in a browser environment"));
      return;
    }
    if (window.google?.maps) {
      resolve();
      return;
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      reject(new Error("VITE_GOOGLE_MAPS_API_KEY is not set"));
      return;
    }

    window.__vmpGoogleMapsCallback = () => resolve();

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&libraries=places&callback=__vmpGoogleMapsCallback`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export interface RawDistanceResult {
  durationInTrafficMinutes: number | null;
  durationMinutes: number | null;
  statusOk: boolean;
}

/** Calls the Distance Matrix service for a single origin/destination pair at a given
 *  departure time. Resolves with statusOk=false (rather than throwing) on any API-level
 *  failure so callers can fall back to a static estimate. */
export async function fetchDistanceMatrix(
  origin: string,
  destination: string,
  departureTime: Date
): Promise<RawDistanceResult> {
  if (authFailed) {
    throw new Error("Google Maps auth failed for this site");
  }
  await loadGoogleMaps();

  return new Promise((resolve) => {
    const service = new google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      {
        origins: [origin],
        destinations: [destination],
        travelMode: google.maps.TravelMode.DRIVING,
        drivingOptions: {
          departureTime,
          trafficModel: google.maps.TrafficModel.BEST_GUESS,
        },
        unitSystem: google.maps.UnitSystem.METRIC,
      },
      (response, status) => {
        if (status !== "OK" || !response) {
          resolve({ durationInTrafficMinutes: null, durationMinutes: null, statusOk: false });
          return;
        }
        const element = response.rows[0]?.elements[0];
        if (!element || element.status !== "OK") {
          resolve({ durationInTrafficMinutes: null, durationMinutes: null, statusOk: false });
          return;
        }
        const durationInTrafficMinutes = element.duration_in_traffic
          ? element.duration_in_traffic.value / 60
          : null;
        const durationMinutes = element.duration ? element.duration.value / 60 : null;
        resolve({ durationInTrafficMinutes, durationMinutes, statusOk: true });
      }
    );
  });
}
