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
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import {
  ALLOWED_DOMAIN,
  getFirebaseAuth,
  googleProvider,
  initAnalytics,
  isAllowedEmail,
} from "@/lib/firebase";
import { resolveRole } from "@/lib/data/orders";
import { capabilities, type Capabilities, type Role } from "@/lib/roles";

export interface TeamUser {
  uid: string;
  email: string;
  name: string;
  photoUrl: string | null;
}

interface AuthValue {
  user: TeamUser | null;
  /** The role this session is acting with — `viewingAs` when an admin has switched. */
  role: Role;
  /** What the account actually is, regardless of any admin role switch. */
  realRole: Role;
  can: Capabilities;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOutNow: () => Promise<void>;
  /** Admin only: look at the app through another role's eyes. */
  viewAs: (role: Role | null) => void;
  viewingAs: Role | null;
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
  const [realRole, setRealRole] = useState<Role>("none");
  const [viewingAs, setViewingAs] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let auth: Auth;
    try {
      auth = getFirebaseAuth();
    } catch (e) {
      // A deployment whose Firebase variables never arrived. The message names
      // exactly which ones, and belongs on the sign-in screen — throwing here
      // would take the whole tree down and say nothing.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError((e as Error).message);
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        setUser(null);
        setRealRole("none");
        setViewingAs(null);
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
      const team = toTeamUser(u);
      void resolveRole(team.email).then((resolved) => {
        setRealRole(resolved);
        setError(null);
        setUser(team);
        setLoading(false);
        void initAnalytics();
      });
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

  // Only an admin may switch, and it changes what the screen offers — never
  // what the database allows. An admin working as accounts is still an admin to
  // the security rules, and everything is logged under their own address.
  const viewAs = useCallback(
    (next: Role | null) => setViewingAs(realRole === "admin" ? next : null),
    [realRole],
  );

  const role: Role = realRole === "admin" && viewingAs ? viewingAs : realRole;

  const value = useMemo(
    () => ({
      user,
      role,
      realRole,
      can: capabilities(role),
      loading,
      error,
      signIn,
      signOutNow,
      viewAs,
      viewingAs,
    }),
    [user, role, realRole, loading, error, signIn, signOutNow, viewAs, viewingAs],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
