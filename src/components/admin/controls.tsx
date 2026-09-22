"use client";

import type { ReactNode } from "react";
import { money } from "@/lib/format";

/**
 * The small parts the admin panel is built from.
 *
 * Every control carries a `hint` because a settings screen with bare labels is
 * a screen nobody dares touch. The hint says what the number *does* and, where
 * it matters, what zero means — an empty ceiling and a ceiling of zero are very
 * different things and the difference has to be on the screen, not in a README.
 */

export function Section({
  title,
  blurb,
  children,
  aside,
}: {
  title: string;
  blurb?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-card">
      <header className="flex flex-wrap items-start gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-[200px] flex-1">
          <h2 className="display text-[14px] font-semibold text-ink">{title}</h2>
          {blurb && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{blurb}</p>}
        </div>
        {aside}
      </header>
      <div className="space-y-4 px-4 py-4">{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function MoneyField({
  label,
  hint,
  value,
  onChange,
  zeroLabel = "No limit",
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
  zeroLabel?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</span>
        <span className="tnum text-[11.5px] text-ink-3">
          {value > 0 ? money(value) : zeroLabel}
        </span>
      </span>
      <div className="flex items-center rounded-lg border border-line bg-paper focus-within:border-spruce">
        <span className="pl-3 text-[13px] text-ink-3">₹</span>
        <input
          value={value === 0 ? "" : String(value)}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0))}
          inputMode="decimal"
          placeholder="0"
          className="tnum w-full bg-transparent px-2 py-2 text-[13px] focus:outline-none"
        />
      </div>
      <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-3">{hint}</span>
    </label>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <div className="flex items-center rounded-lg border border-line bg-paper focus-within:border-spruce">
        <input
          value={String(value)}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/[^0-9]/g, ""));
            onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);
          }}
          inputMode="numeric"
          className="tnum w-full bg-transparent px-3 py-2 text-[13px] focus:outline-none"
        />
        {suffix && <span className="pr-3 text-[12px] text-ink-3">{suffix}</span>}
      </div>
      <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-3">
        {hint} Between {min} and {max}.
      </span>
    </label>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.06em] text-ink-3">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] focus:border-spruce focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
      />
      <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-3">{hint}</span>
    </label>
  );
}

export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-paper px-3 py-2.5">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded-[3px] accent-[#2f6b4f]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-2">{hint}</span>
      </span>
    </label>
  );
}

export function Note({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <p className={`rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed ${TONES[tone]}`}>
      {children}
    </p>
  );
}

type Tone = "plain" | "warn" | "bad" | "good";

const TONES: Record<Tone, string> = {
  plain: "border-line bg-sunk/60 text-ink-2",
  warn: "border-gold/30 bg-gold-wash text-gold",
  bad: "border-clay/30 bg-clay-wash text-clay",
  good: "border-spruce/25 bg-spruce-wash text-spruce",
};

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "bad";
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.07em] text-ink-3">{label}</div>
      <div
        className={`tnum display mt-1 text-[18px] font-semibold ${
          tone === "bad" ? "text-clay" : tone === "warn" ? "text-gold" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export function SecondaryButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] font-medium text-ink-2 transition hover:border-spruce hover:text-spruce disabled:opacity-40"
    >
      {children}
    </button>
  );
}
