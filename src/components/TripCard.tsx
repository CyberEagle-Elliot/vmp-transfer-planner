import type { Assignment, Driver, Trip } from "../types";
import { formatTime, tripTypeLabel } from "../lib/format";

interface Props {
  trip: Trip;
  assignment: Assignment | undefined;
  drivers: Driver[];
  onReassign: (tripId: string, driverId: string | null) => void;
}

export default function TripCard({ trip, assignment, drivers, onReassign }: Props) {
  const unassigned = !assignment || assignment.driverId === null;
  const color = assignment?.color ?? "red";

  return (
    <div className={`trip-card ${unassigned ? "unassigned" : ""}`}>
      <div className="trip-card-top">
        <span className="trip-time">{formatTime(trip.time)}</span>
        <span className={`badge badge-${color}`}>
          {unassigned
            ? "Unassigned"
            : assignment?.slackMinutes !== null && assignment?.slackMinutes !== undefined
              ? `${assignment.slackMinutes} min slack`
              : "No slack"}
        </span>
      </div>

      <div className="trip-route">
        {tripTypeLabel(trip.type)} · {trip.from || "—"} → {trip.to || "—"}
      </div>

      <div className="trip-meta">
        {trip.numbering && <>#{trip.numbering} </>}
        {trip.clientId && <>· {trip.clientId} </>}
        {trip.flightNumber && <>· Flight {trip.flightNumber}</>}
      </div>

      {trip.comment && <div className="trip-comment">{trip.comment}</div>}

      {assignment?.estimated && (
        <div className="trip-estimated-flag">Estimated, not live</div>
      )}

      {assignment?.reason && (
        <div className="trip-reason">
          {unassigned ? assignment.reason : `Warning: ${assignment.reason}`}
        </div>
      )}

      <div className="trip-reassign">
        <label htmlFor={`reassign-${trip.id}`}>Reassign</label>
        <select
          id={`reassign-${trip.id}`}
          value={assignment?.driverId ?? ""}
          onChange={(e) => onReassign(trip.id, e.target.value || null)}
        >
          <option value="">— Unassigned —</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
