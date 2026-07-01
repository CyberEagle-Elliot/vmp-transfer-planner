import type { Assignment, Driver, MarginColor, Trip } from "../types";
import { getTravelTime } from "./distanceMatrix";

export const MRU_AIRPORT = "MRU AIRPORT";
const CLIENT_READY_BUFFER_MIN = 75; // worst-case immigration/baggage buffer
const TURNAROUND_BUFFER_MIN = 15;

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
    });
  }
  return map;
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
  if (trip.type === "arrival") {
    const clientReadyTime = trip.time + minutesToMs(CLIENT_READY_BUFFER_MIN);
    state.freeAt = feas.completionTime;
    state.lastLocation = trip.to;
    void clientReadyTime;
  } else if (trip.type === "departure") {
    state.freeAt = feas.completionTime;
    state.lastLocation = MRU_AIRPORT;
  } else if (trip.type === "tour" && trip.tourWindow) {
    state.freeAt = trip.tourWindow.endTime;
    state.lastLocation = trip.tourWindow.endLocation;
    state.tourWindows.push({
      startTime: trip.tourWindow.startTime,
      endTime: trip.tourWindow.endTime,
    });
  }
}

/** Runs the full auto-assign algorithm from scratch over all trips, in chronological order. */
export async function autoAssign(
  drivers: Driver[],
  trips: Trip[]
): Promise<Record<string, Assignment>> {
  const orderedTrips = [...trips].sort((a, b) => a.time - b.time);
  const dayStart = orderedTrips.length > 0 ? startOfDay(orderedTrips[0].time) : startOfDay(Date.now());
  const states = initDriverStates(drivers, dayStart);
  const assignments: Record<string, Assignment> = {};

  for (const trip of orderedTrips) {
    let best: { driverId: string; feas: FeasibilityResult } | null = null;

    for (const driver of drivers) {
      const state = states.get(driver.id)!;
      const feas = await checkFeasibility(trip, state, dayStart);
      if (!feas.feasible) continue;
      if (!best || feas.routingSlackMinutes > best.feas.routingSlackMinutes) {
        best = { driverId: driver.id, feas };
      }
    }

    if (!best) {
      // Collect a representative reason from the closest-miss driver, if any drivers exist
      let reason = "No driver available";
      if (drivers.length > 0) {
        const state = states.get(drivers[0].id)!;
        const feas = await checkFeasibility(trip, state, dayStart);
        reason = feas.reason ?? reason;
      }
      assignments[trip.id] = {
        tripId: trip.id,
        driverId: null,
        slackMinutes: null,
        color: "red",
        reason,
        estimated: false,
        manualOverride: false,
      };
      continue;
    }

    const state = states.get(best.driverId)!;
    applyAssignment(state, trip, best.feas);

    const driver = drivers.find((d) => d.id === best!.driverId)!;
    const shiftHeadroom = shiftHeadroomMinutes(driver, dayStart, best.feas.completionTime);
    const finalSlack = Math.min(best.feas.routingSlackMinutes, shiftHeadroom);

    assignments[trip.id] = {
      tripId: trip.id,
      driverId: best.driverId,
      slackMinutes: Number.isFinite(finalSlack) ? Math.round(finalSlack) : null,
      color: colorFor(Number.isFinite(finalSlack) ? finalSlack : null),
      reason: "",
      estimated: best.feas.estimated,
      manualOverride: false,
    };
  }

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
    const shiftHeadroom = shiftHeadroomMinutes(driver, dayStart, feas.completionTime);
    const finalSlack = Math.min(feas.routingSlackMinutes, shiftHeadroom);

    updated[trip.id] = {
      tripId: trip.id,
      driverId: driver.id,
      slackMinutes: Number.isFinite(finalSlack) ? Math.round(finalSlack) : null,
      color: colorFor(Number.isFinite(finalSlack) ? finalSlack : null),
      reason: "",
      estimated: feas.estimated,
      manualOverride,
    };
  }

  return updated;
}
