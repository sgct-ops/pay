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

/** Firestore `orders/{orderKey}` = PayoutOrder plus the payment state and provenance. */
export interface StoredOrder extends PayoutOrder {
  paid: boolean;
  paidAt: number | null;
  paidByEmail: string | null;
  batchIds: string[];
  firstSeenAt: number;
  updatedAt: number;
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

/** Firestore `payments/{autoId}` — the audit log. */
export interface PaymentEvent {
  id?: string;
  orderKey: string;
  orderNumber: string;
  amount: number;
  upi: string;
  action: "paid" | "unpaid";
  at: number;
  byUid: string;
  byEmail: string;
}
