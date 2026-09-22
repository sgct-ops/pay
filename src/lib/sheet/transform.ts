import type {
  ExclusionRule,
  OrderLine,
  PayoutOrder,
  RawRow,
  TransformResult,
  TransformSummary,
} from "./types";
import { DEFAULT_EXCLUSIONS, DEFAULT_STAGES } from "./types";

/**
 * The Return Prime transform, stated once so the app and any script agree.
 *
 *   keep a line when   requested_refund_mode is "others"      (the manual UPI bucket)
 *              and     refund_status is not "refunded"        (nobody is paid twice)
 *              and     status is in the chosen stage set      (received + approved by default)
 *
 * then recover the UPI handle out of refund_additional_details, because the
 * export's own `upi` column arrives empty on every row.
 */

/** Columns the export must carry for the transform to mean anything. */
export const REQUIRED_COLUMNS = [
  "order_number",
  "requested_refund_mode",
  "refund_status",
  "status",
  "eligible_refund_amount",
] as const;

/**
 * Anything shaped like local@domain, taking the domain as far as it goes.
 *
 * Grabbing the *whole* domain matters: stopping at the first dot would read
 * "vikram@gmail.com" as the handle "vikram@gmail" and send a customer's refund
 * into the void. The dot test below is what separates a UPI handle
 * (`name@okhdfcbank`, never dotted) from an email address (always dotted).
 * A trailing period is left out of the match, so "pay to abc@ybl." still works.
 */
const HANDLE_RE =
  /(?<![\w.@-])([a-zA-Z0-9][a-zA-Z0-9._-]{0,63})@([a-zA-Z][a-zA-Z0-9.-]{0,63}[a-zA-Z0-9])(?![\w@-])/g;

function isBankHandle(local: string, domain: string): boolean {
  return local.length >= 2 && !domain.includes(".");
}



const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/* ------------------------------------------------------------- helpers ---- */

/** Every distinct UPI handle in a free-text field, in the order they appear. */
export function findUpis(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(HANDLE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    if (!isBankHandle(m[1], m[2])) continue;
    const handle = m[0].toLowerCase();
    if (!out.includes(handle)) out.push(handle);
  }
  return out;
}

/** The first UPI handle in a value, or "" when it holds none. */
export function cleanUpi(value: string): string {
  return findUpis(value)[0] ?? "";
}

/**
 * Does this note trip this rule?
 *
 * The phrase is escaped before it becomes a pattern, so an admin typing "c/o"
 * or "50% off" into the exclusions list gets a literal match rather than a
 * regex that quietly excludes everything — or throws.
 */
export function matchesExclusion(notes: string, rule: ExclusionRule): boolean {
  const phrase = rule.phrase.trim();
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = rule.wholeWord ? `\\b${escaped}\\b` : escaped;
  try {
    return new RegExp(pattern, "i").test(notes || "");
  } catch {
    return false;
  }
}

/**
 * Why this line is not payable, or null when it is.
 *
 * `rules` comes from desk settings at run time; the default is the list the
 * transform has always used, which is what the fixture test pins.
 */
export function nonPayableReason(
  notes: string,
  amount: number,
  rules: readonly ExclusionRule[] = DEFAULT_EXCLUSIONS,
): string | null {
  if (!(amount > 0)) return "no eligible amount";
  for (const rule of rules) {
    if (rule.enabled && matchesExclusion(notes, rule)) return rule.reason;
  }
  return null;
}

export function toAmount(value: string): number {
  const n = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Return Prime writes dates as "Mon August 17th 2026, 10:23 am".
 * Also tolerates ISO and d/m/Y, and returns null rather than guessing.
 */
export function parseWhen(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const named = raw
    .replace(/^[A-Za-z]{3,9},?\s+/, "")
    .match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?[,\s]+(\d{4})/);
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      return Date.UTC(Number(named[3]), month, Number(named[2]));
    }
  }

  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/** How alarming a shipment_tracking_status is. Cancelled and pickup issues rank top. */
export function shipRank(value: string): number {
  const v = String(value || "").toLowerCase();
  if (!v) return 0;
  if (/cancel|issue/.test(v)) return 4;
  if (/returned to warehouse|received/.test(v)) return 3;
  if (/out for pickup|on the way/.test(v)) return 2;
  if (/requested/.test(v)) return 1;
  return 0;
}

