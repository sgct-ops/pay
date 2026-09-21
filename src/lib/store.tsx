"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  clearSyncState,
  markOrderPaid,
  pullOrdersFromServer,
  readOrdersFromCache,
  readSyncState,
  writeSyncState,
} from "@/lib/data/orders";
import type { StoredOrder } from "@/lib/sheet/types";
import { noteFor } from "@/lib/upi";
import { useAuth } from "@/lib/auth-context";

/* ------------------------------------------------------------- orders ---- */

interface OrdersValue {
  orders: StoredOrder[];
  ready: boolean;
  refreshing: boolean;
  lastSyncedAt: number;
  error: string | null;
  /** Pull changes since the last sync. `full` re-reads everything. */
  refresh: (full?: boolean) => Promise<void>;
  /** Fold freshly uploaded orders in without waiting for a round trip. */
  merge: (orders: StoredOrder[]) => void;
  setPaid: (order: StoredOrder, paid: boolean) => Promise<void>;
  byKey: Map<string, StoredOrder>;
}

const OrdersContext = createContext<OrdersValue | null>(null);

function mergeOrders(current: StoredOrder[], incoming: StoredOrder[]): StoredOrder[] {
  if (!incoming.length) return current;
  const map = new Map(current.map((o) => [o.orderKey, o]));
  for (const o of incoming) map.set(o.orderKey, o);
  return Array.from(map.values());
}

