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

## Running it on GitHub (GitHub Pages)

This is a static frontend, so it can be hosted for free on GitHub Pages.
A ready-made workflow at `.github/workflows/deploy.yml` builds and deploys
the app automatically on every push to `main`.

1. **Push this repo to GitHub** (see the main project README/setup notes,
   or just `git push` once you've added a remote).
2. **Add your Maps key as a repo secret**: repo → *Settings* → *Secrets and
   variables* → *Actions* → *New repository secret* → name it
   `VITE_GOOGLE_MAPS_API_KEY`, paste the key (see the restriction steps
   above — restrict it to your Pages URL's HTTP referrer once you know it).
3. **Enable Pages**: repo → *Settings* → *Pages* → under "Build and
   deployment", set **Source** to **GitHub Actions**.
4. **Push to `main`** (or run the workflow manually from the *Actions* tab).
   The site will publish to `https://<your-username>.github.io/<repo-name>/`.
5. Once you know that URL, go back to Google Cloud Console and lock the API
   key's HTTP referrer restriction to it (e.g.
   `https://your-username.github.io/vmp-transfer-planner/*`).

The build's `base` path is set automatically from the repo name via the
`BASE_PATH` env var in the workflow, so no manual `vite.config.ts` edits
are needed even if you rename the repo.

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
order): `Numbering`, `ID`, `Driver`, `Requested Driver`, `Local Time`,
`From`, `To`, `Flight Number`, `Comment`. `Local Time` is parsed as
`DD/MM/YYYY HH:MM`. All columns except `Local Time`/`From`/`To` are
optional.

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

Each trip is placed by the first rule that applies, in order of authority:

1. **Manual placement** — anything you set via the Reassign dropdown is
   pinned and survives re-runs.
2. **Customer request** — a name in the `Requested Driver` column (aliases:
   `Requested`, `Preferred Driver`, `Client Driver`, `Driver Request`) is a
   hard constraint. The trip is locked to that driver even if the schedule
   is tight or infeasible (flagged red with a warning so you can decide),
   and beats a `Driver` preset on the same row. The card shows
   "★ Customer requested …" — green when honored. If the name isn't in the
   roster, the trip lands in the unassigned lane saying so.
3. **Sheet preset** — a name in the `Driver` column locks the trip the same
   way (dispatcher pre-fill).
4. **Client's regular driver** — a remembered client → driver preference
   (see below) gets first refusal whenever that driver is feasible;
   otherwise the auto pool takes over and the card notes that the regular
   driver wasn't available.
5. **Auto pool** — everything else.

Names are matched against the roster case-insensitively.

**Remembering regular drivers**: on any assigned trip card with a client
ID, click "☆ Remember *driver* for *client*". From then on, every trip for
that client ID prefers that driver automatically (a soft preference — never
at the cost of an impossible schedule). "Forget" removes it. Preferences
persist across days and "Clear day".

Each driver has a **priority** (High / Normal / Low, set in the roster).
Among feasible drivers with a **comfortable margin** (≥ 30 min slack) the
trip goes to, in order: the highest-priority driver, then whoever is
**closest to the pickup** (least deadhead — fewer empty kilometres means
less fuel, less fatigue, and more spare capacity for extra jobs), then
whoever has the **least accumulated driving/duty time** today (so fatigue
spreads evenly within a priority tier). If nobody has a comfortable margin,
safety beats preference: the trip goes to the driver with the **largest
slack**. If no driver is feasible, the trip is marked **UNASSIGNED** with
the closest miss's reason shown — the app never double-books.

**Rescue pass.** The chronological sweep is deliberately greedy, so after it
finishes, any trip left uncovered triggers a repair search: the planner
looks for a single reshuffle — move one auto-placed trip from a driver to a
colleague — that frees someone up for the uncovered trip. A rescue only
commits if the whole reshuffle is feasible and no healthy trip turns
infeasible. Customer requests, sheet presets, and manual placements are
never moved by a rescue.

**Re-running keeps your decisions.** "Re-run auto-assign" (and the re-plan
after a travel-time correction) pins every trip you placed manually via the
Reassign dropdown, and re-optimizes only the rest of the day around them.

**Day overview.** A summary strip above the lanes shows totals at a glance:
trip count, how many still need a driver, critical (<10 min) and tight
(10–30 min) margins, warnings, and each driver's trip load.

Margin badges use the stricter of the routing slack and the headroom
before a shift end: green > 30 min, yellow 10–30 min, red < 10 min (or
unassigned / shift-violating).

Manual reassignment (the dropdown on each trip card) overrides the
algorithm and immediately recalculates slack/colors for both the old and
new driver's lanes, without re-solving the rest of the day.

## Correcting travel times

The **Travel times** panel at the top of the dispatch board lists every
route the planner has used today, with its source: *Live traffic*,
*Estimated* (static fallback), or *Corrected* (yours). If a duration looks
wrong — the API is optimistic about a mountain road, or the fallback
estimate is way off — type the real minutes and hit **Apply & re-plan**.
The whole day is re-planned with your corrected times (manual placements
stay pinned), and the correction is remembered for future days until you
reset it. Corrections beat the live API for every hour of the day.

## Travel-time caching

Every origin→destination lookup passes `departure_time` so
`duration_in_traffic` is used. Results are cached in memory and in
`localStorage`, keyed by origin + destination + hour-of-day, since the same
airport↔hotel pairs repeat many times a day. Cached fallback estimates are
ignored as soon as live lookups are possible again, so a temporary API
failure can't lock in wrong times for the day.

**Safety surplus**: planning adds a flat **15 minutes** on top of every
travel leg (live, estimated, or corrected) to absorb loading, parking, and
everyday traffic surprises. The travel-times panel shows the raw driving
times.

**No API key / lookup failed**: instead of one flat estimate for the whole
island, the app recognizes the locality in each address (Grand Baie,
Flic en Flac, Belle Mare, Trou d'Eau Douce, …) and estimates the driving
time from the real geography — the airport→Grand Baie run comes out around
70 min while airport→Blue Bay is minutes. Only when an address mentions no
known locality does the flat 45 min fallback apply. Estimated legs are
still flagged "Estimated, not live" on the trip cards.

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
