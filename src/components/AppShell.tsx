"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { OrdersProvider, PayQueueProvider, useOrders } from "@/lib/store";
import { SettingsProvider, useSettings } from "@/lib/settings-context";
import { ALLOWED_DOMAIN } from "@/lib/firebase";
import { ASSIGNABLE_ROLES, ROLE_LABELS, homeFor, type Role } from "@/lib/roles";
import { relativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Mark } from "@/components/Mark";
import { InstallHint } from "@/components/InstallHint";

interface Tab {
  href: string;
  label: string;
  glyph: string;
}

/** The navigation is the clearest statement of what a role's job is. */
function tabsFor(role: Role): Tab[] {
  const ledger = { href: "/ledger", label: "Verify", glyph: "▤" };
  const refunds = { href: "/refunds", label: "Refunds", glyph: "₹" };
  const pay = { href: "/pay", label: "Pay", glyph: "◈" };
  const upload = { href: "/upload", label: "Upload", glyph: "↥" };
  const activity = { href: "/activity", label: "Activity", glyph: "◷" };

  if (role === "ops") return [ledger, upload, activity];
  if (role === "accounts") return [refunds, pay, activity];
  if (role === "admin") return [ledger, refunds, pay, upload, activity];
  return [];
}

/**
 * Admin is deliberately not in tabsFor.
 *
 * The tab bar is the statement of what a role's job is, and nobody's job is
 * "administer the desk" — it is a thing you go and do occasionally. It sits in
 * the avatar menu, where it is reachable on a phone, and gets a quiet link on
 * the wide nav so an admin at a laptop is one click away.
 */
const ADMIN_TAB: Tab = { href: "/admin", label: "Admin", glyph: "⚙" };

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, role } = useAuth();

  if (loading) return <Splash />;
  if (!user) return <SignIn />;
  if (role === "none") return <NoRole />;

  return (
    <SettingsProvider>
      <OrdersProvider>
        <PayQueueProvider>
        {/* A fixed-height app shell rather than a scrolling page: the header and
            the tab bar stay put, and a screen that says it fits one viewport
            actually does. */}
          <div className="flex h-dvh flex-col overflow-hidden">
            <Header />
            <main className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto h-full w-full max-w-[1400px] px-4 py-4 sm:px-6">
                {children}
              </div>
            </main>
            <MobileNav />
          </div>
        </PayQueueProvider>
      </OrdersProvider>
    </SettingsProvider>
  );
}

/* -------------------------------------------------------------- header ---- */

