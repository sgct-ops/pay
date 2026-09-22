/**
 * The security rules, exercised against the real Firestore emulator.
 *
 * The rules are the only thing standing between an accounts session and an
 * amount it is not allowed to change, so "it compiled" is not the bar. Every
 * case below is a sentence from the README that would otherwise be a claim
 * rather than a fact.
 *
 * Run with:  npm run test:rules   (needs Java, which the emulator runs on)
 */

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const ADMIN = "shantanu@carbontree.com";
const OPS = "operations@carbontree.com";
const ACCOUNTS = "accounts@carbontree.com";
const OUTSIDER = "someone@gmail.com";

let passed = 0;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e.message?.split("\n")[0] ?? e}`);
  }
}

function user(env, email) {
  return env.authenticatedContext(email.replace(/\W/g, ""), {
    email,
    email_verified: true,
  }).firestore();
}

/** An order as the transform and the uploader would write it. */
function order(extra = {}) {
  return {
    orderKey: "42118",
    orderNumber: "42118",
    customerName: "Rahul Verma",
    customerPhone: "",
    customerEmail: "",
    upi: "rahul@okaxis",
    upis: ["rahul@okaxis"],
    upiClash: false,
    pieces: 1,
    total: 2625,
    skipped: 0,
    skippedTotal: 0,
    fees: 0,
    ships: [],
    shipRank: 0,
    approvedAt: null,
    receivedAt: null,
    weekStart: null,
    lines: [],
    keys: [],
    approval: "pending",
    approvalNote: null,
    approvalBy: null,
    approvalAt: null,
    upiOverride: null,
    amountOverride: null,
    correctedBy: null,
    correctedAt: null,
    paid: false,
    paidAt: null,
    paidByEmail: null,
    payFailedReason: null,
    batchIds: [],
    firstSeenAt: 0,
    updatedAt: new Date(),
    reopenedAt: null,
    ...extra,
  };
}

const env = await initializeTestEnvironment({
  projectId: "payout-rules-test",
  firestore: {
    rules: readFileSync("firestore.rules", "utf8"),
    host: "127.0.0.1",
    port: 8080,
  },
});

/** Put a document in place with the rules switched off. */
async function seed(path, data) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

console.log("\nWho gets in\n");

await check("an outside Google account is refused", async () => {
  await assertFails(getDoc(doc(user(env, OUTSIDER), "orders/42118")));
});

await check("an unverified company address is refused", async () => {
  const ctx = env
    .authenticatedContext("unverified", { email: OPS, email_verified: false })
    .firestore();
  await assertFails(getDoc(doc(ctx, "orders/42118")));
});

await check("a signed-out visitor is refused", async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "orders/42118")));
});

console.log("\nThe two-desk split\n");

await env.clearFirestore();
await seed("orders/42118", order());

await check("operations may approve", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/42118"),
      { approval: "approved", approvalBy: OPS, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("operations may NOT mark an order paid", async () => {
  await assertFails(
    setDoc(
      doc(user(env, OPS), "orders/42118"),
      { paid: true, paidAt: Date.now(), paidByEmail: OPS, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("accounts may pay an approved order", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, ACCOUNTS), "orders/42118"),
      { paid: true, paidAt: Date.now(), paidByEmail: ACCOUNTS, payFailedReason: null, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await env.clearFirestore();
await seed("orders/42118", order({ approval: "pending" }));

await check("accounts may NOT pay an order nobody approved", async () => {
  await assertFails(
    setDoc(
      doc(user(env, ACCOUNTS), "orders/42118"),
      { paid: true, paidAt: Date.now(), paidByEmail: ACCOUNTS, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("accounts may NOT approve", async () => {
  await assertFails(
    setDoc(
      doc(user(env, ACCOUNTS), "orders/42118"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await env.clearFirestore();
await seed("orders/42118", order({ approval: "approved" }));

await check("accounts may NOT raise the amount on the way to paying", async () => {
  await assertFails(
    setDoc(
      doc(user(env, ACCOUNTS), "orders/42118"),
      { paid: true, amountOverride: 99999, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("nobody deletes an order", async () => {
  await assertFails(deleteDoc(doc(user(env, ADMIN), "orders/42118")));
});

console.log("\nUploads\n");

await env.clearFirestore();

await check("an upload may not create an order already approved", async () => {
  await assertFails(
    setDoc(doc(user(env, OPS), "orders/50001"), order({ orderKey: "50001", approval: "approved" })),
  );
});

await check("an upload may not create an order already paid", async () => {
  await assertFails(
    setDoc(doc(user(env, OPS), "orders/50002"), order({ orderKey: "50002", paid: true })),
  );
});

await check("an ordinary upload is fine", async () => {
  await assertSucceeds(
    setDoc(doc(user(env, OPS), "orders/50003"), order({ orderKey: "50003" })),
  );
});

console.log("\nGuardrails — no settings document\n");

await env.clearFirestore();
await seed("orders/big", order({ orderKey: "big", total: 500000 }));

await check("with no settings, any amount may be approved", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/big"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

console.log("\nGuardrails — a ceiling of 10,000\n");

await env.clearFirestore();
await seed("settings/app", { maxRefundAmount: 10000 });
await seed("orders/under", order({ orderKey: "under", total: 9000 }));
await seed("orders/over", order({ orderKey: "over", total: 11000 }));
await seed("orders/corrected", order({ orderKey: "corrected", total: 50000, amountOverride: 800 }));
await seed("orders/inflated", order({ orderKey: "inflated", total: 500, amountOverride: 40000 }));

await check("under the ceiling approves", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/under"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("over the ceiling is refused", async () => {
  await assertFails(
    setDoc(
      doc(user(env, OPS), "orders/over"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("a correction DOWN under the ceiling approves", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/corrected"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("a correction UP over the ceiling is refused", async () => {
  await assertFails(
    setDoc(
      doc(user(env, OPS), "orders/inflated"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("an admin is bound by the ceiling too", async () => {
  await assertFails(
    setDoc(
      doc(user(env, ADMIN), "orders/over"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("holding an over-ceiling order is still allowed", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/over"),
      { approval: "hold", approvalNote: "too large, checking", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await env.clearFirestore();
await seed("settings/app", { maxRefundAmount: 10000 });
await seed("orders/legacy", order({ orderKey: "legacy", total: 90000, approval: "approved" }));

await check("a re-upload of an already-approved over-ceiling order still works", async () => {
  // A ceiling lowered after the fact must not make old orders unwritable.
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/legacy"),
      { customerName: "Refreshed by a later export", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("accounts can still pay it", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, ACCOUNTS), "orders/legacy"),
      { paid: true, paidAt: Date.now(), paidByEmail: ACCOUNTS, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

console.log("\nGuardrails — cancelled shipments\n");

await env.clearFirestore();
await seed("settings/app", { blockCancelledShipment: true });
await seed("orders/cancelled", order({ orderKey: "cancelled", shipRank: 4 }));
await seed("orders/fine", order({ orderKey: "fine", shipRank: 2 }));

await check("a cancelled shipment cannot be approved", async () => {
  await assertFails(
    setDoc(
      doc(user(env, OPS), "orders/cancelled"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("an in-transit shipment can", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/fine"),
      { approval: "approved", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

console.log("\nGuardrails — a reason required above 5,000\n");

await env.clearFirestore();
await seed("settings/app", { approvalNoteAbove: 5000 });
await seed("orders/small", order({ orderKey: "small", total: 400 }));
await seed("orders/large", order({ orderKey: "large", total: 25000 }));
await seed("orders/large2", order({ orderKey: "large2", total: 25000 }));

await check("a small refund approves with no note", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/small"),
      { approval: "approved", approvalNote: null, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("a large refund with no note is refused", async () => {
  await assertFails(
    setDoc(
      doc(user(env, OPS), "orders/large"),
      { approval: "approved", approvalNote: null, updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("a large refund with an empty note is refused", async () => {
  await assertFails(
    setDoc(
      doc(user(env, OPS), "orders/large"),
      { approval: "approved", approvalNote: "", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

await check("a large refund with a real note approves", async () => {
  await assertSucceeds(
    setDoc(
      doc(user(env, OPS), "orders/large2"),
      { approval: "approved", approvalNote: "Checked the lines with the warehouse", updatedAt: new Date() },
      { merge: true },
    ),
  );
});

console.log("\nSettings and roles\n");

await env.clearFirestore();

await check("an admin may write settings", async () => {
  await assertSucceeds(
    setDoc(doc(user(env, ADMIN), "settings/app"), { maxRefundAmount: 25000 }),
  );
});

await check("operations may read settings", async () => {
  await assertSucceeds(getDoc(doc(user(env, OPS), "settings/app")));
});

await check("operations may NOT write settings", async () => {
  await assertFails(setDoc(doc(user(env, OPS), "settings/app"), { maxRefundAmount: 0 }));
});

await check("accounts may NOT write settings", async () => {
  await assertFails(setDoc(doc(user(env, ACCOUNTS), "settings/app"), { maxRefundAmount: 0 }));
});

await check("nobody may delete the settings document", async () => {
  await assertFails(deleteDoc(doc(user(env, ADMIN), "settings/app")));
});

await check("the owner's role cannot be edited away", async () => {
  await assertFails(
    setDoc(doc(user(env, ADMIN), `roles/${ADMIN}`), { email: ADMIN, role: "ops" }),
  );
});

await check("an admin may set someone else's role", async () => {
  await assertSucceeds(
    setDoc(doc(user(env, ADMIN), `roles/${OPS}`), {
      email: OPS,
      role: "accounts",
      name: null,
      addedBy: ADMIN,
      addedAt: Date.now(),
    }),
  );
});

await check("operations may NOT set roles", async () => {
  await assertFails(
    setDoc(doc(user(env, OPS), `roles/${ACCOUNTS}`), { email: ACCOUNTS, role: "admin" }),
  );
});

console.log("\nThe audit trail\n");

await env.clearFirestore();

await check("anyone signed in may append an entry", async () => {
  await assertSucceeds(
    setDoc(doc(user(env, ACCOUNTS), "events/e1"), {
      kind: "pay",
      byEmail: ACCOUNTS,
      byRole: "accounts",
      at: Date.now(),
    }),
  );
});

await check("nobody may sign an entry as someone else", async () => {
  await assertFails(
    setDoc(doc(user(env, ACCOUNTS), "events/e2"), {
      kind: "approve",
      byEmail: OPS,
      byRole: "ops",
      at: Date.now(),
    }),
  );
});

await check("an entry cannot be edited", async () => {
  await assertFails(
    setDoc(doc(user(env, ADMIN), "events/e1"), { note: "actually, no" }, { merge: true }),
  );
});

await check("an entry cannot be deleted", async () => {
  await assertFails(deleteDoc(doc(user(env, ADMIN), "events/e1")));
});

await env.cleanup();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
