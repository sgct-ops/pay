/**
 * Desk settings — the things an admin can change without a redeploy.
 *
 * Every value here started life as a constant somewhere in the code. Moving it
 * into a document does not make it less important; it makes it *visible*, and
 * changeable by the person who actually owns the decision rather than by
 * whoever is next to touch the repository.
 *
 * Two rules govern what belongs in here:
 *
 *   1. Nothing that weakens the ops/accounts split. That split is the point of
 *      the app and is pinned in firestore.rules. No setting can grant accounts
 *      the ability to approve, or ops the ability to pay.
 *   2. A setting that guards money is enforced in firestore.rules as well as
 *      here. The functions in this file are what the screens use to explain
 *      themselves; the database is what refuses.
 *
 * The defaults reproduce exactly what the app did before any of this existed,
 * so a project with no settings document behaves as it always has.
 */

import { DEFAULT_EXCLUSIONS, DEFAULT_STAGES, type ExclusionRule } from "@/lib/sheet/types";

export interface AppSettings {
  /* ---- payout guardrails -------------------------------------------- */

  /**
   * The largest refund operations may approve. 0 means no ceiling.
   * Enforced in firestore.rules, so a session that skipped the UI is refused.
   */
  maxRefundAmount: number;
  /** Above this, the ledger colours the amount and says so. 0 turns it off. */
  warnRefundAmount: number;
  /** Above this, an approval must carry a written reason. 0 turns it off. */
  approvalNoteAbove: number;
  /**
   * Refuse to approve an order whose goods never reached the warehouse.
   * A cancelled shipment that still carries a handle is the classic way to pay
   * for a return that never arrived.
   */
  blockCancelledShipment: boolean;

  /* ---- the transform ------------------------------------------------- */

  /** Return stages the upload screen ticks by default. */
  defaultStages: string[];
  /** Line notes that mean "not a payout". */
  exclusions: ExclusionRule[];

  /* ---- payment ------------------------------------------------------- */

  /** The tag every payout note must carry, so refunds are findable on a statement. */
  noteTag: string;
  /** UPI notes longer than this get truncated by some apps. */
  noteMaxLength: number;
  /** Which UPI app the pay desk opens by default, before a payer picks their own. */
  defaultUpiApp: string;
  /** Whether the pay desk may send money to a handle typed in by hand. */
  allowAdhocPayments: boolean;

  /* ---- data ---------------------------------------------------------- */

  /** Hours without a sync before the Refresh button starts asking to be pressed. */
  syncStaleHours: number;
  /** How many audit entries the Activity screen pulls. */
  auditPageSize: number;

  /* ---- provenance ---------------------------------------------------- */

  updatedAt: number | null;
  updatedByEmail: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  maxRefundAmount: 0,
  warnRefundAmount: 0,
  approvalNoteAbove: 0,
  blockCancelledShipment: false,

  defaultStages: [...DEFAULT_STAGES],
  exclusions: DEFAULT_EXCLUSIONS,

  noteTag: "CARBONTREE",
  noteMaxLength: 50,
  defaultUpiApp: "any",
  allowAdhocPayments: true,

  syncStaleHours: 6,
  auditPageSize: 200,

  updatedAt: null,
  updatedByEmail: null,
};

/* ------------------------------------------------------------ coercion ---- */

function num(value: unknown, fallback: number, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown, fallback: string, maxLength = 200): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v ? v.slice(0, maxLength) : fallback;
}

function stages(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)) : fallback;
}

