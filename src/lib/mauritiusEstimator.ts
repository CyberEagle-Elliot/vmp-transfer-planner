// Region-aware travel-time estimator for Mauritius, used when the Google Maps
// API is unavailable (no key, quota, offline, unrecognized address). Much closer
// to reality than a flat island-wide estimate: hotel addresses almost always
// contain a locality name ("Coastal Road, Trou-aux-Biches", "LUX* Grand Gaube"),
// which we match against a gazetteer and convert to driving minutes via
// straight-line distance × a road-winding factor at island average speed.

interface Region {
  name: string;
  keywords: string[];
  lat: number;
  lng: number;
}

/** Straight-line km → road km (Mauritius roads wind around the central plateau) */
const ROAD_FACTOR = 1.35;
const AVG_SPEED_KMH = 55;
const SAME_REGION_MINUTES = 10;
const MIN_TRIP_MINUTES = 12;

const REGIONS: Region[] = [
  // South-east / airport
  { name: "SSR Airport", keywords: ["mru", "airport", "aeroport", "plaine magnien", "ssr international"], lat: -20.43, lng: 57.683 },
  { name: "Mahebourg", keywords: ["mahebourg"], lat: -20.408, lng: 57.7 },
  { name: "Blue Bay", keywords: ["blue bay"], lat: -20.444, lng: 57.717 },
  { name: "Pointe d'Esny", keywords: ["pointe d esny"], lat: -20.425, lng: 57.715 },
  // South
  { name: "Souillac", keywords: ["souillac", "riambel"], lat: -20.517, lng: 57.517 },
  { name: "St Félix", keywords: ["st felix", "saint felix"], lat: -20.5, lng: 57.46 },
  { name: "Bel Ombre", keywords: ["bel ombre"], lat: -20.5, lng: 57.4 },
  { name: "Baie du Cap", keywords: ["baie du cap"], lat: -20.49, lng: 57.38 },
  // South-west
  { name: "Le Morne", keywords: ["le morne"], lat: -20.452, lng: 57.328 },
  { name: "La Gaulette", keywords: ["la gaulette"], lat: -20.427, lng: 57.36 },
  { name: "Chamarel", keywords: ["chamarel"], lat: -20.428, lng: 57.374 },
  { name: "Case Noyale", keywords: ["case noyale"], lat: -20.44, lng: 57.36 },
  // West
  { name: "Black River", keywords: ["black river", "riviere noire"], lat: -20.362, lng: 57.372 },
  { name: "Tamarin", keywords: ["tamarin"], lat: -20.326, lng: 57.371 },
  { name: "Flic en Flac", keywords: ["flic en flac", "wolmar"], lat: -20.274, lng: 57.363 },
  { name: "Albion", keywords: ["albion"], lat: -20.208, lng: 57.396 },
  { name: "Pointe aux Sables", keywords: ["pointe aux sables"], lat: -20.15, lng: 57.47 },
  // Port Louis
  { name: "Port Louis", keywords: ["port louis", "caudan"], lat: -20.161, lng: 57.499 },
  // North-west coast
  { name: "Balaclava", keywords: ["balaclava", "turtle bay"], lat: -20.088, lng: 57.513 },
  { name: "Pointe aux Piments", keywords: ["pointe aux piments"], lat: -20.063, lng: 57.52 },
  { name: "Trou aux Biches", keywords: ["trou aux biches"], lat: -20.035, lng: 57.545 },
  { name: "Mont Choisy", keywords: ["mont choisy"], lat: -20.021, lng: 57.561 },
  { name: "Pointe aux Canonniers", keywords: ["pointe aux canonniers"], lat: -20.004, lng: 57.562 },
  // North
  { name: "Grand Baie", keywords: ["grand baie", "grand bay"], lat: -20.013, lng: 57.581 },
  { name: "Pereybere", keywords: ["pereybere"], lat: -19.996, lng: 57.591 },
  { name: "Cap Malheureux", keywords: ["cap malheureux"], lat: -19.984, lng: 57.614 },
  { name: "Grand Gaube", keywords: ["grand gaube", "calodyne"], lat: -20.006, lng: 57.661 },
  { name: "Goodlands", keywords: ["goodlands"], lat: -20.035, lng: 57.643 },
  { name: "Pamplemousses", keywords: ["pamplemousses"], lat: -20.104, lng: 57.571 },
  // North-east coast
  { name: "Roches Noires", keywords: ["roches noires"], lat: -20.11, lng: 57.712 },
  { name: "Poste Lafayette", keywords: ["poste lafayette"], lat: -20.108, lng: 57.757 },
  // East
  { name: "Belle Mare", keywords: ["belle mare", "palmar"], lat: -20.19, lng: 57.769 },
  { name: "Trou d'Eau Douce", keywords: ["trou d eau douce", "ile aux cerfs"], lat: -20.24, lng: 57.787 },
  { name: "Beau Champ", keywords: ["beau champ", "anahita"], lat: -20.29, lng: 57.76 },
  // Central plateau
  { name: "Quatre Bornes", keywords: ["quatre bornes"], lat: -20.264, lng: 57.479 },
  { name: "Rose Hill", keywords: ["rose hill", "beau bassin"], lat: -20.235, lng: 57.472 },
  { name: "Vacoas", keywords: ["vacoas", "phoenix"], lat: -20.298, lng: 57.478 },
  { name: "Curepipe", keywords: ["curepipe"], lat: -20.317, lng: 57.526 },
  { name: "Moka", keywords: ["moka", "saint pierre", "st pierre"], lat: -20.219, lng: 57.496 },
  { name: "Ebene", keywords: ["ebene"], lat: -20.243, lng: 57.486 },
  { name: "Grand Bassin", keywords: ["grand bassin", "ganga talao", "bois cheri"], lat: -20.418, lng: 57.491 },
];

/** Lowercase, strip accents, collapse punctuation to spaces — so
 *  "Trou-aux-Biches", "Péreybère" and "Trou d'Eau Douce" all match. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findRegion(location: string): Region | null {
  const norm = ` ${normalizeText(location)} `;
  let best: Region | null = null;
  let bestLen = 0;
  for (const region of REGIONS) {
    for (const keyword of region.keywords) {
      if (keyword.length > bestLen && norm.includes(` ${keyword} `)) {
        best = region;
        bestLen = keyword.length;
      }
    }
  }
  return best;
}

function haversineKm(a: Region, b: Region): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Estimated driving minutes between two Mauritius addresses, or null when
 *  either side doesn't mention a known locality. */
export function estimateTravelMinutes(origin: string, destination: string): number | null {
  const from = findRegion(origin);
  const to = findRegion(destination);
  if (!from || !to) return null;
  if (from === to) return SAME_REGION_MINUTES;
  const km = haversineKm(from, to) * ROAD_FACTOR;
  return Math.max(MIN_TRIP_MINUTES, Math.round((km / AVG_SPEED_KMH) * 60));
}
