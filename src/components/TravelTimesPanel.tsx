import { useState } from "react";
import {
  listKnownRoutes,
  setTravelOverride,
  clearTravelOverride,
  getTravelTime,
  type KnownRoute,
  type RouteSource,
} from "../lib/distanceMatrix";

interface Props {
  /** Called after corrections are saved so the caller can re-plan the day. */
  onOverridesApplied: () => void;
  isAssigning: boolean;
}

const SOURCE_LABEL: Record<RouteSource, string> = {
  manual: "Corrected",
  live: "Live traffic",
  estimated: "Estimated",
};

/** Collapsible editor for every travel time the planner has used today.
 *  The dispatcher can correct any duration that looks wrong; corrections are
 *  remembered (they survive reloads and "Clear day") and beat the live API. */
export default function TravelTimesPanel({ onOverridesApplied, isAssigning }: Props) {
  const [open, setOpen] = useState(false);
  const [routes, setRoutes] = useState<KnownRoute[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [checkFrom, setCheckFrom] = useState("");
  const [checkTo, setCheckTo] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<string | null>(null);

  function refresh() {
    setRoutes(listKnownRoutes());
    setEdits({});
  }

  function toggle() {
    if (!open) refresh();
    setOpen(!open);
  }

  const dirtyKeys = Object.keys(edits).filter((key) => {
    const route = routes.find((r) => r.key === key);
    if (!route) return false;
    const minutes = parseInt(edits[key], 10);
    return Number.isFinite(minutes) && minutes > 0 && minutes !== route.durationMinutes;
  });

  function applyEdits() {
    for (const key of dirtyKeys) {
      const route = routes.find((r) => r.key === key)!;
      setTravelOverride(route.origin, route.destination, parseInt(edits[key], 10));
    }
    refresh();
    onOverridesApplied();
  }

  function resetRoute(route: KnownRoute) {
    clearTravelOverride(route.key);
    refresh();
    onOverridesApplied();
  }

  // On-demand lookup for any pair (e.g. hotel to hotel) that today's plan
  // hasn't needed yet — the result is cached and joins the list below.
  async function checkRoute() {
    const from = checkFrom.trim();
    const to = checkTo.trim();
    if (!from || !to) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const result = await getTravelTime(from, to, new Date());
      setCheckResult(
        `${from} → ${to}: ${result.durationMinutes} min ` +
          (result.estimated ? "(estimated)" : "(live traffic)")
      );
      setRoutes(listKnownRoutes());
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="travel-panel">
      <button type="button" className="ghost travel-panel-toggle" onClick={toggle}>
        {open ? "▾" : "▸"} Travel times{routes.length > 0 && open ? ` (${routes.length} routes)` : ""}
      </button>

      {open && (
        <div className="travel-panel-body">
          <div className="route-check">
            <input
              type="text"
              placeholder="From (e.g. LUX Belle Mare)"
              value={checkFrom}
              onChange={(e) => setCheckFrom(e.target.value)}
              aria-label="Check route from"
            />
            <input
              type="text"
              placeholder="To (e.g. Royal Palm, Grand Baie)"
              value={checkTo}
              onChange={(e) => setCheckTo(e.target.value)}
              aria-label="Check route to"
            />
            <button
              type="button"
              className="ghost"
              onClick={checkRoute}
              disabled={checking || !checkFrom.trim() || !checkTo.trim()}
            >
              {checking ? "Checking…" : "Check route"}
            </button>
          </div>
          {checkResult && <p className="route-check-result">{checkResult}</p>}

          {routes.length === 0 ? (
            <p className="empty-state">
              No routes looked up yet — run auto-assign, or check any route above.
            </p>
          ) : (
            <>
              <p className="travel-panel-hint">
                Fix any duration that doesn't match reality, then apply — the day is
                re-planned with your corrections (manual placements stay put).
                Corrections are remembered for future days.
              </p>
              <table className="travel-table">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>To</th>
                    <th>Minutes</th>
                    <th>Source</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.key}>
                      <td>{route.origin}</td>
                      <td>{route.destination}</td>
                      <td>
                        <input
                          type="number"
                          min={1}
                          max={600}
                          value={edits[route.key] ?? String(route.durationMinutes)}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, [route.key]: e.target.value }))
                          }
                          aria-label={`Travel time from ${route.origin} to ${route.destination}`}
                        />
                      </td>
                      <td>
                        <span className={`route-source route-source-${route.source}`}>
                          {SOURCE_LABEL[route.source]}
                        </span>
                      </td>
                      <td>
                        {route.source === "manual" && (
                          <button
                            type="button"
                            className="ghost route-reset"
                            onClick={() => resetRoute(route)}
                            disabled={isAssigning}
                          >
                            Reset
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="step-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={dirtyKeys.length === 0 || isAssigning}
                  onClick={applyEdits}
                >
                  {isAssigning
                    ? "Re-planning…"
                    : dirtyKeys.length > 0
                      ? `Apply ${dirtyKeys.length} correction${dirtyKeys.length === 1 ? "" : "s"} & re-plan`
                      : "Apply corrections & re-plan"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
