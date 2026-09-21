"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useOrders, orderToQueueItem, usePayQueue } from "@/lib/store";
import { groupByWeek } from "@/lib/sheet/transform";
import type { StoredOrder } from "@/lib/sheet/types";
import { money, shortDate } from "@/lib/format";

type Filter = "open" | "paid" | "all";

export function Ledger() {
  const { orders, ready, error } = useOrders();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [onlyUpi, setOnlyUpi] = useState(false);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === "open" && o.paid) return false;
      if (filter === "paid" && !o.paid) return false;
      if (onlyUpi && !o.upi) return false;
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerPhone.includes(q) ||
        o.upi.includes(q)
      );
    });
  }, [orders, search, filter, onlyUpi]);

  const weeks = useMemo(() => groupByWeek(visible), [visible]);
  const picked = useMemo(
    () => visible.filter((o) => selected[o.orderKey]),
    [visible, selected],
  );

  const totals = useMemo(() => {
    const open = orders.filter((o) => !o.paid && o.total > 0);
    return {
      openOrders: open.length,
      openPieces: open.reduce((s, o) => s + o.pieces, 0),
      openValue: open.reduce((s, o) => s + o.total, 0),
      missingUpi: open.filter((o) => !o.upi).length,
      paid: orders.filter((o) => o.paid).length,
    };
  }, [orders]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });

  if (!ready) return <Skeleton />;

  return (
    <div className="space-y-4">
      <Summary totals={totals} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">
            ⌕
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Order, name, phone or UPI"
            className="w-full rounded-lg border border-line bg-card py-2 pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-3 focus:border-spruce focus:outline-none"
          />
        </div>

        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "open", label: "To pay" },
            { value: "paid", label: "Paid" },
            { value: "all", label: "All" },
          ]}
        />

        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={onlyUpi}
            onChange={(e) => setOnlyUpi(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#5a5f7a]"
          />
          Has UPI
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-gold/30 bg-gold-wash px-3 py-2 text-[12.5px] text-gold">
          {error}
        </p>
      )}

      {!visible.length ? (
        <Empty hasAny={orders.length > 0} />
      ) : (
        <div className="space-y-5 pb-20">
          {weeks.map((week) => (
            <section key={String(week.weekStart)}>
              <WeekHeader
                label={week.label}
                orders={week.orders}
                allSelected={week.orders.every((o) => selected[o.orderKey] || !o.upi || !o.total)}
                onSelectAll={(on) =>
                  setSelected((prev) => {
                    const next = { ...prev };
                    for (const o of week.orders) {
                      if (!o.upi || o.total <= 0 || o.paid) continue;
                      if (on) next[o.orderKey] = true;
                      else delete next[o.orderKey];
                    }
                    return next;
                  })
                }
              />
              <div className="overflow-hidden rounded-card border border-line bg-card">
                {week.orders.map((order, i) => (
                  <Row
                    key={order.orderKey}
                    order={order}
                    first={i === 0}
                    selected={Boolean(selected[order.orderKey])}
                    expanded={open === order.orderKey}
                    onToggleSelect={() => toggle(order.orderKey)}
                    onToggleExpand={() =>
                      setOpen((cur) => (cur === order.orderKey ? null : order.orderKey))
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {picked.length > 0 && (
        <BatchBar picked={picked} onClear={() => setSelected({})} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- summary ---- */

function Summary({
  totals,
}: {
  totals: {
    openOrders: number;
    openPieces: number;
    openValue: number;
    missingUpi: number;
    paid: number;
  };
}) {
  const cells = [
    { label: "Orders to pay", value: String(totals.openOrders) },
    { label: "Pieces", value: String(totals.openPieces) },
    { label: "Outstanding", value: money(totals.openValue), wide: true },
    { label: "No UPI yet", value: String(totals.missingUpi), warn: totals.missingUpi > 0 },
    { label: "Paid", value: String(totals.paid) },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="bg-card px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.07em] text-ink-3">{c.label}</div>
          <div
            className={`tnum display mt-1 text-[19px] font-semibold ${
              c.warn ? "text-clay" : "text-ink"
            }`}
          >
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- week ---- */

function WeekHeader({
  label,
  orders,
  allSelected,
  onSelectAll,
}: {
  label: string;
  orders: StoredOrder[];
  allSelected: boolean;
  onSelectAll: (on: boolean) => void;
}) {
  const payable = orders.filter((o) => o.upi && o.total > 0 && !o.paid);
  const value = payable.reduce((s, o) => s + o.total, 0);

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={payable.length > 0 && allSelected}
          disabled={!payable.length}
          onChange={(e) => onSelectAll(e.target.checked)}
          className="h-4 w-4 rounded-[3px] accent-[#5a5f7a] disabled:opacity-30"
        />
        <span className="display text-[14px] font-semibold text-ink">{label}</span>
      </label>
      <span className="tnum text-[12px] text-ink-3">
        {orders.length} order{orders.length === 1 ? "" : "s"}
        {payable.length > 0 && <> · {money(value)} to pay</>}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------- row ---- */

function Row({
  order,
  first,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: {
  order: StoredOrder;
  first: boolean;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}) {
  const router = useRouter();
  const { push } = usePayQueue();
  const { setPaid } = useOrders();
  const payable = Boolean(order.upi) && order.total > 0;

  const sendToDesk = () => {
    push([orderToQueueItem(order)], { replace: true });
    router.push("/pay");
  };

  return (
    <div className={first ? "" : "border-t border-line-soft"}>
      <div
        onClick={onToggleExpand}
        className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition hover:bg-sunk/60 ${
          order.paid ? "opacity-60" : ""
        }`}
      >
        {/* Controls. The click-swallowing wrapper is what keeps ticking a
            checkbox from also unfolding the row. */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex shrink-0 items-center gap-2"
        >
          <input
            type="checkbox"
            aria-label={`Select order ${order.orderNumber} for a batch payout`}
            checked={selected}
            disabled={!payable || order.paid}
            onChange={onToggleSelect}
            className="h-4 w-4 rounded-[3px] accent-[#5a5f7a] disabled:opacity-25"
          />
          <span className="h-5 w-px bg-line-soft" aria-hidden />
          <button
            onClick={sendToDesk}
            disabled={!payable}
            className="rounded-md border border-spruce/25 bg-spruce-wash px-2.5 py-1 text-[12px] font-semibold text-spruce transition hover:bg-spruce hover:text-white disabled:border-line disabled:bg-sunk disabled:text-ink-3"
          >
            Pay
          </button>
          <button
            onClick={() => void setPaid(order, !order.paid)}
            aria-label={order.paid ? "Mark unpaid" : "Mark paid"}
            title={
              order.paid
                ? `Paid${order.paidByEmail ? ` by ${order.paidByEmail}` : ""} — click to undo`
                : "Mark paid"
            }
            className={`grid h-6 w-6 place-items-center rounded-full text-[11px] leading-none transition ${
              order.paid
                ? "bg-spruce text-white"
                : "border border-dashed border-ink-3/50 text-transparent hover:border-spruce"
            }`}
          >
            ✓
          </button>
        </div>

        <div className="tnum w-[92px] shrink-0 font-mono text-[12.5px] text-ink">
          {order.orderNumber}
        </div>

        <div className="min-w-[120px] flex-1 truncate text-[13px] text-ink">
          {order.customerName || <span className="text-ink-3">No name</span>}
          {order.pieces > 1 && (
            <span className="ml-2 rounded bg-sunk px-1.5 py-0.5 text-[11px] text-ink-2">
              {order.pieces} pcs
            </span>
          )}
        </div>

        <div className="hidden min-w-[150px] flex-1 truncate font-mono text-[12px] text-ink-2 sm:block">
          {order.upi || <span className="text-clay">UPI missing</span>}
          {order.upiClash && (
            <span className="ml-2 rounded bg-gold-wash px-1.5 py-0.5 text-[11px] text-gold">
              {order.upis.length} handles
            </span>
          )}
        </div>

        <ShipChip order={order} />

        <div className="tnum ml-auto w-[104px] shrink-0 text-right text-[13.5px] font-semibold text-ink">
          {money(order.total)}
          {order.skipped > 0 && (
            <div className="text-[10.5px] font-normal text-ink-3">
              +{order.skipped} not payable
            </div>
          )}
        </div>

        <span className="w-3 shrink-0 text-[10px] text-ink-3" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </div>

      {expanded && <Detail order={order} />}
    </div>
  );
}

function ShipChip({ order }: { order: StoredOrder }) {
  if (!order.ships.length) return null;
  const worst = order.ships[0];
  const alarming = order.shipRank >= 4;
  return (
    <span
      className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[11px] md:inline ${
        alarming ? "bg-clay-wash text-clay" : "bg-sunk text-ink-2"
      }`}
      title={order.ships.join(" · ")}
    >
      {worst}
    </span>
  );
}

/* -------------------------------------------------------------- detail ---- */

function Detail({ order }: { order: StoredOrder }) {
  return (
    <div className="border-t border-line-soft bg-sunk/50 px-3 py-3">
      <div className="mb-3 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
        <Field label="Phone" value={order.customerPhone || "—"} mono />
        <Field label="Email" value={order.customerEmail || "—"} />
        <Field label="Approved" value={shortDate(order.approvedAt)} />
        <Field label="Received" value={shortDate(order.receivedAt)} />
        <Field label="Return fees" value={money(order.fees)} />
        <Field
          label="Paid"
          value={
            order.paid
              ? `${shortDate(order.paidAt)}${order.paidByEmail ? ` · ${order.paidByEmail}` : ""}`
              : "Not yet"
          }
        />
      </div>

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
          This order carries more than one UPI handle: {order.upis.join(", ")}. The first is used
          — check the notes before paying.
        </p>
      )}
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

/* ----------------------------------------------------------- batch bar ---- */

function BatchBar({ picked, onClear }: { picked: StoredOrder[]; onClear: () => void }) {
  const router = useRouter();
  const { push } = usePayQueue();
  const pieces = picked.reduce((s, o) => s + o.pieces, 0);
  const value = picked.reduce((s, o) => s + o.total, 0);

  return (
    <div className="fixed inset-x-0 bottom-[60px] z-30 px-3 lg:bottom-4">
      <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-3 rounded-card border border-spruce/25 bg-card px-4 py-3 shadow-[0_8px_24px_rgba(29,31,35,0.10)]">
        <div className="tnum text-[13px] text-ink">
          <span className="font-semibold">{picked.length}</span> order
          {picked.length === 1 ? "" : "s"} · {pieces} pcs ·{" "}
          <span className="font-semibold">{money(value)}</span>
        </div>
        <button onClick={onClear} className="text-[12.5px] text-ink-3 hover:text-ink">
          Clear
        </button>
        <button
          onClick={() => {
            push(picked.map(orderToQueueItem), { replace: true });
            router.push("/pay");
          }}
          className="ml-auto rounded-lg bg-spruce px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-spruce-deep"
        >
          Pay these {picked.length} →
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- bits ----- */

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex rounded-lg border border-line bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition ${
            value === o.value ? "bg-spruce text-white" : "text-ink-2 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="rounded-card border border-dashed border-line bg-card px-6 py-14 text-center">
      <p className="display text-[15px] font-semibold text-ink">
        {hasAny ? "Nothing matches those filters" : "No orders yet"}
      </p>
      <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-ink-2">
        {hasAny
          ? "Widen the search, or switch to All to see paid orders too."
          : "Upload a Return Prime export and the orders needing a manual UPI refund will land here, grouped by the week they were approved."}
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
