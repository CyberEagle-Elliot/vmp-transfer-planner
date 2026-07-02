import * as XLSX from "xlsx";
import type { ParsedTripRow, Trip, TripType, TourWindow } from "../types";

/** Header names we look for, matched case-insensitively, trimmed, in any column order */
const HEADER_ALIASES: Record<string, string[]> = {
  numbering: ["numbering", "number", "no", "no.", "#"],
  id: ["id"],
  driver: ["driver"],
  requestedDriver: [
    "requested driver",
    "requested",
    "request",
    "preferred driver",
    "client driver",
    "driver request",
  ],
  localTime: ["local time", "localtime", "time"],
  from: ["from"],
  to: ["to"],
  flightNumber: ["flight number", "flight no", "flight"],
  comment: ["comment", "comments", "notes"],
};

function normalizeHeader(h: string): string {
  return String(h).trim().toLowerCase();
}

function buildHeaderMap(headerRow: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((raw, idx) => {
    const norm = normalizeHeader(String(raw ?? ""));
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(norm) && !(field in map)) {
        map[field] = idx;
      }
    }
  });
  return map;
}

/** Parses "DD/MM/YYYY HH:MM" (also tolerates "DD-MM-YYYY HH:MM" and single-digit parts). */
export function parseLocalDateTime(raw: string): number | null {
  if (!raw) return null;
  const text = String(raw).trim();

  // Excel sometimes gives us a serial date number as text, or the cell was already
  // parsed as a JS Date by SheetJS (handled separately in parseWorkbook via cellDates).
  const match = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return null;

  const [, dStr, mStr, yStr, hStr, minStr] = match;
  let year = parseInt(yStr, 10);
  if (year < 100) year += 2000;
  const day = parseInt(dStr, 10);
  const month = parseInt(mStr, 10);
  const hour = parseInt(hStr, 10);
  const minute = parseInt(minStr, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
}

export interface WorkbookParseResult {
  rows: ParsedTripRow[];
  warnings: string[];
}

export function parseWorkbook(data: ArrayBuffer): WorkbookParseResult {
  const workbook = XLSX.read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  const warnings: string[] = [];
  if (rows.length === 0) {
    return { rows: [], warnings: ["The uploaded file appears to be empty."] };
  }

  const headerMap = buildHeaderMap(rows[0]);
  const requiredForUsefulSheet = ["localTime", "from", "to"];
  const missing = requiredForUsefulSheet.filter((f) => !(f in headerMap));
  if (missing.length > 0) {
    warnings.push(
      `Could not find column(s): ${missing.join(", ")}. Check the header row matches Numbering/ID/Driver/Local Time/From/To/Flight Number/Comment.`
    );
  }

  const parsedRows: ParsedTripRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw || raw.every((c) => String(c ?? "").trim() === "")) continue; // skip blank rows

    const get = (field: string): string => {
      const idx = headerMap[field];
      if (idx === undefined) return "";
      return String(raw[idx] ?? "").trim();
    };

    const localTimeRaw = get("localTime");
    const localTime = parseLocalDateTime(localTimeRaw);

    parsedRows.push({
      rowId: `row-${i}-${Math.random().toString(36).slice(2, 8)}`,
      numbering: get("numbering"),
      clientId: get("id"),
      driverName: get("driver"),
      requestedDriverName: get("requestedDriver"),
      localTimeRaw,
      localTime,
      from: get("from"),
      to: get("to"),
      flightNumber: get("flightNumber"),
      comment: get("comment"),
      parseError: localTime === null,
    });
  }

  return { rows: parsedRows, warnings };
}

/** Parses a "Standby HH:MM PickupPlace → DropPlace | Return HH:MM PickupPlace → ETA HH:MM DropPlace"
 *  style comment into a tour window. Fairly permissive: looks for two time-like tokens
 *  (the earliest and latest) around the anchor date of the row's Local Time. */
export function parseTourWindow(
  comment: string,
  anchorTime: number
): TourWindow | null {
  if (!comment) return null;
  const hasStandby = /standby/i.test(comment);
  const hasReturn = /return/i.test(comment);
  if (!hasStandby && !hasReturn) return null;

  const timeMatches = [...comment.matchAll(/(\d{1,2}):(\d{2})/g)];
  if (timeMatches.length === 0) return null;

  const anchorDate = new Date(anchorTime);
  const toTimestamp = (h: number, m: number): number => {
    const d = new Date(
      anchorDate.getFullYear(),
      anchorDate.getMonth(),
      anchorDate.getDate(),
      h,
      m,
      0,
      0
    );
    return d.getTime();
  };

  const timestamps = timeMatches.map((m) =>
    toTimestamp(parseInt(m[1], 10), parseInt(m[2], 10))
  );

  let startTime = Math.min(...timestamps);
  let endTime = Math.max(...timestamps);

  // "Return" leg might roll past midnight relative to "Standby" — if end < start, push end by a day
  if (endTime < startTime) {
    endTime += 24 * 60 * 60 * 1000;
  }
  if (endTime === startTime) {
    endTime = startTime + 60 * 60 * 1000; // minimum 1hr window if only one time found
  }

  // Try to pull leg locations out of arrow-separated segments, e.g. "A → B"
  const legs = comment.split("|").map((s) => s.trim());
  const arrowLegs = legs
    .map((leg) => leg.split(/→|->/).map((s) => s.trim()))
    .filter((parts) => parts.length >= 2);

  const startLocation = arrowLegs[0]?.[0] || "";
  const endLocation = arrowLegs[arrowLegs.length - 1]?.[1] || startLocation;

  return { startTime, endTime, startLocation, endLocation };
}

export function classifyTrip(row: ParsedTripRow): Trip | null {
  if (row.localTime === null) return null;

  const fromUpper = row.from.toUpperCase();
  const toUpper = row.to.toUpperCase();
  const tourWindow = parseTourWindow(row.comment, row.localTime);

  let type: TripType = "unknown";
  let time = row.localTime;
  let from = row.from;
  let to = row.to;

  if (tourWindow) {
    type = "tour";
    time = tourWindow.startTime;
    from = tourWindow.startLocation;
    to = tourWindow.endLocation;
  } else if (fromUpper.includes("MRU")) {
    type = "arrival";
  } else if (toUpper.includes("MRU")) {
    type = "departure";
  }

  return {
    id: row.rowId,
    numbering: row.numbering,
    clientId: row.clientId,
    type,
    time,
    from,
    to,
    flightNumber: row.flightNumber,
    comment: row.comment,
    tourWindow,
    presetDriverName: row.driverName,
    requestedDriverName: row.requestedDriverName,
  };
}

export function classifyTrips(rows: ParsedTripRow[]): { trips: Trip[]; skipped: number } {
  const trips: Trip[] = [];
  let skipped = 0;
  for (const row of rows) {
    const trip = classifyTrip(row);
    if (trip) trips.push(trip);
    else skipped++;
  }
  trips.sort((a, b) => a.time - b.time);
  return { trips, skipped };
}
