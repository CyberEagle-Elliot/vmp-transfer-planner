export function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "14:30" -> minutes since midnight */
export function timeStringToMinutes(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** minutes since midnight -> "14:30" for <input type="time"> */
export function minutesToTimeString(minutes: number | null): string {
  if (minutes === null) return "";
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function tripTypeLabel(type: string): string {
  switch (type) {
    case "arrival":
      return "Arrival";
    case "departure":
      return "Departure";
    case "tour":
      return "Tour";
    default:
      return "Unclassified";
  }
}
