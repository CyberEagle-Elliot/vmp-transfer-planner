// Core domain types for VMP Transfer Planner

export type TripType = "arrival" | "departure" | "tour" | "unknown";

/** 1 = high (gets trips first), 2 = normal, 3 = low (backup) */
export type DriverPriority = 1 | 2 | 3;

export interface Driver {
  id: string;
  name: string;
  /** Minutes since midnight, or null for no restriction */
  shiftStart: number | null;
  /** Minutes since midnight, or null for no restriction */
  shiftEnd: number | null;
  priority: DriverPriority;
}

/** Raw row as parsed from the spreadsheet, before assignment */
export interface ParsedTripRow {
  rowId: string;
  numbering: string;
  clientId: string;
  driverName: string; // blank = unassigned
  /** driver the customer asked for (hard constraint), blank = none */
  requestedDriverName: string;
  passengerName: string;
  passengerContact: string;
  /** booking amount as text from the sheet, e.g. "23.01" */
  amountRaw: string;
  localTimeRaw: string; // original text, e.g. "01/07/2026 14:30"
  localTime: number | null; // epoch ms, or null if unparsed
  from: string;
  to: string;
  flightNumber: string;
  comment: string;
  /** true if this row failed to parse localTime and needs manual fixing */
  parseError: boolean;
}

export interface TourWindow {
  startTime: number; // epoch ms
  endTime: number; // epoch ms
  startLocation: string;
  endLocation: string;
}

/** A trip after classification, ready for the assignment algorithm */
export interface Trip {
  id: string;
  numbering: string;
  clientId: string;
  type: TripType;
  /** epoch ms - landing time (arrival) / pickup time (departure) / tour start (tour) */
  time: number;
  from: string;
  to: string;
  flightNumber: string;
  comment: string;
  tourWindow: TourWindow | null;
  /** manually pre-assigned driver name from the sheet, blank = unassigned */
  presetDriverName: string;
  /** driver the customer asked for — a hard constraint that beats presets and the auto pool */
  requestedDriverName: string;
  passengerName: string;
  passengerContact: string;
  /** booking amount (revenue), null when the sheet has none */
  amount: number | null;
}

export type MarginColor = "green" | "yellow" | "red";

/** How arrival waiting times are planned: per booking ID (60 min numeric /
 *  75 min with letters) or forced to 60 min for everyone. */
export type WaitMode = "byId" | "all60";

export interface Assignment {
  tripId: string;
  driverId: string | null; // null = unassigned
  slackMinutes: number | null; // null when unassigned
  color: MarginColor;
  /** human-readable reason, mainly for unassigned / shift-violations */
  reason: string;
  /** true when this trip's travel time used a static fallback estimate */
  estimated: boolean;
  /** true when this trip was placed via manual override (not the auto algorithm) */
  manualOverride: boolean;
}

export interface DistanceMatrixResult {
  durationMinutes: number;
  estimated: boolean; // true if this came from static fallback, not the live API
}

export interface DistanceCacheEntry extends DistanceMatrixResult {
  cachedAt: number;
  /** Original (un-normalized) endpoints, kept for display in the travel-times editor */
  origin?: string;
  destination?: string;
}

/** A dispatcher-corrected travel time for a route, in minutes. Overrides both the
 *  live API and the static fallback for every hour of the day. */
export interface TravelOverride {
  origin: string;
  destination: string;
  durationMinutes: number;
}

export interface AppState {
  roster: Driver[];
  trips: Trip[];
  assignments: Record<string, Assignment>; // tripId -> Assignment
  distanceCache: Record<string, DistanceCacheEntry>; // key -> entry
  travelOverrides: Record<string, TravelOverride>; // "origin|destination" (normalized) -> override
  /** Remembered regular drivers: normalized client ID -> driver name.
   *  A soft preference — honored whenever that driver is feasible. */
  clientPreferences: Record<string, string>;
}
