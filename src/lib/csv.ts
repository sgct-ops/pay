/**
 * CSV out.
 *
 * The desk is not the only place this data has to live — a month-end
 * reconciliation happens in a spreadsheet, and an auditor asking "who approved
 * this" wants a file, not a screen. Kept free of React and Firebase for the
 * same reason as the sheet transform: it is testable, and it is obvious.
 */

import type { AuditEvent, StoredOrder } from "@/lib/sheet/types";
import { payAmount, payUpi } from "@/lib/order-view";

/**
 * Quote a cell for Excel and Google Sheets.
 *
 * The leading apostrophe on anything that could be read as a formula is not
 * decoration: a customer note beginning with "=" or "+" is a CSV injection,
 * and this data comes from a third-party export.
 */
function cell(value: unknown): string {
  let v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  // A BOM, so Excel on Windows opens ₹ and customer names correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

function iso(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString() : "";
}

export function ordersToCsv(orders: StoredOrder[]): string {
  return toCsv(
    [
      "order_number",
      "customer_name",
      "customer_phone",
      "customer_email",
      "upi_paid",
      "upi_imported",
      "amount_paid",
      "amount_imported",
      "corrected",
      "pieces",
      "fees",
      "approval",
      "approval_note",
      "approved_by",
      "approved_at",
      "paid",
      "paid_by",
      "paid_at",
      "pay_failed_reason",
      "shipment",
      "first_seen_at",
      "last_batch",
    ],
    orders.map((o) => [
      o.orderNumber,
      o.customerName,
      o.customerPhone,
      o.customerEmail,
      payUpi(o),
      o.upi,
      payAmount(o),
      o.total,
      o.amountOverride !== null || o.upiOverride ? "yes" : "",
      o.pieces,
      o.fees,
      o.approval,
      o.approvalNote ?? "",
      o.approvalBy ?? "",
      iso(o.approvalAt),
      o.paid ? "yes" : "",
      o.paidByEmail ?? "",
      iso(o.paidAt),
      o.payFailedReason ?? "",
      o.ships.join(" | "),
      iso(o.firstSeenAt),
      o.batchIds[o.batchIds.length - 1] ?? "",
    ]),
  );
}

export function eventsToCsv(events: AuditEvent[]): string {
  return toCsv(
    ["at", "kind", "order_number", "amount", "upi", "note", "from", "to", "by_email", "by_role"],
    events.map((e) => [
      iso(e.at),
      e.kind,
      e.orderNumber ?? "",
      e.amount ?? "",
      e.upi ?? "",
      e.note ?? "",
      e.from ?? "",
      e.to ?? "",
      e.byEmail,
      e.byRole,
    ]),
  );
}

/** Hand the browser a file. No server round trip; the data is already here. */
export function downloadCsv(filename: string, contents: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function stampedName(prefix: string): string {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}.csv`;
}
