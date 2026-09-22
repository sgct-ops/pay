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
import { saveSettings, watchSettings } from "@/lib/data/settings";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth-context";

interface SettingsValue {
  settings: AppSettings;
  /** False until the first snapshot lands. The app renders with defaults meanwhile. */
  ready: boolean;
  /**
   * Set when the settings document could not be read — almost always because
   * the rules have not been deployed. The desk keeps working on defaults; this
   * is surfaced on the admin panel rather than shoved in front of everyone.
   */
  error: string | null;
  save: (next: AppSettings) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

/**
 * Desk settings, live.
 *
 * Deliberately never blocks a render. If the document is missing, unreadable
 * or still loading, every consumer gets DEFAULT_SETTINGS — which is what the
 * app did before settings existed. A payout desk that will not open because a
 * configuration document is slow is a worse outcome than one running on its
 * defaults.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user, realRole } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = watchSettings(
      (next) => {
        setSettings(next);
        setReady(true);
        setError(null);
      },
      (e) => {
        setReady(true);
        setError(
          (e as { code?: string }).code === "permission-denied"
            ? "Firestore refused to read the settings document, so the desk is running on its built-in defaults. Deploy firestore.rules."
            : e.message,
        );
      },
    );
    return unsub;
  }, [user]);

  const save = useCallback(
    async (next: AppSettings) => {
      if (!user || realRole !== "admin") {
        throw new Error("Only an admin can change desk settings.");
      }
      await saveSettings(settings, next, {
        uid: user.uid,
        email: user.email,
        role: realRole,
      });
      // The snapshot listener will deliver the saved version; setting it here
      // too means the form stops looking dirty the moment the write lands
      // rather than a round trip later.
      setSettings({ ...next, updatedAt: Date.now(), updatedByEmail: user.email });
    },
    [user, realRole, settings],
  );

  const value = useMemo(
    () => ({ settings, ready, error, save }),
    [settings, ready, error, save],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside <SettingsProvider>");
  return ctx;
}