export function OrdersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<StoredOrder[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef(0);
  const bootstrapped = useRef(false);

  const refresh = useCallback(
    async (full = false) => {
      setRefreshing(true);
      setError(null);
      try {
        if (full) {
          cursor.current = 0;
          clearSyncState();
        }
        const result = await pullOrdersFromServer(cursor.current, full);
        cursor.current = result.cursor;
        const syncedAt = Date.now();
        setOrders((prev) => (full ? result.orders : mergeOrders(prev, result.orders)));
        setLastSyncedAt(syncedAt);
        writeSyncState({ cursor: result.cursor, lastSyncedAt: syncedAt });
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  // Open from the local cache — free, instant, and works with no signal.
  // The server is only contacted on a first run, when there is nothing cached
  // to show; after that it waits for the Refresh button.
  useEffect(() => {
    if (!user || bootstrapped.current) return;
    bootstrapped.current = true;
    let cancelled = false;

    (async () => {
      const state = readSyncState();
      cursor.current = state.cursor;
      setLastSyncedAt(state.lastSyncedAt);
      try {
        const cached = await readOrdersFromCache();
        if (cancelled) return;
        setOrders(cached);
        setReady(true);
        if (!cached.length) await refresh(true);
      } catch {
        if (cancelled) return;
        setReady(true);
        await refresh(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, refresh]);

  const merge = useCallback((incoming: StoredOrder[]) => {
    setOrders((prev) => mergeOrders(prev, incoming));
  }, []);

  const setPaid = useCallback(
    async (order: StoredOrder, paid: boolean) => {
      if (!user) return;
      const at = paid ? Date.now() : null;
      // Optimistic: the tick lands before the write does, so the ledger keeps
      // up with someone working through a carousel at speed.
      setOrders((prev) =>
        prev.map((o) =>
          o.orderKey === order.orderKey
            ? { ...o, paid, paidAt: at, paidByEmail: paid ? user.email : null }
            : o,
        ),
      );
      try {
        await markOrderPaid({ order, paid, user: { uid: user.uid, email: user.email } });
      } catch (e) {
        setOrders((prev) =>
          prev.map((o) => (o.orderKey === order.orderKey ? order : o)),
        );
        setError(friendlyError(e));
      }
    },
    [user],
  );

  const byKey = useMemo(() => new Map(orders.map((o) => [o.orderKey, o])), [orders]);

  const value = useMemo(
    () => ({ orders, ready, refreshing, lastSyncedAt, error, refresh, merge, setPaid, byKey }),
    [orders, ready, refreshing, lastSyncedAt, error, refresh, merge, setPaid, byKey],
  );

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders(): OrdersValue {
  const ctx = useContext(OrdersContext);
  if (!ctx) throw new Error("useOrders must be used inside <OrdersProvider>");
  return ctx;
}

/* ---------------------------------------------------------- pay queue ---- */

export interface QueueItem {
  orderKey: string;
  orderNumber: string;
  vpa: string;
  name: string;
  amount: string;
  note: string;
  pieces: number;
  /** Ad-hoc entries typed into the desk, not sourced from the ledger. */
  adhoc?: boolean;
}

interface QueueValue {
  queue: QueueItem[];
  index: number;
  current: QueueItem | null;
  setIndex: (i: number) => void;
  step: (direction: 1 | -1) => void;
  push: (items: QueueItem[], options?: { replace?: boolean }) => void;
  update: (orderKey: string, patch: Partial<QueueItem>) => void;
  remove: (orderKey: string) => void;
  clear: () => void;
}

const QueueContext = createContext<QueueValue | null>(null);
const QUEUE_KEY = "ct.queue.v1";

export function orderToQueueItem(order: StoredOrder): QueueItem {
  return {
    orderKey: order.orderKey,
    orderNumber: order.orderNumber,
    vpa: order.upi,
    name: order.customerName,
    amount: order.total ? order.total.toFixed(2) : "",
    note: noteFor(order.orderNumber),
    pieces: order.pieces,
  };
}

/**
 * The queue survives a reload — a phone that locks mid-carousel should come
 * back where it was. This provider only ever mounts client-side (it sits below
 * the auth gate), so reading sessionStorage in the initialiser is safe.
 */
function savedQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueueItem[]) : [];
  } catch {
    return [];
  }
}

export function PayQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueItem[]>(savedQueue);
  const [index, setIndexRaw] = useState(0);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch {
      /* ignore */
    }
  }, [queue]);

  const setIndex = useCallback(
    (i: number) => setIndexRaw(queue.length ? clamp(i, 0, queue.length - 1) : 0),
    [queue.length],
  );

  const step = useCallback(
    (direction: 1 | -1) =>
      setIndexRaw((prev) => (queue.length ? clamp(prev + direction, 0, queue.length - 1) : 0)),
    [queue.length],
  );

  const push = useCallback((items: QueueItem[], options?: { replace?: boolean }) => {
    setQueue((prev) => {
      const base = options?.replace ? [] : prev;
      const map = new Map(base.map((i) => [i.orderKey, i]));
      for (const item of items) map.set(item.orderKey, item);
      const next = Array.from(map.values());
      const firstNew = items[0] ? next.findIndex((i) => i.orderKey === items[0].orderKey) : 0;
      setIndexRaw(firstNew < 0 ? 0 : firstNew);
      return next;
    });
  }, []);

  const update = useCallback((orderKey: string, patch: Partial<QueueItem>) => {
    setQueue((prev) => prev.map((i) => (i.orderKey === orderKey ? { ...i, ...patch } : i)));
  }, []);

  const remove = useCallback((orderKey: string) => {
    setQueue((prev) => {
      const next = prev.filter((i) => i.orderKey !== orderKey);
      setIndexRaw((cur) => clamp(cur, 0, Math.max(0, next.length - 1)));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setQueue([]);
    setIndexRaw(0);
  }, []);

  const current = queue[index] ?? null;

  const value = useMemo(
    () => ({ queue, index, current, setIndex, step, push, update, remove, clear }),
    [queue, index, current, setIndex, step, push, update, remove, clear],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function usePayQueue(): QueueValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("usePayQueue must be used inside <PayQueueProvider>");
  return ctx;
}

/* -------------------------------------------------------------- utils ---- */

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function friendlyError(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code === "permission-denied") {
    return "Firestore refused that. Check the security rules are deployed and that you are signed in with a CarbonTree account.";
  }
  if (code === "unavailable" || code === "failed-precondition") {
    return "Could not reach Firestore. You are working from the cached copy — try Refresh again when you have signal.";
  }
  return (e as Error).message || "Something went wrong.";
}