/** Monday 00:00 UTC of the week a timestamp falls in. */
export function weekStart(ts: number): number {
  const d = new Date(ts);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

export function weekLabel(ts: number): string {
  const from = new Date(ts);
  const to = new Date(ts + 6 * 86_400_000);
  const fmt = (d: Date, withYear: boolean) =>
    `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}` +
    (withYear ? ` ${d.getUTCFullYear()}` : "");
  return `${fmt(from, from.getUTCFullYear() !== to.getUTCFullYear())} – ${fmt(to, true)}`;
}

/* ----------------------------------------------------------- transform ---- */

export interface TransformOptions {
  /** Return stages to keep. Defaults to received + approved. */
  stages?: readonly string[];
  /**
   * Line notes that mean "not a payout". Defaults to the list in types.ts,
   * which is what an unconfigured project and the fixture test both use.
   */
  exclusions?: readonly ExclusionRule[];
}

export function transform(rows: RawRow[], options: TransformOptions = {}): TransformResult {
  const stages = (options.stages?.length ? options.stages : DEFAULT_STAGES).map((s) =>
    s.toLowerCase(),
  );
  const exclusions = options.exclusions ?? DEFAULT_EXCLUSIONS;

  const present = new Set<string>();
  rows.slice(0, 5).forEach((r) => Object.keys(r).forEach((k) => present.add(k)));
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !present.has(c));
  if (missingColumns.length) {
    return { orders: [], summary: emptySummary(rows.length), missingColumns: [...missingColumns] };
  }

  const kept: Array<{ row: RawRow; line: OrderLine }> = [];

  rows.forEach((row, index) => {
    const mode = (row.requested_refund_mode || "").trim().toLowerCase();
    const refundStatus = (row.refund_status || "").trim().toLowerCase();
    const stage = (row.status || "").trim().toLowerCase();

    if (mode !== "others") return;
    if (refundStatus === "refunded") return;
    if (!stages.includes(stage)) return;

    const notes = row.refund_additional_details || "";
    const amount = toAmount(row.eligible_refund_amount);
    const excludedFor = nonPayableReason(notes, amount, exclusions);
    const serial = row.serial_number || row.line_item_id || String(index + 1);

    kept.push({
      row,
      line: {
        key: `${(row.order_number || "").trim()}::${serial}`,
        serial,
        item: row.item_name || "",
        sku: row.sku || "",
        qty: Number(row.item_quantity || 1) || 1,
        reason: row.reason || "",
        amount,
        fee: toAmount(row.return_fee),
        notes,
        payable: excludedFor === null,
        excludedFor,
        shipmentStatus: row.shipment_tracking_status || "",
      },
    });
  });

  const byOrder = new Map<string, Array<{ row: RawRow; line: OrderLine }>>();
  for (const entry of kept) {
    const key = (entry.row.order_number || "").trim() || `unknown-${entry.line.serial}`;
    const bucket = byOrder.get(key);
    if (bucket) bucket.push(entry);
    else byOrder.set(key, [entry]);
  }

  const orders: PayoutOrder[] = [];
  let ordersExcluded = 0;
  for (const [orderNumber, entries] of byOrder) {
    const lines = entries.map((e) => e.line);
    const payable = lines.filter((l) => l.payable);
    const skipped = lines.filter((l) => !l.payable);

    // Every line on this order was excluded — an alteration, an exchange, a
    // store credit, an amount settled against another product. There is
    // nothing to pay and so nothing to decide, and an order nobody can act on
    // is not a ledger entry; it is noise that makes the real ones harder to
    // see. It is counted in the summary so the upload still adds up.
    if (!payable.length) {
      ordersExcluded++;
      continue;
    }

    const upis: string[] = [];
    for (const e of entries) {
      for (const handle of findUpis(e.line.notes)) {
        if (!upis.includes(handle)) upis.push(handle);
      }
      const explicit = cleanUpi(e.row.upi || e.row.upi_id || "");
      if (explicit && !upis.includes(explicit)) upis.unshift(explicit);
    }

    const ships = Array.from(
      new Set(lines.map((l) => l.shipmentStatus).filter(Boolean)),
    ).sort((a, b) => shipRank(b) - shipRank(a));

    const approvedAt = firstTime(entries, "approved_at");
    const receivedAt = firstTime(entries, "received_at");
    const anchor = approvedAt ?? receivedAt;

    orders.push({
      orderKey: orderKeyFor(orderNumber),
      orderNumber,
      customerName: firstValue(entries, "customer_name"),
      customerPhone: firstValue(entries, "customer_phone"),
      customerEmail: firstValue(entries, "customer_email"),
      upi: upis[0] || "",
      upis,
      upiClash: upis.length > 1,
      pieces: payable.length,
      total: round2(payable.reduce((s, l) => s + l.amount, 0)),
      skipped: skipped.length,
      skippedTotal: round2(skipped.reduce((s, l) => s + l.amount, 0)),
      fees: round2(payable.reduce((s, l) => s + l.fee, 0)),
      ships,
      shipRank: ships.length ? shipRank(ships[0]) : 0,
      approvedAt,
      receivedAt,
      weekStart: anchor === null ? null : weekStart(anchor),
      lines,
      keys: lines.map((l) => l.key),
    });
  }

  // Oldest week first — the longest-waiting customer sits at the top.
  orders.sort((a, b) => {
    const aw = a.weekStart ?? Number.MAX_SAFE_INTEGER;
    const bw = b.weekStart ?? Number.MAX_SAFE_INTEGER;
    if (aw !== bw) return aw - bw;
    if (b.shipRank !== a.shipRank) return b.shipRank - a.shipRank;
    return a.orderNumber.localeCompare(b.orderNumber, undefined, { numeric: true });
  });

  const payableOrders = orders.filter((o) => o.total > 0);
  const anchors = orders.map((o) => o.approvedAt ?? o.receivedAt).filter((t): t is number => t !== null);

  const summary: TransformSummary = {
    rowsIn: rows.length,
    linesKept: kept.length,
    orders: orders.length,
    ordersExcluded,
    ordersPayable: payableOrders.length,
    ordersWithUpi: payableOrders.filter((o) => o.upi).length,
    ordersMissingUpi: payableOrders.filter((o) => !o.upi).length,
    totalPayable: round2(payableOrders.reduce((s, o) => s + o.total, 0)),
    rangeFrom: anchors.length ? Math.min(...anchors) : null,
    rangeTo: anchors.length ? Math.max(...anchors) : null,
  };

  return { orders, summary, missingColumns: [] };
}