function exclusions(value: unknown, fallback: ExclusionRule[]): ExclusionRule[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value.flatMap((raw): ExclusionRule[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = raw as Partial<ExclusionRule>;
    const phrase = typeof r.phrase === "string" ? r.phrase.trim() : "";
    if (!phrase) return [];
    return [
      {
        id: typeof r.id === "string" && r.id ? r.id : phrase.toLowerCase().replace(/\W+/g, "-"),
        phrase: phrase.slice(0, 80),
        reason: text(r.reason, "excluded by a desk rule", 80),
        wholeWord: bool(r.wholeWord, false),
        enabled: bool(r.enabled, true),
      },
    ];
  });
  // An empty array is a legitimate choice — it means "exclude nothing" — so it
  // is only the *absence* of the field that falls back to the defaults.
  return Array.isArray(value) ? cleaned : fallback;
}

/**
 * Turn whatever is in Firestore into a complete, sane AppSettings.
 *
 * Nothing here trusts the document. A half-written field, a string where a
 * number belongs, a settings doc from an older version of the app — all of it
 * resolves to the default rather than to NaN reaching a refund amount.
 */
export function mergeSettings(raw: unknown): AppSettings {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    maxRefundAmount: num(d.maxRefundAmount, DEFAULT_SETTINGS.maxRefundAmount, { max: 10_000_000 }),
    warnRefundAmount: num(d.warnRefundAmount, DEFAULT_SETTINGS.warnRefundAmount, {
      max: 10_000_000,
    }),
    approvalNoteAbove: num(d.approvalNoteAbove, DEFAULT_SETTINGS.approvalNoteAbove, {
      max: 10_000_000,
    }),
    blockCancelledShipment: bool(d.blockCancelledShipment, DEFAULT_SETTINGS.blockCancelledShipment),

    defaultStages: stages(d.defaultStages, DEFAULT_SETTINGS.defaultStages),
    exclusions:
      d.exclusions === undefined
        ? DEFAULT_SETTINGS.exclusions
        : exclusions(d.exclusions, DEFAULT_SETTINGS.exclusions),

    noteTag: text(d.noteTag, DEFAULT_SETTINGS.noteTag, 24).toUpperCase(),
    noteMaxLength: num(d.noteMaxLength, DEFAULT_SETTINGS.noteMaxLength, { min: 12, max: 120 }),
    defaultUpiApp: text(d.defaultUpiApp, DEFAULT_SETTINGS.defaultUpiApp, 24),
    allowAdhocPayments: bool(d.allowAdhocPayments, DEFAULT_SETTINGS.allowAdhocPayments),

    syncStaleHours: num(d.syncStaleHours, DEFAULT_SETTINGS.syncStaleHours, { min: 1, max: 336 }),
    auditPageSize: num(d.auditPageSize, DEFAULT_SETTINGS.auditPageSize, { min: 25, max: 1000 }),

    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : null,
    updatedByEmail: typeof d.updatedByEmail === "string" ? d.updatedByEmail : null,
  };
}

/* ---------------------------------------------------------- validation ---- */

/**
 * Reasons this draft should not be saved. Empty means it is fine.
 *
 * These catch the combinations that would be quietly self-defeating rather
 * than obviously wrong — a warn threshold above a hard cap can never fire, so
 * the person setting it has misunderstood one of the two fields.
 */
export function settingsProblems(s: AppSettings): string[] {
  const out: string[] = [];

  if (s.maxRefundAmount > 0 && s.warnRefundAmount > s.maxRefundAmount) {
    out.push(
      "The warning threshold is above the hard ceiling, so it could never fire. Put it below the ceiling.",
    );
  }
  if (s.maxRefundAmount > 0 && s.approvalNoteAbove > s.maxRefundAmount) {
    out.push(
      "Approvals above the ceiling are refused outright, so asking for a note above it has no effect.",
    );
  }
  if (!s.defaultStages.length) {
    out.push("At least one return stage has to be kept, or every upload reads as empty.");
  }
  if (!/^[A-Z0-9 _-]{3,24}$/.test(s.noteTag)) {
    out.push(
      "The payout tag has to be 3–24 characters of letters, digits, spaces, hyphens or underscores — it goes into a UPI note.",
    );
  }
  if (s.noteTag.length + 14 > s.noteMaxLength) {
    out.push(
      `A note of "${s.noteTag} #1234567" is already ${s.noteTag.length + 10} characters, so a limit of ${s.noteMaxLength} would reject ordinary payouts.`,
    );
  }
  const seen = new Set<string>();
  for (const rule of s.exclusions) {
    const key = rule.phrase.toLowerCase();
    if (seen.has(key)) out.push(`"${rule.phrase}" is listed twice as an exclusion.`);
    seen.add(key);
    if (rule.phrase.trim().length < 3) {
      out.push(
        `"${rule.phrase}" is too short to be an exclusion — a two-letter phrase matches half the notes in the export.`,
      );
    }
  }

  return out;
}

