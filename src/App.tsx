import { useEffect, useState } from "react";
import type { Assignment, Driver, ParsedTripRow, Trip } from "./types";
import { classifyTrips } from "./lib/parser";
import { autoAssign, recomputeDriverLane } from "./lib/assignment";
import {
  loadAppState,
  saveRoster,
  saveTrips,
  saveAssignments,
  clearTripsOnly,
} from "./lib/storage";
import { isGoogleMapsConfigured } from "./lib/googleMapsClient";
import SetupScreen from "./components/SetupScreen";
import DispatchBoard from "./components/DispatchBoard";
import "./App.css";

type View = "setup" | "board";

export default function App() {
  const initial = loadAppState();

  const [roster, setRoster] = useState<Driver[]>(initial.roster);
  const [trips, setTrips] = useState<Trip[]>(initial.trips);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>(
    initial.assignments
  );
  const [view, setView] = useState<View>(initial.trips.length > 0 ? "board" : "setup");
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    saveRoster(roster);
  }, [roster]);

  useEffect(() => {
    saveTrips(trips);
  }, [trips]);

  useEffect(() => {
    saveAssignments(assignments);
  }, [assignments]);

  function handleRosterConfirmed(drivers: Driver[]) {
    setRoster(drivers);
  }

  async function handleAutoAssign(drivers: Driver[], rows: ParsedTripRow[]) {
    setIsAssigning(true);
    try {
      const { trips: classified } = classifyTrips(rows.filter((r) => !r.parseError));
      const result = await autoAssign(drivers, classified);
      setTrips(classified);
      setAssignments(result);
      setView("board");
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleRerun() {
    if (trips.length === 0) return;
    setIsAssigning(true);
    try {
      const result = await autoAssign(roster, trips);
      setAssignments(result);
    } finally {
      setIsAssigning(false);
    }
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>VMP Transfer Planner</h1>
          <div className="subtitle">
            {isGoogleMapsConfigured()
              ? "Live traffic-aware routing"
              : "Google Maps key not set — using estimated travel times"}
          </div>
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

      {view === "setup" ? (
        <SetupScreen
          savedRoster={roster}
          onRosterConfirmed={handleRosterConfirmed}
          onAutoAssignRequested={handleAutoAssign}
          isAssigning={isAssigning}
        />
      ) : (
        <DispatchBoard
          drivers={roster}
          trips={trips}
          assignments={assignments}
          onReassign={handleReassign}
        />
      )}
    </div>
  );
}
