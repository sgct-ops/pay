"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { OrdersProvider, PayQueueProvider, useOrders } from "@/lib/store";
import { ALLOWED_DOMAIN } from "@/lib/firebase";
import { relativeTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Mark } from "@/components/Mark";
import { InstallHint } from "@/components/InstallHint";

const TABS = [
  { href: "/ledger", label: "Ledger", glyph: "▤" },
  { href: "/pay", label: "Pay", glyph: "◈" },
  { href: "/upload", label: "Upload", glyph: "↥" },
  { href: "/activity", label: "Activity", glyph: "◷" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return <Splash />;
  if (!user) return <SignIn />;

  return (
    <OrdersProvider>
      <PayQueueProvider>
        <div className="flex min-h-dvh flex-col">
          <Header />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-28 pt-4 sm:px-6 lg:pb-8">
            {children}
          </main>
          <MobileNav />
        </div>
      </PayQueueProvider>
    </OrdersProvider>
  );
}

/* -------------------------------------------------------------- header ---- */

function Header() {
  const { user, signOutNow } = useAuth();
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/ledger" className="flex items-center gap-2.5">
          <Mark size={26} />
          <span className="display text-[15px] font-semibold leading-none text-ink">
            Payout Desk
          </span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {TABS.map((t) => {
            const active = pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                  active
                    ? "bg-spruce text-white"
                    : "text-ink-2 hover:bg-sunk hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <SyncButton />
          <button
            onClick={() => void signOutNow()}
            title={`${user?.email} — sign out`}
            className="grid h-8 w-8 place-items-center rounded-full bg-slate-wash text-[11px] font-semibold text-slate transition hover:bg-slate hover:text-white"
          >
            {(user?.name || "?").slice(0, 1).toUpperCase()}
          </button>
        </div>
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------- sync ---- */

export function SyncButton() {
  const { refresh, refreshing, lastSyncedAt, orders } = useOrders();
  const now = useNow();

  // Six hours without a sync and the button starts asking to be pressed.
  const stale = lastSyncedAt > 0 && now - lastSyncedAt > 6 * 3600_000;

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
      <span
        className={`text-[13px] leading-none ${refreshing ? "animate-spin" : ""}`}
        aria-hidden
      >
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
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="grid grid-cols-4">
        {TABS.map((t) => {
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

/* ------------------------------------------------------------- sign in ---- */

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
