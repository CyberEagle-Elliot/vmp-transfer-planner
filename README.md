# VMP Transfer Planner

A single-page dispatch tool for planning driver assignments for a Mauritius
airport transfer company. Upload today's trip sheet, auto-assign drivers
using traffic-aware routing, and export a per-driver WhatsApp schedule.

No backend — everything runs in the browser. Session state (roster, trips,
manual overrides, travel-time cache) is persisted to `localStorage`.

## Getting started

```bash
npm install
cp .env.example .env
# edit .env and set VITE_GOOGLE_MAPS_API_KEY
npm run dev
```

Open the printed local URL. Without an API key the app still works, using a
flat fallback travel-time estimate for every route (clearly flagged as
"Estimated, not live" on affected trip cards).

## Google Maps API key setup — read before deploying

This app calls the **Distance Matrix** service (via the Google Maps
JavaScript API's `DistanceMatrixService`, loaded client-side) to get
traffic-aware driving times between pickup/drop-off addresses.

1. In Google Cloud Console, create an API key.
2. Enable the **Maps JavaScript API** (which includes Distance Matrix) for
   the project.
3. **Restrict the key before using it anywhere but localhost:**
   - Under "Application restrictions", choose **HTTP referrers** and list
     the exact domain(s) this app will be served from (e.g.
     `https://dispatch.yourcompany.mu/*`).
   - Under "API restrictions", limit the key to the Maps JavaScript API
     only.
   - Set a billing/quota alert — Distance Matrix calls are billed per
     element, and this app calls it live (with `departure_time` set for
     traffic) rather than caching indefinitely.
4. Put the key in `.env` as `VITE_GOOGLE_MAPS_API_KEY`. Never commit `.env`
   or hardcode the key in source — it's git-ignored by default here.

An unrestricted key pasted into a client-side app is usable by anyone who
opens the browser dev tools, so step 3 is not optional for anything beyond
local testing.

## How trips are classified

The uploaded sheet is matched by header name (case-insensitive, any column
order): `Numbering`, `ID`, `Driver`, `Local Time`, `From`, `To`,
`Flight Number`, `Comment`. `Local Time` is parsed as `DD/MM/YYYY HH:MM`.

- **Arrival** — `From` contains "MRU". `Local Time` is treated as the
  flight's landing time.
- **Departure** — `To` contains "MRU". `Local Time` is treated as the
  hotel pickup time.
- **Tour** — `Comment` contains a multi-leg standby/return pattern (e.g.
  `Standby 09:00 Hotel A → Site | Return 14:00 Site → 15:30 Hotel A`). The
  driver is reserved for the full window, from the first pickup time to the
  final ETA.

A blank `Driver` cell means the row is unassigned and eligible for
auto-assign; anything the parser can't read (bad date format, etc.) is
flagged in the preview table for manual fixing before you can auto-assign.

## Assignment algorithm

Trips are processed in chronological order. Each driver tracks `freeAt`
(when they're next available) and `lastLocation` (where they'll be).

- **Arrival**: feasible if the driver can reach `MRU AIRPORT` at least 15
  minutes before landing. On assignment, the driver becomes free 75 minutes
  after landing (worst-case immigration/baggage) plus the drive time to the
  drop-off.
- **Departure**: feasible if the driver can reach the pickup address at
  least 15 minutes before pickup time. On assignment, the driver becomes
  free at pickup time plus the drive time back to the airport.
- **Tour**: the driver is reserved for the whole standby/return window and
  excluded from the feasible pool for any other trip inside it.

Drivers with a shift start/end are only feasible if the trip starts at or
after `shiftStart` and finishes at or before `shiftEnd` — this is checked
even if the routing math would otherwise work.

Among feasible drivers, the trip goes to whichever has the **largest
slack** (most spare time before the trip), to spread tight connections
across the fleet instead of stacking them on one driver. If no driver is
feasible, the trip is marked **UNASSIGNED** — the app never double-books.

Margin badges use the stricter of the routing slack and the headroom
before a shift end: green > 30 min, yellow 10–30 min, red < 10 min (or
unassigned / shift-violating).

Manual reassignment (the dropdown on each trip card) overrides the
algorithm and immediately recalculates slack/colors for both the old and
new driver's lanes, without re-solving the rest of the day.

## Travel-time caching

Every origin→destination lookup passes `departure_time` so
`duration_in_traffic` is used. Results are cached in memory and in
`localStorage`, keyed by origin + destination + hour-of-day, since the same
airport↔hotel pairs repeat many times a day. If a lookup fails or an
address won't geocode, the app falls back to a static estimate and marks
the affected trip card "Estimated, not live".

## Project structure

```
src/
  components/       UI components (setup screen, dispatch board, trip cards, ...)
  lib/
    parser.ts        Excel parsing + trip classification
    assignment.ts     Auto-assign algorithm + slack/margin calculation
    distanceMatrix.ts Cached, traffic-aware travel-time lookups
    googleMapsClient.ts  Thin Google Maps JS API loader/wrapper
    storage.ts        localStorage persistence
    format.ts          Time/date formatting helpers
  types.ts             Shared domain types
```

## Data persistence

- **Roster** (drivers, shift times) persists until you explicitly start a
  fresh roster.
- **Trips, manual overrides, and the travel-time cache** persist across
  reloads too.
- **"Clear day"** resets trips and assignments only — the roster and
  travel-time cache are kept, so tomorrow's upload starts from a clean
  board without re-entering drivers or re-fetching common routes.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build locally
- `npm run lint` — run oxlint
