import type { Assignment, Driver, Trip } from "../types";
import TripCard from "./TripCard";
import ExportWhatsAppButton from "./ExportWhatsAppButton";
import { minutesToTimeString } from "../lib/format";

interface Props {
  driver: Driver;
  trips: Trip[];
  allTrips: Trip[];
  drivers: Driver[];
  assignments: Record<string, Assignment>;
  clientPreferences: Record<string, string>;
  onReassign: (tripId: string, driverId: string | null) => void;
  onSetClientPreference: (clientId: string, driverName: string | null) => void;
}

export default function DriverLane({
  driver,
  trips,
  allTrips,
  drivers,
  assignments,
  clientPreferences,
  onReassign,
  onSetClientPreference,
}: Props) {
  const shiftLabel =
    driver.shiftStart !== null || driver.shiftEnd !== null
      ? `${minutesToTimeString(driver.shiftStart) || "00:00"}–${
          minutesToTimeString(driver.shiftEnd) || "24:00"
        }`
      : "No shift restriction";
  const priorityLabel =
    driver.priority === 1 ? " · High priority" : driver.priority === 3 ? " · Low priority" : "";

  return (
    <div className="lane">
      <div className="lane-header">
        <h3>{driver.name}</h3>
        <div className="lane-meta">
          {shiftLabel} · {trips.length} trip{trips.length === 1 ? "" : "s"}
          {priorityLabel}
        </div>
        <ExportWhatsAppButton driver={driver} trips={allTrips} assignments={assignments} />
      </div>
      <div className="lane-body">
        {trips.length === 0 && <p className="empty-state">No trips assigned.</p>}
        {trips.map((trip) => (
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
  );
}
