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
 * hiding these values. They are still read from env vars so a second project
 * (staging, a fork) needs no code change.
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyCt86XN67YFyTjbzfczUu_t_7QyB3GhLhI",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "payout-891fa.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "payout-891fa",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "payout-891fa.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "80190112062",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:80190112062:web:b96beb2420c165ea36ec6f",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-P7SNYPNMXK",
};

/** Only these email domains may sign in. Mirrored in firestore.rules and storage.rules. */
export const ALLOWED_DOMAIN = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? "carbontree.com"
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
