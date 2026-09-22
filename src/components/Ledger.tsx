"use client";

import { useMemo, useState } from "react";
import { useOrders } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { groupByWeek } from "@/lib/sheet/transform";
import { isUpiHandle } from "@/lib/upi";
import type { Approval, StoredOrder } from "@/lib/sheet/types";
import {
  APPROVAL_LABELS,
  APPROVAL_TONES,
  approvableNow,
  approvalNeedsNote,
  approvalWarning,
  blockingReason,
  isCorrected,
  payAmount,
  payUpi,
} from "@/lib/order-view";
import { money, shortDate } from "@/lib/format";
import { useSettings } from "@/lib/settings-context";
import type { AppSettings } from "@/lib/settings";

type Filter = Approval | "all";

/** The date ranges worth one tap. "custom" is whatever the two inputs say. */
type Preset = "all" | "7" | "30" | "month" | "custom";

const PRESETS: Array<[Preset, string]> = [
  ["all", "All time"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["month", "This month"],
  ["custom", "Custom"],
];

/** yyyy-mm-dd in UTC, matching how the export's dates are parsed and compared. */
function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * The two dates a preset stands for, both inclusive.
 *
 * Module scope on purpose: it reads the clock, which is not something to do
 * while rendering. It is only ever called from a click.
 */
function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  if (preset === "all") return { from: "", to: "" };

  const today = Date.now();
  if (preset === "month") {
    const now = new Date(today);
    return {
      from: isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to: isoDay(today),
    };
  }
  // Inclusive of today, so "7 days" is a week of work, not six days and today.
  const days = preset === "7" ? 7 : 30;
  return { from: isoDay(today - (days - 1) * 86_400_000), to: isoDay(today) };
}

/**
 * The operations desk: verify what the export says, fix what it got wrong, and
 * decide what accounts is allowed to pay. There is no payment control anywhere
 * on this screen — that is deliberately someone else's step.
 */
