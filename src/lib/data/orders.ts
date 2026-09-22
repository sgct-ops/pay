import {
  Timestamp,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDocsFromCache,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import type {
  Approval,
  AuditEvent,
  Batch,
  EventKind,
  PayoutOrder,
  RoleRecord,
  StoredOrder,
  TransformSummary,
} from "@/lib/sheet/types";
import { DEFAULT_ROLES, FIXED_ADMIN, type Role } from "@/lib/roles";
import { payAmount, payUpi } from "@/lib/order-view";

const ORDERS = "orders";
const BATCHES = "batches";
const EVENTS = "events";
const ROLES = "roles";

export interface Actor {
  uid: string;
  email: string;
  role: Role;
}

export interface SyncState {
  /** Max server `updatedAt` we have seen, in ms. The delta cursor. */
  cursor: number;
  /** When the last successful server pull finished, in ms. */
  lastSyncedAt: number;
}

const SYNC_KEY = "ct.sync.v1";

export function readSyncState(): SyncState {
  if (typeof window === "undefined") return { cursor: 0, lastSyncedAt: 0 };
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (!raw) return { cursor: 0, lastSyncedAt: 0 };
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return { cursor: Number(parsed.cursor) || 0, lastSyncedAt: Number(parsed.lastSyncedAt) || 0 };
  } catch {
    return { cursor: 0, lastSyncedAt: 0 };
  }
}

export function writeSyncState(state: SyncState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(state));
  } catch {
    /* private mode — the Firestore cache still works, we just re-pull more */
  }
}

export function clearSyncState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SYNC_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- read ---- */

function toStoredOrder(id: string, data: Record<string, unknown>): StoredOrder {
  const updatedAt = data.updatedAt as Timestamp | undefined;
  return {
    ...(data as unknown as StoredOrder),
    orderKey: id,
    approval: (data.approval as Approval) ?? "pending",
    approvalNote: (data.approvalNote as string | null) ?? null,
    approvalBy: (data.approvalBy as string | null) ?? null,
    approvalAt: (data.approvalAt as number | null) ?? null,
    upiOverride: (data.upiOverride as string | null) ?? null,
    amountOverride: (data.amountOverride as number | null) ?? null,
    correctedBy: (data.correctedBy as string | null) ?? null,
    correctedAt: (data.correctedAt as number | null) ?? null,
    paid: Boolean(data.paid),
    paidAt: (data.paidAt as number | null) ?? null,
    paidByEmail: (data.paidByEmail as string | null) ?? null,
    payFailedReason: (data.payFailedReason as string | null) ?? null,
    batchIds: (data.batchIds as string[]) ?? [],
    firstSeenAt: (data.firstSeenAt as number) ?? 0,
    updatedAt: updatedAt?.toMillis?.() ?? Date.now(),
    reopenedAt: (data.reopenedAt as number | null) ?? null,
    lines: (data.lines as StoredOrder["lines"]) ?? [],
    keys: (data.keys as string[]) ?? [],
    upis: (data.upis as string[]) ?? [],
    ships: (data.ships as string[]) ?? [],
  };
}

/**
 * Everything already on this device. Costs nothing and works offline —
 * this is what the app opens with, every time.
 */
export async function readOrdersFromCache(): Promise<StoredOrder[]> {
  const snap = await getDocsFromCache(collection(getDb(), ORDERS));
  return snap.docs.map((d) => toStoredOrder(d.id, d.data()));
}

/**
 * Ask the server for what changed since the cursor. A normal refresh after a
 * quiet hour reads zero documents; a refresh after an upload reads only the
 * orders that upload touched. Pass `full` to re-pull the whole collection.
 */
export async function pullOrdersFromServer(
  cursor: number,
  full = false,
): Promise<{ orders: StoredOrder[]; cursor: number }> {
  const ref = collection(getDb(), ORDERS);
  const q =
    full || !cursor
      ? query(ref, orderBy("updatedAt", "asc"))
      : query(
          ref,
          where("updatedAt", ">", Timestamp.fromMillis(cursor)),
          orderBy("updatedAt", "asc"),
        );

  const snap = await getDocsFromServer(q);
  const orders = snap.docs.map((d) => toStoredOrder(d.id, d.data()));
  const newest = orders.reduce((max, o) => Math.max(max, o.updatedAt), cursor);
  return { orders, cursor: newest };
}

