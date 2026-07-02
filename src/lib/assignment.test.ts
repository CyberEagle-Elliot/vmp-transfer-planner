import { describe, it, expect, vi } from "vitest";
import type { Assignment, Driver, DriverPriority, Trip } from "../types";

vi.mock("./distanceMatrix", () => ({
  getTravelTime: vi.fn(async (origin: string, destination: string) => {
    // Fixed synthetic travel times (minutes) so tests are deterministic
    const key = `${origin.toLowerCase().trim()}|${destination.toLowerCase().trim()}`;
    const table: Record<string, number> = {
      "base|mru airport": 30,
      "base|hotel a": 30,
      "mru airport|hotel a": 40,
      "hotel a|mru airport": 40,
    };
    if (origin.toLowerCase().trim() === destination.toLowerCase().trim()) {
      return { durationMinutes: 5, estimated: false };
    }
    return { durationMinutes: table[key] ?? 45, estimated: false };
  }),
}));

import { autoAssign } from "./assignment";

const DAY = new Date(2026, 6, 2, 0, 0, 0, 0).getTime();
const at = (h: number, m = 0) => DAY + (h * 60 + m) * 60000;

function driver(id: string, name: string, priority: DriverPriority = 2): Driver {
  return { id, name, shiftStart: null, shiftEnd: null, priority };
}

function arrival(id: string, timeMs: number, to = "Hotel A"): Trip {
  return {
    id,
    numbering: id,
    clientId: "",
    type: "arrival",
    time: timeMs,
    from: "MRU Airport",
    to,
    flightNumber: "",
    comment: "",
    tourWindow: null,
    presetDriverName: "",
  };
}

describe("autoAssign", () => {
  it("gives trips to the high-priority driver first when both are comfortable", async () => {
    const low = driver("d1", "Low", 3);
    const high = driver("d2", "High", 1);
    const result = await autoAssign([low, high], [arrival("t1", at(12))]);
    expect(result["t1"].driverId).toBe("d2");
  });

  it("distributes trips evenly within the same priority tier", async () => {
    const a = driver("d1", "A");
    const b = driver("d2", "B");
    // Two arrivals far apart in time — both drivers are comfortable for each,
    // so the second trip must go to whoever has fewer trips.
    const result = await autoAssign([a, b], [arrival("t1", at(10)), arrival("t2", at(16))]);
    expect(new Set([result["t1"].driverId, result["t2"].driverId]).size).toBe(2);
  });

  it("prefers the largest slack when the trip is tight, regardless of priority", async () => {
    // High-priority driver only starts at 11:30: 30 min travel + 15 min buffer
    // puts them at the airport at exactly 12:15 — zero slack for a 12:15 landing.
    const highTight: Driver = { ...driver("d1", "HighTight", 1), shiftStart: 11 * 60 + 30 };
    const normalFree = driver("d2", "NormalFree", 2);
    const result = await autoAssign([highTight, normalFree], [arrival("t1", at(12, 15))]);
    expect(result["t1"].driverId).toBe("d2");
  });

  it("pins manual overrides across re-runs", async () => {
    const a = driver("d1", "A", 1);
    const b = driver("d2", "B", 2);
    const pinned: Record<string, Assignment> = {
      t1: {
        tripId: "t1",
        driverId: "d2",
        slackMinutes: 0,
        color: "green",
        reason: "",
        estimated: false,
        manualOverride: true,
      },
    };
    const result = await autoAssign([a, b], [arrival("t1", at(12))], pinned);
    expect(result["t1"].driverId).toBe("d2"); // stays with B despite A's higher priority
    expect(result["t1"].manualOverride).toBe(true);
  });

  it("locks trips to the preset driver from the sheet, matched loosely", async () => {
    const rajesh = driver("d1", "Rajesh", 1);
    const kevin = driver("d2", "Kevin", 2);
    const trip = arrival("t1", at(12));
    trip.presetDriverName = "  kevin ";
    const result = await autoAssign([rajesh, kevin], [trip]);
    expect(result["t1"].driverId).toBe("d2");
  });

  it("flags unknown preset driver names instead of silently reassigning", async () => {
    const trip = arrival("t1", at(12));
    trip.presetDriverName = "Somebody Else";
    const result = await autoAssign([driver("d1", "Rajesh", 1)], [trip]);
    expect(result["t1"].driverId).toBeNull();
    expect(result["t1"].reason).toContain("Somebody Else");
  });

  it("never double-books: reports a reason when nobody is feasible", async () => {
    const early: Driver = { ...driver("d1", "Early"), shiftEnd: 8 * 60 }; // shift ends 08:00
    const result = await autoAssign([early], [arrival("t1", at(12))]);
    expect(result["t1"].driverId).toBeNull();
    expect(result["t1"].reason.length).toBeGreaterThan(0);
  });
});
