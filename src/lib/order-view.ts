import type { Approval, StoredOrder } from "@/lib/sheet/types";

/**
 * The imported figures and the figures that get paid are not always the same.
 * Everything downstream — the pay desk, the totals, the QR — must go through
 * these two functions rather than reading `total` and `upi` directly, or a
 * correction made by operations will silently fail to reach the payment.
 */

export function payAmount(order: StoredOrder): number {
  return order.amountOverride ?? order.total;
}

export function payUpi(order: StoredOrder): string {
  return order.upiOverride || order.upi;
}

export function isCorrected(order: StoredOrder): boolean {
  return order.amountOverride !== null || Boolean(order.upiOverride);
}

/** An order accounts is allowed to act on. */
export function isRefundable(order: StoredOrder): boolean {
  return order.approval === "approved" && !order.paid && payAmount(order) > 0 && Boolean(payUpi(order));
}

/** An order operations still has to make a decision about. */
export function needsVerifying(order: StoredOrder): boolean {
  return order.approval === "pending" || order.approval === "hold";
}

/** Why this order cannot be approved yet, or null when it can. */
export function blockingReason(order: StoredOrder): string | null {
  if (payAmount(order) <= 0) return "Nothing payable on this order.";
  if (!payUpi(order)) return "No UPI handle — add one before approving.";
  return null;
}

export const APPROVAL_LABELS: Record<Approval, string> = {
  pending: "To verify",
  approved: "Approved",
  hold: "On hold",
  rejected: "Rejected",
};

export const APPROVAL_TONES: Record<Approval, string> = {
  pending: "bg-sunk text-ink-2",
  approved: "bg-spruce-wash text-spruce",
  hold: "bg-gold-wash text-gold",
  rejected: "bg-clay-wash text-clay",
};
