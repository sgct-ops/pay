/**
 * Shapes shared by the sheet parser, the Return Prime transform and Firestore.
 *
 * One `RawRow` is one line in the Return Prime export (one returned item).
 * One `OrderLine` is a kept line after filtering.
 * One `PayoutOrder` is every kept line for a single order_number, combined.
 */

export type RawRow = Record<string, string>;

export const DEFAULT_STAGES = ["received", "approved"] as const;

/** Return stages Return Prime uses in the `status` column. */
export const ALL_STAGES = [
  "requested",
  "approved",
  "received",
  "inspected",
  "archived",
] as const;

export type Stage = (typeof ALL_STAGES)[number];

export interface OrderLine {
  /** Stable id for the line, used as the key for paid-ticks and dedupe. */
  key: string;
  serial: string;
  item: string;
  sku: string;
  qty: number;
  reason: string;
  /** Rupee value of this line as Return Prime computed it. */
  amount: number;
  fee: number;
  notes: string;
  /** Counts toward the order total. False for adjusted / exchanged / ₹0 lines. */
  payable: boolean;
  /** Why it was excluded, when it was. */
  excludedFor: string | null;
  shipmentStatus: string;
}

export interface PayoutOrder {
  /** Firestore document id. Derived from the order number. */
  orderKey: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;

  /** The UPI handle to pay. Empty when the export never carried one. */
  upi: string;
  /** Every distinct handle found across the order's lines. */
  upis: string[];
  /** True when lines of one order disagree about the handle — check before paying. */
  upiClash: boolean;

  /** Payable line count and their sum. This is what gets paid. */
  pieces: number;
  total: number;
  /** Non-payable lines that were deliberately left out, and their value. */
  skipped: number;
  skippedTotal: number;
  /** Return fees across payable lines. */
  fees: number;

  /** Distinct shipment_tracking_status values, worst first. */
  ships: string[];
  /** Severity of the worst shipment status, 0–4. */
  shipRank: number;

  approvedAt: number | null;
  receivedAt: number | null;
  /** Monday 00:00 of the week the order was approved in. Drives ledger grouping. */
  weekStart: number | null;

  lines: OrderLine[];
  /** Keys of every line in the order, payable or not. */
  keys: string[];
}

export interface TransformSummary {
  rowsIn: number;
  linesKept: number;
  orders: number;
  ordersPayable: number;
  ordersWithUpi: number;
  ordersMissingUpi: number;
  totalPayable: number;
  rangeFrom: number | null;
  rangeTo: number | null;
}

export interface TransformResult {
  orders: PayoutOrder[];
  summary: TransformSummary;
  /** Columns the export was missing. Non-empty means the file is the wrong shape. */
  missingColumns: string[];
}

/** Where an order sits in the two-step workflow. */
export type Approval = "pending" | "approved" | "hold" | "rejected";

/** Firestore `orders/{orderKey}` = PayoutOrder plus workflow state and provenance. */
export interface StoredOrder extends PayoutOrder {
  /* --- operations' decision ------------------------------------------- */
  approval: Approval;
  /** Why it is on hold or rejected. Shown to accounts so nobody chases twice. */
  approvalNote: string | null;
  approvalBy: string | null;
  approvalAt: number | null;

  /**
   * Corrections operations made before approving. The imported `upi` and
   * `total` are left exactly as the export had them, so the change is always
   * visible as a change rather than overwriting the evidence.
   */
  upiOverride: string | null;
  amountOverride: number | null;
  correctedBy: string | null;
  correctedAt: number | null;

  /* --- accounts' decision ---------------------------------------------- */
  paid: boolean;
  paidAt: number | null;
  paidByEmail: string | null;
  /** Set when a transfer bounced, which sends the order back to operations. */
  payFailedReason: string | null;

  /* --- provenance ------------------------------------------------------- */
  batchIds: string[];
  firstSeenAt: number;
  updatedAt: number;
  /** Set when a re-upload changed the amount or handle after approval. */
  reopenedAt: number | null;
}

/** Who a person is, as stored. Seeded defaults live in lib/roles.ts. */
export interface RoleRecord {
  email: string;
  role: "admin" | "ops" | "accounts";
  name: string | null;
  addedBy: string;
  addedAt: number;
}

export type EventKind =
  | "upload"
  | "approve"
  | "hold"
  | "reject"
  | "reopen"
  | "correct"
  | "pay"
  | "unpay"
  | "payfail"
  | "role";

/** Firestore `events/{autoId}` — one append-only trail for the whole desk. */
export interface AuditEvent {
  id?: string;
  kind: EventKind;
  orderKey: string | null;
  orderNumber: string | null;
  amount: number | null;
  upi: string | null;
  /** Free text: a hold reason, a rejection reason, a failed-transfer note. */
  note: string | null;
  /** For corrections and role changes: what it was, and what it became. */
  from: string | null;
  to: string | null;
  at: number;
  byUid: string;
  byEmail: string;
  byRole: string;
}

/** Firestore `batches/{batchId}` — one upload. */
export interface Batch {
  id: string;
  fileName: string;
  storagePath: string | null;
  uploadedAt: number;
  uploadedByUid: string;
  uploadedByEmail: string;
  stages: string[];
  summary: TransformSummary;
  /** Orders this upload created vs. refreshed an existing document for. */
  ordersNew: number;
  ordersUpdated: number;
}

