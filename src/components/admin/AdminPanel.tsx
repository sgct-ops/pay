"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import {
  DEFAULT_SETTINGS,
  settingsChanged,
  settingsProblems,
  type AppSettings,
} from "@/lib/settings";
import { relativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { PeopleTab } from "@/components/admin/PeopleTab";
import { PayoutsTab } from "@/components/admin/PayoutsTab";
import { TransformTab } from "@/components/admin/TransformTab";
import { PaymentsTab } from "@/components/admin/PaymentsTab";
import { DataTab } from "@/components/admin/DataTab";

export type AdminTab = "overview" | "people" | "payouts" | "transform" | "payments" | "data";

const TABS: Array<{ id: AdminTab; label: string; blurb: string }> = [
  { id: "overview", label: "Overview", blurb: "What the desk is doing, and the rules in force." },
  { id: "people", label: "People", blurb: "Who is allowed in, and which desk they work." },
  { id: "payouts", label: "Payouts", blurb: "Ceilings and checks on what may be approved." },
  { id: "transform", label: "Transform", blurb: "How an export becomes a list of payouts." },
  { id: "payments", label: "Payments", blurb: "The note on the money, and which app opens." },
  { id: "data", label: "Data", blurb: "The ledger, the audit trail, exports and sync." },
];

function isTab(value: string | null): value is AdminTab {
  return TABS.some((t) => t.id === value);
}

/**
 * The admin panel.
 *
 * One draft, one save. Every settings tab edits the same in-memory copy and
 * nothing is written until Save is pressed — a guardrail that took effect
 * halfway through being typed would be worse than no guardrail, and switching
 * tabs to check a related figure should not silently commit the first one.
 *
 * People is the exception: role changes write immediately, because they are
 * individually meaningful and each one is its own audit entry.
 */
export function AdminPanel() {
  const { can, realRole } = useAuth();
  const { settings, ready, save } = useSettings();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const now = useNow();

  const requested = params.get("tab");
  const tab: AdminTab = isTab(requested) ? requested : "overview";

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [baseline, setBaseline] = useState<AppSettings>(settings);

  // Adopt what the server has, but never over the top of someone's unsaved
  // edits — an admin typing a ceiling while a colleague saves a different one
  // should keep what they typed and be told, not have it vanish mid-keystroke.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBaseline(settings);
    setDraft((current) => (settingsChanged(current, baseline) ? current : settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const patch = useCallback((change: Partial<AppSettings>) => {
    setError(null);
    setSavedAt(null);
    setDraft((current) => ({ ...current, ...change }));
  }, []);

  const go = useCallback(
    (next: AdminTab) => router.replace(`${pathname}?tab=${next}`, { scroll: false }),
    [router, pathname],
  );

  const dirty = settingsChanged(draft, settings);
  const problems = useMemo(() => settingsProblems(draft), [draft]);
  const conflicted = dirty && settingsChanged(settings, baseline);

  const commit = async () => {
    if (problems.length) return;
    setSaving(true);
    setError(null);
    try {
      await save(draft);
      setSavedAt(Date.now());
    } catch (e) {
      setError(friendly(e));
    } finally {
      setSaving(false);
    }
  };

  if (!can.manageRoles) {
    return (
      <div className="mx-auto max-w-[520px] rounded-card border border-line bg-card px-6 py-12 text-center">
        <h1 className="display text-[16px] font-semibold text-ink">Admin only</h1>
        <p className="mx-auto mt-2 max-w-[380px] text-[13px] leading-relaxed text-ink-2">
          {realRole === "admin"
            ? "You are working as another role. Switch back to Admin in the avatar menu to open this panel."
            : "This panel changes who has access and the rules money moves under. Ask an admin if you need something changed."}
        </p>
      </div>
    );
  }

  const active = TABS.find((t) => t.id === tab)!;
  const editsSettings = tab !== "people" && tab !== "overview";

  return (
    <div className="mx-auto max-w-[1040px] space-y-4 pb-28">
      <header>
        <h1 className="display text-[19px] font-semibold text-ink">Admin</h1>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">
          Access, and the rules the desk runs on. Guardrails set here are enforced by the database,
          not just by these screens — so are the limits of this panel.
        </p>
      </header>

      {/* Horizontal scroll rather than a wrap: six tabs that reflow to two rows
          on a phone move under the thumb between renders. */}
      <nav className="-mx-1 overflow-x-auto px-1">
        <div className="flex w-max gap-1 rounded-lg border border-line bg-card p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
              title={t.blurb}
              className={`whitespace-nowrap rounded-[6px] px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                tab === t.id ? "bg-spruce text-white" : "text-ink-2 hover:bg-sunk hover:text-ink"
              }`}
            >
              {t.label}
              {t.id !== "people" && t.id !== "overview" && dirty && (
                <span className="ml-1.5 text-gold" aria-label="unsaved changes">
                  •
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <p className="px-1 text-[12.5px] text-ink-3">{active.blurb}</p>

      {!ready && editsSettings && (
        <p className="rounded-card border border-line bg-card px-4 py-3 text-[13px] text-ink-3">
          Reading settings…
        </p>
      )}

      {tab === "overview" && <OverviewTab go={go} />}
      {tab === "people" && <PeopleTab />}
      {tab === "payouts" && <PayoutsTab draft={draft} patch={patch} />}
      {tab === "transform" && <TransformTab draft={draft} patch={patch} />}
      {tab === "payments" && <PaymentsTab draft={draft} saved={settings} patch={patch} />}
      {tab === "data" && <DataTab draft={draft} patch={patch} />}

      {savedAt && !dirty && (
        <p className="rounded-card border border-spruce/25 bg-spruce-wash px-4 py-2.5 text-[12.5px] text-spruce">
          Saved {relativeTime(savedAt, now)}. Everyone&rsquo;s app picks this up without a reload.
        </p>
      )}

      {(dirty || error) && (
        <div className="fixed inset-x-0 bottom-[60px] z-30 px-3 lg:bottom-4">
          <div className="mx-auto max-w-[860px] rounded-card border border-line bg-card px-4 py-3 shadow-[0_8px_24px_rgba(29,31,35,0.12)]">
            {conflicted && (
              <p className="mb-2 rounded-lg border border-gold/30 bg-gold-wash px-3 py-2 text-[12px] text-gold">
                Someone else changed these settings while you were editing. Saving replaces their
                version with yours — reload the page first if you would rather keep theirs.
              </p>
            )}
            {problems.map((p) => (
              <p
                key={p}
                className="mb-2 rounded-lg border border-clay/30 bg-clay-wash px-3 py-2 text-[12px] text-clay"
              >
                {p}
              </p>
            ))}
            {error && (
              <p className="mb-2 rounded-lg border border-clay/30 bg-clay-wash px-3 py-2 text-[12px] text-clay">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[12.5px] text-ink-2">
                {dirty ? "Unsaved changes" : "Nothing to save"}
              </span>
              <button
                onClick={() => setDraft(DEFAULT_SETTINGS)}
                className="text-[12px] text-ink-3 hover:text-ink"
                title="Put every setting back to the value the app ships with. Still has to be saved."
              >
                Reset all to defaults
              </button>
              <button
                onClick={() => {
                  setDraft(settings);
                  setError(null);
                }}
                className="ml-auto rounded-lg border border-line px-3 py-2 text-[12.5px] font-medium text-ink-2 hover:text-ink"
              >
                Discard
              </button>
              <button
                onClick={() => void commit()}
                disabled={saving || !dirty || problems.length > 0}
                className="rounded-lg bg-spruce px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-spruce-deep disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function friendly(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code === "permission-denied") {
    return "Firestore refused the write. Deploy firestore.rules — the settings document needs the admin-only rule that ships with it.";
  }
  if (code === "unavailable") {
    return "Could not reach Firestore. The change is queued and will save when the connection returns.";
  }
  return (e as Error).message || "The save failed.";
}
