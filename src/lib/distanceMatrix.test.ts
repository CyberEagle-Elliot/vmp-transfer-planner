import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("./googleMapsClient", () => ({
  isGoogleMapsConfigured: () => true,
  reportLiveLookupOk: () => {},
  fetchDistanceMatrix: fetchMock,
}));

import { getTravelTime } from "./distanceMatrix";

beforeEach(() => {
  fetchMock.mockReset();
});

describe("getTravelTime route library", () => {
  it("retries at village level with live traffic when the exact address fails", async () => {
    fetchMock.mockImplementation(async (origin: string, destination: string) => {
      // Only locality-level queries ("<Village>, Mauritius") geocode in this scenario
      if (origin.endsWith(", Mauritius") && destination.endsWith(", Mauritius")) {
        return { durationInTrafficMinutes: 37, durationMinutes: 35, statusOk: true };
      }
      return { durationInTrafficMinutes: null, durationMinutes: null, statusOk: false };
    });

    const result = await getTravelTime(
      "Azur et Terrasse, XHG2+4W2, Coastal Road, Trou-aux-Biches",
      "Secret Villa 12, Pereybere backroad",
      new Date()
    );
    expect(result).toEqual({ durationMinutes: 37, estimated: false }); // live, not estimated
    expect(fetchMock).toHaveBeenCalledTimes(2); // exact attempt, then village attempt
  });

  it("serves repeat lookups from the library instead of refetching (same traffic band)", async () => {
    fetchMock.mockResolvedValue({ durationInTrafficMinutes: 52, durationMinutes: 50, statusOk: true });
    const noon = new Date();
    noon.setHours(12, 0, 0, 0); // off-peak band
    const first = await getTravelTime("LUX Belle Mare", "MRU AIRPORT", noon);
    const callsAfterFirst = fetchMock.mock.calls.length;

    const halfPastOne = new Date();
    halfPastOne.setHours(13, 30, 0, 0); // still off-peak — same band
    const second = await getTravelTime("LUX Belle Mare", "MRU AIRPORT", halfPastOne);

    expect(second.durationMinutes).toBe(first.durationMinutes);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // no extra API call
  });

  it("falls back to an estimate only when both exact and village lookups fail", async () => {
    fetchMock.mockResolvedValue({ durationInTrafficMinutes: null, durationMinutes: null, statusOk: false });
    const result = await getTravelTime("Mystery place one", "Mystery place two", new Date());
    expect(result.estimated).toBe(true);
    expect(result.durationMinutes).toBe(45); // no locality recognized → flat fallback
  });
});
