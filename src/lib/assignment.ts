import type { Assignment, Driver, MarginColor, Trip } from "../types";
import { getTravelTime } from "./distanceMatrix";

export const MRU_AIRPORT = "MRU AIRPORT";
const CLIENT_READY_BUFFER_MIN = 75; // worst-case immigration/baggage buffer
const TURNAROUND_BUFFER_MIN = 15;
/** Slack above which a connection is considered safe; among these drivers we
 *  optimize for least deadhead + workload balance instead of raw slack. */
const COMFORTABLE_SLACK_MIN = 30;

function minutesToMs(min: number): number {
  return min * 60 * 1000;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function shiftMinutesToTimestamp(dayStartMs: number, minutesSinceMidnight: number): number {
  return dayStartMs + minutesToMs(minutesSinceMidnight);
}

interface DriverRunState {
  driver: Driver;
  freeAt: number; // epoch ms
  lastLocation: string;
  tourWindows: { startTime: number; endTime: number }[];
  tripCount: number;
  /** Accumulated driving/duty minutes today (deadhead + trip legs + tour windows) —
   *  the fatigue measure used to balance workload across the fleet. */
  workMinutes: number;
}

function initDriverStates(drivers: Driver[], anchorDayStart: number): Map<string, DriverRunState> {
  const map = new Map<string, DriverRunState>();
  for (const driver of drivers) {
    const freeAt =
      driver.shiftStart !== null
        ? shiftMinutesToTimestamp(anchorDayStart, driver.shiftStart)
        : anchorDayStart;
    map.set(driver.id, {
      driver,
      freeAt,
      lastLocation: "base",
      tourWindows: [],
      tripCount: 0,
      workMinutes: 0,
    });
  }
  return map;
}

function normalizeDriverName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeClientId(clientId: string): string {
  return clientId.trim().toLowerCase().replace(/\s+/g, " ");
}

function isWithinShiftStart(driver: Driver, dayStart: number, tripTime: number): boolean {
  if (driver.shiftStart === null) return true;
  return tripTime >= shiftMinutesToTimestamp(dayStart, driver.shiftStart);
}

function isWithinShiftEnd(driver: Driver, dayStart: number, completionTime: number): boolean {
  if (driver.shiftEnd === null) return true;
  return completionTime <= shiftMinutesToTimestamp(dayStart, driver.shiftEnd);
}

function shiftHeadroomMinutes(driver: Driver, dayStart: number, completionTime: number): number {
  if (driver.shiftEnd === null) return Infinity;
  const shiftEndTs = shiftMinutesToTimestamp(dayStart, driver.shiftEnd);
  return (shiftEndTs - completionTime) / 60000;
}

function colorFor(slackMinutes: number | null): MarginColor {
  if (slackMinutes === null) return "red";
  if (slackMinutes > 30) return "green";
  if (slackMinutes >= 10) return "yellow";
  return "red";
}

function overlapsTourWindow(state: DriverRunState, tripTime: number): boolean {
  return state.tourWindows.some((w) => tripTime >= w.startTime && tripTime <= w.endTime);
}

interface FeasibilityResult {
  feasible: boolean;
  routingSlackMinutes: number;
  completionTime: number;
  travelToStartMinutes: number;
  estimated: boolean;
  reason?: string;
}

async function checkFeasibility(
  trip: Trip,
  state: DriverRunState,
  dayStart: number
): Promise<FeasibilityResult> {
  if (overlapsTourWindow(state, trip.time)) {
    return {
      feasible: false,
      routingSlackMinutes: -Infinity,
      completionTime: trip.time,
      travelToStartMinutes: 0,
      estimated: false,
      reason: `${state.driver.name} is on a reserved tour during this time`,
    };
  }

  if (!isWithinShiftStart(state.driver, dayStart, trip.time)) {
    return {
      feasible: false,
      routingSlackMinutes: -Infinity,
      completionTime: trip.time,
      travelToStartMinutes: 0,
      estimated: false,
      reason: `starts before ${state.driver.name}'s shift start`,
    };
  }

  if (trip.type === "arrival") {
    const clientReadyTime = trip.time + minutesToMs(CLIENT_READY_BUFFER_MIN);
    const travelToAirport = await getTravelTime(
      state.lastLocation,
      MRU_AIRPORT,
      new Date(state.freeAt)
    );
    const requiredArrival = state.freeAt + minutesToMs(travelToAirport.durationMinutes + TURNAROUND_BUFFER_MIN);
    const feasibleRouting = requiredArrival <= trip.time;
    const routingSlackMinutes = (trip.time - requiredArrival) / 60000;

    const travelToDest = await getTravelTime(MRU_AIRPORT, trip.to, new Date(clientReadyTime));
    const completionTime = clientReadyTime + minutesToMs(travelToDest.durationMinutes);
    const withinShiftEnd = isWithinShiftEnd(state.driver, dayStart, completionTime);

    if (!feasibleRouting) {
      return {
        feasible: false,
        routingSlackMinutes,
        completionTime,
        travelToStartMinutes: travelToAirport.durationMinutes,
        estimated: travelToAirport.estimated || travelToDest.estimated,
        reason: `${state.driver.name} can't reach the airport in time`,
      };
    }
    if (!withinShiftEnd) {
      return {
        feasible: false,
        routingSlackMinutes,
        completionTime,
        travelToStartMinutes: travelToAirport.durationMinutes,
        estimated: travelToAirport.estimated || travelToDest.estimated,
        reason: `ends after ${state.driver.name}'s shift end`,
      };
    }
    return {
      feasible: true,
      routingSlackMinutes,
      completionTime,
      travelToStartMinutes: travelToAirport.durationMinutes,
      estimated: travelToAirport.estimated || travelToDest.estimated,
    };
  }

  if (trip.type === "departure") {
    const travelToPickup = await getTravelTime(
      state.lastLocation,
      trip.from,
      new Date(state.freeAt)
    );
    const requiredArrival = state.freeAt + minutesToMs(travelToPickup.durationMinutes + TURNAROUND_BUFFER_MIN);
    const feasibleRouting = requiredArrival <= trip.time;
    const routingSlackMinutes = (trip.time - requiredArrival) / 60000;

    const travelToAirport = await getTravelTime(trip.from, MRU_AIRPORT, new Date(trip.time));
    const completionTime = trip.time + minutesToMs(travelToAirport.durationMinutes);
    const withinShiftEnd = isWithinShiftEnd(state.driver, dayStart, completionTime);

    if (!feasibleRouting) {
      return {
        feasible: false,
        routingSlackMinutes,
        completionTime,
        travelToStartMinutes: travelToPickup.durationMinutes,
        estimated: travelToPickup.estimated || travelToAirport.estimated,
        reason: `${state.driver.name} can't reach the pickup in time`,
      };
    }
    if (!withinShiftEnd) {
      return {
        feasible: false,
        routingSlackMinutes,
        completionTime,
        travelToStartMinutes: travelToPickup.durationMinutes,
        estimated: travelToPickup.estimated || travelToAirport.estimated,
        reason: `ends after ${state.driver.name}'s shift end`,
      };
    }
    return {
      feasible: true,
      routingSlackMinutes,
      completionTime,
      travelToStartMinutes: travelToPickup.durationMinutes,
      estimated: travelToPickup.estimated || travelToAirport.estimated,
    };
  }

  if (trip.type === "tour" && trip.tourWindow) {
    const travelToStart = await getTravelTime(
      state.lastLocation,
      trip.tourWindow.startLocation,
      new Date(state.freeAt)
    );
    const requiredArrival = state.freeAt + minutesToMs(travelToStart.durationMinutes + TURNAROUND_BUFFER_MIN);
    const feasibleRouting = requiredArrival <= trip.tourWindow.startTime;
    const routingSlackMinutes = (trip.tourWindow.startTime - requiredArrival) / 60000;
    const completionTime = trip.tourWindow.endTime;
    const withinShiftEnd = isWithinShiftEnd(state.driver, dayStart, completionTime);

    if (!feasibleRouting) {
      return {
        feasible: false,
        routingSlackMinutes,
        completionTime,
        travelToStartMinutes: travelToStart.durationMinutes,
        estimated: travelToStart.estimated,
        reason: `${state.driver.name} can't reach the tour start in time`,
      };
    }
    if (!withinShiftEnd) {
      return {
        feasible: false,
        routingSlackMinutes,
        completionTime,
        travelToStartMinutes: travelToStart.durationMinutes,
        estimated: travelToStart.estimated,
        reason: `tour ends after ${state.driver.name}'s shift end`,
      };
    }
    return {
      feasible: true,
      routingSlackMinutes,
      completionTime,
      travelToStartMinutes: travelToStart.durationMinutes,
      estimated: travelToStart.estimated,
    };
  }

  return {
    feasible: false,
    routingSlackMinutes: -Infinity,
    completionTime: trip.time,
    travelToStartMinutes: 0,
    estimated: false,
    reason: "Trip could not be classified (not an arrival, departure, or tour)",
  };
}

function applyAssignment(state: DriverRunState, trip: Trip, feas: FeasibilityResult): void {
  state.tripCount++;
  state.workMinutes += feas.travelToStartMinutes; // deadhead to reach the job
  if (trip.type === "arrival") {
    const clientReadyTime = trip.time + minutesToMs(CLIENT_READY_BUFFER_MIN);
    state.workMinutes += Math.max(0, (feas.completionTime - clientReadyTime) / 60000);
    state.freeAt = feas.completionTime;
    state.lastLocation = trip.to;
  } else if (trip.type === "departure") {
    state.workMinutes += Math.max(0, (feas.completionTime - trip.time) / 60000);
    state.freeAt = feas.completionTime;
    state.lastLocation = MRU_AIRPORT;
  } else if (trip.type === "tour" && trip.tourWindow) {
    state.workMinutes +=
      (trip.tourWindow.endTime - trip.tourWindow.startTime) / 60000;
    state.freeAt = trip.tourWindow.endTime;
    state.lastLocation = trip.tourWindow.endLocation;
    state.tourWindows.push({
      startTime: trip.tourWindow.startTime,
      endTime: trip.tourWindow.endTime,
    });
  }
}

function buildAssignment(
  trip: Trip,
  driver: Driver,
  feas: FeasibilityResult,
  dayStart: number
): Assignment {
  const shiftHeadroom = shiftHeadroomMinutes(driver, dayStart, feas.completionTime);
  const finalSlack = Math.min(feas.routingSlackMinutes, shiftHeadroom);
  return {
    tripId: trip.id,
    driverId: driver.id,
    slackMinutes: Number.isFinite(finalSlack) ? Math.round(finalSlack) : null,
    color: colorFor(Number.isFinite(finalSlack) ? finalSlack : null),
    reason: "",
    estimated: feas.estimated,
    manualOverride: false,
  };
}

function unassignedAssignment(trip: Trip, reason: string): Assignment {
  return {
    tripId: trip.id,
    driverId: null,
    slackMinutes: null,
    color: "red",
    reason,
    estimated: false,
    manualOverride: false,
  };
}

/** Picks the winner among feasible drivers.
 *
 *  Comfortable drivers (slack ≥ 30 min) compete on, in order:
 *    1. priority       — high-priority drivers get trips first
 *    2. least deadhead — whoever is already closest to the pickup. Fewer empty
 *       kilometres means less fuel burned, less driver fatigue, and more spare
 *       capacity across the fleet for extra work.
 *    3. least work so far — accumulated driving/duty minutes, so the day's
 *       fatigue spreads evenly within a priority tier
 *    4. largest slack
 *
 *  If nobody is comfortable the trip is tight, and safety beats preference:
 *  the largest slack wins, with priority only breaking exact ties. */
function pickBestDriver(
  candidates: { driver: Driver; feas: FeasibilityResult }[],
  states: Map<string, DriverRunState>
): { driver: Driver; feas: FeasibilityResult } {
  const comfortable = candidates.filter(
    (c) => c.feas.routingSlackMinutes >= COMFORTABLE_SLACK_MIN
  );
  if (comfortable.length === 0) {
    return candidates.reduce((best, c) => {
      if (c.feas.routingSlackMinutes !== best.feas.routingSlackMinutes) {
        return c.feas.routingSlackMinutes > best.feas.routingSlackMinutes ? c : best;
      }
      return c.driver.priority < best.driver.priority ? c : best;
    });
  }
  return comfortable.reduce((best, c) => {
    if (c.driver.priority !== best.driver.priority) {
      return c.driver.priority < best.driver.priority ? c : best;
    }
    if (c.feas.travelToStartMinutes !== best.feas.travelToStartMinutes) {
      return c.feas.travelToStartMinutes < best.feas.travelToStartMinutes ? c : best;
    }
    const cWork = states.get(c.driver.id)!.workMinutes;
    const bestWork = states.get(best.driver.id)!.workMinutes;
    if (cWork !== bestWork) return cWork < bestWork ? c : best;
    return c.feas.routingSlackMinutes > best.feas.routingSlackMinutes ? c : best;
  });
}

interface LaneSim {
  /** true when every trip the caller requires to be feasible came out feasible */
  ok: boolean;
  assignments: Record<string, Assignment>;
}

/** Replays a hypothetical lane for one driver from scratch, chronologically.
 *  `mustBeFeasible` lets the caller tolerate trips that were already infeasible
 *  before (e.g. a forced manual pin) while insisting the rest stay healthy. */
async function simulateLane(
  driver: Driver,
  laneTrips: Trip[],
  dayStart: number,
  mustBeFeasible: (tripId: string) => boolean
): Promise<LaneSim> {
  const ordered = [...laneTrips].sort((a, b) => a.time - b.time);
  const state: DriverRunState = {
    driver,
    freeAt:
      driver.shiftStart !== null ? shiftMinutesToTimestamp(dayStart, driver.shiftStart) : dayStart,
    lastLocation: "base",
    tourWindows: [],
    tripCount: 0,
    workMinutes: 0,
  };
  const result: Record<string, Assignment> = {};
  let ok = true;

  for (const trip of ordered) {
    const feas = await checkFeasibility(trip, state, dayStart);
    applyAssignment(state, trip, feas);
    if (feas.feasible) {
      result[trip.id] = buildAssignment(trip, driver, feas, dayStart);
    } else {
      if (mustBeFeasible(trip.id)) ok = false;
      result[trip.id] = {
        tripId: trip.id,
        driverId: driver.id,
        slackMinutes: null,
        color: "red",
        reason: feas.reason ?? "Not feasible for this driver",
        estimated: feas.estimated,
        manualOverride: false,
      };
    }
  }
  return { ok, assignments: result };
}

/** Repair pass for trips the greedy sweep couldn't cover: tries to free up a
 *  driver by moving exactly one of their auto-placed trips to a colleague.
 *  A rescue only commits when the whole reshuffle is feasible — the uncovered
 *  trip gets a driver, the moved trip stays covered, and no healthy trip on
 *  either lane turns infeasible. Locked trips (customer requests, sheet
 *  presets, manual pins) are never moved. Mutates `assignments` in place. */
async function rescueUnassigned(
  drivers: Driver[],
  trips: Trip[],
  assignments: Record<string, Assignment>,
  dayStart: number
): Promise<void> {
  const laneOf = (driverId: string) =>
    trips.filter((t) => assignments[t.id]?.driverId === driverId);
  const isLocked = (t: Trip) =>
    t.requestedDriverName.trim() !== "" ||
    t.presetDriverName.trim() !== "" ||
    (assignments[t.id]?.manualOverride ?? false);

  const rescuable = trips
    .filter((t) => assignments[t.id]?.driverId === null && !isLocked(t))
    .sort((a, b) => a.time - b.time);

  const commitLane = (sim: LaneSim) => {
    for (const [id, a] of Object.entries(sim.assignments)) {
      assignments[id] = { ...a, manualOverride: assignments[id]?.manualOverride ?? false };
    }
  };
  // Trips that are currently healthy must stay healthy after a reshuffle
  const stillHealthy = (extraId: string) => (tripId: string) =>
    tripId === extraId || assignments[tripId]?.slackMinutes !== null;

  for (const uncovered of rescuable) {
    let rescued = false;
    for (const overloaded of drivers) {
      const lane = laneOf(overloaded.id);
      for (const moved of lane) {
        if (isLocked(moved)) continue;
        const laneWithoutMoved = lane.filter((t) => t.id !== moved.id).concat(uncovered);
        const simFreed = await simulateLane(
          overloaded,
          laneWithoutMoved,
          dayStart,
          stillHealthy(uncovered.id)
        );
        if (!simFreed.ok) continue;

        for (const colleague of drivers) {
          if (colleague.id === overloaded.id) continue;
          const simColleague = await simulateLane(
            colleague,
            laneOf(colleague.id).concat(moved),
            dayStart,
            stillHealthy(moved.id)
          );
          if (!simColleague.ok) continue;

          commitLane(simFreed);
          commitLane(simColleague);
          rescued = true;
          break;
        }
        if (rescued) break;
      }
      if (rescued) break;
    }
  }
}

/** Assigns a trip to a specific driver no matter what (sheet preset or pinned manual
 *  override), advancing the driver's timeline and flagging infeasibility as a warning. */
async function assignLocked(
  trip: Trip,
  driver: Driver,
  states: Map<string, DriverRunState>,
  dayStart: number,
  manualOverride: boolean
): Promise<Assignment> {
  const state = states.get(driver.id)!;
  const feas = await checkFeasibility(trip, state, dayStart);
  applyAssignment(state, trip, feas);
  if (feas.feasible) {
    return { ...buildAssignment(trip, driver, feas, dayStart), manualOverride };
  }
  return {
    tripId: trip.id,
    driverId: driver.id,
    slackMinutes: null,
    color: "red",
    reason: feas.reason ?? `Not feasible for ${driver.name}`,
    estimated: feas.estimated,
    manualOverride,
  };
}

/** Runs the full auto-assign algorithm from scratch over all trips, in chronological order.
 *
 *  Per trip, in order of authority:
 *    1. trips the dispatcher manually placed (`manualOverride` in `existingAssignments`)
 *    2. the driver the customer requested (`Requested Driver` on the sheet) — hard
 *       constraint: assigned even if tight/infeasible, with a visible warning
 *    3. a Driver name already filled in on the sheet (dispatcher preset) — same handling
 *    4. the client's remembered regular driver (`clientPreferences`) — soft: honored
 *       whenever feasible, otherwise the auto pool takes over with a visible note
 *    5. the auto pool (priority → fewest trips → least deadhead → slack)
 *
 *  Pass the current assignments when re-planning (after a travel-time correction,
 *  roster change, etc.) so manual decisions survive the re-run. */
export async function autoAssign(
  drivers: Driver[],
  trips: Trip[],
  existingAssignments: Record<string, Assignment> = {},
  clientPreferences: Record<string, string> = {},
  /** Called after each placement so the UI can show a progress bar.
   *  `total` includes one extra step for the final rescue pass. */
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, Assignment>> {
  const orderedTrips = [...trips].sort((a, b) => a.time - b.time);
  const progressTotal = orderedTrips.length + 1; // +1 for the rescue pass
  let progressDone = 0;
  const reportProgress = () => onProgress?.(++progressDone, progressTotal);
  const dayStart = orderedTrips.length > 0 ? startOfDay(orderedTrips[0].time) : startOfDay(Date.now());
  const states = initDriverStates(drivers, dayStart);
  const assignments: Record<string, Assignment> = {};

  const driversByName = new Map<string, Driver>();
  const driversById = new Map<string, Driver>();
  for (const driver of drivers) {
    driversByName.set(normalizeDriverName(driver.name), driver);
    driversById.set(driver.id, driver);
  }

  const placeTrip = async (trip: Trip): Promise<void> => {
    // Manual placement by the dispatcher is pinned across re-runs
    const prior = existingAssignments[trip.id];
    if (prior?.manualOverride && prior.driverId) {
      const pinnedDriver = driversById.get(prior.driverId);
      if (pinnedDriver) {
        assignments[trip.id] = await assignLocked(trip, pinnedDriver, states, dayStart, true);
        return;
      }
    }

    // The driver the customer asked for is a hard constraint
    const requestedName = trip.requestedDriverName.trim();
    if (requestedName) {
      const requested = driversByName.get(normalizeDriverName(requestedName));
      if (!requested) {
        assignments[trip.id] = unassignedAssignment(
          trip,
          `Customer requested "${requestedName}", who is not in the roster`
        );
        return;
      }
      assignments[trip.id] = await assignLocked(trip, requested, states, dayStart, false);
      return;
    }

    // Preset driver from the sheet wins over the auto pool
    const presetName = trip.presetDriverName.trim();
    if (presetName) {
      const preset = driversByName.get(normalizeDriverName(presetName));
      if (!preset) {
        assignments[trip.id] = unassignedAssignment(
          trip,
          `Sheet assigns "${presetName}", who is not in the roster`
        );
        return;
      }
      assignments[trip.id] = await assignLocked(trip, preset, states, dayStart, false);
      return;
    }

    // Check every driver in parallel — feasibility is read-only over states
    const results = await Promise.all(
      drivers.map(async (driver) => ({
        driver,
        feas: await checkFeasibility(trip, states.get(driver.id)!, dayStart),
      }))
    );
    const feasible = results.filter((r) => r.feas.feasible);

    // The client's remembered regular driver gets first refusal when feasible
    const preferredName = clientPreferences[normalizeClientId(trip.clientId)];
    if (preferredName && feasible.length > 0) {
      const preferred = feasible.find(
        (r) => normalizeDriverName(r.driver.name) === normalizeDriverName(preferredName)
      );
      if (preferred) {
        applyAssignment(states.get(preferred.driver.id)!, trip, preferred.feas);
        assignments[trip.id] = buildAssignment(trip, preferred.driver, preferred.feas, dayStart);
        return;
      }
    }

    if (feasible.length === 0) {
      // Report the closest miss: the driver who came nearest to making it
      let closest: { driver: Driver; feas: FeasibilityResult } | null = null;
      for (const r of results) {
        if (!r.feas.reason) continue;
        if (!closest || r.feas.routingSlackMinutes > closest.feas.routingSlackMinutes) {
          closest = r;
        }
      }
      assignments[trip.id] = unassignedAssignment(
        trip,
        closest?.feas.reason ?? "No driver available"
      );
      return;
    }

    const best = pickBestDriver(feasible, states);
    applyAssignment(states.get(best.driver.id)!, trip, best.feas);
    const assignment = buildAssignment(trip, best.driver, best.feas, dayStart);
    if (preferredName) {
      // A remembered preference existed but that driver couldn't take this trip
      assignment.reason = `Client's regular driver ${preferredName} isn't available for this trip`;
    }
    assignments[trip.id] = assignment;
  };

  for (const trip of orderedTrips) {
    await placeTrip(trip);
    reportProgress();
  }

  // The greedy sweep is myopic: an early comfortable assignment can make a later
  // trip impossible for everyone. Try single-move reshuffles to cover the leftovers.
  await rescueUnassigned(drivers, orderedTrips, assignments, dayStart);
  reportProgress();

  return assignments;
}

/** Replays a single driver's assigned trips in chronological order to recompute
 *  freeAt/lastLocation/slack for that lane. Used after a manual reassignment so the
 *  lane's slack/colors stay accurate without re-solving the whole day. Trips assigned
 *  to `driverId` that are not in `assignedTripIds` are ignored (i.e. this recomputes
 *  exactly the set the caller says belongs to this driver post-override). */
export async function recomputeDriverLane(
  driver: Driver,
  driverTrips: Trip[],
  existingAssignments: Record<string, Assignment>
): Promise<Record<string, Assignment>> {
  const ordered = [...driverTrips].sort((a, b) => a.time - b.time);
  const dayStart = ordered.length > 0 ? startOfDay(ordered[0].time) : startOfDay(Date.now());
  const state: DriverRunState = {
    driver,
    freeAt: driver.shiftStart !== null ? shiftMinutesToTimestamp(dayStart, driver.shiftStart) : dayStart,
    lastLocation: "base",
    tourWindows: [],
    tripCount: 0,
    workMinutes: 0,
  };

  const updated: Record<string, Assignment> = { ...existingAssignments };

  for (const trip of ordered) {
    const feas = await checkFeasibility(trip, state, dayStart);
    const prior = existingAssignments[trip.id];
    const manualOverride = prior?.manualOverride ?? false;

    if (!feas.feasible) {
      updated[trip.id] = {
        tripId: trip.id,
        driverId: driver.id,
        slackMinutes: null,
        color: "red",
        reason: feas.reason ?? "Not feasible for this driver",
        estimated: feas.estimated,
        manualOverride,
      };
      // Still advance state using the (infeasible) completion time so downstream
      // trips in this lane reflect the driver actually being there, dispatcher-visible.
      applyAssignment(state, trip, feas);
      continue;
    }

    applyAssignment(state, trip, feas);
    updated[trip.id] = { ...buildAssignment(trip, driver, feas, dayStart), manualOverride };
  }

  return updated;
}
