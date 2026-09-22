/**
 * The upload archive — the original export, kept on this device.
 *
 * The ledger in Firestore is the record: every order, every figure, every
 * decision. The raw file is a convenience on top of that — something to open
 * when a number looks wrong and you want to see the row it came from.
 *
 * It lives in IndexedDB rather than in Firebase Storage. That is a deliberate
 * trade and worth being honest about: the copy belongs to one browser on one
 * machine. Whoever uploaded the file has it; nobody else does, and clearing
 * site data throws it away. It is a convenience, not a company archive. If the
 * team ever needs a shared one, Firebase Storage is the place for it and this
 * module is what gets replaced.
 *
 * IndexedDB and not localStorage: localStorage holds strings, so a spreadsheet
 * would have to be base64-encoded into a ~5 MB budget and a real export would
 * not fit. IndexedDB stores the file as a Blob, at its own size.
 */

const DB_NAME = "carbontree-payout";
const STORE = "uploads";
const VERSION = 1;

/** What the archive holds before it starts dropping the oldest entries. */
const MAX_ENTRIES = 24;
const MAX_BYTES = 200 * 1024 * 1024;

/**
 * How long a copy is kept.
 *
 * A raw export is customer PII — names, phone numbers, UPI handles — sitting on
 * a laptop outside Firestore and outside the security rules. It earns its place
 * for as long as someone might reasonably question a payout, and after that it
 * is only a liability, so it goes. The sweep runs whenever the archive is
 * written to or listed; nobody has to remember to clear anything.
 */
export const ARCHIVE_MAX_AGE_DAYS = 90;
const MAX_AGE_MS = ARCHIVE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** When this copy deletes itself. */
export function expiresAt(entry: ArchiveEntry): number {
  return entry.uploadedAt + MAX_AGE_MS;
}

/** Whole days left before it does, floored at zero. */
export function daysLeft(entry: ArchiveEntry, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt(entry) - now) / (24 * 60 * 60 * 1000)));
}

/** One archived upload, without the file itself. */
export interface ArchiveEntry {
  /** The batch this file produced, so an entry ties back to the ledger. */
  batchId: string;
  fileName: string;
  fileType: string;
  size: number;
  uploadedAt: number;
  uploadedByEmail: string;
}

export interface ArchiveRecord extends ArchiveEntry {
  blob: Blob;
}

/** IndexedDB is missing in some private-browsing modes, and absent on the server. */
export function archiveSupported(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function promised<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The archive could not be read."));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!archiveSupported()) {
      reject(new Error("This browser has no IndexedDB, so the archive is unavailable."));
      return;
    }
    const req = window.indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "batchId" });
        store.createIndex("uploadedAt", "uploadedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("The archive could not be opened."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("The archive write was rolled back."));
    tx.onerror = () => reject(tx.error ?? new Error("The archive write failed."));
  });
}

function strip(record: ArchiveRecord): ArchiveEntry {
  const { blob: _blob, ...entry } = record;
  void _blob;
  return entry;
}

/**
 * Expire what is too old, then keep the rest from growing without bound.
 *
 * Age comes first and is absolute: past ninety days a copy goes, however small
 * the archive is. After that it is oldest-first, and only ever the oldest — the
 * file just archived is the one most likely to be wanted, so it is never the
 * one dropped.
 *
 * Returns how many entries it removed for having expired.
 */
async function prune(db: IDBDatabase, now = Date.now()): Promise<number> {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const all = await promised(store.index("uploadedAt").getAll() as IDBRequest<ArchiveRecord[]>);

  let count = all.length;
  let bytes = all.reduce((sum, r) => sum + (r.size || 0), 0);
  let expired = 0;

  const drop = (record: ArchiveRecord) => {
    store.delete(record.batchId);
    count--;
    bytes -= record.size || 0;
  };

  // The index orders by uploadedAt, so this walks oldest to newest.
  const living: ArchiveRecord[] = [];
  for (const record of all) {
    if (now - record.uploadedAt >= MAX_AGE_MS) {
      drop(record);
      expired++;
    } else {
      living.push(record);
    }
  }

  for (const record of living) {
    if (count <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    drop(record);
  }

  await done(tx);
  return expired;
}

/**
 * Put a file in the archive.
 *
 * Throws on a full disk or a browser that refuses the write. The caller decides
 * what that means — for an upload it means nothing, because the ledger is
 * already saved by the time this runs.
 */
export async function archiveUpload(record: ArchiveRecord): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    await done(tx);
    await prune(db);
  } finally {
    db.close();
  }
}

/**
 * Every archived upload on this device, newest first.
 *
 * Sweeps expired copies before listing, so what the screen shows is what the
 * disk holds — an entry is never displayed past its ninety days.
 */
export async function listArchived(): Promise<ArchiveEntry[]> {
  const db = await openDb();
  try {
    await prune(db);
    const tx = db.transaction(STORE, "readonly");
    const all = await promised(
      tx.objectStore(STORE).index("uploadedAt").getAll() as IDBRequest<ArchiveRecord[]>,
    );
    return all.map(strip).reverse();
  } finally {
    db.close();
  }
}

/** One archived file, or null if this device never had it. */
export async function getArchived(batchId: string): Promise<ArchiveRecord | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const record = await promised(
      tx.objectStore(STORE).get(batchId) as IDBRequest<ArchiveRecord | undefined>,
    );
    return record ?? null;
  } finally {
    db.close();
  }
}

export async function deleteArchived(batchId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(batchId);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function clearArchive(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await done(tx);
  } finally {
    db.close();
  }
}

/** Hand an archived file to the browser as a download. */
export function saveArchivedFile(record: ArchiveRecord): void {
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = record.fileName;
  a.click();
  URL.revokeObjectURL(url);
}