function Header() {
  const { user, role, realRole, viewingAs, viewAs, signOutNow } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);

  return (
    <header className="shrink-0 border-b border-line bg-paper">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
        <Link href={homeFor(role)} className="flex items-center gap-2.5">
          <Mark size={26} />
          <span className="display text-[15px] font-semibold leading-none text-ink">
            Payout Desk
          </span>
        </Link>

        <span
          className={`hidden rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline ${
            viewingAs ? "bg-gold-wash text-gold" : "bg-slate-wash text-slate"
          }`}
          title={viewingAs ? `You are ${ROLE_LABELS[realRole]}, viewing as ${ROLE_LABELS[role]}` : undefined}
        >
          {ROLE_LABELS[role]}
          {viewingAs && " (acting)"}
        </span>

        <nav className="ml-3 hidden items-center gap-1 lg:flex">
          {[...tabsFor(role), ...(realRole === "admin" ? [ADMIN_TAB] : [])].map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                  active ? "bg-spruce text-white" : "text-ink-2 hover:bg-sunk hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="relative ml-auto flex items-center gap-2">
          <SyncButton />
          <button
            onClick={() => setMenu((v) => !v)}
            title={user?.email}
            className="grid h-8 w-8 place-items-center rounded-full bg-slate-wash text-[11px] font-semibold text-slate transition hover:bg-slate hover:text-white"
          >
            {(user?.name || "?").slice(0, 1).toUpperCase()}
          </button>

          {menu && (
            <>
              <button
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setMenu(false)}
                aria-label="Close menu"
              />
              <div className="absolute right-0 top-10 z-50 w-[248px] rounded-card border border-line bg-card p-1.5 shadow-[0_10px_30px_rgba(29,31,35,0.12)]">
                <div className="px-2.5 py-2">
                  <div className="truncate text-[12.5px] font-medium text-ink">{user?.name}</div>
                  <div className="truncate text-[11.5px] text-ink-3">{user?.email}</div>
                </div>

                {realRole === "admin" && (
                  <>
                    <div className="mt-1 border-t border-line-soft px-2.5 pb-1 pt-2 text-[11px] uppercase tracking-[0.06em] text-ink-3">
                      Work as
                    </div>
                    {(["admin", ...ASSIGNABLE_ROLES.filter((r) => r !== "admin")] as Role[]).map(
                      (r) => (
                        <button
                          key={r}
                          onClick={() => {
                            viewAs(r === "admin" ? null : r);
                            setMenu(false);
                            router.push(homeFor(r));
                          }}
                          className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition hover:bg-sunk ${
                            role === r ? "text-spruce" : "text-ink-2"
                          }`}
                        >
                          {ROLE_LABELS[r]}
                          {role === r && <span>✓</span>}
                        </button>
                      ),
                    )}
                    <Link
                      href="/admin"
                      onClick={() => setMenu(false)}
                      className="mt-1 block border-t border-line-soft px-2.5 py-2 text-[12.5px] text-ink-2 hover:text-ink"
                    >
                      Admin &mdash; people &amp; settings
                    </Link>
                  </>
                )}

                <button
                  onClick={() => void signOutNow()}
                  className="mt-1 w-full border-t border-line-soft px-2.5 py-2 text-left text-[12.5px] text-ink-2 hover:text-clay"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- sync ---- */

export function SyncButton() {
  const { refresh, refreshing, lastSyncedAt, orders } = useOrders();
  const { settings } = useSettings();
  const now = useNow();

  // Long enough without a sync and the button starts asking to be pressed.
  // How long is an admin's call — a desk that uploads weekly wants a different
  // answer from one that uploads daily.
  const stale = lastSyncedAt > 0 && now - lastSyncedAt > settings.syncStaleHours * 3600_000;

  return (
    <button
      onClick={() => void refresh()}
      disabled={refreshing}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-60 ${
        stale
          ? "border-gold bg-gold-wash text-gold"
          : "border-line bg-card text-ink-2 hover:border-spruce hover:text-spruce"
      }`}
    >
      <span className={`text-[13px] leading-none ${refreshing ? "animate-spin" : ""}`} aria-hidden>
        ↻
      </span>
      <span className="hidden sm:inline">
        {refreshing
          ? "Refreshing…"
          : lastSyncedAt
            ? `Synced ${relativeTime(lastSyncedAt, now)}`
            : "Never synced"}
      </span>
      <span className="tnum text-ink-3">{orders.length}</span>
    </button>
  );
}

/* ------------------------------------------------------------ mobile nav -- */

function MobileNav() {
  const pathname = usePathname();
  const { role } = useAuth();
  const tabs = tabsFor(role);

  return (
    <nav className="shrink-0 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
        {tabs.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition ${
                active ? "text-spruce" : "text-ink-3"
              }`}
            >
              <span className="text-[16px] leading-none" aria-hidden>
                {t.glyph}
              </span>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* --------------------------------------------------------- gate screens --- */

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex items-center gap-3 text-ink-3">
        <Mark size={24} />
        <span className="text-sm">Opening the desk…</span>
      </div>
    </div>
  );
}

function NoRole() {
  const { user, signOutNow } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="max-w-[420px] text-center">
        <div className="mb-4 flex justify-center">
          <Mark size={38} />
        </div>
        <h1 className="display text-[18px] font-semibold text-ink">No role yet</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">{user?.email}</span> is signed in but has not been
          given a role. Ask an admin to add you as operations or accounts on the admin panel.
        </p>
        <button
          onClick={() => void signOutNow()}
          className="mt-5 rounded-lg border border-line px-4 py-2 text-[13px] text-ink-2 hover:text-ink"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function SignIn() {
  const { signIn, error } = useAuth();

  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex items-center gap-3">
          <Mark size={38} />
          <div>
            <h1 className="display text-[20px] font-semibold leading-tight text-ink">
              CarbonTree Payout Desk
            </h1>
            <p className="text-[13px] text-ink-3">Manual UPI refunds, start to finish.</p>
          </div>
        </div>

        <div className="rounded-card border border-line bg-card p-6 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
          <p className="text-[14px] leading-relaxed text-ink-2">
            The ledger holds customer names, phone numbers and UPI handles, so it is closed to
            everyone outside the company. Sign in with your{" "}
            <span className="font-medium text-ink">@{ALLOWED_DOMAIN}</span> Google account.
          </p>

          <button
            onClick={() => void signIn()}
            className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-lg bg-spruce px-4 py-3 text-[14px] font-semibold text-white transition hover:bg-spruce-deep"
          >
            <GoogleGlyph />
            Continue with Google
          </button>

          {error && (
            <p className="mt-4 rounded-lg border border-clay/30 bg-clay-wash px-3 py-2.5 text-[13px] text-clay">
              {error}
            </p>
          )}
        </div>

        <InstallHint />
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9Z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.8-2 13.3-5.2l-6.2-5.2C29.1 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44Z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C37 40.2 44 35 44 24c0-1.3-.1-2.6-.4-3.9Z"
      />
    </svg>
  );
}

/** Sends a signed-in user to the screen their role actually starts at. */
export function RoleHome() {
  const { role, loading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(homeFor(role));
  }, [loading, user, role, router]);

  return null;
}
