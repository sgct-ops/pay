"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import {
  ALLOWED_DOMAIN,
  getFirebaseAuth,
  googleProvider,
  initAnalytics,
  isAllowedEmail,
} from "@/lib/firebase";

export interface TeamUser {
  uid: string;
  email: string;
  name: string;
  photoUrl: string | null;
}

interface AuthValue {
  user: TeamUser | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOutNow: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function toTeamUser(user: User): TeamUser {
  return {
    uid: user.uid,
    email: (user.email || "").toLowerCase(),
    name: user.displayName || user.email || "Unknown",
    photoUrl: user.photoURL,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TeamUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUser(null);
        setLoading(false);
        return;
      }
      // Belt and braces: the `hd` parameter is only a hint to Google, and the
      // rules are the real gate. This stops a wrong account ever seeing a
      // half-rendered ledger before the rules reject its reads.
      if (!isAllowedEmail(u.email)) {
        setError(`${u.email} is not a @${ALLOWED_DOMAIN} account.`);
        setUser(null);
        void signOut(auth);
        setLoading(false);
        return;
      }
      setError(null);
      setUser(toTeamUser(u));
      setLoading(false);
      void initAnalytics();
    });
    return unsub;
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      const auth = getFirebaseAuth();
      const cred = await signInWithPopup(auth, googleProvider());
      if (!isAllowedEmail(cred.user.email)) {
        await signOut(auth);
        setError(`${cred.user.email} is not a @${ALLOWED_DOMAIN} account.`);
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
      setError(
        code === "auth/popup-blocked"
          ? "Your browser blocked the sign-in window. Allow pop-ups for this site and try again."
          : (e as Error).message,
      );
    }
  }, []);

  const signOutNow = useCallback(async () => {
    await signOut(getFirebaseAuth());
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, signIn, signOutNow }),
    [user, loading, error, signIn, signOutNow],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
