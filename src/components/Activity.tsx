"use client";

import { useCallback, useEffect, useState } from "react";
import { listBatches, listPayments } from "@/lib/data/orders";
import type { Batch, PaymentEvent } from "@/lib/sheet/types";
import { dateTime, money, shortDate } from "@/lib/format";
import { useOrders } from "@/lib/store";

/**
 * Uploads and the payment audit log. Both are server reads, so this page pulls
 * only when opened or asked — it is deliberately not part of the cached set.
 */
export function Activity() {
  const { refresh, refreshing } = useOrders();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [payments, setPayments] = useState<PaymentEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Starts true: the effect below fetches on mount, so "not loading yet" would
  // only ever be a lie for one frame.
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([listBatches(30), listPayments(120)]);
      setBatches(b);
      setPayments(p);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    // fetchAll only sets state after awaiting, which is the supported pattern
    // for fetching on mount; the rule cannot see past the call boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  return (
    <div className="mx-auto max-w-[980px] space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="display text-[19px] font-semibold text-ink">Activity</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">
            Every upload, and every payout anyone has ticked off.
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={reload}
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

      <section>
        <h2 className="display mb-2 text-[14px] font-semibold text-ink">Payments</h2>
        <div className="overflow-hidden rounded-card border border-line bg-card">
          {!payments?.length ? (
            <p className="px-4 py-6 text-[13px] text-ink-3">
              {loading ? "Loading…" : "Nothing marked paid yet."}
            </p>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-4 py-2.5 text-[12.5px] last:border-0"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    p.action === "paid"
                      ? "bg-spruce-wash text-spruce"
                      : "bg-clay-wash text-clay"
                  }`}
                >
                  {p.action}
                </span>
                <span className="tnum w-[88px] shrink-0 font-mono text-ink">{p.orderNumber}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-3">
                  {p.upi}
                </span>
                <span className="tnum font-semibold text-ink">{money(p.amount)}</span>
                <span className="text-ink-3">{p.byEmail}</span>
                <span className="tnum text-ink-3">{dateTime(p.at)}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
