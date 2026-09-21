const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: number | null | undefined): string {
  return rupees.format(Number(value) || 0);
}

export function shortDate(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Pass `now` from useNow() when calling this during a render — reading the
 * clock mid-render is impure and gives stale text on the next paint.
 */
export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "never";
  const seconds = Math.round((Math.max(now, ts) - ts) / 1000);
  if (seconds < 45) return "just now";
  const units: Array<[number, string]> = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
  ];
  let value = seconds;
  let unit = "second";
  for (const [size, name] of units) {
    if (seconds >= size) {
      value = Math.floor(seconds / size);
      unit = name;
    }
  }
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function initials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
