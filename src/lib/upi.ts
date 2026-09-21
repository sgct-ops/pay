/** The note every CarbonTree payout must carry, so refunds are recognisable on a statement. */
export const NOTE_TAG = "CARBONTREE";

export interface UpiLinkInput {
  vpa: string;
  name?: string;
  amount?: string | number;
  note: string;
}

export function noteFor(orderNumber?: string): string {
  return orderNumber ? `${NOTE_TAG} #${String(orderNumber).replace(/^#/, "")}` : NOTE_TAG;
}

/** The note is mandatory and must contain CARBONTREE. Returns null when it is fine. */
export function noteProblem(note: string): string | null {
  const v = (note || "").trim();
  if (!v) return "A payout note is required.";
  if (!v.toUpperCase().includes(NOTE_TAG)) return `The note must contain ${NOTE_TAG}.`;
  if (v.length > 50) return "UPI notes longer than 50 characters get truncated by some apps.";
  return null;
}

export function isUpiHandle(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test((value || "").trim());
}

/** Build the `upi://pay` deep link a UPI app understands. */
export function upiLink({ vpa, name, amount, note }: UpiLinkInput): string {
  const params = new URLSearchParams();
  params.set("pa", (vpa || "").trim());
  if (name) params.set("pn", name.trim());
  params.set("cu", "INR");
  const amt = amount === undefined || amount === "" ? null : Number(amount);
  if (amt !== null && Number.isFinite(amt) && amt > 0) params.set("am", amt.toFixed(2));
  params.set("tn", (note || "").trim());
  return `upi://pay?${params.toString()}`;
}
