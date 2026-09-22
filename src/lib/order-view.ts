import type { Approval, StoredOrder } from "@/lib/sheet/types";
import type { AppSettings } from "@/lib/settings";
import { money } from "@/lib/format";

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

/**
 * Why this order cannot be approved, or null when it can.
 *
 * The first two reasons are facts about the order and hold whatever the desk
 * settings say. The rest are the admin's guardrails, and each one is mirrored
 * in firestore.rules — this function explains the refusal, the database
 * performs it. If you add a case here, add it there, or the button will lie.
 */
export function blockingReason(order: StoredOrder, settings?: AppSettings): string | null {
  if (payAmount(order) <= 0) return "Nothing payable on this order.";
  if (!payUpi(order)) return "No UPI handle — add one before approving.";

  if (settings) {
    const amount = payAmount(order);
    if (settings.maxRefundAmount > 0 && amount > settings.maxRefundAmount) {
      return `Over the ${money(settings.maxRefundAmount)} ceiling an admin set. Correct the amount, or have the ceiling raised on the admin panel.`;
    }
    if (settings.blockCancelledShipment && order.shipRank >= 4) {
      return `Shipment is "${order.ships[0] ?? "cancelled"}" — the goods never reached the warehouse, and approving these is switched off on the admin panel.`;
    }
  }

  return null;
}

/**
 * Worth a second look before approving, but not a refusal.
 *
 * Deliberately separate from blockingReason: a threshold that stops the work
 * gets raised until it stops firing, and then it is not a threshold. A
 * threshold that makes someone read the row once is the one that survives.
 */
export function approvalWarning(order: StoredOrder, settings: AppSettings): string | null {
  const amount = payAmount(order);
  if (settings.warnRefundAmount > 0 && amount > settings.warnRefundAmount) {
    return `${money(amount)} is above the ${money(settings.warnRefundAmount)} mark — worth checking the lines before approving.`;
  }
  if (!settings.blockCancelledShipment && order.shipRank >= 4) {
    return `Shipment is "${order.ships[0]}" — check the goods actually arrived.`;
  }
  if (order.upiClash) {
    return `This order carries ${order.upis.length} different handles. Pick the right one before approving.`;
  }
  return null;
}

/** True when approving this order must carry a written reason. */
export function approvalNeedsNote(order: StoredOrder, settings: AppSettings): boolean {
  return settings.approvalNoteAbove > 0 && payAmount(order) > settings.approvalNoteAbove;
}

/** Orders from a selection that may actually be approved as-is. */
export function approvableNow(orders: StoredOrder[], settings: AppSettings): StoredOrder[] {
  return orders.filter((o) => !blockingReason(o, settings));
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
