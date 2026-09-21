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

/** Admin only. Who is allowed in, and which half of the job they do. */
export function People() {
  const { user, can } = useAuth();
  const [rows, setRows] = useState<RoleRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRoleChoice] = useState<RoleRecord["role"]>("ops");

  const fetchAll = useCallback(async () => {
    try {
      setRows(await listRoles());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  if (!can.manageRoles) {
    return (
      <p className="rounded-card border border-line bg-card px-5 py-10 text-center text-[13px] text-ink-2">
        Only an admin can change roles.
      </p>
    );
  }

  const add = async () => {
    const value = email.trim().toLowerCase();
    if (!value.endsWith(`@${ALLOWED_DOMAIN}`)) {
      setError(`Only @${ALLOWED_DOMAIN} addresses can be given a role.`);
      return;
    }
    if (!user) return;
    setError(null);
    try {
      await setRole(value, role, null, { uid: user.uid, email: user.email, role: "admin" });
      setEmail("");
      await fetchAll();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Addresses that work today because they are seeded in code, and have no
  // stored record yet. Showing them stops the screen looking empty and wrong.
  const stored = new Set((rows ?? []).map((r) => r.email));
  const seeded = Object.entries(DEFAULT_ROLES).filter(([e]) => !stored.has(e));

  return (
    <div className="mx-auto max-w-[820px] space-y-5 pb-10">
      <header>
        <h1 className="display text-[19px] font-semibold text-ink">People &amp; roles</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Operations verifies and approves. Accounts pays what has been approved. Neither can do
          the other&rsquo;s step, and that is enforced by the database rather than by these screens.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {ASSIGNABLE_ROLES.map((r) => (
          <div key={r} className="rounded-card border border-line bg-card px-4 py-3">
            <div className="display text-[13px] font-semibold text-ink">{ROLE_LABELS[r]}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{ROLE_BLURBS[r]}</p>
          </div>
        ))}
      </div>

      <div className="rounded-card border border-line bg-card p-4">
        <h2 className="display text-[13px] font-semibold text-ink">Add someone</h2>
        <div className="mt-3 flex flex-wrap gap-2">
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
            disabled={!email.trim()}
            className="rounded-lg bg-spruce px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-spruce-deep disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {error && <p className="mt-2 text-[12.5px] text-clay">{error}</p>}
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card">
        {loading && <p className="px-4 py-6 text-[13px] text-ink-3">Loading…</p>}

        {seeded.map(([seededEmail, seededRole]) => (
          <div
            key={seededEmail}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 text-[12.5px] last:border-0"
          >
            <span className="min-w-0 flex-1 truncate text-ink">{seededEmail}</span>
            <span className="rounded bg-slate-wash px-2 py-0.5 text-[11px] font-medium text-slate">
              {ROLE_LABELS[seededRole as Role]}
            </span>
            <span className="text-[11.5px] text-ink-3">
              {seededEmail === FIXED_ADMIN ? "owner, fixed in code" : "built-in default"}
            </span>
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
              onChange={async (e) => {
                if (!user) return;
                await setRole(r.email, e.target.value as RoleRecord["role"], r.name, {
                  uid: user.uid,
                  email: user.email,
                  role: "admin",
                });
                await fetchAll();
              }}
              disabled={r.email === FIXED_ADMIN}
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
            {r.email !== FIXED_ADMIN && (
              <button
                onClick={async () => {
                  if (!user) return;
                  await removeRole(r.email, {
                    uid: user.uid,
                    email: user.email,
                    role: "admin",
                  });
                  await fetchAll();
                }}
                className="text-[12px] text-ink-3 hover:text-clay"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-[12px] leading-relaxed text-ink-3">
        Removing someone here stops them acting, but they can still sign in with a company Google
        account and will see a &ldquo;no role&rdquo; screen. To stop that entirely, remove their
        Google Workspace account. The owner address ({FIXED_ADMIN}) is pinned in the code and in the
        security rules so this screen can never lock you out.
      </p>
    </div>
  );
}
