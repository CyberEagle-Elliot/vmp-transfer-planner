import type { Assignment, Driver, Trip } from "../types";
import DriverLane from "./DriverLane";
import TripCard from "./TripCard";

interface Props {
  drivers: Driver[];
  trips: Trip[];
  assignments: Record<string, Assignment>;
  onReassign: (tripId: string, driverId: string | null) => void;
}

export default function DispatchBoard({ drivers, trips, assignments, onReassign }: Props) {
  const sortedTrips = [...trips].sort((a, b) => a.time - b.time);
  const unassigned = sortedTrips.filter((t) => !assignments[t.id]?.driverId);

  if (trips.length === 0) {
    return (
      <div className="empty-state">
        No trips loaded yet. Go back to setup and upload today's sheet.
      </div>
    );
  }

  return (
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
              onReassign={onReassign}
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
          onReassign={onReassign}
        />
      ))}
    </div>
  );
}
