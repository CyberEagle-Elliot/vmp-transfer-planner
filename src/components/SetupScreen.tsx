import { useState } from "react";
import type { Driver, ParsedTripRow } from "../types";
import DriverRosterForm from "./DriverRosterForm";
import ExcelUpload from "./ExcelUpload";
import ParsedPreviewTable from "./ParsedPreviewTable";

interface Props {
  savedRoster: Driver[];
  onRosterConfirmed: (drivers: Driver[]) => void;
  onAutoAssignRequested: (drivers: Driver[], rows: ParsedTripRow[]) => void;
  isAssigning: boolean;
}

export default function SetupScreen({
  savedRoster,
  onRosterConfirmed,
  onAutoAssignRequested,
  isAssigning,
}: Props) {
  const [confirmedRoster, setConfirmedRoster] = useState<Driver[] | null>(
    savedRoster.length > 0 ? savedRoster : null
  );
  const [parsedRows, setParsedRows] = useState<ParsedTripRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  function handleRosterConfirm(drivers: Driver[]) {
    setConfirmedRoster(drivers);
    onRosterConfirmed(drivers);
  }

  const usableRows = parsedRows.filter((r) => !r.parseError);
  const canAssign = confirmedRoster !== null && usableRows.length > 0;

  return (
    <div className="setup-section">
      <DriverRosterForm
        initialDrivers={savedRoster}
        onConfirm={handleRosterConfirm}
        hasSavedRoster={savedRoster.length > 0}
        onLoadSaved={() => {
          setConfirmedRoster(savedRoster);
          onRosterConfirmed(savedRoster);
        }}
      />

      {confirmedRoster && (
        <div className="setup-step">
          <h2>2. Upload today's trip sheet</h2>
          <ExcelUpload
            onParsed={(rows, w) => {
              setParsedRows(rows);
              setWarnings(w);
            }}
          />
          {warnings.map((w, i) => (
            <p className="warning-box" key={i}>
              {w}
            </p>
          ))}
        </div>
      )}

      {confirmedRoster && parsedRows.length > 0 && (
        <div className="setup-step">
          <h2>3. Check the parsed trips</h2>
          <p className="lane-meta">
            Fix any cell before assigning — this is the data the algorithm will use.
          </p>
          <ParsedPreviewTable rows={parsedRows} onChange={setParsedRows} />

          <div className="step-actions">
            <button
              type="button"
              className="primary"
              disabled={!canAssign || isAssigning}
              onClick={() => onAutoAssignRequested(confirmedRoster, parsedRows)}
            >
              {isAssigning ? "Assigning…" : `Auto-assign ${usableRows.length} trips`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
