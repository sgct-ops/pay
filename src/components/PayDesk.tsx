"use client";

import { useMemo, useRef, useState } from "react";
import { useOrders, usePayQueue, type QueueItem } from "@/lib/store";
import { useAuth } from "@/lib/auth-context";
import { QrCode } from "@/components/QrCode";
import { InstallHint } from "@/components/InstallHint";
import { isUpiHandle, noteFor, noteProblem, upiLink } from "@/lib/upi";
import { useSettings } from "@/lib/settings-context";
import { money } from "@/lib/format";
import {
  UPI_APPS,
  appById,
  linkForApp,
  readPreferredApp,
  writePreferredApp,
  type UpiApp,
} from "@/lib/upi-apps";
import type { StoredOrder } from "@/lib/sheet/types";

export function PayDesk() {
  const { queue, index, current, setIndex, step, push, update, remove, clear } = usePayQueue();
  const { byKey, setPaid, failPayment } = useOrders();
  const { can, role } = useAuth();
  const { settings } = useSettings();

  // Two canvases exist — one per layout — and only one is ever on screen.
  const deskCanvas = useRef<HTMLCanvasElement>(null);
  const phoneCanvas = useRef<HTMLCanvasElement>(null);

  const [copiedAt, setCopiedAt] = useState(-1);
  // Which UPI app the phone opens. Remembered, because paying twenty refunds
  // through the same app should not mean twenty trips through a chooser.
  const [upiApp, setUpiApp] = useState<UpiApp>(() => {
    // A payer who has chosen for themselves keeps that choice; the admin
    // setting is only the starting point for a phone that has not.
    const chosen = readPreferredApp();
    return chosen.id === "any" ? appById(settings.defaultUpiApp) : chosen;
  });
  const [pickingApp, setPickingApp] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [failing, setFailing] = useState(false);

  const order = current ? byKey.get(current.orderKey) ?? null : null;
  const paid = Boolean(order?.paid);

  /**
   * Amount, handle and note are read-only for anything that came through the
   * ledger — they are what operations approved, and editing them here would
   * make the approval meaningless. Only a payee typed straight into the desk
   * (admin only) can be changed.
   */
  const editable = Boolean(current?.adhoc);

  const problem = current
    ? noteProblem(current.note, settings.noteTag, settings.noteMaxLength)
    : null;
  const vpaOk = current ? isUpiHandle(current.vpa) : false;
  const link = current && vpaOk && !problem ? upiLink(current) : "";

  const unpaidLeft = useMemo(
    () => queue.filter((q) => !byKey.get(q.orderKey)?.paid).length,
    [queue, byKey],
  );

  const saveQr = () => {
    const canvas = visibleCanvas(phoneCanvas.current, deskCanvas.current);
    if (!canvas || !current) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `upi-${current.orderNumber || current.vpa.replace(/[^a-z0-9]/gi, "-")}.png`;
    a.click();
  };

  const copyLink = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiedAt(index);
  };

  const markPaidAndAdvance = async () => {
    if (order) await setPaid(order, true);
    const nextUnpaid = queue.findIndex((q, i) => i > index && !byKey.get(q.orderKey)?.paid);
    if (nextUnpaid >= 0) setIndex(nextUnpaid);
    else step(1);
  };

  if (!can.pay) return <NoPayAccess />;

  return (
    <>
      {/* ----------------------------------------------------------- phone --
          One screen, nothing to scroll. The order across the screen follows the
          order of the job: who and how much, then the QR, then the button that
          actually moves the money, then where you are in the run. */}
      <div className="flex h-full flex-col gap-3 lg:hidden">
        {!current ? (
          <EmptyDesk role={role} />
        ) : (
          <>
            <ProgressBar
              index={index}
              total={queue.length}
              unpaidLeft={unpaidLeft}
              isPaid={(key) => Boolean(byKey.get(key)?.paid)}
              onOpenQueue={() => setShowQueue(true)}
              queue={queue}
              onPick={setIndex}
            />

            <div className="rounded-card border border-line bg-card px-3.5 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="display truncate text-[16px] font-semibold text-ink">
                  {current.name || "Unnamed payee"}
                </span>
                <span className="tnum display shrink-0 text-[20px] font-semibold text-ink">
                  {current.amount ? money(Number(current.amount)) : "—"}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-[12.5px] text-ink-2">
                  {current.vpa || "—"}
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-3">
                  {current.adhoc
                    ? "Added by hand"
                    : `#${current.orderNumber} · ${current.pieces} pc${
                        current.pieces === 1 ? "" : "s"
                      }`}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2 rounded-md bg-sunk px-2 py-1">
                <span className="shrink-0 text-[10px] uppercase tracking-[0.06em] text-ink-3">
                  Note
                </span>
                {editable ? (
                  <input
                    value={current.note}
                    onChange={(e) => update(current.orderKey, { note: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-ink focus:outline-none"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                    {current.note}
                  </span>
                )}
                {paid && (
                  <span className="shrink-0 rounded bg-spruce px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    PAID
                  </span>
                )}
              </div>
            </div>

            {/* Small on purpose: on the phone you are holding, the QR is
                only for handing the payment to another device. The space is
                better spent on targets big enough not to misfire. */}
            <div className="flex max-h-[38vh] min-h-0 flex-1 items-center justify-center">
              <QrCode value={link} fluid disabled={!link} canvasRef={phoneCanvas} />
            </div>

            {!link && (
              <p className="rounded-lg border border-clay/30 bg-clay-wash px-3 py-2.5 text-[12.5px] text-clay">
                {problem ?? "This payee has no usable UPI handle."}
              </p>
            )}

            {/* Split button: the big half pays through the remembered app, the
                narrow half changes it. */}
            <div className="flex gap-2.5">
              <a
                href={link ? linkForApp(link, upiApp) : undefined}
                aria-disabled={!link}
                className={`flex h-14 flex-1 items-center justify-center rounded-xl text-[16px] font-semibold transition ${
                  link
                    ? "bg-spruce text-white shadow-[0_2px_0_#1d4632] active:translate-y-px active:shadow-none"
                    : "pointer-events-none bg-sunk text-ink-3"
                }`}
              >
                {upiApp.id === "any" ? "Open in UPI app" : `Pay with ${upiApp.name}`}
              </a>
              <button
                onClick={() => setPickingApp(true)}
                aria-label="Choose which UPI app to pay with"
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-line bg-card text-[13px] font-semibold text-ink-2 active:bg-sunk"
              >
                <span
                  className="grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold text-white"
                  style={{ background: upiApp.tint }}
                >
                  {upiApp.letter}
                </span>
              </button>
            </div>

            <div className="flex gap-2.5">
              <button
                onClick={() => step(-1)}
                disabled={index === 0}
                aria-label="Previous payout"
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-line bg-card text-[18px] text-ink-2 active:bg-sunk disabled:opacity-25"
              >
                ←
              </button>
              <button
                onClick={() => {
                  if (!order) return;
                  void (paid ? setPaid(order, false) : markPaidAndAdvance());
                }}
                disabled={!order}
                className={`h-14 flex-1 rounded-xl text-[15px] font-semibold transition disabled:opacity-40 ${
                  paid
                    ? "border border-line bg-card text-ink-2 active:bg-sunk"
                    : "border-2 border-spruce bg-spruce-wash text-spruce active:bg-spruce active:text-white"
                }`}
              >
                {paid ? "Undo paid" : queue.length > 1 ? "Mark paid & next →" : "Mark paid"}
              </button>
              <button
                onClick={() => step(1)}
                disabled={index >= queue.length - 1}
                aria-label="Next payout"
                className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-line bg-card text-[18px] text-ink-2 active:bg-sunk disabled:opacity-25"
              >
                →
              </button>
            </div>

            <div className="flex gap-2.5 pb-1">
              <button
                onClick={saveQr}
                disabled={!link}
                className="h-11 flex-1 rounded-xl border border-line bg-card text-[13px] font-medium text-ink-2 active:bg-sunk disabled:opacity-40"
              >
                Save QR
              </button>
              <button
                onClick={() => void copyLink()}
                disabled={!link}
                className="h-11 flex-1 rounded-xl border border-line bg-card text-[13px] font-medium text-ink-2 active:bg-sunk disabled:opacity-40"
              >
                {copiedAt === index ? "Copied ✓" : "Copy link"}
              </button>
              {order && !current.adhoc && (
                <button
                  onClick={() => setFailing(true)}
                  className="h-11 flex-1 rounded-xl border border-clay/40 bg-card text-[13px] font-medium text-clay active:bg-clay-wash"
                >
                  Failed
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* --------------------------------------------------------- desktop -- */}
      <div className="hidden gap-4 lg:grid xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4">
          {can.manageRoles && settings.allowAdhocPayments && (
            <AddPayee onAdd={(item) => push([item])} tag={settings.noteTag} />
          )}
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

        <section className="rounded-card border border-line bg-card">
          {!current ? (
            <EmptyDesk role={role} />
          ) : (
            <div className="grid lg:grid-cols-[286px_minmax(0,1fr)]">
              <div className="perf flex flex-col items-center justify-center gap-3 px-5 py-6">
                <QrCode value={link} disabled={!link} canvasRef={deskCanvas} size={224} />
                <p className="text-center text-[11.5px] leading-relaxed text-ink-3">
                  Scan with any UPI app.
                  <br />
                  Paying from this device? Use{" "}
                  <span className="font-medium text-ink-2">Open in UPI app</span> — a screen can’t
                  scan itself.
                </p>
              </div>

              <div className="flex w-full max-w-[620px] flex-col gap-4 px-5 py-6">
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
                      {order?.approvalBy && <> · approved by {order.approvalBy}</>}
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)]">
                  <Labelled label="Amount (₹)">
                    {editable ? (
                      <input
                        inputMode="decimal"
                        value={current.amount}
                        onChange={(e) => update(current.orderKey, { amount: e.target.value })}
                        className="tnum w-full rounded-lg border border-line bg-paper px-3 py-2 text-[15px] font-semibold text-ink focus:border-spruce focus:outline-none"
                      />
                    ) : (
                      <div className="tnum rounded-lg border border-line bg-sunk px-3 py-2 text-[15px] font-semibold text-ink">
                        {current.amount ? money(Number(current.amount)) : "—"}
                      </div>
                    )}
                  </Labelled>
                  <Labelled label={`Note — must contain ${settings.noteTag}`}>
                    {editable ? (
                      <input
                        value={current.note}
                        onChange={(e) => update(current.orderKey, { note: e.target.value })}
                        className={`w-full rounded-lg border bg-paper px-3 py-2 font-mono text-[13px] text-ink focus:outline-none ${
                          problem ? "border-clay" : "border-line focus:border-spruce"
                        }`}
                      />
                    ) : (
                      <div className="rounded-lg border border-line bg-sunk px-3 py-2 font-mono text-[13px] text-ink">
                        {current.note}
                      </div>
                    )}
                  </Labelled>
                </div>

                {problem ? (
                  <p className="rounded-lg border border-clay/30 bg-clay-wash px-3 py-2 text-[12.5px] text-clay">
                    {problem} The QR will not build until it is fixed.
                  </p>
                ) : (
                  <p className="text-[12px] text-ink-3">
                    {editable
                      ? "The note is what the customer sees on their statement."
                      : "The amount and handle are what operations approved. If either looks wrong, send it back rather than editing it here."}
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
                    onClick={saveQr}
                    disabled={!link}
                    className="rounded-lg border border-line bg-card px-3.5 py-2.5 text-[13px] font-medium text-ink-2 transition hover:border-spruce hover:text-spruce disabled:opacity-40"
                  >
                    Save QR
                  </button>
                  <button
                    onClick={() => void copyLink()}
                    disabled={!link}
                    className="rounded-lg border border-line bg-card px-3.5 py-2.5 text-[13px] font-medium text-ink-2 transition hover:border-spruce hover:text-spruce disabled:opacity-40"
                  >
                    {copiedAt === index ? "Copied" : "Copy link"}
                  </button>
                  {order && !current.adhoc && (
                    <button
                      onClick={() => setFailing(true)}
                      className="rounded-lg border border-line bg-card px-3.5 py-2.5 text-[13px] font-medium text-ink-2 transition hover:border-clay hover:text-clay"
                    >
                      Payment failed
                    </button>
                  )}
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

      {pickingApp && (
        <AppSheet
          current={upiApp}
          onPick={(app) => {
            setUpiApp(app);
            writePreferredApp(app.id);
            setPickingApp(false);
          }}
          onClose={() => setPickingApp(false)}
        />
      )}

      {showQueue && (
        <QueueSheet
          queue={queue}
          index={index}
          isPaid={(key) => Boolean(byKey.get(key)?.paid)}
          onPick={(i) => {
            setIndex(i);
            setShowQueue(false);
          }}
          onClose={() => setShowQueue(false)}
        />
      )}

      {failing && order && (
        <FailDialog
          order={order}
          onCancel={() => setFailing(false)}
          onConfirm={async (reason) => {
            await failPayment(order, reason);
            setFailing(false);
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------- phone bits -- */

function ProgressBar({
  index,
  total,
  unpaidLeft,
  queue,
  isPaid,
  onPick,
  onOpenQueue,
}: {
  index: number;
  total: number;
  unpaidLeft: number;
  queue: QueueItem[];
  isPaid: (key: string) => boolean;
  onPick: (i: number) => void;
  onOpenQueue: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="tnum shrink-0 text-[12.5px] text-ink-2">
        <span className="font-semibold text-ink">{index + 1}</span> of {total}
        {unpaidLeft > 0 && <span className="text-ink-3"> · {unpaidLeft} left</span>}
      </span>
      <div className="flex min-w-0 flex-1 gap-1 overflow-hidden">
        {queue.slice(0, 14).map((q, i) => (
          <button
            key={q.orderKey}
            onClick={() => onPick(i)}
            aria-label={`Payout ${i + 1}`}
            className={`h-1.5 min-w-0 flex-1 rounded-full ${
              i === index ? "bg-ink" : isPaid(q.orderKey) ? "bg-spruce/60" : "bg-line"
            }`}
          />
        ))}
      </div>
      <button
        onClick={onOpenQueue}
        className="shrink-0 rounded-full border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink-2"
      >
        Queue
      </button>
    </div>
  );
}

function AppSheet({
  current,
  onPick,
  onClose,
}: {
  current: UpiApp;
  onPick: (app: UpiApp) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-ink/30 lg:hidden">
      <button className="flex-1" onClick={onClose} aria-label="Close" />
      <div className="rounded-t-2xl border-t border-line bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
          <span className="display text-[14px] font-semibold text-ink">Pay with</span>
          <button onClick={onClose} className="text-[13px] text-ink-3">
            Close
          </button>
        </div>
        <ul className="p-2">
          {UPI_APPS.map((app) => (
            <li key={app.id}>
              <button
                onClick={() => onPick(app)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition active:bg-sunk ${
                  current.id === app.id ? "bg-spruce-wash" : ""
                }`}
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-bold text-white"
                  style={{ background: app.tint }}
                >
                  {app.letter}
                </span>
                <span className="flex-1 text-[14px] text-ink">{app.name}</span>
                {current.id === app.id && <span className="text-[14px] text-spruce">✓</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="px-4 pb-4 text-[11.5px] leading-relaxed text-ink-3">
          Remembered for next time. If the app you pick is not installed, nothing will happen —
          come back here and choose <span className="text-ink-2">Any UPI app</span>.
        </p>
      </div>
    </div>
  );
}

function QueueSheet({
  queue,
  index,
  isPaid,
  onPick,
  onClose,
}: {
  queue: QueueItem[];
  index: number;
  isPaid: (key: string) => boolean;
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-ink/30 lg:hidden">
      <button className="flex-1" onClick={onClose} aria-label="Close the queue" />
      <div className="max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-card pb-[env(safe-area-inset-bottom)]">
        <div className="sticky top-0 flex items-center justify-between border-b border-line-soft bg-card px-4 py-3">
          <span className="display text-[14px] font-semibold text-ink">
            Queue <span className="tnum font-normal text-ink-3">{queue.length}</span>
          </span>
          <button onClick={onClose} className="text-[13px] text-ink-3">
            Done
          </button>
        </div>
        <ul>
          {queue.map((q, i) => (
            <li key={q.orderKey}>
              <button
                onClick={() => onPick(i)}
                className={`flex w-full items-center gap-3 border-b border-line-soft px-4 py-3 text-left ${
                  i === index ? "bg-spruce-wash" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink">{q.name || q.vpa}</span>
                  <span className="tnum block truncate font-mono text-[11px] text-ink-3">
                    {q.orderNumber ? `#${q.orderNumber} · ` : ""}
                    {q.amount ? money(Number(q.amount)) : "no amount"}
                  </span>
                </span>
                {isPaid(q.orderKey) && <span className="text-[13px] text-spruce">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FailDialog({
  order,
  onCancel,
  onConfirm,
}: {
  order: StoredOrder;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const presets = [
    "UPI handle rejected the transfer",
    "Customer asked for a different handle",
    "Bank declined or limit reached",
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 px-4">
      <div className="w-full max-w-[420px] rounded-card border border-line bg-card p-5">
        <h3 className="display text-[15px] font-semibold text-ink">
          Send #{order.orderNumber} back to operations
        </h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
          It stays approved but is flagged as a failed transfer, so operations can fix the handle
          and approve it again. Nothing is marked paid.
        </p>
        <div className="mt-3 space-y-1.5">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => setReason(p)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-[12.5px] transition ${
                reason === p
                  ? "border-spruce bg-spruce-wash text-spruce"
                  : "border-line text-ink-2 hover:border-spruce"
              }`}
            >
              {p}
            </button>
          ))}
          <input
            value={presets.includes(reason) ? "" : reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Or type what happened"
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
            onClick={() => void onConfirm(reason.trim())}
            disabled={!reason.trim()}
            className="flex-1 rounded-lg bg-clay py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            Send back
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- desktop bits -- */

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
          Mark paid &amp; next →
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

function AddPayee({ onAdd, tag }: { onAdd: (item: QueueItem) => void; tag: string }) {
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
      note: noteFor(undefined, tag),
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
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
        A payout with no approval behind it. Admin only, and it reads as such in the audit trail.
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
          Empty. Pick approved refunds and send them here.
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

/* ---------------------------------------------------------------- shared -- */

function EmptyDesk({ role }: { role: string }) {
  return (
    <div className="grid h-full place-items-center rounded-card border border-line bg-card px-6 py-16 text-center">
      <div>
        <p className="display text-[15px] font-semibold text-ink">Nothing queued</p>
        <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-relaxed text-ink-2">
          {role === "accounts"
            ? "Open Refunds, pick the approved orders you want to pay, and send them here. They arrive as a carousel you work through one at a time."
            : "Select approved orders and send them here — they arrive as a carousel you work through one at a time, marking each paid as you go."}
        </p>
      </div>
    </div>
  );
}

function NoPayAccess() {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center">
      <div>
        <p className="display text-[15px] font-semibold text-ink">Payments are not your step</p>
        <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-ink-2">
          Operations verifies and approves; accounts pays. That split is enforced by the database,
          not just this screen — approving and paying are deliberately different pairs of hands.
        </p>
      </div>
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

/** Whichever canvas is actually on screen — the two layouts are exclusive. */
function visibleCanvas(...candidates: Array<HTMLCanvasElement | null>): HTMLCanvasElement | null {
  return candidates.find((c) => c && c.offsetParent !== null) ?? null;
}