/* --------------------------------------------------------------- utils ---- */

/** Firestore document ids cannot contain "/" and must be non-empty. */
export function orderKeyFor(orderNumber: string): string {
  const cleaned = String(orderNumber || "")
    .trim()
    .replace(/[^\w#.-]+/g, "-")
    .replace(/^#/, "")
    .replace(/^-+|-+$/g, "");
  return cleaned || "unknown";
}

function firstValue(entries: Array<{ row: RawRow }>, column: string): string {
  for (const e of entries) {
    const v = (e.row[column] || "").trim();
    if (v) return v;
  }
  return "";
}

function firstTime(entries: Array<{ row: RawRow }>, column: string): number | null {
  for (const e of entries) {
    const t = parseWhen(e.row[column] || "");
    if (t !== null) return t;
  }
  return null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function emptySummary(rowsIn: number): TransformSummary {
  return {
    rowsIn,
    linesKept: 0,
    orders: 0,
    ordersExcluded: 0,
    ordersPayable: 0,
    ordersWithUpi: 0,
    ordersMissingUpi: 0,
    totalPayable: 0,
    rangeFrom: null,
    rangeTo: null,
  };
}

/** Bucket orders into weeks for the ledger, oldest first. */
export function groupByWeek<T extends { weekStart: number | null }>(
  orders: T[],
): Array<{ weekStart: number | null; label: string; orders: T[] }> {
  const buckets = new Map<number | null, T[]>();
  for (const o of orders) {
    const bucket = buckets.get(o.weekStart);
    if (bucket) bucket.push(o);
    else buckets.set(o.weekStart, [o]);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => (a[0] ?? Number.MAX_SAFE_INTEGER) - (b[0] ?? Number.MAX_SAFE_INTEGER))
    .map(([ws, list]) => ({
      weekStart: ws,
      label: ws === null ? "No approval date" : weekLabel(ws),
      orders: list,
    }));
}
