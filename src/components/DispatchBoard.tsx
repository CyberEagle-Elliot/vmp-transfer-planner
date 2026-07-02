import type { Assignment, Driver, Trip } from "../types";
import DriverLane from "./DriverLane";
import TripCard from "./TripCard";

interface Props {
  drivers: Driver[];
  trips: Trip[];
  assignments: Record<string, Assignment>;
  clientPreferences: Record<string, string>;
  onReassign: (tripId: string, driverId: string | null) => void;
  onSetClientPreference: (clientId: string, driverName: string | null) => void;
}

export default function DispatchBoard({
  drivers,
  trips,
  assignments,
  clientPreferences,
  onReassign,
  onSetClientPreference,
}: Props) {
  const sortedTrips = [...trips].sort((a, b) => a.time - b.time);
  const unassigned = sortedTrips.filter((t) => !assignments[t.id]?.driverId);

  if (trips.length === 0) {
    return (
      <div className="empty-state">
        No trips loaded yet. Go back to setup and upload today's sheet.
      </div>
    );
  }

  const assigned = sortedTrips.filter((t) => assignments[t.id]?.driverId);
  const redCount = assigned.filter((t) => assignments[t.id]?.color === "red").length;
  const yellowCount = assigned.filter((t) => assignments[t.id]?.color === "yellow").length;
  const warningCount = assigned.filter((t) => assignments[t.id]?.reason).length;

  return (
    <>
      <div className="board-summary">
        <span className="stat">
          <strong>{sortedTrips.length}</strong> trips
        </span>
        <span className={`stat ${unassigned.length > 0 ? "stat-red" : "stat-green"}`}>
          <strong>{unassigned.length}</strong> need a driver
        </span>
        <span className={`stat ${redCount > 0 ? "stat-red" : ""}`}>
          <strong>{redCount}</strong> critical (&lt;10 min)
        </span>
        <span className={`stat ${yellowCount > 0 ? "stat-yellow" : ""}`}>
          <strong>{yellowCount}</strong> tight (10–30 min)
        </span>
        <span className={`stat ${warningCount > 0 ? "stat-yellow" : ""}`}>
          <strong>{warningCount}</strong> warning{warningCount === 1 ? "" : "s"}
        </span>
        <span className="stat-divider" />
        {drivers.map((driver) => {
          const count = assigned.filter((t) => assignments[t.id]?.driverId === driver.id).length;
          return (
            <span key={driver.id} className="stat driver-load">
              {driver.name} <strong>{count}</strong>
            </span>
          );
        })}
      </div>
      <div className="board">
      <div className="lane unassigned-lane">
        <div className="lane-header">
          <h3>Needs driver</h3>
          <div className="lane-meta">{unassigned.length} unassigned</div>
        </div>
        <div className="lane-body">
          {unassigned.length === 0 && <p className="empty-state">Everything's covered.</p>}
          {unassigned.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              assignment={assignments[trip.id]}
              drivers={drivers}
              clientPreferences={clientPreferences}
              onReassign={onReassign}
              onSetClientPreference={onSetClientPreference}
            />
          ))}
        </div>
      </div>

      {drivers.map((driver) => (
        <DriverLane
          key={driver.id}
          driver={driver}
          trips={sortedTrips.filter((t) => assignments[t.id]?.driverId === driver.id)}
          allTrips={sortedTrips}
          drivers={drivers}
          assignments={assignments}
          clientPreferences={clientPreferences}
          onReassign={onReassign}
          onSetClientPreference={onSetClientPreference}
        />
      ))}
      </div>
    </>
  );
}