export async function listBatches(max = 50): Promise<Batch[]> {
  const q = query(collection(getDb(), BATCHES), orderBy("uploadedAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...(d.data() as Batch), id: d.id }));
}

export async function listEvents(max = 200): Promise<AuditEvent[]> {
  const q = query(collection(getDb(), EVENTS), orderBy("at", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...(d.data() as AuditEvent), id: d.id }));
}

/* ---------------------------------------------------------------- roles --- */

export async function resolveRole(email: string): Promise<Role> {
  const key = email.toLowerCase();
  // The admin address is pinned here and in firestore.rules, so a careless edit
  // on the roles screen can never lock the owner out of the project.
  if (key === FIXED_ADMIN) return "admin";
  try {
    const snap = await getDoc(doc(getDb(), ROLES, key));
    if (snap.exists()) {
      const role = (snap.data() as RoleRecord).role;
      if (role === "admin" || role === "ops" || role === "accounts") return role;
    }
  } catch {
    // Offline on a first run, or rules not deployed yet. Fall through to the
    // seeded defaults rather than locking someone out of a working app.
  }
  return DEFAULT_ROLES[key] ?? "none";
}

export async function listRoles(): Promise<RoleRecord[]> {
  const snap = await getDocs(query(collection(getDb(), ROLES), orderBy("email")));
  return snap.docs.map((d) => d.data() as RoleRecord);
}

export async function setRole(
  email: string,
  role: RoleRecord["role"],
  name: string | null,
  actor: Actor,
): Promise<void> {
  const key = email.trim().toLowerCase();
  const db = getDb();
  const writer = writeBatch(db);
  const previous = await getDoc(doc(db, ROLES, key));
  writer.set(doc(db, ROLES, key), {
    email: key,
    role,
    name,
    addedBy: actor.email,
    addedAt: Date.now(),
  } satisfies RoleRecord);
  logInto(writer, {
    kind: "role",
    note: key,
    from: previous.exists() ? (previous.data() as RoleRecord).role : "none",
    to: role,
  }, actor);
  await writer.commit();
}

export async function removeRole(email: string, actor: Actor): Promise<void> {
  const key = email.trim().toLowerCase();
  if (key === FIXED_ADMIN) throw new Error("The owner account cannot be removed.");
  await deleteDoc(doc(getDb(), ROLES, key));
  const writer = writeBatch(getDb());
  logInto(writer, { kind: "role", note: key, from: "—", to: "removed" }, actor);
  await writer.commit();
}

/* --------------------------------------------------------------- write ---- */

type EventDraft = Partial<Omit<AuditEvent, "kind" | "at" | "byUid" | "byEmail" | "byRole">> & {
  kind: EventKind;
};

/** Append to the audit trail inside the same atomic write as the change itself. */
function logInto(
  writer: ReturnType<typeof writeBatch>,
  draft: EventDraft,
  actor: Actor,
): void {
  const event: AuditEvent = {
    kind: draft.kind,
    orderKey: draft.orderKey ?? null,
    orderNumber: draft.orderNumber ?? null,
    amount: draft.amount ?? null,
    upi: draft.upi ?? null,
    note: draft.note ?? null,
    from: draft.from ?? null,
    to: draft.to ?? null,
    at: Date.now(),
    byUid: actor.uid,
    byEmail: actor.email,
    byRole: actor.role,
  };
  writer.set(doc(collection(getDb(), EVENTS)), event);
}

export interface SaveBatchInput {
  orders: PayoutOrder[];
  summary: TransformSummary;
  stages: string[];
  fileName: string;
  actor: Actor;
  /** Orders already known locally, so first-seen dates and approvals survive. */
  known: Map<string, StoredOrder>;
}

/**
 * Write an upload into Firestore.
 *
 * Orders are keyed by order number, so re-uploading an overlapping export
 * refreshes the existing documents instead of duplicating them. Two things are
 * deliberately left out of the write for orders that already exist: the payment
 * fields, and the approval fields — so nothing an export says can quietly mark
 * an order paid or approved.
 *
 * The exception is a *material* change. If a new export moves the amount or the
 * handle on an order operations had already approved, the approval is pulled
 * back to pending. An approval is a decision about a specific figure; change the
 * figure and the decision has to be made again.
 */
export async function saveBatch(input: SaveBatchInput): Promise<Batch> {
  const db = getDb();
  const batchId = `${new Date().toISOString().slice(0, 10)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const now = Date.now();

  let ordersNew = 0;
  let ordersUpdated = 0;
  let ordersReopened = 0;

  const chunks: PayoutOrder[][] = [];
  for (let i = 0; i < input.orders.length; i += 200) {
    chunks.push(input.orders.slice(i, i + 200));
  }

  for (const chunk of chunks) {
    const writer = writeBatch(db);
    for (const order of chunk) {
      const existing = input.known.get(order.orderKey);
      if (!existing) ordersNew++;
      else ordersUpdated++;

      const payload: Record<string, unknown> = {
        ...order,
        batchIds: arrayUnion(batchId),
        lastBatchId: batchId,
        updatedAt: serverTimestamp(),
      };

      if (!existing) {
        payload.approval = "pending";
        payload.approvalNote = null;
        payload.approvalBy = null;
        payload.approvalAt = null;
        payload.upiOverride = null;
        payload.amountOverride = null;
        payload.correctedBy = null;
        payload.correctedAt = null;
        payload.paid = false;
        payload.paidAt = null;
        payload.paidByEmail = null;
        payload.payFailedReason = null;
        payload.reopenedAt = null;
        payload.firstSeenAt = now;
      } else {
        const changedAmount = existing.total !== order.total;
        const changedUpi = existing.upi !== order.upi;
        if ((changedAmount || changedUpi) && existing.approval === "approved" && !existing.paid) {
          payload.approval = "pending";
          payload.approvalNote = changedAmount
            ? `Re-opened: the export changed the amount from ₹${existing.total} to ₹${order.total}.`
            : "Re-opened: the export changed the UPI handle.";
          payload.reopenedAt = now;
          ordersReopened++;
          logInto(
            writer,
            {
              kind: "reopen",
              orderKey: order.orderKey,
              orderNumber: order.orderNumber,
              amount: order.total,
              from: String(existing.total),
              to: String(order.total),
              note: payload.approvalNote as string,
            },
            input.actor,
          );
        }
      }

      writer.set(doc(db, ORDERS, order.orderKey), payload, { merge: true });
    }
    await writer.commit();
  }

  const batch: Batch = {
    id: batchId,
    fileName: input.fileName,
    uploadedAt: now,
    uploadedByUid: input.actor.uid,
    uploadedByEmail: input.actor.email,
    stages: input.stages,
    summary: input.summary,
    ordersNew,
    ordersUpdated,
  };

  const writer = writeBatch(db);
  writer.set(doc(db, BATCHES, batchId), batch);
  logInto(
    writer,
    {
      kind: "upload",
      note: `${input.fileName} · ${ordersNew} new, ${ordersUpdated} refreshed${
        ordersReopened ? `, ${ordersReopened} re-opened` : ""
      }`,
      amount: input.summary.totalPayable,
    },
    input.actor,
  );
  await writer.commit();

  return batch;
}

/* ------------------------------------------------- operations' decisions --- */

export async function setApproval(
  order: StoredOrder,
  approval: Approval,
  note: string | null,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  const writer = writeBatch(db);
  writer.set(
    doc(db, ORDERS, order.orderKey),
    {
      approval,
      approvalNote: note,
      approvalBy: actor.email,
      approvalAt: Date.now(),
      // A fresh decision clears a previous failed transfer.
      payFailedReason: approval === "approved" ? null : order.payFailedReason,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  logInto(
    writer,
    {
      kind: approval === "approved" ? "approve" : approval === "hold" ? "hold" : "reject",
      orderKey: order.orderKey,
      orderNumber: order.orderNumber,
      amount: payAmount(order),
      upi: payUpi(order),
      note,
      from: order.approval,
      to: approval,
    },
    actor,
  );
  await writer.commit();
}

/** Approve several at once — the "approve this whole week" action. */
export async function setApprovalMany(
  orders: StoredOrder[],
  approval: Approval,
  note: string | null,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  for (let i = 0; i < orders.length; i += 100) {
    const writer = writeBatch(db);
    for (const order of orders.slice(i, i + 100)) {
      writer.set(
        doc(db, ORDERS, order.orderKey),
        {
          approval,
          approvalNote: note,
          approvalBy: actor.email,
          approvalAt: Date.now(),
          payFailedReason: approval === "approved" ? null : order.payFailedReason,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      logInto(
        writer,
        {
          kind: approval === "approved" ? "approve" : approval === "hold" ? "hold" : "reject",
          orderKey: order.orderKey,
          orderNumber: order.orderNumber,
          amount: payAmount(order),
          upi: payUpi(order),
          note,
          from: order.approval,
          to: approval,
        },
        actor,
      );
    }
    await writer.commit();
  }
}

export interface CorrectionInput {
  upi?: string | null;
  amount?: number | null;
}

/**
 * Record a correction without destroying the imported value. `upi` and `total`
 * stay exactly as the export had them; the override is what gets paid.
 */
export async function applyCorrection(
  order: StoredOrder,
  change: CorrectionInput,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  const writer = writeBatch(db);

  const patch: Record<string, unknown> = {
    correctedBy: actor.email,
    correctedAt: Date.now(),
    updatedAt: serverTimestamp(),
  };
  if (change.upi !== undefined) patch.upiOverride = change.upi || null;
  if (change.amount !== undefined) patch.amountOverride = change.amount;

  writer.set(doc(db, ORDERS, order.orderKey), patch, { merge: true });

  if (change.upi !== undefined) {
    logInto(
      writer,
      {
        kind: "correct",
        orderKey: order.orderKey,
        orderNumber: order.orderNumber,
        note: "UPI handle",
        from: payUpi(order) || "(none)",
        to: change.upi || "(cleared)",
      },
      actor,
    );
  }
  if (change.amount !== undefined) {
    logInto(
      writer,
      {
        kind: "correct",
        orderKey: order.orderKey,
        orderNumber: order.orderNumber,
        note: "Amount",
        amount: change.amount,
        from: String(payAmount(order)),
        to: change.amount === null ? `${order.total} (reset)` : String(change.amount),
      },
      actor,
    );
  }

  await writer.commit();
}

/* ---------------------------------------------------- accounts' decisions -- */

/**
 * Mark one refund paid or un-paid, and record who did it.
 *
 * Both writes go through Firestore's offline queue, so this works on a phone
 * with no signal and syncs when the connection comes back.
 */
export async function markOrderPaid(
  order: StoredOrder,
  paid: boolean,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  const at = Date.now();
  const writer = writeBatch(db);
  writer.set(
    doc(db, ORDERS, order.orderKey),
    {
      paid,
      paidAt: paid ? at : null,
      paidByEmail: paid ? actor.email : null,
      payFailedReason: null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  logInto(
    writer,
    {
      kind: paid ? "pay" : "unpay",
      orderKey: order.orderKey,
      orderNumber: order.orderNumber,
      amount: payAmount(order),
      upi: payUpi(order),
    },
    actor,
  );
  await writer.commit();
}

/** A transfer bounced. Sends the order back to operations with the reason. */
export async function markPayFailed(
  order: StoredOrder,
  reason: string,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  const writer = writeBatch(db);
  writer.set(
    doc(db, ORDERS, order.orderKey),
    {
      paid: false,
      paidAt: null,
      paidByEmail: null,
      payFailedReason: reason,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  logInto(
    writer,
    {
      kind: "payfail",
      orderKey: order.orderKey,
      orderNumber: order.orderNumber,
      amount: payAmount(order),
      upi: payUpi(order),
      note: reason,
    },
    actor,
  );
  await writer.commit();
}
