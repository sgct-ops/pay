"use client";

import { useMemo } from "react";
import { useOrders } from "@/lib/store";
import { useSettings } from "@/lib/settings-context";
import { blockingReason, payAmount } from "@/lib/order-view";
import { dateTime, money } from "@/lib/format";
import { DEFAULT_SETTINGS, settingsChanged } from "@/lib/settings";
import { Note, Section } from "@/components/admin/controls";
import type { AdminTab } from "@/components/admin/AdminPanel";

/**
 * What the desk currently is.
 *
 * A settings screen usually answers "what can I change". This answers "what is
 * true right now" first, because the interesting question on opening an admin
 * panel is almost always whether something is stuck rather than which knob to
 * turn.
 */
export function OverviewTab({ go }: { go: (tab: AdminTab) => void }) {
  const { orders } = useOrders();
  const { settings, error } = useSettings();

  const state = useMemo(() => {
    const unpaid = orders.filter((o) => o.approval !== "rejected" && !o.paid);
    const blocked = unpaid.filter(
      (o) => o.approval === "pending" && blockingReason(o, settings),
    );
    return {
      pending: orders.filter((o) => o.approval === "pending").length,
      pendingValue: orders
        .filter((o) => o.approval === "pending")
        .reduce((s, o) => s + payAmount(o), 0),
      hold: orders.filter((o) => o.approval === "hold").length,
      approvedUnpaid: orders.filter((o) => o.approval === "approved" && !o.paid).length,
      approvedValue: orders
        .filter((o) => o.approval === "approved" && !o.paid)
        .reduce((s, o) => s + payAmount(o), 0),
      failed: orders.filter((o) => o.payFailedReason).length,
      noUpi: unpaid.filter((o) => !((o.upiOverride || o.upi) as string) && payAmount(o) > 0).length,
      blocked: blocked.length,
    };
  }, [orders, settings]);

  const configured = settingsChanged(settings, DEFAULT_SETTINGS);

  return (
    <div className="space-y-4">
      {error && <Note tone="bad">{error}</Note>}

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="To verify" value={String(state.pending)} sub={money(state.pendingValue)} />
        <Tile label="On hold" value={String(state.hold)} tone={state.hold ? "warn" : undefined} />
        <Tile
          label="Approved, unpaid"
          value={String(state.approvedUnpaid)}
          sub={money(state.approvedValue)}
        />
        <Tile
          label="Failed transfers"
          value={String(state.failed)}
          tone={state.failed ? "bad" : undefined}
        />
        <Tile
          label="Missing a handle"
          value={String(state.noUpi)}
          tone={state.noUpi ? "warn" : undefined}
        />
        <Tile
          label="Blocked by a rule"
          value={String(state.blocked)}
          tone={state.blocked ? "bad" : undefined}
        />
      </div>

      {state.blocked > 0 && (
        <Note tone="bad">
          {state.blocked} order{state.blocked === 1 ? "" : "s"} waiting to be verified cannot be
          approved as {state.blocked === 1 ? "it stands" : "they stand"} — a guardrail, a missing
          handle or nothing payable.{" "}
          <button onClick={() => go("payouts")} className="underline">
            Check the guardrails
          </button>
          .
        </Note>
      )}

      <Section
        title="Rules in force"
        blurb={
          settings.updatedAt
            ? `Last changed by ${settings.updatedByEmail ?? "someone"} on ${dateTime(settings.updatedAt)}.`
            : "Nothing has been changed yet — the desk is running on the values it ships with."
        }
        aside={
          <span
            className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${
              configured ? "bg-spruce-wash text-spruce" : "bg-slate-wash text-slate"
            }`}
          >
            {configured ? "Customised" : "Defaults"}
          </span>
        }
      >
        <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <Line
            label="Hard ceiling on an approval"
            value={settings.maxRefundAmount > 0 ? money(settings.maxRefundAmount) : "None"}
            onClick={() => go("payouts")}
          />
          <Line
            label="Warn above"
            value={settings.warnRefundAmount > 0 ? money(settings.warnRefundAmount) : "Off"}
            onClick={() => go("payouts")}
          />
          <Line
            label="Reason required above"
            value={settings.approvalNoteAbove > 0 ? money(settings.approvalNoteAbove) : "Never"}
            onClick={() => go("payouts")}
          />
          <Line
            label="Cancelled shipments"
            value={settings.blockCancelledShipment ? "Cannot be approved" : "Flagged only"}
            onClick={() => go("payouts")}
          />
          <Line
            label="Stages kept by default"
            value={settings.defaultStages.join(" + ") || "None"}
            onClick={() => go("transform")}
          />
          <Line
            label="Exclusion rules"
            value={`${settings.exclusions.filter((e) => e.enabled).length} active of ${settings.exclusions.length}`}
            onClick={() => go("transform")}
          />
          <Line label="Payout tag" value={settings.noteTag} onClick={() => go("payments")} mono />
          <Line
            label="Ad-hoc payees"
            value={settings.allowAdhocPayments ? "Allowed for admins" : "Off"}
            onClick={() => go("payments")}
          />
        </dl>
      </Section>

      <Section
        title="What an admin cannot change"
        blurb="Some things are deliberately not settings, because making them adjustable is what would break the app's one real guarantee."
      >
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
          <li>
            <span className="font-medium text-ink">The two-desk split.</span> Operations approves,
            accounts pays, and no setting grants either the other&rsquo;s step. It is checked field
            by field in <code className="font-mono text-[11.5px]">firestore.rules</code>.
          </li>
          <li>
            <span className="font-medium text-ink">The owner address.</span> Pinned in the code and
            in the rules, so a mistake on the People tab can never lock you out.
          </li>
          <li>
            <span className="font-medium text-ink">The audit trail.</span> Append-only. Nothing in
            the app can edit or delete an entry, including this panel.
          </li>
          <li>
            <span className="font-medium text-ink">Deleting an order.</span> The ledger is the
            record of what was owed, so nothing removes one.
          </li>
        </ul>
      </Section>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="bg-card px-3 py-3">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div
        className={`tnum display mt-0.5 text-[19px] font-semibold ${
          tone === "bad" ? "text-clay" : tone === "warn" ? "text-gold" : "text-ink"
        }`}
      >
        {value}
      </div>
      {sub && <div className="tnum text-[11px] text-ink-3">{sub}</div>}
    </div>
  );
}

function Line({
  label,
  value,
  onClick,
  mono,
}: {
  label: string;
  value: string;
  onClick: () => void;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft pb-2 last:border-0">
      <dt className="text-[12.5px] text-ink-2">{label}</dt>
      <dd>
        <button
          onClick={onClick}
          className={`text-[12.5px] font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-spruce ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </button>
      </dd>
    </div>
  );
}
