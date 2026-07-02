import { useEffect, useState, useSyncExternalStore } from "react";
import type { Assignment, Driver, ParsedTripRow, Trip } from "./types";
import { classifyTrips } from "./lib/parser";
import {
  autoAssign,
  prefetchRouteTimes,
  recomputeDriverLane,
  normalizeClientId,
} from "./lib/assignment";
import {
  loadAppState,
  saveRoster,
  saveTrips,
  saveAssignments,
  saveClientPreferences,
  clearTripsOnly,
} from "./lib/storage";
import { getMapsStatus, subscribeMapsStatus } from "./lib/googleMapsClient";
import { getTravelTime } from "./lib/distanceMatrix";
import SetupScreen from "./components/SetupScreen";
import DispatchBoard from "./components/DispatchBoard";
import TravelTimesPanel from "./components/TravelTimesPanel";
import "./App.css";

type View = "setup" | "board";

export default function App() {
  const initial = loadAppState();

  const [roster, setRoster] = useState<Driver[]>(initial.roster);
  const [trips, setTrips] = useState<Trip[]>(initial.trips);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>(
    initial.assignments
  );
  const [clientPreferences, setClientPreferences] = useState<Record<string, string>>(
    initial.clientPreferences
  );
  const [view, setView] = useState<View>(initial.trips.length > 0 ? "board" : "setup");
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignProgress, setAssignProgress] = useState<{
    done: number;
    total: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    // Startup self-test: fire one route lookup so the header immediately shows
    // whether Google Maps accepts this site's key, instead of waiting for a re-plan.
    if (getMapsStatus().configured) {
      void getTravelTime(
        "SSR International Airport, Mauritius",
        "Port Louis, Mauritius",
        new Date()
      );
    }
  }, []);

  useEffect(() => {
    saveRoster(roster);
  }, [roster]);

  useEffect(() => {
    saveClientPreferences(clientPreferences);
  }, [clientPreferences]);

  useEffect(() => {
    saveTrips(trips);
  }, [trips]);

  useEffect(() => {
    saveAssignments(assignments);
  }, [assignments]);

  function handleRosterConfirmed(drivers: Driver[]) {
    setRoster(drivers);
  }

  // Phase 1: fetch every drive time the day could need (MRU→hotel, hotel→MRU,
  // hotel→hotel chains). Phase 2: plan on top of that complete data.
  async function runPlanning(
    drivers: Driver[],
    dayTrips: Trip[],
    existing: Record<string, Assignment>
  ): Promise<Record<string, Assignment>> {
    setAssignProgress({ done: 0, total: 1, label: "Checking drive times" });
    await prefetchRouteTimes(dayTrips, (done, total) =>
      setAssignProgress({ done, total, label: "Checking drive times" })
    );
    setAssignProgress({ done: 0, total: dayTrips.length + 1, label: "Planning" });
    return autoAssign(drivers, dayTrips, existing, clientPreferences, (done, total) =>
      setAssignProgress({ done, total, label: "Planning" })
    );
  }

  async function handleAutoAssign(drivers: Driver[], rows: ParsedTripRow[]) {
    setIsAssigning(true);
    const { trips: classified } = classifyTrips(rows.filter((r) => !r.parseError));
    try {
      const result = await runPlanning(drivers, classified, {});
      setTrips(classified);
      setAssignments(result);
      setView("board");
    } finally {
      setIsAssigning(false);
      setAssignProgress(null);
    }
  }

  // Re-plans the whole day but keeps the dispatcher's manual placements pinned.
  // Used by the re-run button and after travel-time corrections.
  async function handleRerun() {
    if (trips.length === 0) return;
    setIsAssigning(true);
    try {
      const result = await runPlanning(roster, trips, assignments);
      setAssignments(result);
    } finally {
      setIsAssigning(false);
      setAssignProgress(null);
    }
  }

  /** Remembers (or forgets, with null) a client's regular driver for future planning. */
  function handleSetClientPreference(clientId: string, driverName: string | null) {
    const key = normalizeClientId(clientId);
    if (!key) return;
    setClientPreferences((prev) => {
      const next = { ...prev };
      if (driverName) next[key] = driverName;
      else delete next[key];
      return next;
    });
  }

  async function handleReassign(tripId: string, newDriverId: string | null) {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const oldDriverId = assignments[tripId]?.driverId ?? null;

    let updated: Record<string, Assignment> = {
      ...assignments,
      [tripId]: {
        tripId,
        driverId: newDriverId,
        slackMinutes: null,
        color: "red",
        reason: "",
        estimated: false,
        manualOverride: true,
      },
    };

    // Recompute the new driver's lane (includes this trip now)
    if (newDriverId) {
      const newDriver = roster.find((d) => d.id === newDriverId);
      if (newDriver) {
        const laneTrips = trips.filter(
          (t) => t.id === tripId || updated[t.id]?.driverId === newDriverId
        );
        updated = await recomputeDriverLane(newDriver, laneTrips, updated);
      }
    }

    // Recompute the old driver's lane (this trip has left it)
    if (oldDriverId && oldDriverId !== newDriverId) {
      const oldDriver = roster.find((d) => d.id === oldDriverId);
      if (oldDriver) {
        const laneTrips = trips.filter(
          (t) => t.id !== tripId && updated[t.id]?.driverId === oldDriverId
        );
        updated = await recomputeDriverLane(oldDriver, laneTrips, updated);
      }
    }

    setAssignments(updated);
  }

  function handleClearDay() {
    clearTripsOnly();
    setTrips([]);
    setAssignments({});
    setView("setup");
  }

  const mapsStatus = useSyncExternalStore(subscribeMapsStatus, getMapsStatus);
  let subtitle: string;
  let subtitleClass = "subtitle";
  if (!mapsStatus.configured) {
    subtitle = "Google Maps key not set — using estimated travel times";
  } else if (mapsStatus.authFailed) {
    subtitle = `Google Maps rejected this site${
      mapsStatus.errorName ? `: ${mapsStatus.errorName}` : ""
    } — using estimates. Fix the key's website restrictions in Google Cloud Console.`;
    subtitleClass = "subtitle subtitle-error";
  } else if (mapsStatus.liveOk) {
    subtitle = "Live traffic-aware routing ✓";
    subtitleClass = "subtitle subtitle-ok";
  } else {
    subtitle = "Google Maps key set — live check pending first route lookup";
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>VMP Transfer Planner</h1>
          <div className={subtitleClass}>{subtitle}</div>
        </div>
        <div className="header-actions">
          {view === "board" && (
            <>
              <button type="button" className="ghost" onClick={() => setView("setup")}>
                Back to setup
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleRerun}
                disabled={isAssigning}
              >
                {isAssigning ? "Re-running…" : "Re-run auto-assign"}
              </button>
              <button type="button" className="ghost" onClick={handleClearDay}>
                Clear day
              </button>
            </>
          )}
        </div>
      </header>

      {assignProgress && (
        <div
          className="assign-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((assignProgress.done / assignProgress.total) * 100)}
        >
          <div
            className="assign-progress-fill"
            style={{ width: `${Math.round((assignProgress.done / assignProgress.total) * 100)}%` }}
          />
          <span className="assign-progress-label">
            {assignProgress.label} {Math.min(assignProgress.done, assignProgress.total)}/
            {assignProgress.total} — {Math.round((assignProgress.done / assignProgress.total) * 100)}%
          </span>
        </div>
      )}

      {view === "setup" ? (
        <SetupScreen
          savedRoster={roster}
          onRosterConfirmed={handleRosterConfirmed}
          onAutoAssignRequested={handleAutoAssign}
          isAssigning={isAssigning}
        />
      ) : (
        <>
          <TravelTimesPanel onOverridesApplied={handleRerun} isAssigning={isAssigning} />
          <DispatchBoard
            drivers={roster}
            trips={trips}
            assignments={assignments}
            clientPreferences={clientPreferences}
            onReassign={handleReassign}
            onSetClientPreference={handleSetClientPreference}
          />
        </>
      )}
    </div>
  );
}
