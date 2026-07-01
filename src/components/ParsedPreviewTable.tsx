import type { ParsedTripRow } from "../types";
import { parseLocalDateTime } from "../lib/parser";

interface Props {
  rows: ParsedTripRow[];
  onChange: (rows: ParsedTripRow[]) => void;
}

const EDITABLE_FIELDS: { key: keyof ParsedTripRow; label: string }[] = [
  { key: "numbering", label: "Numbering" },
  { key: "clientId", label: "ID" },
  { key: "driverName", label: "Driver" },
  { key: "localTimeRaw", label: "Local Time" },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "flightNumber", label: "Flight Number" },
  { key: "comment", label: "Comment" },
];

export default function ParsedPreviewTable({ rows, onChange }: Props) {
  function updateCell(rowId: string, key: keyof ParsedTripRow, value: string) {
    onChange(
      rows.map((r) => {
        if (r.rowId !== rowId) return r;
        const updated: ParsedTripRow = { ...r, [key]: value };
        if (key === "localTimeRaw") {
          const parsed = parseLocalDateTime(value);
          updated.localTime = parsed;
          updated.parseError = parsed === null;
        }
        return updated;
      })
    );
  }

  const errorCount = rows.filter((r) => r.parseError).length;

  return (
    <div>
      {errorCount > 0 && (
        <p className="warning-box">
          {errorCount} row{errorCount === 1 ? "" : "s"} couldn't be parsed — fix the
          highlighted Local Time cell(s) (expected DD/MM/YYYY HH:MM) before auto-assigning.
        </p>
      )}
      <div className="preview-table-wrap">
        <table>
          <thead>
            <tr>
              {EDITABLE_FIELDS.map((f) => (
                <th key={f.key as string}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowId} className={row.parseError ? "row-error" : ""}>
                {EDITABLE_FIELDS.map((f) => (
                  <td key={f.key as string}>
                    <input
                      type="text"
                      value={(row[f.key] as string) ?? ""}
                      onChange={(e) => updateCell(row.rowId, f.key, e.target.value)}
                      aria-label={`${f.label} for row ${row.numbering || row.rowId}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
