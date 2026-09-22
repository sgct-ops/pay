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

/**
 * Firebase, initialised once and only in the browser.
 *
 * The web config is not a secret — Firebase expects it to ship in the bundle,
 * and access is controlled by the security rules in firestore.rules, not by
 * hiding these values. They are intentionally supplied only by environment
 * variables: this repository must never choose a Firebase project on its own.
 */
/**
 * Every value the app needs before it can reach Firebase, read once.
 *
 * These are read but not checked here. Checking at module scope would throw
 * during `next build`, where a prerendered page imports this file and no
 * NEXT_PUBLIC_* variable exists — which is a build machine having no secrets,
 * not a misconfigured app. The check belongs where Firebase is actually
 * reached, so it happens in getFirebaseApp() below.
 */
const ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN: process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN,
};

/** Which of them are absent. Empty on a correctly configured deployment. */
export const missingFirebaseEnv: string[] = Object.keys(ENV).filter((k) => !ENV[k]);

export const firebaseConfig = {
  apiKey: ENV.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: ENV.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: ENV.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  // Optional, and unused: this app writes nothing to Firebase Storage. An
  // export is transformed in the browser and the ledger goes to Firestore;
  // the original file, if it is kept at all, is kept on the uploader’s own
  // device, and only for 90 days. See src/lib/archive.ts.
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: ENV.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: ENV.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  measurementId: ENV.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "",
};

/** Only this email domain may sign in. Mirrored in firestore.rules. */
export const ALLOWED_DOMAIN = (ENV.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "").toLowerCase();

export function isAllowedEmail(email: string | null | undefined): boolean {
  // With no configured domain every address would match "@", so an
  // unconfigured app admits nobody rather than everybody.
  if (!ALLOWED_DOMAIN) return false;
  return (email || "").toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

/**
 * Refuse to run against a half-configured project.
 *
 * This fires on the first real Firebase call — in the browser, where the
 * variables are supposed to have arrived — rather than at import time. A
 * missing value is a deployment that would otherwise fail deep inside the
 * Firebase SDK with a message nobody can act on.
 */
function assertConfigured(): void {
  if (!missingFirebaseEnv.length) return;
  throw new Error(
    `Missing ${missingFirebaseEnv.join(", ")}. Add ${
      missingFirebaseEnv.length === 1 ? "it" : "them"
    } to .env.local or the Vercel project environment variables.`,
  );
}

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;
  assertConfigured();
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
