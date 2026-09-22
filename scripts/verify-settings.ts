/**
 * Desk settings, pinned.
 *
 * mergeSettings is the only thing between a malformed settings document and a
 * NaN reaching a refund ceiling, so it gets the same treatment as the
 * transform: a fixture of every awkward case, run in ten seconds, standing
 * between a careless edit and a guardrail that silently stops guarding.
 *
 * Run with:  npm test
 */

import {
  DEFAULT_SETTINGS,
  describeChange,
  mergeSettings,
  settingsChanged,
  settingsProblems,
} from "../src/lib/settings";
import { DEFAULT_EXCLUSIONS } from "../src/lib/sheet/types";
import { matchesExclusion, nonPayableReason } from "../src/lib/sheet/transform";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok  ${name}  →  ${a}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
  }
}

console.log("\nDefaults\n");

check("an empty document is the shipped defaults", mergeSettings({}), DEFAULT_SETTINGS);
check("null is the shipped defaults", mergeSettings(null), DEFAULT_SETTINGS);
check("a string is the shipped defaults", mergeSettings("nonsense"), DEFAULT_SETTINGS);
check("no ceiling by default", DEFAULT_SETTINGS.maxRefundAmount, 0);
check("the defaults are valid", settingsProblems(DEFAULT_SETTINGS), []);

console.log("\nGarbage never reaches a money field\n");

check(
  "a string amount falls back rather than becoming NaN",
  mergeSettings({ maxRefundAmount: "twenty thousand" }).maxRefundAmount,
  0,
);
check(
  "a negative ceiling is clamped to off, not to a negative ceiling",
  mergeSettings({ maxRefundAmount: -5000 }).maxRefundAmount,
  0,
);
check(
  "an absurd ceiling is capped",
  mergeSettings({ maxRefundAmount: 1e12 }).maxRefundAmount,
  10_000_000,
);
check("NaN falls back", mergeSettings({ warnRefundAmount: NaN }).warnRefundAmount, 0);
check("Infinity falls back", mergeSettings({ approvalNoteAbove: Infinity }).approvalNoteAbove, 0);
check(
  "a real ceiling survives",
  mergeSettings({ maxRefundAmount: 25000 }).maxRefundAmount,
  25000,
);
check(
  "a non-boolean toggle falls back to off",
  mergeSettings({ blockCancelledShipment: "yes" }).blockCancelledShipment,
  false,
);

console.log("\nStages\n");

check(
  "an empty stage list falls back rather than emptying every upload",
  mergeSettings({ defaultStages: [] }).defaultStages,
  ["received", "approved"],
);
check(
  "stages are lowercased and de-duplicated",
  mergeSettings({ defaultStages: ["Received", "RECEIVED", " approved "] }).defaultStages,
  ["received", "approved"],
);
check(
  "non-strings are dropped",
  mergeSettings({ defaultStages: ["received", 7, null] }).defaultStages,
  ["received"],
);

console.log("\nExclusions\n");

check(
  "a missing field keeps the built-in rules",
  mergeSettings({}).exclusions.length,
  DEFAULT_EXCLUSIONS.length,
);
check(
  "an explicitly empty list means exclude nothing",
  mergeSettings({ exclusions: [] }).exclusions,
  [],
);
check(
  "a rule with no phrase is dropped",
  mergeSettings({ exclusions: [{ phrase: "  ", reason: "x" }] }).exclusions,
  [],
);
check(
  "a partial rule is completed",
  mergeSettings({ exclusions: [{ phrase: "gift card" }] }).exclusions,
  [
    {
      id: "gift-card",
      phrase: "gift card",
      reason: "excluded by a desk rule",
      wholeWord: false,
      enabled: true,
    },
  ],
);

console.log("\nMatching behaves exactly as the old regexes did\n");

const byId = (id: string) => DEFAULT_EXCLUSIONS.find((r) => r.id === id)!;

check(
  '"marketing" is a whole word, so "remarketing" is not a match',
  matchesExclusion("remarketing spend", byId("marketing")),
  false,
);
check(
  '"marketing" matches on its own',
  matchesExclusion("sent as marketing sample", byId("marketing")),
  true,
);
check(
  '"exchang" is a stem, so it catches "exchanged"',
  matchesExclusion("item was exchanged", byId("exchange")),
  true,
);
check(
  '"exchang" also catches "exchange"',
  matchesExclusion("exchange requested", byId("exchange")),
  true,
);
check(
  "matching ignores case",
  matchesExclusion("SETTLED AS STORE CREDIT", byId("store-credit")),
  true,
);
check(
  "a phrase with regex characters is matched literally, not compiled",
  matchesExclusion("50% off applied", {
    id: "t",
    phrase: "50% off",
    reason: "promo",
    wholeWord: false,
    enabled: true,
  }),
  true,
);
check(
  "a phrase of regex metacharacters matches nothing rather than everything",
  matchesExclusion("an ordinary note", {
    id: "t",
    phrase: ".*",
    reason: "would have eaten every line",
    wholeWord: false,
    enabled: true,
  }),
  false,
);
check(
  "a disabled rule does not exclude",
  nonPayableReason("adjusted in another product", 500, [
    { ...byId("adjusted"), enabled: false },
  ]),
  null,
);
check(
  "a zero amount is never payable, whatever the rules say",
  nonPayableReason("perfectly ordinary note", 0, []),
  "no eligible amount",
);

console.log("\nValidation catches the self-defeating combinations\n");

check(
  "a warning above the ceiling is flagged",
  settingsProblems({ ...DEFAULT_SETTINGS, maxRefundAmount: 5000, warnRefundAmount: 9000 }).length,
  1,
);
check(
  "a warning below the ceiling is fine",
  settingsProblems({ ...DEFAULT_SETTINGS, maxRefundAmount: 9000, warnRefundAmount: 5000 }),
  [],
);
check(
  "a tag with punctuation is rejected before it reaches a UPI note",
  settingsProblems({ ...DEFAULT_SETTINGS, noteTag: "CARBON@TREE!" }).length > 0,
  true,
);
check(
  "a note limit too short for an ordinary payout is rejected",
  settingsProblems({ ...DEFAULT_SETTINGS, noteTag: "CARBONTREE", noteMaxLength: 12 }).length > 0,
  true,
);
check(
  "a duplicated exclusion is flagged",
  settingsProblems({
    ...DEFAULT_SETTINGS,
    exclusions: [byId("marketing"), { ...byId("marketing"), id: "other" }],
  }).length,
  1,
);
check(
  "a two-character exclusion is flagged as too broad",
  settingsProblems({
    ...DEFAULT_SETTINGS,
    exclusions: [{ id: "x", phrase: "cr", reason: "credit", wholeWord: false, enabled: true }],
  }).length,
  1,
);

console.log("\nDirty tracking and the audit line\n");

check(
  "provenance alone is not a change",
  settingsChanged(DEFAULT_SETTINGS, {
    ...DEFAULT_SETTINGS,
    updatedAt: 123,
    updatedByEmail: "a@b.com",
  }),
  false,
);
check(
  "a moved ceiling is a change",
  settingsChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, maxRefundAmount: 1 }),
  true,
);
check(
  "the audit line names the figures rather than saying 'settings changed'",
  describeChange(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, maxRefundAmount: 25000 }),
  "ceiling off → ₹25,000",
);
check(
  "an empty change says so",
  describeChange(DEFAULT_SETTINGS, DEFAULT_SETTINGS),
  "no effective change",
);

console.log(failures ? `\n${failures} check(s) failed\n` : "\nAll checks passed\n");
process.exit(failures ? 1 : 0);
