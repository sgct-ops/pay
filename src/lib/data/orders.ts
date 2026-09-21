import {
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  doc,
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
  Batch,
  PaymentEvent,
  PayoutOrder,
  StoredOrder,
  TransformSummary,
} from "@/lib/sheet/types";

const ORDERS = "orders";
const BATCHES = "batches";
const PAYMENTS = "payments";

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
    paid: Boolean(data.paid),
    paidAt: (data.paidAt as number | null) ?? null,
    paidByEmail: (data.paidByEmail as string | null) ?? null,
    batchIds: (data.batchIds as string[]) ?? [],
    firstSeenAt: (data.firstSeenAt as number) ?? 0,
    updatedAt: updatedAt?.toMillis?.() ?? Date.now(),
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
      : query(ref, where("updatedAt", ">", Timestamp.fromMillis(cursor)), orderBy("updatedAt", "asc"));

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

export async function listPayments(max = 200): Promise<PaymentEvent[]> {
  const q = query(collection(getDb(), PAYMENTS), orderBy("at", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...(d.data() as PaymentEvent), id: d.id }));
}

/* --------------------------------------------------------------- write ---- */

export interface SaveBatchInput {
  orders: PayoutOrder[];
  summary: TransformSummary;
  stages: string[];
  fileName: string;
  storagePath: string | null;
  user: { uid: string; email: string };
  /** Order keys already known locally, so first-seen dates stay honest. */
  knownKeys: Set<string>;
}

/**
 * Write an upload into Firestore.
 *
 * Orders are keyed by order number, so re-uploading an overlapping export
 * refreshes the existing documents instead of duplicating them — and because
 * the payment fields are never included in the write, a paid order stays paid
 * even if it shows up in next month's export again.
 */
export async function saveBatch(input: SaveBatchInput): Promise<Batch> {
  const db = getDb();
  const batchId = `${new Date().toISOString().slice(0, 10)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const now = Date.now();

  let ordersNew = 0;
  let ordersUpdated = 0;

  const chunks: PayoutOrder[][] = [];
  for (let i = 0; i < input.orders.length; i += 400) {
    chunks.push(input.orders.slice(i, i + 400));
  }

  for (const chunk of chunks) {
    const writer = writeBatch(db);
    for (const order of chunk) {
      const isNew = !input.knownKeys.has(order.orderKey);
      if (isNew) ordersNew++;
      else ordersUpdated++;

      // Note what is *not* here: paid, paidAt, paidByEmail on an existing
      // order. Leaving them out of a merge write is what preserves them.
      const payload: Record<string, unknown> = {
        ...order,
        batchIds: arrayUnion(batchId),
        lastBatchId: batchId,
        updatedAt: serverTimestamp(),
      };
      if (isNew) {
        payload.firstSeenAt = now;
        payload.paid = false;
        payload.paidAt = null;
        payload.paidByEmail = null;
      }

      writer.set(doc(db, ORDERS, order.orderKey), payload, { merge: true });
    }
    await writer.commit();
  }

  const batch: Batch = {
    id: batchId,
    fileName: input.fileName,
    storagePath: input.storagePath,
    uploadedAt: now,
    uploadedByUid: input.user.uid,
    uploadedByEmail: input.user.email,
    stages: input.stages,
    summary: input.summary,
    ordersNew,
    ordersUpdated,
  };

  const writer = writeBatch(db);
  writer.set(doc(db, BATCHES, batchId), batch);
  await writer.commit();

  return batch;
}

export interface MarkPaidInput {
  order: StoredOrder;
  paid: boolean;
  user: { uid: string; email: string };
}

/**
 * Mark one order paid or un-paid, and record who did it.
 *
 * Both writes go through the offline queue, so this works on a phone in a
 * basement and syncs when signal comes back.
 */
export async function markOrderPaid({ order, paid, user }: MarkPaidInput): Promise<void> {
  const db = getDb();
  const at = Date.now();

  const writer = writeBatch(db);
  writer.set(
    doc(db, ORDERS, order.orderKey),
    {
      paid,
      paidAt: paid ? at : null,
      paidByEmail: paid ? user.email : null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await writer.commit();

  const event: PaymentEvent = {
    orderKey: order.orderKey,
    orderNumber: order.orderNumber,
    amount: order.total,
    upi: order.upi,
    action: paid ? "paid" : "unpaid",
    at,
    byUid: user.uid,
    byEmail: user.email,
  };
  await addDoc(collection(db, PAYMENTS), event);
}

/** Mark several orders at once — used when a carousel run is finished. */
export async function markOrdersPaid(
  orders: StoredOrder[],
  paid: boolean,
  user: { uid: string; email: string },
): Promise<void> {
  for (const order of orders) {
    await markOrderPaid({ order, paid, user });
  }
}
