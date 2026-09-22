"use client";

import { useMemo } from "react";
import { useOrders } from "@/lib/store";
import { payAmount } from "@/lib/order-view";
import { money } from "@/lib/format";
import type { AppSettings } from "@/lib/settings";
import { MoneyField, Note, Row, Section, Toggle } from "@/components/admin/controls";

/**
 * The guardrails.
 *
 * UPI has no chargeback, so a wrong payout is unrecoverable — these are the
 * only settings in the app that are also enforced in firestore.rules. Every
 * field shows what it would do to the ledger as it stands right now, because a
 * ceiling nobody has measured against real orders is a number somebody guessed.
 */
export function PayoutsTab({
  draft,
  patch,
}: {
  draft: AppSettings;
  patch: (change: Partial<AppSettings>) => void;
}) {
  const { orders } = useOrders();

  const impact = useMemo(() => {
    const live = orders.filter((o) => o.approval !== "rejected" && !o.paid);
    const amounts = live.map(payAmount).filter((a) => a > 0);
    const largest = amounts.length ? Math.max(...amounts) : 0;
    return {
      live: live.length,
      largest,
      overCeiling:
        draft.maxRefundAmount > 0 ? amounts.filter((a) => a > draft.maxRefundAmount).length : 0,
      overWarn:
        draft.warnRefundAmount > 0 ? amounts.filter((a) => a > draft.warnRefundAmount).length : 0,
      needingNote:
        draft.approvalNoteAbove > 0
          ? amounts.filter((a) => a > draft.approvalNoteAbove).length
          : 0,
      cancelled: live.filter((o) => o.shipRank >= 4).length,
      alreadyApprovedOverCeiling:
        draft.maxRefundAmount > 0
          ? orders.filter(
              (o) => o.approval === "approved" && !o.paid && payAmount(o) > draft.maxRefundAmount,
            ).length
          : 0,
    };
  }, [orders, draft.maxRefundAmount, draft.warnRefundAmount, draft.approvalNoteAbove]);

  return (
    <div className="space-y-4">
      <Section
        title="Amount limits"
        blurb="Measured against the amount that would actually be paid — a correction operations made, not whatever the export said."
      >
        <Row>
          <MoneyField
            label="Hard ceiling"
            hint="Operations cannot approve above this, and the database refuses it too, not just the button. 0 means no ceiling."
            value={draft.maxRefundAmount}
            onChange={(maxRefundAmount) => patch({ maxRefundAmount })}
            zeroLabel="No ceiling"
          />
          <MoneyField
            label="Warn above"
            hint="Still approvable, but the ledger flags it. Set this to the figure that deserves a second read rather than the one that deserves a refusal."
            value={draft.warnRefundAmount}
            onChange={(warnRefundAmount) => patch({ warnRefundAmount })}
            zeroLabel="No warning"
          />
        </Row>

        <MoneyField
          label="Require a written reason above"
          hint="Approving a refund larger than this has to carry a note, the same way a hold or a rejection does. The note goes into the audit trail."
          value={draft.approvalNoteAbove}
          onChange={(approvalNoteAbove) => patch({ approvalNoteAbove })}
          zeroLabel="Never required"
        />

        {draft.maxRefundAmount > 0 && impact.alreadyApprovedOverCeiling > 0 && (
          <Note tone="warn">
            {impact.alreadyApprovedOverCeiling} refund
            {impact.alreadyApprovedOverCeiling === 1 ? " is" : "s are"} already approved and unpaid
            above this ceiling. A ceiling only applies at the moment of approving, so those stay
            payable — pull them back on the ledger if that is not what you want.
          </Note>
        )}
      </Section>

      <Section
        title="Shipment check"
        blurb="Return Prime's status column is the return's stage; shipment_tracking_status is where the courier got to. They are easy to confuse, and a cancelled shipment means the goods never arrived."
      >
        <Toggle
          label="Refuse to approve orders whose shipment was cancelled"
          hint="Without this, a cancelled shipment is only a red chip on the row. With it, approving is blocked in the database until the shipment status changes or the order is corrected."
          value={draft.blockCancelledShipment}
          onChange={(blockCancelledShipment) => patch({ blockCancelledShipment })}
        />
        {draft.blockCancelledShipment && impact.cancelled > 0 && (
          <Note tone="warn">
            {impact.cancelled} unpaid order{impact.cancelled === 1 ? "" : "s"} in the ledger right
            now carr{impact.cancelled === 1 ? "ies" : "y"} a cancelled or problem shipment. Turning
            this on stops {impact.cancelled === 1 ? "it" : "them"} being approved.
          </Note>
        )}
      </Section>

      <Section
        title="Against the ledger as it stands"
        blurb={`${impact.live} order${impact.live === 1 ? "" : "s"} are unpaid and not rejected. The largest is ${money(impact.largest)}.`}
      >
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
          <Cell
            label="Blocked by ceiling"
            value={draft.maxRefundAmount > 0 ? String(impact.overCeiling) : "—"}
            bad={impact.overCeiling > 0}
          />
          <Cell
            label="Flagged by warning"
            value={draft.warnRefundAmount > 0 ? String(impact.overWarn) : "—"}
            warn={impact.overWarn > 0}
          />
          <Cell
            label="Would need a note"
            value={draft.approvalNoteAbove > 0 ? String(impact.needingNote) : "—"}
          />
          <Cell
            label="Cancelled shipment"
            value={String(impact.cancelled)}
            warn={impact.cancelled > 0}
          />
        </div>
        {impact.overCeiling > 0 && (
          <Note tone="bad">
            This ceiling would stop {impact.overCeiling} order
            {impact.overCeiling === 1 ? "" : "s"} currently waiting to be verified. That may be the
            point — but if it is not, the largest legitimate refund here is {money(impact.largest)}.
          </Note>
        )}
      </Section>
    </div>
  );
}

function Cell({
  label,
  value,
  warn,
  bad,
}: {
  label: string;
  value: string;
  warn?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div
        className={`tnum display mt-0.5 text-[17px] font-semibold ${
          bad ? "text-clay" : warn ? "text-gold" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
