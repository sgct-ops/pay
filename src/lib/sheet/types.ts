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

/**
 * One reason a line is not a payout, whatever its amount says.
 *
 * These were regexes buried in the transform. They are data now, because the
 * list is a business rule that changes — "settled as store credit" is a
 * decision someone made about how returns are handled, not a fact about the
 * code. The admin panel edits them; the defaults below reproduce exactly what
 * the transform did before they were editable, so `npm test` still pins them.
 *
 * `phrase` is matched case-insensitively against the line's note. `wholeWord`
 * wraps it in word boundaries — on for "marketing", which must not fire on
 * "remarketing"; off for "exchang", which is a deliberate stem catching both
 * "exchange" and "exchanged".
 */
export interface ExclusionRule {
  id: string;
  phrase: string;
  /** Shown on the excluded line, so the exclusion explains itself. */
  reason: string;
  wholeWord: boolean;
  enabled: boolean;
}

export const DEFAULT_EXCLUSIONS: ExclusionRule[] = [
  {
    id: "adjusted",
    phrase: "adjusted in another product",
    reason: "adjusted against another product",
    wholeWord: false,
    enabled: true,
  },
  {
    id: "store-credit",
    phrase: "store credit",
    reason: "settled as store credit",
    wholeWord: true,
    enabled: true,
  },
  {
    id: "marketing",
    phrase: "marketing",
    reason: "marketing, not a refund",
    wholeWord: true,
    enabled: true,
  },
  {
    id: "no-refund",
    phrase: "no refund needed",
    reason: "marked no refund needed",
    wholeWord: false,
    enabled: true,
  },
  {
    id: "exchange",
    phrase: "exchang",
    reason: "exchanged, not refunded",
    wholeWord: false,
    enabled: true,
  },
  {
    id: "alteration",
    phrase: "alter and send",
    reason: "alteration, not a refund",
    wholeWord: false,
    enabled: true,
  },
];

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
  /** Orders that reached the ledger: every one has at least one payable line. */
  orders: number;
  /**
   * Orders left out because every line was excluded — an alteration, an
   * exchange, a store credit, an amount settled elsewhere. Counted so an
   * upload still adds up, but never written to the ledger.
   *
   * Absent on batches saved before this was recorded, so read it as
   * `ordersExcluded ?? 0`.
   */
  ordersExcluded: number;
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
  | "role"
  | "settings";

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
  uploadedAt: number;
  uploadedByUid: string;
  uploadedByEmail: string;
  stages: string[];
  summary: TransformSummary;
  /** Orders this upload created vs. refreshed an existing document for. */
  ordersNew: number;
  ordersUpdated: number;
  /**
   * Orders the export carried again with nothing changed, so they were not
   * rewritten. Exports overlap by design; this is how much of a file was
   * already in the ledger.
   *
   * Absent on batches saved before this was recorded — read as
   * `ordersDuplicate ?? 0`.
   */
  ordersDuplicate: number;
}

