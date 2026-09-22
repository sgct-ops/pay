"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { orderToQueueItem, useOrders, usePayQueue } from "@/lib/store";
import { groupByWeek } from "@/lib/sheet/transform";
import type { StoredOrder } from "@/lib/sheet/types";
import { isCorrected, payAmount, payUpi } from "@/lib/order-view";
import { money, shortDate } from "@/lib/format";
import { InstallHint } from "@/components/InstallHint";
import { useSettings } from "@/lib/settings-context";

/**
 * The accounts desk.
 *
 * Only what operations has approved, and nothing editable. A wrong figure goes
 * back rather than being fixed here — that is the whole reason the two roles
 * exist. The screen is deliberately narrow in what it offers: pick, send to the
 * pay desk, work through them.
 */
export function Refunds() {
  const { orders, ready, error } = useOrders();
  const { push } = usePayQueue();
  const { settings } = useSettings();
  const router = useRouter();

  const [tab, setTab] = useState<"due" | "paid">("due");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, true>>({});

  const due = useMemo(
    () => orders.filter((o) => o.approval === "approved" && !o.paid),
    [orders],
  );
  const donePaid = useMemo(() => orders.filter((o) => o.paid), [orders]);

  const visible = useMemo(() => {
    const list = tab === "due" ? due : donePaid;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        payUpi(o).includes(q),
    );
  }, [tab, due, donePaid, search]);

  const weeks = useMemo(() => groupByWeek(visible), [visible]);
  const picked = useMemo(() => visible.filter((o) => selected[o.orderKey]), [visible, selected]);

  const totals = useMemo(
    () => ({
      count: due.length,
      value: due.reduce((s, o) => s + payAmount(o), 0),
      failed: due.filter((o) => o.payFailedReason).length,
    }),
    [due],
  );

  if (!ready) return <Skeleton />;

  const send = (list: StoredOrder[]) => {
    push(
      list.map((o) => orderToQueueItem(o, settings.noteTag)),
      { replace: true },
    );
    router.push("/pay");
  };

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <h1 className="display text-[19px] font-semibold text-ink">Refunds to pay</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">
            Approved by operations and waiting on you.
          </p>
        </div>
        <div className="ml-auto flex items-baseline gap-5">
          <Stat label="Waiting" value={String(totals.count)} />
          <Stat label="Total" value={money(totals.value)} />
          {totals.failed > 0 && <Stat label="Failed" value={String(totals.failed)} warn />}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-line bg-card p-0.5">
          {(["due", "paid"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-[6px] px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                tab === t ? "bg-spruce text-white" : "text-ink-2 hover:text-ink"
              }`}
            >
              {t === "due" ? "To pay" : "Paid"}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order, name or UPI"
          className="min-w-[160px] flex-1 rounded-lg border border-line bg-card px-3 py-2 text-[13px] focus:border-spruce focus:outline-none"
        />
        {tab === "due" && due.length > 0 && (
          <button
            onClick={() => send(due)}
            className="rounded-lg border border-spruce/30 bg-spruce-wash px-3.5 py-2 text-[12.5px] font-semibold text-spruce transition hover:bg-spruce hover:text-white"
          >
            Pay all {due.length}
          </button>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-gold/30 bg-gold-wash px-3 py-2 text-[12.5px] text-gold">
          {error}
        </p>
      )}

      {!visible.length ? (
        <Empty tab={tab} />
      ) : (
        <div className="space-y-5">
          {weeks.map((week) => (
            <section key={String(week.weekStart)}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 px-1">
                <span className="display text-[14px] font-semibold text-ink">{week.label}</span>
                <span className="tnum text-[12px] text-ink-3">
                  {week.orders.length} order{week.orders.length === 1 ? "" : "s"} ·{" "}
                  {money(week.orders.reduce((s, o) => s + payAmount(o), 0))}
                </span>
                {tab === "due" && (
                  <button
                    onClick={() => send(week.orders)}
                    className="ml-auto text-[12px] font-medium text-spruce hover:underline"
                  >
                    Pay this week →
                  </button>
                )}
              </div>

              <div className="overflow-hidden rounded-card border border-line bg-card">
                {week.orders.map((order, i) => (
                  <RefundRow
                    key={order.orderKey}
                    order={order}
                    first={i === 0}
                    selectable={tab === "due"}
                    selected={Boolean(selected[order.orderKey])}
                    onToggle={() =>
                      setSelected((prev) => {
                        const next = { ...prev };
                        if (next[order.orderKey]) delete next[order.orderKey];
                        else next[order.orderKey] = true;
                        return next;
                      })
                    }
                    onPay={() => send([order])}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <InstallHint />

      {picked.length > 0 && (
        <div className="fixed inset-x-0 bottom-[60px] z-30 px-3 lg:bottom-4">
          <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-3 rounded-card border border-spruce/25 bg-card px-4 py-3 shadow-[0_8px_24px_rgba(29,31,35,0.10)]">
            <div className="tnum text-[13px] text-ink">
              <span className="font-semibold">{picked.length}</span> selected ·{" "}
              <span className="font-semibold">
                {money(picked.reduce((s, o) => s + payAmount(o), 0))}
              </span>
            </div>
            <button
              onClick={() => setSelected({})}
              className="text-[12.5px] text-ink-3 hover:text-ink"
            >
              Clear
            </button>
            <button
              onClick={() => send(picked)}
              className="ml-auto rounded-lg bg-spruce px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-spruce-deep"
            >
              Pay these {picked.length} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RefundRow({
  order,
  first,
  selectable,
  selected,
  onToggle,
  onPay,
}: {
  order: StoredOrder;
  first: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onPay: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={first ? "" : "border-t border-line-soft"}>
      <div
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-2 px-2.5 py-2.5 transition hover:bg-sunk/60 sm:gap-x-3 sm:px-3"
      >
        <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-2">
          {selectable && (
            <input
              type="checkbox"
              aria-label={`Select order ${order.orderNumber}`}
              checked={selected}
              onChange={onToggle}
              className="h-4 w-4 rounded-[3px] accent-[#5a5f7a]"
            />
          )}
          {selectable && (
            <button
              onClick={onPay}
              className="rounded-md border border-spruce/25 bg-spruce-wash px-2.5 py-1 text-[12px] font-semibold text-spruce transition hover:bg-spruce hover:text-white"
            >
              Pay
            </button>
          )}
          {order.paid && (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-spruce text-[11px] text-white">
              ✓
            </span>
          )}
        </div>

        <div className="min-w-[88px] flex-1 truncate text-[13px] text-ink">
          <span className="tnum mr-1.5 font-mono text-[12px] text-ink-3">{order.orderNumber}</span>
          {order.customerName || <span className="text-ink-3">No name</span>}
        </div>

        <div className="hidden min-w-[140px] flex-1 truncate font-mono text-[12px] text-ink-2 sm:block">
          {payUpi(order)}
        </div>

        {order.payFailedReason && (
          <span className="shrink-0 rounded bg-clay-wash px-1.5 py-0.5 text-[11px] text-clay">
            failed
          </span>
        )}
        {isCorrected(order) && (
          <span className="hidden shrink-0 rounded bg-gold-wash px-1.5 py-0.5 text-[11px] text-gold sm:inline">
            corrected
          </span>
        )}

        <div className="tnum ml-auto shrink-0 text-right text-[13.5px] font-semibold text-ink sm:w-[96px]">
          {money(payAmount(order))}
        </div>
        <span className="w-3 shrink-0 text-[10px] text-ink-3" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </div>

      {open && (
        <div className="grid gap-x-6 gap-y-2 border-t border-line-soft bg-sunk/50 px-3 py-3 text-[12.5px] sm:grid-cols-3">
          <Field label="Phone" value={order.customerPhone || "—"} />
          <Field label="Pieces" value={String(order.pieces)} />
          <Field label="Approved" value={shortDate(order.approvalAt)} />
          <Field label="Approved by" value={order.approvalBy || "—"} />
          {isCorrected(order) && (
            <Field
              label="Corrected by operations"
              value={`${order.amountOverride !== null ? `amount was ${money(order.total)}` : ""}${
                order.amountOverride !== null && order.upiOverride ? " · " : ""
              }${order.upiOverride ? `handle was ${order.upi || "(none)"}` : ""}`}
            />
          )}
          {order.payFailedReason && (
            <Field label="Last attempt failed" value={order.payFailedReason} />
          )}
          {order.paid && (
            <Field
              label="Paid"
              value={`${shortDate(order.paidAt)}${order.paidByEmail ? ` · ${order.paidByEmail}` : ""}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div className="text-ink-2">{value}</div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.07em] text-ink-3">{label}</div>
      <div className={`tnum display text-[18px] font-semibold ${warn ? "text-clay" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function Empty({ tab }: { tab: "due" | "paid" }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-card px-6 py-14 text-center">
      <p className="display text-[15px] font-semibold text-ink">
        {tab === "due" ? "Nothing waiting" : "Nothing paid yet"}
      </p>
      <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] leading-relaxed text-ink-2">
        {tab === "due"
          ? "Operations has not approved any refunds that are still unpaid. Press Refresh if you are expecting some."
          : "Refunds you mark paid will be listed here."}
      </p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3">
      <div className="h-12 animate-pulse rounded-card bg-sunk" />
      <div className="h-64 animate-pulse rounded-card bg-sunk" />
    </div>
  );
}
