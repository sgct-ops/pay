"use client";

import { useMemo, useRef, useState } from "react";
import { useOrders, usePayQueue, type QueueItem } from "@/lib/store";
import { QrCode } from "@/components/QrCode";
import { InstallHint } from "@/components/InstallHint";
import { isUpiHandle, noteFor, noteProblem, upiLink, NOTE_TAG } from "@/lib/upi";
import { money } from "@/lib/format";

export function PayDesk() {
  const { queue, index, current, setIndex, step, push, update, remove, clear } = usePayQueue();
  const { byKey, setPaid } = useOrders();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keyed by position, so stepping the carousel clears the "Copied" label
  // without an effect chasing the index.
  const [copiedAt, setCopiedAt] = useState(-1);

  const order = current ? byKey.get(current.orderKey) ?? null : null;
  const paid = Boolean(order?.paid);

  const problem = current ? noteProblem(current.note) : null;
  const vpaOk = current ? isUpiHandle(current.vpa) : false;
  const link = current && vpaOk && !problem ? upiLink(current) : "";

  const unpaidLeft = useMemo(
    () => queue.filter((q) => !byKey.get(q.orderKey)?.paid).length,
    [queue, byKey],
  );

  const markPaidAndAdvance = async () => {
    if (order) await setPaid(order, true);
    const nextUnpaid = queue.findIndex(
      (q, i) => i > index && !byKey.get(q.orderKey)?.paid,
    );
    if (nextUnpaid >= 0) setIndex(nextUnpaid);
    else step(1);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="order-2 space-y-4 xl:order-1">
        <AddPayee onAdd={(item) => push([item])} />
        <Queue
          queue={queue}
          index={index}
          onPick={setIndex}
          onRemove={remove}
          onClear={clear}
          isPaid={(key) => Boolean(byKey.get(key)?.paid)}
        />
        <InstallHint compact />
      </aside>

      <section className="order-1 rounded-card border border-line bg-card xl:order-2">
        {!current ? (
          <EmptyDesk />
        ) : (
          <div className="grid lg:grid-cols-[286px_minmax(0,1fr)]">
            {/* Stub: the QR and nothing else, so it stays scannable. On a
                phone it drops below the payment details — you cannot scan the
                screen you are holding, so the QR is for someone else's device
                and the UPI link is what you actually press. */}
            <div className="perf order-2 flex flex-col items-center justify-center gap-3 px-5 py-6 lg:order-1">
              <QrCode value={link} disabled={!link} canvasRef={canvasRef} size={224} />
              <p className="text-center text-[11.5px] leading-relaxed text-ink-3">
                Scan with any UPI app.
                <br />
                Paying from this device? Use{" "}
                <span className="font-medium text-ink-2">Open in UPI app</span> — a phone can’t
                scan its own screen.
              </p>
            </div>

            {/* Counterfoil: everything about the payment, beside the QR rather
                than under it, so a full payout fits one screen. */}
            <div className="order-1 flex w-full max-w-[620px] flex-col gap-4 px-5 py-6 lg:order-2">
              <div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h2 className="display text-[17px] font-semibold text-ink">
                    {current.name || "Unnamed payee"}
                  </h2>
                  {paid && (
                    <span className="rounded-full bg-spruce-wash px-2 py-0.5 text-[11px] font-semibold text-spruce">
                      Paid
                    </span>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-[13px] text-ink-2">{current.vpa || "—"}</p>
                {!current.adhoc && (
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    Order {current.orderNumber} · {current.pieces} piece
                    {current.pieces === 1 ? "" : "s"}
                  </p>
                )}
                {!vpaOk && current.vpa && (
                  <p className="mt-1.5 text-[12px] text-clay">
                    That does not look like a UPI handle (name@bank).
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                <Labelled label="Amount (₹)">
                  <input
                    inputMode="decimal"
                    value={current.amount}
                    onChange={(e) => update(current.orderKey, { amount: e.target.value })}
                    placeholder="Blank = type in app"
                    className="tnum w-full rounded-lg border border-line bg-paper px-3 py-2 text-[15px] font-semibold text-ink focus:border-spruce focus:outline-none"
                  />
                </Labelled>
                <Labelled label={`Note — must contain ${NOTE_TAG}`}>
                  <input
                    value={current.note}
                    onChange={(e) => update(current.orderKey, { note: e.target.value })}
                    className={`w-full rounded-lg border bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none ${
                      problem ? "border-clay" : "border-line focus:border-spruce"
                    }`}
                  />
                </Labelled>
              </div>

              {problem ? (
                <p className="rounded-lg border border-clay/30 bg-clay-wash px-3 py-2 text-[12.5px] text-clay">
                  {problem} The QR will not build until it is fixed.
                </p>
              ) : (
                <p className="text-[12px] text-ink-3">
                  The note is what the customer sees on their statement — keep the order number
                  on it so a query can be traced back.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <a
                  href={link || undefined}
                  aria-disabled={!link}
                  className={`rounded-lg px-4 py-2.5 text-[13px] font-semibold transition ${
                    link
                      ? "bg-spruce text-white hover:bg-spruce-deep"
                      : "pointer-events-none bg-sunk text-ink-3"
                  }`}
                >
                  Open in UPI app
                </a>
                <button
                  onClick={() => saveQr(canvasRef.current, current)}
                  disabled={!link}
                  className="rounded-lg border border-line bg-card px-3.5 py-2.5 text-[13px] font-medium text-ink-2 transition hover:border-spruce hover:text-spruce disabled:opacity-40"
                >
                  Save QR
                </button>
                <button
                  onClick={async () => {
                    if (!link) return;
                    await navigator.clipboard.writeText(link);
                    setCopiedAt(index);
                  }}
                  disabled={!link}
                  className="rounded-lg border border-line bg-card px-3.5 py-2.5 text-[13px] font-medium text-ink-2 transition hover:border-spruce hover:text-spruce disabled:opacity-40"
                >
                  {copiedAt === index ? "Copied" : "Copy link"}
                </button>
                <button
                  onClick={() => order && void setPaid(order, !paid)}
                  disabled={!order}
                  className={`rounded-lg px-4 py-2.5 text-[13px] font-semibold transition disabled:opacity-40 sm:ml-auto ${
                    paid
                      ? "border border-line bg-card text-ink-2 hover:border-clay hover:text-clay"
                      : "border border-spruce/30 bg-spruce-wash text-spruce hover:bg-spruce hover:text-white"
                  }`}
                >
                  {paid ? "Undo paid" : "Mark paid"}
                </button>
              </div>

              {queue.length > 1 && (
                <Carousel
                  queue={queue}
                  index={index}
                  unpaidLeft={unpaidLeft}
                  isPaid={(key) => Boolean(byKey.get(key)?.paid)}
                  onStep={step}
                  onPick={setIndex}
                  onPaidNext={markPaidAndAdvance}
                  canMark={Boolean(order) && !paid}
                />
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ carousel ---- */

function Carousel({
  queue,
  index,
  unpaidLeft,
  isPaid,
  onStep,
  onPick,
  onPaidNext,
  canMark,
}: {
  queue: QueueItem[];
  index: number;
  unpaidLeft: number;
  isPaid: (key: string) => boolean;
  onStep: (d: 1 | -1) => void;
  onPick: (i: number) => void;
  onPaidNext: () => void;
  canMark: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-paper px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onStep(-1)}
          disabled={index === 0}
          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-card text-ink-2 transition hover:border-spruce hover:text-spruce disabled:opacity-30"
          aria-label="Previous payout"
        >
          ←
        </button>
        <div className="tnum whitespace-nowrap text-[12.5px] text-ink-2">
          <span className="font-semibold text-ink">{index + 1}</span> of {queue.length} ·{" "}
          {unpaidLeft} left
        </div>
        <button
          onClick={() => onStep(1)}
          disabled={index >= queue.length - 1}
          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-card text-ink-2 transition hover:border-spruce hover:text-spruce disabled:opacity-30"
          aria-label="Next payout"
        >
          →
        </button>
        <button
          onClick={onPaidNext}
          disabled={!canMark}
          className="ml-auto whitespace-nowrap rounded-lg bg-spruce px-3.5 py-2 text-[12.5px] font-semibold text-white transition hover:bg-spruce-deep disabled:opacity-40"
        >
          Mark paid & next →
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1">
        {queue.map((q, i) => (
          <button
            key={q.orderKey}
            onClick={() => onPick(i)}
            title={`${q.orderNumber} · ${q.name}`}
            aria-label={`Go to payout ${i + 1}`}
            className={`h-1.5 w-5 rounded-full transition ${
              i === index
                ? "bg-ink"
                : isPaid(q.orderKey)
                  ? "bg-spruce/60"
                  : "bg-line hover:bg-ink-3"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- side ---- */

function AddPayee({ onAdd }: { onAdd: (item: QueueItem) => void }) {
  const [vpa, setVpa] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");

  const submit = () => {
    const handle = vpa.trim().toLowerCase();
    if (!isUpiHandle(handle)) return;
    onAdd({
      orderKey: `adhoc:${handle}:${Date.now()}`,
      orderNumber: "",
      vpa: handle,
      name: name.trim(),
      amount: amount.trim(),
      note: noteFor(),
      pieces: 0,
      adhoc: true,
    });
    setVpa("");
    setName("");
    setAmount("");
  };

  return (
    <div className="rounded-card border border-line bg-card p-4">
      <h3 className="display text-[13px] font-semibold text-ink">Add a payee</h3>
      <p className="mt-0.5 text-[12px] text-ink-3">
        For a payout that isn’t in the ledger.
      </p>
      <div className="mt-3 space-y-2">
        <input
          value={vpa}
          onChange={(e) => setVpa(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="name@bank"
          className="w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[13px] focus:border-spruce focus:outline-none"
        />
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] focus:border-spruce focus:outline-none"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="₹"
            className="tnum w-20 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] focus:border-spruce focus:outline-none"
          />
        </div>
        <button
          onClick={submit}
          disabled={!isUpiHandle(vpa.trim().toLowerCase())}
          className="w-full rounded-lg border border-spruce/30 bg-spruce-wash py-2 text-[13px] font-semibold text-spruce transition hover:bg-spruce hover:text-white disabled:border-line disabled:bg-sunk disabled:text-ink-3"
        >
          Add to queue
        </button>
      </div>
    </div>
  );
}

function Queue({
  queue,
  index,
  onPick,
  onRemove,
  onClear,
  isPaid,
}: {
  queue: QueueItem[];
  index: number;
  onPick: (i: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  isPaid: (key: string) => boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
        <h3 className="display text-[13px] font-semibold text-ink">
          Queue <span className="tnum font-normal text-ink-3">{queue.length}</span>
        </h3>
        {queue.length > 0 && (
          <button onClick={onClear} className="text-[12px] text-ink-3 hover:text-clay">
            Clear
          </button>
        )}
      </div>
      {!queue.length ? (
        <p className="px-4 py-5 text-[12.5px] leading-relaxed text-ink-3">
          Empty. Pick orders in the ledger and send them here, or add a payee by hand.
        </p>
      ) : (
        <ul className="max-h-[380px] overflow-y-auto">
          {queue.map((q, i) => {
            const paid = isPaid(q.orderKey);
            return (
              <li
                key={q.orderKey}
                className={`flex items-center gap-2 border-b border-line-soft px-3 py-2 last:border-0 ${
                  i === index ? "bg-spruce-wash" : ""
                }`}
              >
                <button onClick={() => onPick(i)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[12.5px] text-ink">
                    {q.name || q.vpa}
                    {paid && <span className="ml-1.5 text-[11px] text-spruce">✓</span>}
                  </div>
                  <div className="tnum truncate font-mono text-[11px] text-ink-3">
                    {q.orderNumber ? `${q.orderNumber} · ` : ""}
                    {q.amount ? money(Number(q.amount)) : "no amount"}
                  </div>
                </button>
                <button
                  onClick={() => onRemove(q.orderKey)}
                  className="shrink-0 px-1 text-[13px] text-ink-3 hover:text-clay"
                  aria-label="Remove from queue"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyDesk() {
  return (
    <div className="px-6 py-20 text-center">
      <p className="display text-[15px] font-semibold text-ink">Nothing queued</p>
      <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-ink-2">
        Select orders in the ledger and send them here — they arrive as a carousel you can work
        through one at a time, marking each paid as you go.
      </p>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}

function saveQr(canvas: HTMLCanvasElement | null, item: QueueItem) {
  if (!canvas) return;
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `upi-${item.orderNumber || item.vpa.replace(/[^a-z0-9]/gi, "-")}.png`;
  a.click();
}
