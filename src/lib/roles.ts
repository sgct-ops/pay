/**
 * Who can do what.
 *
 * The split is the point: ops decides *whether* a refund is owed and for how
 * much, accounts decides *when the money leaves*. Neither does the other's
 * step, so a wrong amount has to get past two people rather than one.
 *
 * These names are mirrored in firestore.rules, which is where they are actually
 * enforced. Anything here is convenience for the UI; the database is the gate.
 */

export type Role = "admin" | "ops" | "accounts" | "none";

/**
 * Seeded so the app is usable before anyone touches the roles screen — and so
 * the admin can never be locked out of their own project by a bad edit.
 * firestore.rules pins the admin address the same way.
 */
export const FIXED_ADMIN = "shantanu@carbontree.com";

export const DEFAULT_ROLES: Record<string, Role> = {
  [FIXED_ADMIN]: "admin",
  "operations@carbontree.com": "ops",
  // Two addresses share the accounts desk. Both can pay; neither can approve.
  "accounts@carbontree.com": "accounts",
  "contact@carbontree.com": "accounts",
};

export interface Capabilities {
  /** Upload a Return Prime export. */
  upload: boolean;
  /** Approve, hold, reject, and correct a UPI handle or amount. */
  verify: boolean;
  /** Build QRs and mark refunds paid. */
  pay: boolean;
  /** Add and remove people, and change their role. */
  manageRoles: boolean;
  /** See every order, including ones still pending or rejected. */
  seeUnapproved: boolean;
}

const NONE: Capabilities = {
  upload: false,
  verify: false,
  pay: false,
  manageRoles: false,
  seeUnapproved: false,
};

export function capabilities(role: Role): Capabilities {
  switch (role) {
    case "admin":
      return { upload: true, verify: true, pay: true, manageRoles: true, seeUnapproved: true };
    case "ops":
      return { ...NONE, upload: true, verify: true, seeUnapproved: true };
    case "accounts":
      // Deliberately no verify and no upload. Accounts sees approved refunds
      // only, and sees the amount as read-only — if it looks wrong it goes back
      // to ops rather than being fixed at the moment of payment.
      return { ...NONE, pay: true };
    default:
      return NONE;
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  ops: "Operations",
  accounts: "Accounts",
  none: "No access",
};

export const ROLE_BLURBS: Record<Role, string> = {
  admin: "Everything, plus roles and the full audit trail.",
  ops: "Uploads exports, verifies orders, approves what should be refunded.",
  accounts: "Refunds what operations has approved. Cannot change amounts.",
  none: "Signed in, but not yet given a role.",
};

export const ASSIGNABLE_ROLES: Role[] = ["ops", "accounts", "admin"];

/** Where a role starts. Someone with no role is caught by the shell, not routed. */
export function homeFor(role: Role): string {
  return role === "accounts" ? "/refunds" : "/ledger";
}
