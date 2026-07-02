import { describe, it, expect } from "vitest";
import { estimateTravelMinutes, findRegion } from "./mauritiusEstimator";

describe("mauritiusEstimator", () => {
  it("matches localities inside full hotel addresses, hyphens and accents included", () => {
    expect(findRegion("Azur et Terrasse, Coastal Road, Trou-aux-Biches, Mauritius")?.name).toBe(
      "Trou aux Biches"
    );
    expect(findRegion("Beach front penthouse in Péreybère")?.name).toBe("Pereybere");
    expect(findRegion("LUX* Grand Gaube Resort & Villas")?.name).toBe("Grand Gaube");
    expect(findRegion("Trou d'Eau Douce jetty")?.name).toBe("Trou d'Eau Douce");
    expect(findRegion("MRU AIRPORT")?.name).toBe("SSR Airport");
  });

  it("does not confuse Grand Baie with Grand Gaube", () => {
    expect(findRegion("Hotel in Grand Baie")?.name).toBe("Grand Baie");
    expect(findRegion("Hotel in Grand Gaube")?.name).toBe("Grand Gaube");
  });

  it("estimates realistic airport travel times per region", () => {
    const toGrandBaie = estimateTravelMinutes("MRU Airport", "Royal Palm, Grand Baie")!;
    const toBelleMare = estimateTravelMinutes("MRU Airport", "LUX* Belle Mare")!;
    const toBlueBay = estimateTravelMinutes("MRU Airport", "Blue Bay villa")!;
    expect(toGrandBaie).toBeGreaterThan(55);
    expect(toGrandBaie).toBeLessThan(95);
    expect(toBelleMare).toBeGreaterThan(30);
    expect(toBelleMare).toBeLessThan(60);
    expect(toBlueBay).toBeLessThanOrEqual(15);
    // Sanity: farther destinations take longer
    expect(toGrandBaie).toBeGreaterThan(toBelleMare);
    expect(toBelleMare).toBeGreaterThan(toBlueBay);
  });

  it("uses a small constant within the same region", () => {
    expect(estimateTravelMinutes("Hotel A, Flic en Flac", "Hotel B, Flic-en-Flac")).toBe(10);
  });

  it("returns null when a side has no recognizable locality", () => {
    expect(estimateTravelMinutes("Somewhere unknown", "MRU Airport")).toBeNull();
    expect(estimateTravelMinutes("base", "Grand Baie")).toBeNull();
  });
});
