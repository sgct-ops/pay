"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listBatches, listEvents } from "@/lib/data/orders";
import type { AuditEvent, Batch, EventKind } from "@/lib/sheet/types";
import { dateTime, money, shortDate } from "@/lib/format";
import { useOrders } from "@/lib/store";
import { ROLE_LABELS, type Role } from "@/lib/roles";

const KIND_LABELS: Record<EventKind, string> = {
  upload: "uploaded",
  approve: "approved",
  hold: "held",
  reject: "rejected",
  reopen: "re-opened",
  correct: "corrected",
  pay: "paid",
  unpay: "un-paid",
  payfail: "transfer failed",
  role: "role change",
};

const KIND_TONES: Record<EventKind, string> = {
  upload: "bg-slate-wash text-slate",
  approve: "bg-spruce-wash text-spruce",
  hold: "bg-gold-wash text-gold",
  reject: "bg-clay-wash text-clay",
  reopen: "bg-gold-wash text-gold",
  correct: "bg-gold-wash text-gold",
  pay: "bg-spruce-wash text-spruce",
  unpay: "bg-clay-wash text-clay",
  payfail: "bg-clay-wash text-clay",
  role: "bg-slate-wash text-slate",
};

/**
 * The trail. Every approval, correction and payment, with who did it — which
 * is the thing you actually want three months later when a customer queries a
 * refund. Server reads, so it pulls only when opened or asked.
 */
export function Activity() {
  const { refresh, refreshing } = useOrders();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"all" | "money" | "decisions">("all");

  const fetchAll = useCallback(async () => {
    try {
      const [e, b] = await Promise.all([listEvents(200), listBatches(20)]);
      setEvents(e);
      setBatches(b);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  const shown = useMemo(() => {
    if (!events) return [];
    if (kind === "money") return events.filter((e) => ["pay", "unpay", "payfail"].includes(e.kind));
    if (kind === "decisions")
      return events.filter((e) => ["approve", "hold", "reject", "correct", "reopen"].includes(e.kind));
    return events;
  }, [events, kind]);

  return (
    <div className="mx-auto max-w-[980px] space-y-5 pb-10">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="display text-[19px] font-semibold text-ink">Activity</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">
            Every decision and every payment, and who made it.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => {
              setLoading(true);
              void fetchAll();
            }}
            disabled={loading}
            className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:border-spruce hover:text-spruce disabled:opacity-50"
          >
            {loading ? "Loading…" : "Reload"}
          </button>
          <button
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:border-spruce hover:text-spruce disabled:opacity-50"
            title="Throws away the local copy and re-reads every order from Firestore"
          >
            Full resync
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-card border border-clay/30 bg-clay-wash px-4 py-3 text-[13px] text-clay">
          {error}
        </p>
      )}

      <div className="flex rounded-lg border border-line bg-card p-0.5">
        {(
          [
            ["all", "Everything"],
            ["decisions", "Approvals & fixes"],
            ["money", "Payments"],
          ] as Array<[typeof kind, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setKind(value)}
            className={`rounded-[6px] px-3 py-1.5 text-[12.5px] font-medium transition ${
              kind === value ? "bg-spruce text-white" : "text-ink-2 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card">
        {!shown.length ? (
          <p className="px-4 py-6 text-[13px] text-ink-3">
            {loading ? "Loading…" : "Nothing recorded yet."}
          </p>
        ) : (
          shown.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-4 py-2.5 text-[12.5px] last:border-0"
            >
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  KIND_TONES[e.kind]
                }`}
              >
                {KIND_LABELS[e.kind]}
              </span>
              {e.orderNumber && (
                <span className="tnum w-[80px] shrink-0 font-mono text-ink">{e.orderNumber}</span>
              )}
              <span className="min-w-[120px] flex-1 truncate text-ink-2">
                {e.note ?? e.upi ?? ""}
                {e.from && e.to && (
                  <span className="text-ink-3">
                    {e.note ? " · " : ""}
                    {e.from} → {e.to}
                  </span>
                )}
              </span>
              {e.amount !== null && (
                <span className="tnum shrink-0 font-semibold text-ink">{money(e.amount)}</span>
              )}
              <span className="shrink-0 text-[11.5px] text-ink-3">
                {e.byEmail}
                {e.byRole && e.byRole !== "none" && (
                  <span className="text-ink-3"> · {ROLE_LABELS[e.byRole as Role] ?? e.byRole}</span>
                )}
              </span>
              <span className="tnum shrink-0 text-[11.5px] text-ink-3">{dateTime(e.at)}</span>
            </div>
          ))
        )}
      </div>

      <section>
        <h2 className="display mb-2 text-[14px] font-semibold text-ink">Uploads</h2>
        <div className="overflow-hidden rounded-card border border-line bg-card">
          {!batches?.length ? (
            <p className="px-4 py-6 text-[13px] text-ink-3">
              {loading ? "Loading…" : "No uploads yet."}
            </p>
          ) : (
            batches.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 text-[12.5px] last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{b.fileName}</span>
                <span className="tnum text-ink-2">
                  {b.summary.orders} orders · {money(b.summary.totalPayable)}
                </span>
                <span className="tnum text-ink-3">
                  {b.ordersNew} new · {b.ordersUpdated} refreshed
                </span>
                <span className="text-ink-3">{b.uploadedByEmail}</span>
                <span className="tnum text-ink-3">{shortDate(b.uploadedAt)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