export function Ledger() {
  const { orders, ready, error, clearError, decide, decideMany } = useOrders();
  const { can } = useAuth();

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");
  // Both ends inclusive, as yyyy-mm-dd from a date input. Empty means open,
  // which is what "All time" sets them back to.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  // A paid order is finished business, so the desk opens on what still needs
  // doing. Unticking brings them back for anyone checking an old payment.
  const [hidePaid, setHidePaid] = useState(true);
  // Orders with nothing payable are no longer written by the transform, but
  // ones uploaded before that change are still in Firestore.
  const [showNothingToPay, setShowNothingToPay] = useState(false);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ order: StoredOrder | null; approval: Approval } | null>(
    null,
  );
  const { settings } = useSettings();

  const counts = useMemo(
    () => ({
      pending: orders.filter((o) => o.approval === "pending").length,
      hold: orders.filter((o) => o.approval === "hold").length,
      approved: orders.filter((o) => o.approval === "approved" && !o.paid).length,
      failed: orders.filter((o) => o.payFailedReason).length,
      pendingValue: orders
        .filter((o) => o.approval === "pending")
        .reduce((s, o) => s + payAmount(o), 0),
      noUpi: orders.filter((o) => o.approval !== "rejected" && !payUpi(o) && payAmount(o) > 0)
        .length,
      blocked: orders.filter(
        (o) => o.approval === "pending" && blockingReason(o, settings) !== null,
      ).length,
      paid: orders.filter((o) => o.paid).length,
      nothingToPay: orders.filter((o) => payAmount(o) <= 0).length,
    }),
    [orders, settings],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Both ends inclusive: "to" covers the whole of that day. The dates in the
    // export are UTC midnights, so the comparison is made in UTC too — a range
    // must not shift by a day for someone reading it in a different timezone.
    const fromTs = from ? Date.parse(`${from}T00:00:00Z`) : null;
    const toTs = to ? Date.parse(`${to}T23:59:59.999Z`) : null;

    return orders.filter((o) => {
      if (filter !== "all" && o.approval !== filter) return false;
      if (payAmount(o) <= 0 && !showNothingToPay) return false;
      if (hidePaid && o.paid) return false;

      if (fromTs !== null || toTs !== null) {
        // The same date the week headings group by, so a range and a heading
        // never disagree about which week an order belongs to.
        const when = o.approvedAt ?? o.receivedAt;
        if (when === null) return false;
        if (fromTs !== null && when < fromTs) return false;
        if (toTs !== null && when > toTs) return false;
      }

      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerPhone.includes(q) ||
        payUpi(o).includes(q)
      );
    });
  }, [orders, search, filter, from, to, hidePaid, showNothingToPay]);

  const applyPreset = (next: Preset) => {
    setPreset(next);
    if (next === "custom") return;
    const range = presetRange(next);
    setFrom(range.from);
    setTo(range.to);
  };

  const weeks = useMemo(() => groupByWeek(visible), [visible]);
  const picked = useMemo(() => visible.filter((o) => selected[o.orderKey]), [visible, selected]);
  const pickedApprovable = useMemo(() => approvableNow(picked, settings), [picked, settings]);
  const pickedBlocked = picked.length - pickedApprovable.length;
  const pickedNeedsNote = useMemo(
    () => pickedApprovable.some((o) => approvalNeedsNote(o, settings)),
    [pickedApprovable, settings],
  );

  if (!ready) return <Skeleton />;

  return (
    <div className="space-y-4 pb-24">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-5">
        <Tile label="To verify" value={String(counts.pending)} />
        <Tile label="Value pending" value={money(counts.pendingValue)} />
        <Tile label="On hold" value={String(counts.hold)} warn={counts.hold > 0} />
        <Tile label="Approved, unpaid" value={String(counts.approved)} />
        <Tile
          label={counts.failed ? "Failed transfers" : counts.blocked ? "Blocked" : "No UPI yet"}
          value={String(counts.failed || counts.blocked || counts.noUpi)}
          warn={Boolean(counts.failed || counts.blocked || counts.noUpi)}
          span
        />
      </div>

      {settings.maxRefundAmount > 0 && (
        <p className="px-1 text-[12px] text-ink-3">
          A refund over {money(settings.maxRefundAmount)} cannot be approved
          {settings.blockCancelledShipment && ", and nor can one whose shipment was cancelled"}.
          {settings.approvalNoteAbove > 0 &&
            ` Above ${money(settings.approvalNoteAbove)} an approval has to carry a reason.`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order, name, phone or UPI"
          className="min-w-[170px] flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[13px] focus:border-spruce focus:outline-none"
        />
        <div className="flex flex-wrap rounded-lg border border-line bg-card p-0.5">
          {(
            [
              ["pending", "To verify"],
              ["hold", "On hold"],
              ["approved", "Approved"],
              ["rejected", "Rejected"],
              ["all", "All"],
            ] as Array<[Filter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition ${
                filter === value ? "bg-spruce text-white" : "text-ink-2 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stacks on a phone and stays on one line from sm up. Two date inputs
          plus their labels do not fit across a 360px screen, so the presets
          carry the common cases and the inputs only appear when they are the
          thing being used. */}
      <div className="space-y-2 px-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <span className="mr-0.5 text-ink-3">Approved</span>
          {PRESETS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => applyPreset(value)}
              className={`rounded-full border px-2.5 py-1 font-medium transition ${
                preset === value
                  ? "border-spruce/30 bg-spruce-wash text-spruce"
                  : "border-line bg-card text-ink-2 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(preset === "custom" || from || to) && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
            <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">From</span>
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPreset("custom");
                }}
                className="w-full rounded-lg border border-line bg-card px-2 py-1.5 text-[12.5px] focus:border-spruce focus:outline-none sm:w-auto"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">To</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPreset("custom");
                }}
                className="w-full rounded-lg border border-line bg-card px-2 py-1.5 text-[12.5px] focus:border-spruce focus:outline-none sm:w-auto"
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-ink-2">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={hidePaid}
              onChange={(e) => setHidePaid(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#2f6b4f]"
            />
            Hide paid{counts.paid > 0 && ` (${counts.paid})`}
          </label>

          {counts.nothingToPay > 0 && (
            <label
              className="flex cursor-pointer items-center gap-1.5"
              title="Orders where every line was an alteration, an exchange, a store credit or an amount settled elsewhere. Uploads no longer create these."
            >
              <input
                type="checkbox"
                checked={showNothingToPay}
                onChange={(e) => setShowNothingToPay(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#2f6b4f]"
              />
              Show {counts.nothingToPay} with nothing to pay
            </label>
          )}
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-3 rounded-lg border border-clay/30 bg-clay-wash px-3 py-2 text-[12.5px] text-clay">
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="shrink-0 underline">
            Dismiss
          </button>
        </p>
      )}

      {!visible.length ? (
        <Empty filter={filter} hasAny={orders.length > 0} narrowed={Boolean(from || to)} />
      ) : (
        <div className="space-y-5">
          {weeks.map((week) => {
            const approvable = approvableNow(week.orders, settings).filter(
              (o) => o.approval !== "approved",
            );
            return (
              <section key={String(week.weekStart)}>
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      disabled={!approvable.length || !can.verify}
                      checked={
                        approvable.length > 0 && approvable.every((o) => selected[o.orderKey])
                      }
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = { ...prev };
                          for (const o of approvable) {
                            if (e.target.checked) next[o.orderKey] = true;
                            else delete next[o.orderKey];
                          }
                          return next;
                        })
                      }
                      className="h-4 w-4 rounded-[3px] accent-[#5a5f7a] disabled:opacity-30"
                    />
                    <span className="display text-[14px] font-semibold text-ink">{week.label}</span>
                  </label>
                  <span className="tnum text-[12px] text-ink-3">
                    {week.orders.length} order{week.orders.length === 1 ? "" : "s"} ·{" "}
                    {money(week.orders.reduce((s, o) => s + payAmount(o), 0))}
                  </span>
                </div>

                <div className="overflow-hidden rounded-card border border-line bg-card">
                  {week.orders.map((order, i) => (
                    <Row
                      key={order.orderKey}
                      order={order}
                      first={i === 0}
                      canVerify={can.verify}
                      settings={settings}
                      selected={Boolean(selected[order.orderKey])}
                      expanded={open === order.orderKey}
                      onToggleSelect={() =>
                        setSelected((prev) => {
                          const next = { ...prev };
                          if (next[order.orderKey]) delete next[order.orderKey];
                          else next[order.orderKey] = true;
                          return next;
                        })
                      }
                      onToggleExpand={() =>
                        setOpen((cur) => (cur === order.orderKey ? null : order.orderKey))
                      }
                      onApprove={() =>
                        approvalNeedsNote(order, settings)
                          ? setAsking({ order, approval: "approved" })
                          : void decide(order, "approved", null)
                      }
                      onAsk={(approval) => setAsking({ order, approval })}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {picked.length > 0 && can.verify && (
        <div className="fixed inset-x-0 bottom-[60px] z-30 px-3 lg:bottom-4">
          <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-3 rounded-card border border-spruce/25 bg-card px-4 py-3 shadow-[0_8px_24px_rgba(29,31,35,0.10)]">
            <div className="tnum text-[13px] text-ink">
              <span className="font-semibold">{picked.length}</span> selected ·{" "}
              <span className="font-semibold">
                {money(picked.reduce((s, o) => s + payAmount(o), 0))}
              </span>
              {pickedBlocked > 0 && (
                <span className="ml-2 font-normal text-clay">
                  {pickedBlocked} cannot be approved
                </span>
              )}
            </div>
            <button
              onClick={() => setSelected({})}
              className="text-[12.5px] text-ink-3 hover:text-ink"
            >
              Clear
            </button>
            <button
              onClick={() => setAsking({ order: null, approval: "hold" })}
              className="rounded-lg border border-line px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:border-gold hover:text-gold"
            >
              Hold
            </button>
            <button
              onClick={() => {
                // A single blocked order in the batch would have the whole
                // atomic write refused, so they are filtered out here as well
                // as being un-tickable individually.
                if (pickedNeedsNote) {
                  setAsking({ order: null, approval: "approved" });
                  return;
                }
                void decideMany(pickedApprovable, "approved", null);
                setSelected({});
              }}
              disabled={!pickedApprovable.length}
              className="rounded-lg bg-spruce px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-spruce-deep disabled:opacity-40"
            >
              Approve {pickedApprovable.length} →
            </button>
          </div>
        </div>
      )}

      {asking && (
        <ReasonDialog
          approval={asking.approval}
          count={asking.order ? 1 : asking.approval === "approved" ? pickedApprovable.length : picked.length}
          amount={
            asking.order
              ? payAmount(asking.order)
              : (asking.approval === "approved" ? pickedApprovable : picked).reduce(
                  (sum, o) => sum + payAmount(o),
                  0,
                )
          }
          threshold={settings.approvalNoteAbove}
          onCancel={() => setAsking(null)}
          onConfirm={async (note) => {
            if (asking.order) await decide(asking.order, asking.approval, note);
            else {
              await decideMany(
                asking.approval === "approved" ? pickedApprovable : picked,
                asking.approval,
                note,
              );
              setSelected({});
            }
            setAsking(null);
          }}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- row ---- */

function Row({
  order,
  first,
  canVerify,
  settings,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onApprove,
  onAsk,
}: {
  order: StoredOrder;
  first: boolean;
  canVerify: boolean;
  settings: AppSettings;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onApprove: () => void;
  onAsk: (approval: Approval) => void;
}) {
  const blocked = blockingReason(order, settings);
  const warning = blocked ? null : approvalWarning(order, settings);
  const needsNote = approvalNeedsNote(order, settings);

  return (
    <div className={first ? "" : "border-t border-line-soft"}>
      <div
        onClick={onToggleExpand}
        className={`flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-2 px-2.5 py-2.5 transition hover:bg-sunk/60 sm:gap-x-3 sm:px-3 ${
          order.approval === "rejected" ? "opacity-55" : ""
        }`}
      >
        {/* Swallowing clicks here is what stops ticking a box from also
            unfolding the row. */}
        <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={`Select order ${order.orderNumber}`}
            checked={selected}
            disabled={!canVerify || Boolean(blocked)}
            onChange={onToggleSelect}
            className="h-4 w-4 rounded-[3px] accent-[#5a5f7a] disabled:opacity-25"
          />
          <span className="h-5 w-px bg-line-soft" aria-hidden />
          {order.approval === "approved" ? (
            <button
              onClick={() => onAsk("hold")}
              disabled={!canVerify}
              title="Approved — click to pull it back"
              className="grid h-6 w-6 place-items-center rounded-full bg-spruce text-[11px] leading-none text-white disabled:opacity-60"
            >
              ✓
            </button>
          ) : (
            <button
              onClick={onApprove}
              disabled={!canVerify || Boolean(blocked)}
              title={blocked ?? (needsNote ? "Approve — this one needs a reason" : "Approve for payment")}
              className="rounded-md border border-spruce/25 bg-spruce-wash px-2.5 py-1 text-[12px] font-semibold text-spruce transition hover:bg-spruce hover:text-white disabled:border-line disabled:bg-sunk disabled:text-ink-3"
            >
              Approve{needsNote && !blocked ? "…" : ""}
            </button>
          )}
          <button
            onClick={() => onAsk(order.approval === "rejected" ? "hold" : "rejected")}
            disabled={!canVerify}
            title="Reject, or put on hold"
            className="grid h-6 w-6 place-items-center rounded-full border border-dashed border-ink-3/50 text-[12px] leading-none text-ink-3 transition hover:border-clay hover:text-clay disabled:opacity-30"
          >
            ×
          </button>
        </div>

        <div className="min-w-[88px] flex-1 truncate text-[13px] text-ink">
          <span className="tnum mr-1.5 font-mono text-[12px] text-ink-3">{order.orderNumber}</span>
          {order.customerName || <span className="text-ink-3">No name</span>}
          {order.pieces > 1 && (
            <span className="ml-1.5 rounded bg-sunk px-1.5 py-0.5 text-[11px] text-ink-2">
              {order.pieces}
            </span>
          )}
        </div>

        <div className="hidden min-w-[140px] flex-1 truncate font-mono text-[12px] text-ink-2 sm:block">
          {payUpi(order) || <span className="text-clay">UPI missing</span>}
          {order.upiClash && (
            <span className="ml-2 rounded bg-gold-wash px-1.5 py-0.5 text-[11px] text-gold">
              {order.upis.length} handles
            </span>
          )}
        </div>

        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${APPROVAL_TONES[order.approval]}`}
        >
          {APPROVAL_LABELS[order.approval]}
        </span>

        {order.payFailedReason && (
          <span className="shrink-0 rounded bg-clay-wash px-1.5 py-0.5 text-[11px] text-clay">
            transfer failed
          </span>
        )}
        {blocked && order.approval !== "approved" && order.approval !== "rejected" && (
          <span
            className="shrink-0 rounded bg-clay-wash px-1.5 py-0.5 text-[11px] text-clay"
            title={blocked}
          >
            blocked
          </span>
        )}
        {warning && order.approval === "pending" && (
          <span
            className="hidden shrink-0 rounded bg-gold-wash px-1.5 py-0.5 text-[11px] text-gold sm:inline"
            title={warning}
          >
            check
          </span>
        )}
        {order.shipRank >= 4 && (
          <span
            className="hidden shrink-0 rounded bg-clay-wash px-1.5 py-0.5 text-[11px] text-clay md:inline"
            title={order.ships.join(" · ")}
          >
            {order.ships[0]}
          </span>
        )}

        <div className="tnum ml-auto shrink-0 text-right text-[13.5px] font-semibold text-ink sm:w-[100px]">
          {money(payAmount(order))}
          {isCorrected(order) && (
            <div className="text-[10.5px] font-normal text-gold">corrected</div>
          )}
        </div>

        <span className="w-3 shrink-0 text-[10px] text-ink-3" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {expanded && (
        <Detail order={order} canVerify={canVerify} blocked={blocked} warning={warning} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- detail ---- */

function Detail({
  order,
  canVerify,
  blocked,
  warning,
}: {
  order: StoredOrder;
  canVerify: boolean;
  blocked: string | null;
  warning: string | null;
}) {
  const { correct } = useOrders();
  const [upi, setUpi] = useState(payUpi(order));
  const [amount, setAmount] = useState(String(payAmount(order)));

  const upiDirty = upi.trim().toLowerCase() !== payUpi(order);
  const amountDirty = Number(amount) !== payAmount(order);
  const upiValid = !upi.trim() || isUpiHandle(upi.trim().toLowerCase());

  return (
    <div className="border-t border-line-soft bg-sunk/50 px-3 py-3">
      {blocked && order.approval !== "rejected" && (
        <p className="mb-3 rounded-lg border border-clay/30 bg-clay-wash px-2.5 py-2 text-[12px] text-clay">
          Cannot be approved: {blocked}
        </p>
      )}
      {warning && !blocked && (
        <p className="mb-3 rounded-lg border border-gold/30 bg-gold-wash px-2.5 py-2 text-[12px] text-gold">
          {warning}
        </p>
      )}
      {(order.approvalNote || order.payFailedReason) && (
        <div className="mb-3 space-y-1.5">
          {order.approvalNote && (
            <p className="rounded-lg border border-gold/30 bg-gold-wash px-2.5 py-2 text-[12px] text-gold">
              {order.approvalNote}
              {order.approvalBy && (
                <span className="text-gold/70">
                  {" "}
                  — {order.approvalBy}, {shortDate(order.approvalAt)}
                </span>
              )}
            </p>
          )}
          {order.payFailedReason && (
            <p className="rounded-lg border border-clay/30 bg-clay-wash px-2.5 py-2 text-[12px] text-clay">
              Transfer failed: {order.payFailedReason}
            </p>
          )}
        </div>
      )}

      <div className="mb-3 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
        <Field label="Phone" value={order.customerPhone || "—"} mono />
        <Field label="Email" value={order.customerEmail || "—"} />
        <Field label="Approved in Return Prime" value={shortDate(order.approvedAt)} />
        <Field label="Received" value={shortDate(order.receivedAt)} />
        <Field label="Return fees" value={money(order.fees)} />
        <Field label="Shipment" value={order.ships.join(" · ") || "—"} />
      </div>

      {/* Corrections. The imported values stay untouched underneath — a change
          here is recorded as a change, not as a replacement. */}
      {canVerify && (
        <div className="mb-3 grid gap-3 rounded-lg border border-line bg-card p-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-ink-3">
              UPI handle {order.upiOverride && <span className="text-gold">· corrected</span>}
            </span>
            <div className="flex gap-2">
              <input
                value={upi}
                onChange={(e) => setUpi(e.target.value)}
                placeholder="name@bank"
                className={`min-w-0 flex-1 rounded-lg border bg-paper px-3 py-2 font-mono text-[12.5px] focus:outline-none ${
                  upiValid ? "border-line focus:border-spruce" : "border-clay"
                }`}
              />
              <button
                onClick={() => void correct(order, { upi: upi.trim().toLowerCase() || null })}
                disabled={!upiDirty || !upiValid}
                className="shrink-0 rounded-lg border border-line px-3 text-[12.5px] font-medium text-ink-2 hover:border-spruce hover:text-spruce disabled:opacity-30"
              >
                Save
              </button>
            </div>
            {order.upiOverride && (
              <span className="mt-1 block text-[11px] text-ink-3">
                Export had {order.upi || "nothing"}
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-ink-3">
              Amount{" "}
              {order.amountOverride !== null && <span className="text-gold">· corrected</span>}
            </span>
            <div className="flex gap-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="tnum min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] focus:border-spruce focus:outline-none"
              />
              <button
                onClick={() =>
                  void correct(order, {
                    amount: Number(amount) === order.total ? null : Number(amount),
                  })
                }
                disabled={!amountDirty || !Number.isFinite(Number(amount))}
                className="shrink-0 rounded-lg border border-line px-3 text-[12.5px] font-medium text-ink-2 hover:border-spruce hover:text-spruce disabled:opacity-30"
              >
                Save
              </button>
            </div>
            {order.amountOverride !== null && (
              <span className="mt-1 block text-[11px] text-ink-3">
                Export had {money(order.total)}
              </span>
            )}
          </label>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-card">
        {order.lines.map((line, i) => (
          <div
            key={line.key}
            className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[12.5px] ${
              i ? "border-t border-line-soft" : ""
            }`}
          >
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium ${
                line.payable ? "bg-spruce-wash text-spruce" : "bg-sunk text-ink-3"
              }`}
            >
              {line.payable ? "counted" : "excluded"}
            </span>
            <div className="min-w-[160px] flex-1">
              <div className="text-ink">{line.item || "—"}</div>
              <div className="text-[11.5px] text-ink-3">
                {[line.sku, line.reason, line.excludedFor].filter(Boolean).join(" · ")}
              </div>
              {line.notes && (
                <div className="mt-0.5 text-[11.5px] italic text-ink-3">{line.notes}</div>
              )}
            </div>
            <div
              className={`tnum w-[92px] shrink-0 text-right ${
                line.payable ? "text-ink" : "text-ink-3 line-through"
              }`}
            >
              {money(line.amount)}
            </div>
          </div>
        ))}
      </div>

      {order.upiClash && (
        <p className="mt-2 rounded-lg border border-gold/30 bg-gold-wash px-2.5 py-2 text-[12px] text-gold">
          This order carries more than one handle: {order.upis.join(", ")}. Pick the right one
          above before approving.
        </p>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- bits ----- */

function ReasonDialog({
  approval,
  count,
  amount,
  threshold,
  onCancel,
  onConfirm,
}: {
  approval: Approval;
  count: number;
  amount: number;
  threshold: number;
  onCancel: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const holding = approval === "hold";
  const approving = approval === "approved";
  const presets = approving
    ? [
        "Checked the line items against the return",
        "Customer confirmed the handle and the amount",
        "Verified with the warehouse that the goods arrived",
      ]
    : holding
      ? [
          "Waiting on the customer's UPI ID",
          "Shipment cancelled — checking with the warehouse",
          "Amount queried with the customer",
        ]
      : [
          "Not a refund — exchange or alteration",
          "Already settled another way",
          "Duplicate of another order",
        ];
  const [note, setNote] = useState("");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-card p-5">
        <h3 className="display text-[15px] font-semibold text-ink">
          {approving ? "Approve for payment" : holding ? "Put on hold" : "Reject"}
          {count > 1 && ` — ${count} orders`}
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
          {approving
            ? `${money(amount)} is above the ${money(threshold)} an admin set as needing a written reason. Once approved, accounts can pay it and UPI has no way to take it back — so say what you checked.`
            : holding
              ? "It stays in the ledger and out of the accounts queue until you approve it. The reason is what stops someone chasing it twice."
              : "It leaves the queue entirely. Say why, so the decision still makes sense in three months."}
        </p>
        <div className="mt-3 space-y-1.5">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setNote(p)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-[12.5px] transition ${
                note === p
                  ? "border-spruce bg-spruce-wash text-spruce"
                  : "border-line text-ink-2 hover:border-spruce"
              }`}
            >
              {p}
            </button>
          ))}
          <input
            value={presets.includes(note) ? "" : note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Or type a reason"
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-[12.5px] focus:border-spruce focus:outline-none"
          />
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-line py-2 text-[13px] text-ink-2"
          >
            Cancel
          </button>
          <button
            onClick={() => void onConfirm(note.trim())}
            disabled={!note.trim()}
            className={`flex-1 rounded-lg py-2 text-[13px] font-semibold text-white disabled:opacity-40 ${
              approving ? "bg-spruce" : holding ? "bg-gold" : "bg-clay"
            }`}
          >
            {approving ? "Approve" : holding ? "Hold" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  warn,
  span,
}: {
  label: string;
  value: string;
  warn?: boolean;
  span?: boolean;
}) {
  return (
    <div className={`bg-card px-4 py-3 ${span ? "col-span-2 sm:col-span-1" : ""}`}>
      <div className="text-[11px] uppercase tracking-[0.07em] text-ink-3">{label}</div>
      <div
        className={`tnum display mt-1 text-[19px] font-semibold ${warn ? "text-clay" : "text-ink"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div className={`text-ink-2 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Empty({
  filter,
  hasAny,
  narrowed,
}: {
  filter: Filter;
  hasAny: boolean;
  narrowed: boolean;
}) {
  // A date range that matches nothing is not the same as an empty ledger, and
  // telling someone to upload an export when the answer is to widen the dates
  // sends them off to do the wrong thing.
  if (narrowed && hasAny) {
    return (
      <div className="rounded-card border border-dashed border-line bg-card px-6 py-14 text-center">
        <p className="display text-[15px] font-semibold text-ink">Nothing in these dates</p>
        <p className="mx-auto mt-1 max-w-[380px] text-[13px] leading-relaxed text-ink-2">
          No order was approved in the range you picked. Widen it, or clear the dates to see
          everything again.
        </p>
      </div>
    );
  }
  const copy: Record<Filter, string> = {
    pending: "Nothing waiting to be verified. Upload an export, or look at the other tabs.",
    hold: "Nothing on hold.",
    approved: "Nothing approved yet.",
    rejected: "Nothing rejected.",
    all: "Upload a Return Prime export and the orders needing a manual UPI refund will land here.",
  };
  return (
    <div className="rounded-card border border-dashed border-line bg-card px-6 py-14 text-center">
      <p className="display text-[15px] font-semibold text-ink">
        {hasAny ? "Nothing here" : "No orders yet"}
      </p>
      <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] leading-relaxed text-ink-2">
        {copy[filter]}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="h-[74px] animate-pulse rounded-card bg-sunk" />
      <div className="h-10 animate-pulse rounded-lg bg-sunk" />
      <div className="h-64 animate-pulse rounded-card bg-sunk" />
    </div>
  );
}
