import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
  type Auth,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

/**
 * Firebase, initialised once and only in the browser.
 *
 * The web config is not a secret — Firebase expects it to ship in the bundle,
 * and access is controlled by the security rules in firestore.rules, not by
 * hiding these values. They are intentionally supplied only by environment
 * variables: this repository must never choose a Firebase project on its own.
 */
function requiredEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it to .env.local or the Vercel project environment variables.`,
    );
  }
  return value;
}

export const firebaseConfig = {
  apiKey: requiredEnv("NEXT_PUBLIC_FIREBASE_API_KEY", process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: requiredEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: requiredEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: requiredEnv(
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  ),
  messagingSenderId: requiredEnv(
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  ),
  appId: requiredEnv("NEXT_PUBLIC_FIREBASE_APP_ID", process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  measurementId: requiredEnv(
    "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID",
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  ),
};

/** Only these email domains may sign in. Mirrored in firestore.rules and storage.rules. */
export const ALLOWED_DOMAIN = requiredEnv(
  "NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN",
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN,
).toLowerCase();

export function isAllowedEmail(email: string | null | undefined): boolean {
  return (email || "").toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

/**
 * Firestore with the IndexedDB cache switched on.
 *
 * This is what makes opening the app free: every read goes to the local cache
 * first (see readOrdersFromCache), so a normal session bills nothing. Only the
 * Refresh button talks to the server, and it asks for changes since the last
 * sync rather than the whole collection. It also means the app keeps working
 * on a phone with no signal — marking a payout paid is queued locally and
 * replays when the connection comes back.
 */
export function getDb(): Firestore {
  if (db) return db;
  db = initializeFirestore(getFirebaseApp(), {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  return db;
}

export function getFirebaseAuth(): Auth {
  const auth = getAuth(getFirebaseApp());
  void setPersistence(auth, browserLocalPersistence).catch(() => {});
  return auth;
}

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  // Nudges Google to show only work accounts. Enforcement still happens below
  // and in the security rules — a hint is not a control.
  provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: "select_account" });
  return provider;
}

export function getFirebaseStorage(): FirebaseStorage {
  return getStorage(getFirebaseApp());
}

let analytics: Analytics | null = null;

/** Analytics, browser-only and best-effort. Never blocks or breaks a render. */
export async function initAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined" || analytics) return analytics;
  if (process.env.NODE_ENV !== "production") return null;
  try {
    if (await isSupported()) analytics = getAnalytics(getFirebaseApp());
  } catch {
    analytics = null;
  }
  return analytics;
}
