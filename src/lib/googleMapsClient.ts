// Loads the Google Maps JavaScript API once and exposes a promise-based
// Distance Matrix lookup. We use the JS API's DistanceMatrixService (not a
// raw fetch to the REST endpoint) because the REST Distance Matrix endpoint
// does not support browser CORS — the JS library handles that for us.

declare global {
  interface Window {
    google?: typeof google;
    __vmpGoogleMapsCallback?: () => void;
  }
}

let loadPromise: Promise<void> | null = null;

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
