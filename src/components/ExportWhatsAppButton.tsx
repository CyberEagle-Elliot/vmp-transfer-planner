import { useState } from "react";
import type { Driver, Trip, Assignment } from "../types";
import { formatDate, formatTime, tripTypeLabel } from "../lib/format";

interface Props {
  driver: Driver;
  trips: Trip[];
  assignments: Record<string, Assignment>;
}

function buildMessage(driver: Driver, trips: Trip[], assignments: Record<string, Assignment>): string {
  const mine = trips
    .filter((t) => assignments[t.id]?.driverId === driver.id)
    .sort((a, b) => a.time - b.time);

  if (mine.length === 0) {
    return `${driver.name} — no trips assigned today.`;
  }

  const dateLabel = formatDate(mine[0].time);
  const lines = [`*${driver.name} — ${dateLabel}*`, ""];

  for (const trip of mine) {
    lines.push(`${formatTime(trip.time)} — ${tripTypeLabel(trip.type)}`);
    lines.push(`Pickup: ${trip.from || "—"}`);
    lines.push(`Drop-off: ${trip.to || "—"}`);
    if (trip.flightNumber) lines.push(`Flight: ${trip.flightNumber}`);
    if (trip.comment) lines.push(`Note: ${trip.comment}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

export default function ExportWhatsAppButton({ driver, trips, assignments }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const message = buildMessage(driver, trips, assignments);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button type="button" className="ghost whatsapp-export" onClick={() => setOpen(true)}>
        Export WhatsApp message
      </button>

      {open && (
        <div className="export-modal-backdrop" onClick={() => setOpen(false)}>
          <div className="export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="export-modal-header">
              <h3>{driver.name}'s schedule</h3>
              <button type="button" className="ghost" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
            <div className="export-modal-body">
              <pre>{message}</pre>
            </div>
            <div className="export-modal-actions">
              <button type="button" className="primary" onClick={copy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
