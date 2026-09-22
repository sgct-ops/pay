import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import {
  DEFAULT_SETTINGS,
  describeChange,
  mergeSettings,
  settingsPayload,
  type AppSettings,
} from "@/lib/settings";
import type { AuditEvent } from "@/lib/sheet/types";
import type { Actor } from "@/lib/data/orders";

const SETTINGS = "settings";
const DOC_ID = "app";
const EVENTS = "events";

/**
 * Desk settings live in one document, `settings/app`.
 *
 * One document, not one per setting: a guardrail that can be half-applied is
 * worse than no guardrail, and a single write means a ceiling and the warning
 * threshold below it can never disagree with each other in the database.
 */
function settingsRef() {
  return doc(getDb(), SETTINGS, DOC_ID);
}

/**
 * Watch the settings document.
 *
 * This is the one live listener in the app, and it earns its keep: a ceiling
 * an admin sets on a laptop has to reach the phone that is paying refunds
 * without that phone being reloaded. It costs one document read when it
 * attaches (served from the IndexedDB cache when there is one) and one per
 * change, which is a few reads a month rather than a few per session.
 *
 * `onError` matters more than it looks: before the rules are deployed this
 * read is refused, and the app has to carry on with the defaults rather than
 * showing an empty desk.
 */
export function watchSettings(
  onChange: (settings: AppSettings) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    settingsRef(),
    (snap) => onChange(snap.exists() ? mergeSettings(snap.data()) : DEFAULT_SETTINGS),
    (error) => onError(error as Error),
  );
}

/** A one-off read, for code that is not a React tree. */
export async function readSettings(): Promise<AppSettings> {
  try {
    const snap = await getDoc(settingsRef());
    return snap.exists() ? mergeSettings(snap.data()) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings and record what moved, in one atomic write.
 *
 * The audit entry is written in the same batch as the change, exactly as
 * approvals and payments are — a ceiling that quietly doubled with nothing in
 * the trail is the kind of thing that only becomes interesting after it has
 * cost something.
 */
export async function saveSettings(
  before: AppSettings,
  after: AppSettings,
  actor: Actor,
): Promise<void> {
  const db = getDb();
  const writer = writeBatch(db);
  const at = Date.now();

  writer.set(
    settingsRef(),
    { ...settingsPayload(after), updatedAt: at, updatedByEmail: actor.email },
    { merge: true },
  );

  const event: AuditEvent = {
    kind: "settings",
    orderKey: null,
    orderNumber: null,
    amount: null,
    upi: null,
    note: describeChange(before, after),
    from: null,
    to: null,
    at,
    byUid: actor.uid,
    byEmail: actor.email,
    byRole: actor.role,
  };
  writer.set(doc(collection(db, EVENTS)), event);

  await writer.commit();
}
