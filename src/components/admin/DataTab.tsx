"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { listBatches, listEvents } from "@/lib/data/orders";
import type { AuditEvent, Batch, EventKind } from "@/lib/sheet/types";
import { useOrders } from "@/lib/store";
import { downloadCsv, eventsToCsv, ordersToCsv, stampedName } from "@/lib/csv";
import {
  ARCHIVE_MAX_AGE_DAYS,
  archiveSupported,
  clearArchive,
  daysLeft,
  getArchived,
  listArchived,
  saveArchivedFile,
  type ArchiveEntry,
} from "@/lib/archive";
import { dateTime, money, relativeTime, shortDate } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { firebaseConfig, ALLOWED_DOMAIN } from "@/lib/firebase";
import { FIXED_ADMIN } from "@/lib/roles";
import type { AppSettings } from "@/lib/settings";
import { NumberField, Note, Row, Section, SecondaryButton } from "@/components/admin/controls";

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
  settings: "settings",
};

/**
 * The ledger as data, and the trail behind it.
 *
 * Everything here reads from the server on demand rather than on mount, except
 * the orders, which are already in memory from the local cache. Exports are
 * built in the browser out of what is already loaded — no extra reads, and
 * they work with no signal.
 */
export function DataTab({
  draft,
  patch,
}: {
  draft: AppSettings;
  patch: (change: Partial<AppSettings>) => void;
}) {
  const { orders, refresh, refreshing, lastSyncedAt } = useOrders();
  const now = useNow();

  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  // The archive is this browser's, not the project's, so it loads from
  // IndexedDB rather than from Firestore and costs nothing to read.
  const [archived, setArchived] = useState<ArchiveEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);

  const load = useCallback(
    async (limit: number) => {
      setLoading(true);
      try {
        const [e, b] = await Promise.all([listEvents(limit), listBatches(50)]);
        setEvents(e);
        setBatches(b);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadArchive = useCallback(async () => {
    if (!archiveSupported()) return;
    try {
      setArchived(await listArchived());
    } catch {
      // A browser that refuses IndexedDB is not an error worth a banner. The
      // archive simply is not there, and the Uploads list says as much.
      setArchived([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(draft.auditPageSize);
    void loadArchive();
    // Deliberately once on mount: re-pulling the trail on every keystroke in
    // the page-size field would bill a read per character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kept = useMemo(
    () => new Map(archived.map((a) => [a.batchId, a])),
    [archived],
  );

  const download = async (batchId: string) => {
    try {
      const record = await getArchived(batchId);
      if (record) saveArchivedFile(record);
      else await loadArchive();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const forgetArchive = async () => {
    try {
      await clearArchive();
      setArchived([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const counts = useMemo(() => {
    const paid = orders.filter((o) => o.paid);
    return {
      total: orders.length,
      pending: orders.filter((o) => o.approval === "pending").length,
      hold: orders.filter((o) => o.approval === "hold").length,
      approvedUnpaid: orders.filter((o) => o.approval === "approved" && !o.paid).length,
      rejected: orders.filter((o) => o.approval === "rejected").length,
      paid: paid.length,
      paidValue: paid.reduce((s, o) => s + (o.amountOverride ?? o.total), 0),
    };
  }, [orders]);

  const fullResync = async () => {
    setResyncing(true);
    try {
      await refresh(true);
    } finally {
      setResyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="The ledger"
        blurb={`Held locally on this device and refreshed on demand. Last synced ${relativeTime(lastSyncedAt, now)}.`}
        aside={
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              onClick={() => downloadCsv(stampedName("payout-ledger"), ordersToCsv(orders))}
              disabled={!orders.length}
              title="Every order with both the imported and the paid figures"
            >
              Export ledger CSV
            </SecondaryButton>
            <SecondaryButton
              onClick={() => void fullResync()}
              disabled={resyncing || refreshing}
              title="Throw away the local copy and re-read every order from Firestore"
            >
              {resyncing ? "Resyncing…" : "Full resync"}
            </SecondaryButton>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          <Cell label="Orders" value={String(counts.total)} />
          <Cell label="To verify" value={String(counts.pending)} />
          <Cell label="On hold" value={String(counts.hold)} warn={counts.hold > 0} />
          <Cell label="Approved, unpaid" value={String(counts.approvedUnpaid)} />
          <Cell label="Paid" value={String(counts.paid)} />
          <Cell label="Paid value" value={money(counts.paidValue)} />
        </div>
        <Note>
          A full resync re-reads the whole collection and is billed accordingly. The ordinary
          Refresh only asks for what changed since the last sync, which is usually nothing.
        </Note>
      </Section>

      <Section
        title="Sync"
        blurb="The app opens from its local copy and bills nothing for it. Only Refresh talks to Firestore."
      >
        <Row>
          <NumberField
            label="Warn when unsynced for"
            hint="After this, the Refresh button turns amber and asks to be pressed."
            value={draft.syncStaleHours}
            onChange={(syncStaleHours) => patch({ syncStaleHours })}
            min={1}
            max={336}
            suffix="hours"
          />
          <NumberField
            label="Audit entries to load"
            hint="How many trail entries the Activity screen and the panel below pull at a time."
            value={draft.auditPageSize}
            onChange={(auditPageSize) => patch({ auditPageSize })}
            min={25}
            max={1000}
            suffix="entries"
          />
        </Row>
      </Section>

      <Section
        title="Audit trail"
        blurb="Append-only. Every decision, correction, payment, role change and settings change, with who made it."
        aside={
          <div className="flex flex-wrap gap-2">
            <SecondaryButton
              onClick={() => downloadCsv(stampedName("payout-audit"), eventsToCsv(events ?? []))}
              disabled={!events?.length}
            >
              Export CSV
            </SecondaryButton>
            <SecondaryButton onClick={() => void load(draft.auditPageSize)} disabled={loading}>
              {loading ? "Loading…" : "Reload"}
            </SecondaryButton>
          </div>
        }
      >
        {error && <Note tone="bad">{error}</Note>}
        <div className="max-h-[340px] overflow-y-auto rounded-lg border border-line">
          {!events?.length ? (
            <p className="px-3 py-5 text-[12.5px] text-ink-3">
              {loading ? "Loading…" : "Nothing recorded yet."}
            </p>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-3 py-2 text-[12px] last:border-0"
              >
                <span className="w-[92px] shrink-0 font-medium text-ink-2">
                  {KIND_LABELS[e.kind] ?? e.kind}
                </span>
                {e.orderNumber && (
                  <span className="tnum w-[72px] shrink-0 font-mono text-ink">{e.orderNumber}</span>
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
                <span className="shrink-0 text-[11px] text-ink-3">{e.byEmail}</span>
                <span className="tnum shrink-0 text-[11px] text-ink-3">{dateTime(e.at)}</span>
              </div>
            ))
          )}
        </div>
      </Section>

      <Section
        title="Uploads"
        blurb="One entry per export, with what the file contained. The transformed ledger is in Firestore and permanent; the original file, where one was kept, is on the machine it was uploaded from."
      >
        <div className="max-h-[260px] overflow-y-auto rounded-lg border border-line">
          {!batches?.length ? (
            <p className="px-3 py-5 text-[12.5px] text-ink-3">
              {loading ? "Loading…" : "No uploads yet."}
            </p>
          ) : (
            batches.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-3 py-2 text-[12px] last:border-0"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{b.fileName}</span>
                <span className="tnum text-ink-2">
                  {b.summary.orders} orders · {money(b.summary.totalPayable)}
                </span>
                <span className="tnum text-ink-3">
                  {b.ordersNew} new · {b.ordersUpdated} refreshed
                  {(b.ordersDuplicate ?? 0) > 0 && ` · ${b.ordersDuplicate} already had`}
                  {(b.summary.ordersExcluded ?? 0) > 0 &&
                    ` · ${b.summary.ordersExcluded} not a refund`}
                </span>
                <span className="hidden text-ink-3 sm:inline">{b.stages.join("+")}</span>
                <span className="text-ink-3">{b.uploadedByEmail}</span>
                <span className="tnum text-ink-3">{shortDate(b.uploadedAt)}</span>
                {kept.has(b.id) ? (
                  <button
                    onClick={() => void download(b.id)}
                    className="shrink-0 text-[11px] font-medium text-spruce underline-offset-2 hover:underline"
                    title={`The original file, on this device. Deletes itself in ${daysLeft(
                      kept.get(b.id)!,
                      now,
                    )} day${daysLeft(kept.get(b.id)!, now) === 1 ? "" : "s"}.`}
                  >
                    download file
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-ink-3">not on this device</span>
                )}
              </div>
            ))
          )}
        </div>
        <Note>
          A kept file lives in this browser only — not in Firestore, not in Firebase Storage, and
          not on anyone else&rsquo;s machine. It deletes itself {ARCHIVE_MAX_AGE_DAYS} days after
          the upload, because a raw export is customer PII and stops earning its keep long before
          the ledger does. Clearing site data takes it early.
          {archived.length > 0 && (
            <>
              {" "}
              <button
                onClick={() => void forgetArchive()}
                className="font-medium text-clay underline-offset-2 hover:underline"
              >
                Delete all {archived.length} now
              </button>
            </>
          )}
        </Note>
      </Section>

      <Section
        title="This deployment"
        blurb="Read-only. These come from environment variables and the security rules, not from this screen — changing them means changing the Vercel configuration and redeploying."
      >
        <div className="overflow-hidden rounded-lg border border-line text-[12.5px]">
          <Env label="Firebase project" value={firebaseConfig.projectId} />
          <Env label="Sign-in domain" value={`@${ALLOWED_DOMAIN}`} />
          <Env label="Owner, pinned in code and rules" value={FIXED_ADMIN} />
        </div>
        <Note>
          Changing the company domain means changing it in two places:{" "}
          <code className="font-mono text-[11.5px]">NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN</code> and{" "}
          <code className="font-mono text-[11.5px]">firestore.rules</code>.
        </Note>
      </Section>
    </div>
  );
}

function Cell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-3">{label}</div>
      <div
        className={`tnum display mt-0.5 text-[16px] font-semibold ${warn ? "text-gold" : "text-ink"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Env({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 border-b border-line-soft px-3 py-2 last:border-0">
      <span className="min-w-[180px] text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-ink">{value}</span>
    </div>
  );
}
