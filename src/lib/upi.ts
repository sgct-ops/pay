/**
 * The tag every payout note must carry, so refunds are recognisable on a bank
 * statement months later.
 *
 * This is the fallback. The live value comes from desk settings, because the
 * tag is a decision about how the company reads its own statement, not a fact
 * about the code — and the helpers below take it as an argument so nothing
 * silently pays out under the wrong one when it is changed.
 */
export const NOTE_TAG = "CARBONTREE";

/** The fallback note length. Some UPI apps truncate beyond this. */
export const NOTE_MAX_LENGTH = 50;

export interface UpiLinkInput {
  vpa: string;
  name?: string;
  amount?: string | number;
  note: string;
}

export function noteFor(orderNumber?: string, tag: string = NOTE_TAG): string {
  return orderNumber ? `${tag} #${String(orderNumber).replace(/^#/, "")}` : tag;
}

/** The note is mandatory and must carry the tag. Returns null when it is fine. */
export function noteProblem(
  note: string,
  tag: string = NOTE_TAG,
  maxLength: number = NOTE_MAX_LENGTH,
): string | null {
  const v = (note || "").trim();
  if (!v) return "A payout note is required.";
  if (!v.toUpperCase().includes(tag.toUpperCase())) return `The note must contain ${tag}.`;
  if (v.length > maxLength) {
    return `UPI notes longer than ${maxLength} characters get truncated by some apps.`;
  }
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
