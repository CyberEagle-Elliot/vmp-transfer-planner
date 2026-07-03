import type { Assignment, Driver, Trip } from "../types";
import { formatTime, tripTypeLabel } from "../lib/format";
import { normalizeClientId } from "../lib/assignment";

interface Props {
  trip: Trip;
  assignment: Assignment | undefined;
  drivers: Driver[];
  clientPreferences: Record<string, string>;
  onReassign: (tripId: string, driverId: string | null) => void;
  onSetClientPreference: (clientId: string, driverName: string | null) => void;
}

function sameDriverName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export default function TripCard({
  trip,
  assignment,
  drivers,
  clientPreferences,
  onReassign,
  onSetClientPreference,
}: Props) {
  const unassigned = !assignment || assignment.driverId === null;
  const color = assignment?.color ?? "red";

  const assignedDriver = drivers.find((d) => d.id === assignment?.driverId);
  const requestedName = trip.requestedDriverName.trim();
  const requestHonored =
    requestedName !== "" &&
    assignedDriver !== undefined &&
    sameDriverName(assignedDriver.name, requestedName);

  const preferredName = trip.clientId
    ? clientPreferences[normalizeClientId(trip.clientId)]
    : undefined;
  const canRemember =
    trip.clientId.trim() !== "" &&
    assignedDriver !== undefined &&
    (!preferredName || !sameDriverName(preferredName, assignedDriver.name));

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

      {trip.passengerName && <div className="trip-passenger">{trip.passengerName}</div>}

      <div className="trip-route">
        {tripTypeLabel(trip.type)} · {trip.from || "—"} → {trip.to || "—"}
      </div>

      {requestedName && (
        <div className={`trip-request ${requestHonored ? "honored" : "not-honored"}`}>
          ★ Customer requested {requestedName}
          {!requestHonored && " — not honored"}
        </div>
      )}

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

      {trip.clientId.trim() !== "" && (preferredName || canRemember) && (
        <div className="trip-preference">
          {preferredName && (
            <>
              <span className="pref-label">
                Regular driver for {trip.clientId}: <strong>{preferredName}</strong>
              </span>
              <button
                type="button"
                className="ghost pref-btn"
                onClick={() => onSetClientPreference(trip.clientId, null)}
              >
                Forget
              </button>
            </>
          )}
          {canRemember && (
            <button
              type="button"
              className="ghost pref-btn"
              onClick={() => onSetClientPreference(trip.clientId, assignedDriver!.name)}
            >
              ☆ Remember {assignedDriver!.name} for {trip.clientId}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
