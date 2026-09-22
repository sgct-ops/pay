"use client";

import { useCallback, useEffect, useState } from "react";
import { listRoles, removeRole, setRole } from "@/lib/data/orders";
import type { RoleRecord } from "@/lib/sheet/types";
import { useAuth } from "@/lib/auth-context";
import {
  ASSIGNABLE_ROLES,
  DEFAULT_ROLES,
  FIXED_ADMIN,
  ROLE_BLURBS,
  ROLE_LABELS,
  type Role,
} from "@/lib/roles";
import { ALLOWED_DOMAIN } from "@/lib/firebase";
import { shortDate } from "@/lib/format";
import { Note, Section } from "@/components/admin/controls";

/** Who is allowed in, and which half of the job they do. */
export function PeopleTab() {
  const { user } = useAuth();
  const [rows, setRows] = useState<RoleRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRoleChoice] = useState<RoleRecord["role"]>("ops");
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setRows(await listRoles());
      setError(null);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!value.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`Only @${ALLOWED_DOMAIN} addresses can be given a role.`);
      return;
    }
    if (!user) return;
    setError(null);
    setBusy(value);
    try {
      await setRole(value, role, null, { uid: user.uid, email: user.email, role: "admin" });
      setEmail("");
      await fetchAll();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const change = async (target: string, next: RoleRecord["role"], name: string | null) => {
    if (!user) return;
    setBusy(target);
    setError(null);
    try {
      await setRole(target, next, name, { uid: user.uid, email: user.email, role: "admin" });
      await fetchAll();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const drop = async (target: string) => {
    if (!user) return;
    setBusy(target);
    setError(null);
    try {
      await removeRole(target, { uid: user.uid, email: user.email, role: "admin" });
      setConfirming(null);
      await fetchAll();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  };

  // Addresses that work today because they are seeded in code and have no
  // stored record yet. Showing them stops the screen looking empty and wrong.
  const stored = new Set((rows ?? []).map((r) => r.email));
  const seeded = Object.entries(DEFAULT_ROLES).filter(([e]) => !stored.has(e));
  const admins =
    (rows ?? []).filter((r) => r.role === "admin").length +
    seeded.filter(([, r]) => r === "admin").length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {ASSIGNABLE_ROLES.map((r) => (
          <div key={r} className="rounded-card border border-line bg-card px-4 py-3">
            <div className="display text-[13px] font-semibold text-ink">{ROLE_LABELS[r]}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{ROLE_BLURBS[r]}</p>
          </div>
        ))}
      </div>

      <Section
        title="Add someone"
        blurb={`They also need a Google account on @${ALLOWED_DOMAIN}. Adding them here decides which desk they land on; it does not create the account.`}
      >
        <div className="flex flex-wrap gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder={`name@${ALLOWED_DOMAIN}`}
            className="min-w-[200px] flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] focus:border-spruce focus:outline-none"
          />
          <select
            value={role}
            onChange={(e) => setRoleChoice(e.target.value as RoleRecord["role"])}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-[13px] focus:border-spruce focus:outline-none"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <button
            onClick={() => void add()}
            disabled={!email.trim() || busy !== null}
            className="rounded-lg bg-spruce px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-spruce-deep disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {role === "admin" && (
          <Note tone="warn">
            An admin can do both desks and change these roles. The ops/accounts split only means
            something while most people are on one side of it.
          </Note>
        )}
        {error && <Note tone="bad">{error}</Note>}
      </Section>

      <Section
        title="Who has access"
        blurb="Changing a role takes effect the next time that person's app resolves it — a reload, or their next sign-in."
        aside={
          <span className="rounded-full bg-slate-wash px-2.5 py-1 text-[11.5px] font-medium text-slate">
            {admins} admin{admins === 1 ? "" : "s"}
          </span>
        }
      >
        <div className="overflow-hidden rounded-lg border border-line">
          {loading && <p className="px-4 py-6 text-[13px] text-ink-3">Loading…</p>}

          {seeded.map(([seededEmail, seededRole]) => (
            <div
              key={seededEmail}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft bg-sunk/40 px-4 py-3 text-[12.5px] last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-ink">{seededEmail}</span>
              <span className="rounded bg-slate-wash px-2 py-0.5 text-[11px] font-medium text-slate">
                {ROLE_LABELS[seededRole as Role]}
              </span>
              <span className="text-[11.5px] text-ink-3">
                {seededEmail === FIXED_ADMIN ? "owner, fixed in code" : "built-in default"}
              </span>
              {seededEmail !== FIXED_ADMIN && (
                <button
                  onClick={() => void change(seededEmail, seededRole as RoleRecord["role"], null)}
                  disabled={busy !== null}
                  title="Write this default into the database so it can be edited or removed"
                  className="text-[12px] text-ink-3 underline hover:text-spruce disabled:opacity-40"
                >
                  Make editable
                </button>
              )}
            </div>
          ))}

          {(rows ?? []).map((r) => (
            <div
              key={r.email}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 text-[12.5px] last:border-0"
            >
              <span className="min-w-0 flex-1 truncate text-ink">{r.email}</span>
              <select
                value={r.role}
                onChange={(e) => void change(r.email, e.target.value as RoleRecord["role"], r.name)}
                disabled={r.email === FIXED_ADMIN || busy !== null}
                className="rounded-md border border-line bg-paper px-2 py-1 text-[12px] disabled:opacity-50"
              >
                {ASSIGNABLE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABELS[option]}
                  </option>
                ))}
              </select>
              <span className="text-[11.5px] text-ink-3">
                added by {r.addedBy} · {shortDate(r.addedAt)}
              </span>
              {r.email !== FIXED_ADMIN &&
                (confirming === r.email ? (
                  <span className="flex items-center gap-2">
                    <button
                      onClick={() => void drop(r.email)}
                      disabled={busy !== null}
                      className="rounded bg-clay px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-40"
                    >
                      Remove
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="text-[12px] text-ink-3 hover:text-ink"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirming(r.email)}
                    className="text-[12px] text-ink-3 hover:text-clay"
                  >
                    Remove
                  </button>
                ))}
            </div>
          ))}

          {!loading && !seeded.length && !(rows ?? []).length && (
            <p className="px-4 py-6 text-[13px] text-ink-3">Nobody has a stored role yet.</p>
          )}
        </div>

        <Note>
          Removing someone here stops them acting, but they can still sign in with a company Google
          account and will see a &ldquo;no role&rdquo; screen. To stop that entirely, remove their
          Google Workspace account. The owner address ({FIXED_ADMIN}) is pinned in the code and in
          the security rules, so this screen can never lock you out.
        </Note>
      </Section>
    </div>
  );
}

function friendly(e: unknown): string {
  const code = (e as { code?: string }).code ?? "";
  if (code === "permission-denied") {
    return "Firestore refused that. Either the rules are not deployed, or you are not signed in as an admin.";
  }
  if (code === "unavailable") {
    return "Could not reach Firestore. Roles are read from the server, so this needs a connection.";
  }
  return (e as Error).message || "Something went wrong.";
}
