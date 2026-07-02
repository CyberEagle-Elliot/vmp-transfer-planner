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
      "mru airport|far hotel": 120,
      "far hotel|near hotel": 120,
      "base|near hotel": 20,
      "near hotel|mru airport": 45,
    };
    if (origin.toLowerCase().trim() === destination.toLowerCase().trim()) {
      return { durationMinutes: 5, estimated: false };
    }
    return { durationMinutes: table[key] ?? 45, estimated: false };
  }),
}));

import { autoAssign, buildPrefetchPairs, MRU_AIRPORT } from "./assignment";

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
    requestedDriverName: "",
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
    // High-priority driver only starts at 11:30: with the 15 min buffer they make
    // an 11:50 landing with just 5 min slack — the free normal driver is safer.
    const highTight: Driver = { ...driver("d1", "HighTight", 1), shiftStart: 11 * 60 + 30 };
    const normalFree = driver("d2", "NormalFree", 2);
    const result = await autoAssign([highTight, normalFree], [arrival("t1", at(11, 50))]);
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

  it("waits 60 min after landing for numeric IDs, 75 min for IDs with letters", async () => {
    // One driver: 10:00 arrival to Hotel A, then a 12:05 departure from Hotel A.
    // Numeric ID: ready 11:00, done 11:40 (+40 drive), reach pickup 12:00 — fits.
    // Alpha ID: ready 11:15, done 11:55, reach pickup 12:15 — misses 12:05.
    const solo = [driver("d1", "Solo")];
    const makeDay = (clientId: string): Trip[] => {
      const arr = arrival("t1", at(10));
      arr.clientId = clientId;
      const dep: Trip = {
        ...arrival("t2", at(12, 5)),
        type: "departure",
        from: "Hotel A",
        to: "MRU Airport",
      };
      return [arr, dep];
    };

    const numeric = await autoAssign(solo, makeDay("12345"));
    expect(numeric["t2"].driverId).toBe("d1");

    const alpha = await autoAssign(solo, makeDay("C12345"));
    expect(alpha["t2"].driverId).toBeNull();
  });

  it("prefetch covers MRU→hotel, hotel→MRU, and forward hotel→hotel chains", () => {
    const arrivalTrip = arrival("t1", at(10), "Hotel A");
    const departureTrip: Trip = {
      ...arrival("t2", at(14)),
      type: "departure",
      from: "Hotel B",
      to: "MRU Airport",
    };
    const pairs = buildPrefetchPairs([arrivalTrip, departureTrip]);
    const has = (o: string, d: string) =>
      pairs.some((p) => p.origin === o && p.destination === d);

    expect(has(MRU_AIRPORT, "Hotel A")).toBe(true); // arrival main leg
    expect(has("Hotel B", MRU_AIRPORT)).toBe(true); // departure main leg
    expect(has("Hotel A", "Hotel B")).toBe(true); // deadhead chain (10:00 drop → 14:00 pickup)
    expect(has("Hotel B", "Hotel A")).toBe(false); // never chains backwards in time
    expect(pairs.every((p) => p.origin !== "base" && p.destination !== "base")).toBe(true);
  });

  it("never double-books: reports a reason when nobody is feasible", async () => {
    const early: Driver = { ...driver("d1", "Early"), shiftEnd: 8 * 60 }; // shift ends 08:00
    const result = await autoAssign([early], [arrival("t1", at(12))]);
    expect(result["t1"].driverId).toBeNull();
    expect(result["t1"].reason.length).toBeGreaterThan(0);
  });

  it("honors a customer's requested driver over priority and presets", async () => {
    const rajesh = driver("d1", "Rajesh", 1);
    const kevin = driver("d2", "Kevin", 3);
    const trip = arrival("t1", at(12));
    trip.presetDriverName = "Rajesh";
    trip.requestedDriverName = "Kevin"; // customer beats the sheet preset
    const result = await autoAssign([rajesh, kevin], [trip]);
    expect(result["t1"].driverId).toBe("d2");
  });

  it("assigns a requested driver even when tight, with a visible warning", async () => {
    // Requested driver's shift ends before the trip completes — infeasible,
    // but the customer asked, so it's assigned with a red warning.
    const requested: Driver = { ...driver("d1", "Rajesh"), shiftEnd: 12 * 60 };
    const other = driver("d2", "Kevin");
    const trip = arrival("t1", at(12));
    trip.requestedDriverName = "Rajesh";
    const result = await autoAssign([requested, other], [trip]);
    expect(result["t1"].driverId).toBe("d1");
    expect(result["t1"].color).toBe("red");
    expect(result["t1"].reason.length).toBeGreaterThan(0);
  });

  it("flags unknown requested driver names so the dispatcher sees the mismatch", async () => {
    const trip = arrival("t1", at(12));
    trip.requestedDriverName = "Ghost Driver";
    const result = await autoAssign([driver("d1", "Rajesh")], [trip]);
    expect(result["t1"].driverId).toBeNull();
    expect(result["t1"].reason).toContain("Ghost Driver");
  });

  it("gives a client's remembered regular driver first refusal when feasible", async () => {
    const rajesh = driver("d1", "Rajesh", 1); // higher priority — would normally win
    const kevin = driver("d2", "Kevin", 3);
    const trip = arrival("t1", at(12));
    trip.clientId = "C100";
    const result = await autoAssign([rajesh, kevin], [trip], {}, { c100: "Kevin" });
    expect(result["t1"].driverId).toBe("d2");
    expect(result["t1"].reason).toBe("");
  });

  it("rescues an uncovered trip by moving one trip to a colleague", async () => {
    // Greedy gives the 10:00 far-hotel arrival to A (first in a tie). That leaves
    // the 13:30 near-hotel departure impossible: A is stuck far away until 13:15,
    // and B's shift ends at 14:00 — before the departure would finish (14:15).
    // The rescue pass must discover the swap: B takes the arrival (done 13:15,
    // inside shift), freeing A for the departure.
    const a = driver("d1", "A");
    const b: Driver = { ...driver("d2", "B"), shiftEnd: 14 * 60 };
    const farArrival = arrival("t1", at(10), "Far Hotel");
    const nearDeparture: Trip = {
      ...arrival("t2", at(13, 30)),
      type: "departure",
      from: "Near Hotel",
      to: "MRU Airport",
    };
    const result = await autoAssign([a, b], [farArrival, nearDeparture]);
    expect(result["t1"].driverId).toBe("d2");
    expect(result["t2"].driverId).toBe("d1");
  });

  it("never moves locked trips during a rescue", async () => {
    // Same shape as the rescue scenario, but the far arrival is a customer
    // request for A — so the swap is forbidden and the departure stays uncovered.
    const a = driver("d1", "A");
    const b: Driver = { ...driver("d2", "B"), shiftEnd: 14 * 60 };
    const farArrival = arrival("t1", at(10), "Far Hotel");
    farArrival.requestedDriverName = "A";
    const nearDeparture: Trip = {
      ...arrival("t2", at(13, 30)),
      type: "departure",
      from: "Near Hotel",
      to: "MRU Airport",
    };
    const result = await autoAssign([a, b], [farArrival, nearDeparture]);
    expect(result["t1"].driverId).toBe("d1"); // request honored
    expect(result["t2"].driverId).toBeNull(); // not rescued at the customer's expense
  });

  it("falls back with a note when the regular driver isn't available", async () => {
    const busy: Driver = { ...driver("d1", "Rajesh"), shiftEnd: 8 * 60 }; // can't do a noon trip
    const kevin = driver("d2", "Kevin");
    const trip = arrival("t1", at(12));
    trip.clientId = "C100";
    const result = await autoAssign([busy, kevin], [trip], {}, { c100: "Rajesh" });
    expect(result["t1"].driverId).toBe("d2");
    expect(result["t1"].reason).toContain("Rajesh");
  });
});
