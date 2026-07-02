import { useState } from "react";
import type { Driver, DriverPriority } from "../types";
import { minutesToTimeString, timeStringToMinutes } from "../lib/format";

interface Props {
  initialDrivers: Driver[];
  onConfirm: (drivers: Driver[]) => void;
  hasSavedRoster: boolean;
  onLoadSaved: () => void;
}

function makeDriver(index: number): Driver {
  return {
    id: `driver-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    shiftStart: null,
    shiftEnd: null,
    priority: 2,
  };
}

export default function DriverRosterForm({
  initialDrivers,
  onConfirm,
  hasSavedRoster,
  onLoadSaved,
}: Props) {
  const [count, setCount] = useState(initialDrivers.length || 1);
  const [drivers, setDrivers] = useState<Driver[]>(
    initialDrivers.length > 0
      ? initialDrivers
      : Array.from({ length: count }, (_, i) => makeDriver(i))
  );
  const [started, setStarted] = useState(initialDrivers.length > 0);

  function applyCount(n: number) {
    const safe = Math.max(1, Math.min(40, n));
    setCount(safe);
    setDrivers((prev) => {
      const next = [...prev];
      while (next.length < safe) next.push(makeDriver(next.length));
      while (next.length > safe) next.pop();
      return next;
    });
    setStarted(true);
  }

  function updateDriver(id: string, patch: Partial<Driver>) {
    setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function removeDriver(id: string) {
    setDrivers((prev) => prev.filter((d) => d.id !== id));
    setCount((c) => Math.max(1, c - 1));
  }

  function addDriver() {
    setDrivers((prev) => [...prev, makeDriver(prev.length)]);
    setCount((c) => c + 1);
  }

  const allNamed = drivers.length > 0 && drivers.every((d) => d.name.trim().length > 0);

  return (
    <div className="setup-step">
      <h2>1. How many drivers today?</h2>

      {hasSavedRoster && !started && (
        <div className="roster-actions" style={{ marginBottom: "1rem" }}>
          <button type="button" className="primary" onClick={onLoadSaved}>
            Reload last saved roster
          </button>
          <button type="button" className="ghost" onClick={() => setStarted(true)}>
            Start a fresh roster instead
          </button>
        </div>
      )}

      {(started || !hasSavedRoster) && (
        <>
          <div className="driver-count-row">
            <div>
              <label htmlFor="driver-count">Number of drivers</label>
              <input
                id="driver-count"
                type="number"
                min={1}
                max={40}
                value={count}
                onChange={(e) => applyCount(parseInt(e.target.value, 10) || 1)}
              />
            </div>
          </div>

          <hr />

          {drivers.map((driver, i) => (
            <div className="driver-row" key={driver.id}>
              <div>
                <label htmlFor={`driver-name-${driver.id}`}>Driver {i + 1} name</label>
                <input
                  id={`driver-name-${driver.id}`}
                  type="text"
                  value={driver.name}
                  placeholder="e.g. Rajesh"
                  onChange={(e) => updateDriver(driver.id, { name: e.target.value })}
                />
              </div>
              <div>
                <label htmlFor={`shift-start-${driver.id}`}>Shift start</label>
                <input
                  id={`shift-start-${driver.id}`}
                  type="time"
                  value={minutesToTimeString(driver.shiftStart)}
                  onChange={(e) =>
                    updateDriver(driver.id, { shiftStart: timeStringToMinutes(e.target.value) })
                  }
                />
              </div>
              <div>
                <label htmlFor={`shift-end-${driver.id}`}>Shift end</label>
                <input
                  id={`shift-end-${driver.id}`}
                  type="time"
                  value={minutesToTimeString(driver.shiftEnd)}
                  onChange={(e) =>
                    updateDriver(driver.id, { shiftEnd: timeStringToMinutes(e.target.value) })
                  }
                />
              </div>
              <div>
                <label htmlFor={`priority-${driver.id}`}>Priority</label>
                <select
                  id={`priority-${driver.id}`}
                  value={driver.priority}
                  onChange={(e) =>
                    updateDriver(driver.id, {
                      priority: parseInt(e.target.value, 10) as DriverPriority,
                    })
                  }
                >
                  <option value={1}>High</option>
                  <option value={2}>Normal</option>
                  <option value={3}>Low</option>
                </select>
              </div>
              <button
                type="button"
                className="ghost remove-btn"
                aria-label={`Remove driver ${i + 1}`}
                onClick={() => removeDriver(driver.id)}
                disabled={drivers.length <= 1}
              >
                ✕
              </button>
            </div>
          ))}

          <div className="roster-actions">
            <button type="button" className="ghost" onClick={addDriver}>
              + Add another driver
            </button>
          </div>

          <div className="step-actions">
            <button
              type="button"
              className="primary"
              disabled={!allNamed}
              onClick={() => onConfirm(drivers)}
            >
              Save roster &amp; continue
            </button>
          </div>
          {!allNamed && (
            <p className="warning-box">Give every driver a name before continuing.</p>
          )}
        </>
      )}
    </div>
  );
}
