import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook, parseLocalDateTime } from "./parser";

function sheetFromRows(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  XLSX.utils.book_append_sheet(wb, ws, "Trips");
  return XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true });
}

const HEADERS = [
  "Numbering",
  "ID",
  "Driver",
  "Local Time",
  "From",
  "To",
  "Passenger Name",
  "Passenger Contact",
  "Flight Number",
  "Total Amount",
  "Comment",
];

describe("parseWorkbook", () => {
  it("reads real Excel date cells unambiguously (July 3 stays July 3, not March 7)", () => {
    const buf = sheetFromRows([
      HEADERS,
      ["1", "557201009", "", new Date(2026, 6, 3, 4, 15), "LUX Belle Mare", "MRU AIRPORT", "qiqi gao", "+27625686128", "", 23.01, ""],
    ]);
    const { rows } = parseWorkbook(buf);
    expect(rows).toHaveLength(1);
    expect(rows[0].parseError).toBe(false);
    const d = new Date(rows[0].localTime!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 7, 3, 4, 15,
    ]);
  });

  it("carries passenger name, contact and amount through", () => {
    const buf = sheetFromRows([
      HEADERS,
      ["1", "123", "", "03/07/2026 04:15", "LUX Belle Mare", "MRU AIRPORT", "qiqi gao", "+27625686128", "MK15", "23.01", ""],
    ]);
    const { rows } = parseWorkbook(buf);
    expect(rows[0].passengerName).toBe("qiqi gao");
    expect(rows[0].passengerContact).toBe("+27625686128");
    expect(rows[0].amountRaw).toBe("23.01");
  });

  it("still parses DD/MM/YYYY text times", () => {
    expect(parseLocalDateTime("03/07/2026 14:30")).toBe(new Date(2026, 6, 3, 14, 30).getTime());
  });
});
