"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseDelimited, readSheetFile } from "@/lib/sheet/parse";
import { transform } from "@/lib/sheet/transform";
import { ALL_STAGES } from "@/lib/sheet/types";
import type { StoredOrder, TransformResult } from "@/lib/sheet/types";
import { saveBatch } from "@/lib/data/orders";
import { archiveSupported, archiveUpload } from "@/lib/archive";
import { useAuth } from "@/lib/auth-context";
import { useOrders } from "@/lib/store";
import { useSettings } from "@/lib/settings-context";
import { money, shortDate } from "@/lib/format";

type Phase = "idle" | "reading" | "review" | "saving" | "done";

export function Uploader() {
  const router = useRouter();
  const { user, role, can } = useAuth();
  const { orders, merge, refresh } = useOrders();
  const { settings } = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  // Seeded from desk settings, then owned by this screen — an admin sets the
  // usual answer, whoever is uploading can still override it for one file.
  const [stages, setStages] = useState<string[]>(() => [...settings.defaultStages]);
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<TransformResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    created: number;
    updated: number;
    duplicate: number;
  } | null>(null);
  const [archive, setArchive] = useState(true);
  const [archived, setArchived] = useState(false);

  const run = useCallback(
    async (source: File | string, nextStages = stages) => {
      setError(null);
      setPhase("reading");
      try {
        const rows =
          typeof source === "string" ? parseDelimited(source) : await readSheetFile(source);
        if (!rows.length) {
          setError("That file had no rows in it.");
          setPhase("idle");
          return;
        }
        const out = transform(rows, { stages: nextStages, exclusions: settings.exclusions });
        if (out.missingColumns.length) {
          setError(
            `This does not look like a Return Prime export — it is missing ${out.missingColumns.join(
              ", ",
            )}. Upload the file exactly as Return Prime exports it, with no columns removed.`,
          );
          setPhase("idle");
          return;
        }
        setResult(out);
        setPhase("review");
      } catch (e) {
        setError((e as Error).message);
        setPhase("idle");
      }
    },
    [stages, settings.exclusions],
  );

  const pick = (f: File | null) => {
    if (!f) return;
    setFile(f);
    setPasted("");
    void run(f);
  };

  const changeStages = (stage: string, on: boolean) => {
    const next = on ? [...stages, stage] : stages.filter((s) => s !== stage);
    setStages(next);
    if (phase === "review") void run(file ?? pasted, next);
  };

  const save = async () => {
    if (!result || !user) return;
    setPhase("saving");
    setError(null);
    try {
      const known = new Map(orders.map((o) => [o.orderKey, o]));
      const { batch, duplicateKeys } = await saveBatch({
        orders: result.orders,
        summary: result.summary,
        stages,
        fileName: file?.name ?? "pasted-text",
        actor: { uid: user.uid, email: user.email, role },
        known,
      });

      // The ledger is in Firestore by this point. Keeping the original file is
      // a convenience on top of that, and it is kept on this device, so a
      // failure here is worth a line on the screen and nothing more.
      let kept = false;
      if (archive && file && archiveSupported()) {
        try {
          await archiveUpload({
            batchId: batch.id,
            fileName: file.name,
            fileType: file.type,
            size: file.size,
            uploadedAt: Date.now(),
            uploadedByEmail: user.email,
            blob: file,
          });
          kept = true;
        } catch {
          kept = false;
        }
      }
      setArchived(kept);

      const now = Date.now();
      // Orders skipped as duplicates were not written, so they must not be
      // touched locally either — merging them would add this batch id to a
      // document that never recorded it and put the cache out of step.
      const skipped = new Set(duplicateKeys);
      merge(
        result.orders
          .filter((o) => !skipped.has(o.orderKey))
          .map((o): StoredOrder => {
          const existing = known.get(o.orderKey);
          // Mirror the server's rule locally: a changed amount or handle pulls
          // an approval back, everything else about the decision is preserved.
          const material =
            existing && (existing.total !== o.total || existing.upi !== o.upi);
          const reopened =
            material && existing!.approval === "approved" && !existing!.paid;
          return {
            ...o,
            approval: reopened ? "pending" : existing?.approval ?? "pending",
            approvalNote: reopened ? "Re-opened: the export changed." : existing?.approvalNote ?? null,
            approvalBy: existing?.approvalBy ?? null,
            approvalAt: existing?.approvalAt ?? null,
            upiOverride: existing?.upiOverride ?? null,
            amountOverride: existing?.amountOverride ?? null,
            correctedBy: existing?.correctedBy ?? null,
            correctedAt: existing?.correctedAt ?? null,
            paid: existing?.paid ?? false,
            paidAt: existing?.paidAt ?? null,
            paidByEmail: existing?.paidByEmail ?? null,
            payFailedReason: existing?.payFailedReason ?? null,
            batchIds: [...(existing?.batchIds ?? []), batch.id],
            firstSeenAt: existing?.firstSeenAt ?? now,
            updatedAt: now,
            reopenedAt: reopened ? now : existing?.reopenedAt ?? null,
          };
        }),
      );

      setSaved({
        created: batch.ordersNew,
        updated: batch.ordersUpdated,
        duplicate: batch.ordersDuplicate,
      });
      setPhase("done");
      void refresh();
    } catch (e) {
      setError(friendly(e));
      setPhase("review");
    }
  };

  if (!can.upload) {
    return (
      <p className="rounded-card border border-line bg-card px-5 py-10 text-center text-[13px] text-ink-2">
        Uploading exports is the operations step.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4 pb-10">
      <header>
        <h1 className="display text-[19px] font-semibold text-ink">Upload a Return Prime export</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Drop the file in exactly as Return Prime exports it. It is read here in your browser,
          filtered down to the manual UPI payouts, and only those go to Firestore. Orders already
          in the ledger are refreshed rather than duplicated, and an approval or a paid tick is
          never overwritten by a file — except when the export moves an amount or a handle, which
          pulls that approval back for a second look.
        </p>
      </header>

      <div className="rounded-card border border-line bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[12px] uppercase tracking-[0.06em] text-ink-3">
            Return stages to keep
          </span>
          <span
            className="ml-auto text-[11.5px] text-ink-3"
            title={settings.exclusions
              .filter((e) => e.enabled)
              .map((e) => `"${e.phrase}" → ${e.reason}`)
              .join("\n")}
          >
            {settings.exclusions.filter((e) => e.enabled).length} exclusion rule
            {settings.exclusions.filter((e) => e.enabled).length === 1 ? "" : "s"} in force
          </span>
          {ALL_STAGES.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] capitalize transition ${
                stages.includes(s)
                  ? "border-spruce/30 bg-spruce-wash text-spruce"
                  : "border-line bg-card text-ink-3"
              }`}
            >
              <input
                type="checkbox"
                checked={stages.includes(s)}
                onChange={(e) => changeStages(s, e.target.checked)}
                className="h-3.5 w-3.5 accent-[#2f6b4f]"
              />
              {s}
            </label>
          ))}
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer rounded-lg border border-dashed border-line bg-paper px-6 py-9 text-center transition hover:border-spruce"
        >
          <p className="text-[13.5px] font-medium text-ink">
            {file ? file.name : "Drop the export here, or choose a file"}
          </p>
          <p className="mt-1 text-[12px] text-ink-3">CSV, TSV, XLSX or XLS</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] text-ink-3 hover:text-ink">
            Or paste the sheet as text
          </summary>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder="Paste the rows, including the header line"
            className="mt-2 w-full rounded-lg border border-line bg-paper p-3 font-mono text-[12px] focus:border-spruce focus:outline-none"
          />
          <button
            onClick={() => {
              setFile(null);
              void run(pasted);
            }}
            disabled={!pasted.trim()}
            className="mt-2 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:border-spruce hover:text-spruce disabled:opacity-40"
          >
            Transform pasted text
          </button>
        </details>

        <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={archive && !!file}
            disabled={!file}
            onChange={(e) => setArchive(e.target.checked)}
            className="h-3.5 w-3.5 accent-[#2f6b4f] disabled:opacity-40"
          />
          Keep a copy of the original file on this device
        </label>
        <p className="mt-1 pl-[22px] text-[11.5px] leading-relaxed text-ink-3">
          {file
            ? "Kept in this browser, on this machine, and nowhere else — it is there to open when a figure looks wrong. The ledger in Firestore is the record; this copy is not, and clearing site data discards it."
            : "Pasted text has no file to keep."}
        </p>
      </div>

      {error && (
        <p className="rounded-card border border-clay/30 bg-clay-wash px-4 py-3 text-[13px] leading-relaxed text-clay">
          {error}
        </p>
      )}

      {phase === "reading" && <p className="text-[13px] text-ink-3">Reading the sheet…</p>}

      {result && (phase === "review" || phase === "saving" || phase === "done") && (
        <Review
          result={result}
          phase={phase}
          saved={saved}
          archived={archived}
          onSave={save}
          onOpenLedger={() => router.push("/ledger")}
        />
      )}
    </div>
  );
}

function Review({
  result,
  phase,
  saved,
  archived,
  onSave,
  onOpenLedger,
}: {
  result: TransformResult;
  phase: Phase;
  saved: { created: number; updated: number; duplicate: number } | null;
  archived: boolean;
  onSave: () => void;
  onOpenLedger: () => void;
}) {
  const s = result.summary;
  const preview = result.orders.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
        <Stat label="Rows read" value={String(s.rowsIn)} />
        <Stat label="Lines kept" value={String(s.linesKept)} />
        <Stat label="Orders" value={String(s.orders)} />
        <Stat label="To pay" value={money(s.totalPayable)} />
      </div>

      <p className="text-[13px] leading-relaxed text-ink-2">
        {s.ordersPayable} order{s.ordersPayable === 1 ? "" : "s"} need a payout.{" "}
        {s.ordersWithUpi} carr{s.ordersWithUpi === 1 ? "ies" : "y"} a usable UPI handle
        {s.ordersMissingUpi > 0 && (
          <>
            , and{" "}
            <span className="font-semibold text-clay">
              {s.ordersMissingUpi} still need one chased down
            </span>
          </>
        )}
        . Approvals run {shortDate(s.rangeFrom)} to {shortDate(s.rangeTo)}.
        {(s.ordersExcluded ?? 0) > 0 && (
          <>
            {" "}
            <span className="text-ink-3">
              {s.ordersExcluded} order{s.ordersExcluded === 1 ? " was" : "s were"} left out
              entirely — every line on {s.ordersExcluded === 1 ? "it" : "them"} was an alteration,
              an exchange, a store credit or an amount settled elsewhere.
            </span>
          </>
        )}
      </p>

      <div className="overflow-hidden rounded-card border border-line bg-card">
        <div className="border-b border-line-soft bg-sunk/60 px-3 py-2 text-[11px] uppercase tracking-[0.06em] text-ink-3">
          First {preview.length} of {result.orders.length}
        </div>
        {preview.map((o) => (
          <div
            key={o.orderKey}
            className="flex items-center gap-3 border-b border-line-soft px-3 py-2 text-[12.5px] last:border-0"
          >
            <span className="tnum w-[88px] shrink-0 font-mono text-ink">{o.orderNumber}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{o.customerName}</span>
            <span className="hidden min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2 sm:block">
              {o.upi || <span className="text-clay">missing</span>}
            </span>
            <span className="tnum w-14 shrink-0 text-right text-ink-3">{o.pieces} pcs</span>
            <span className="tnum w-24 shrink-0 text-right font-semibold text-ink">
              {money(o.total)}
            </span>
          </div>
        ))}
      </div>

      {phase === "done" && saved ? (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-spruce/25 bg-spruce-wash px-4 py-3">
          <p className="text-[13px] text-spruce">
            Saved. <span className="font-semibold">{saved.created}</span> new order
            {saved.created === 1 ? "" : "s"}, <span className="font-semibold">{saved.updated}</span>{" "}
            refreshed
            {saved.duplicate > 0 && (
              <>
                , and <span className="font-semibold">{saved.duplicate}</span> already in the
                ledger unchanged, so {saved.duplicate === 1 ? "it was" : "they were"} left alone
              </>
            )}
            . Paid ticks were left untouched.
            {archived && " The file is kept on this device, under Admin → Data."}
          </p>
          <button
            onClick={onOpenLedger}
            className="ml-auto rounded-lg bg-spruce px-4 py-2 text-[13px] font-semibold text-white hover:bg-spruce-deep"
          >
            Verify them →
          </button>
        </div>
      ) : (
        <button
          onClick={onSave}
          disabled={phase === "saving"}
          className="w-full rounded-lg bg-spruce py-3 text-[14px] font-semibold text-white transition hover:bg-spruce-deep disabled:opacity-60"
        >
          {phase === "saving"
            ? "Saving to Firestore…"
            : `Save ${result.orders.length} orders to the ledger`}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.07em] text-ink-3">{label}</div>
      <div className="tnum display mt-1 text-[18px] font-semibold text-ink">{value}</div>
    </div>
  );
}

function friendly(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code === "permission-denied") {
    return "Firestore refused the write. Deploy the security rules, and check you are signed in with a CarbonTree account.";
  }
  return (e as Error).message || "The upload failed.";
}