/** True when the draft differs from what is saved, ignoring provenance. */
export function settingsChanged(a: AppSettings, b: AppSettings): boolean {
  return JSON.stringify(withoutProvenance(a)) !== JSON.stringify(withoutProvenance(b));
}

function withoutProvenance(s: AppSettings) {
  const { updatedAt: _at, updatedByEmail: _by, ...rest } = s;
  void _at;
  void _by;
  return rest;
}

/** The fields that actually get written. Provenance is set by the writer. */
export function settingsPayload(s: AppSettings): Omit<AppSettings, "updatedAt" | "updatedByEmail"> {
  return withoutProvenance(s);
}

/**
 * A one-line summary of what changed, for the audit trail.
 *
 * A settings change that only says "settings changed" is not worth logging —
 * the whole reason to record it is so that, months later, someone can see that
 * the ceiling moved from ₹5,000 to ₹25,000 the week before a large payout.
 */
export function describeChange(before: AppSettings, after: AppSettings): string {
  const parts: string[] = [];
  const money = (n: number) => (n > 0 ? `₹${n.toLocaleString("en-IN")}` : "off");

  if (before.maxRefundAmount !== after.maxRefundAmount) {
    parts.push(`ceiling ${money(before.maxRefundAmount)} → ${money(after.maxRefundAmount)}`);
  }
  if (before.warnRefundAmount !== after.warnRefundAmount) {
    parts.push(`warn ${money(before.warnRefundAmount)} → ${money(after.warnRefundAmount)}`);
  }
  if (before.approvalNoteAbove !== after.approvalNoteAbove) {
    parts.push(`note required ${money(before.approvalNoteAbove)} → ${money(after.approvalNoteAbove)}`);
  }
  if (before.blockCancelledShipment !== after.blockCancelledShipment) {
    parts.push(`cancelled shipments ${after.blockCancelledShipment ? "blocked" : "allowed"}`);
  }
  if (before.defaultStages.join() !== after.defaultStages.join()) {
    parts.push(`stages ${after.defaultStages.join("+") || "none"}`);
  }
  if (JSON.stringify(before.exclusions) !== JSON.stringify(after.exclusions)) {
    const on = after.exclusions.filter((e) => e.enabled).length;
    parts.push(`${on} exclusion rule${on === 1 ? "" : "s"} active`);
  }
  if (before.noteTag !== after.noteTag) parts.push(`tag ${before.noteTag} → ${after.noteTag}`);
  if (before.noteMaxLength !== after.noteMaxLength) {
    parts.push(`note limit ${after.noteMaxLength}`);
  }
  if (before.defaultUpiApp !== after.defaultUpiApp) parts.push(`default app ${after.defaultUpiApp}`);
  if (before.allowAdhocPayments !== after.allowAdhocPayments) {
    parts.push(`ad-hoc payees ${after.allowAdhocPayments ? "on" : "off"}`);
  }
  if (before.syncStaleHours !== after.syncStaleHours) parts.push(`stale after ${after.syncStaleHours}h`);
  if (before.auditPageSize !== after.auditPageSize) parts.push(`audit page ${after.auditPageSize}`);

  return parts.join(" · ") || "no effective change";
}
