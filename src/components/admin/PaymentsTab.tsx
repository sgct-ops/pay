"use client";

import { UPI_APPS } from "@/lib/upi-apps";
import { noteFor, noteProblem } from "@/lib/upi";
import type { AppSettings } from "@/lib/settings";
import { NumberField, Note, Row, Section, TextField, Toggle } from "@/components/admin/controls";

/**
 * How money leaves.
 *
 * The note tag is the one setting here with a long tail: change it and refunds
 * paid from tomorrow are findable on a statement under a different word than
 * the ones paid yesterday. The preview and the warning below exist so that is
 * a decision rather than a surprise.
 */
export function PaymentsTab({
  draft,
  saved,
  patch,
}: {
  draft: AppSettings;
  saved: AppSettings;
  patch: (change: Partial<AppSettings>) => void;
}) {
  const sample = noteFor("42118", draft.noteTag);
  const problem = noteProblem(sample, draft.noteTag, draft.noteMaxLength);
  const tagChanged = draft.noteTag !== saved.noteTag;

  return (
    <div className="space-y-4">
      <Section
        title="The payout note"
        blurb="Every UPI payment carries this note, which is how a refund is recognised on a bank statement three months later. The order number is appended automatically."
      >
        <Row>
          <TextField
            label="Tag"
            hint="Letters, digits, spaces, hyphens or underscores. Kept short — it shares a 50-ish character note with the order number."
            value={draft.noteTag}
            onChange={(noteTag) => patch({ noteTag: noteTag.toUpperCase() })}
            placeholder="CARBONTREE"
            mono
          />
          <NumberField
            label="Maximum note length"
            hint="The pay desk refuses a longer note."
            value={draft.noteMaxLength}
            onChange={(noteMaxLength) => patch({ noteMaxLength })}
            min={12}
            max={120}
            suffix="chars"
          />
        </Row>

        <div className="rounded-lg border border-line bg-paper px-3 py-2.5">
          <div className="text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
            What the customer&rsquo;s bank shows
          </div>
          <div className="mt-1 font-mono text-[13px] text-ink">{sample}</div>
          <div className="tnum mt-1 text-[11.5px] text-ink-3">
            {sample.length} of {draft.noteMaxLength} characters
          </div>
        </div>

        {problem && <Note tone="bad">{problem}</Note>}

        {tagChanged && !problem && (
          <Note tone="warn">
            Refunds already paid stay tagged <span className="font-mono">{saved.noteTag}</span>.
            Anyone searching a statement after this change has two words to look for, so it is
            worth telling whoever does the reconciliation.
          </Note>
        )}
      </Section>

      <Section
        title="Which UPI app opens"
        blurb="Every Indian UPI app understands the same payment query; only the scheme differs. This is the starting choice — a payer can still switch, and their own choice is remembered on their phone."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {UPI_APPS.map((app) => (
            <label
              key={app.id}
              className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                draft.defaultUpiApp === app.id
                  ? "border-spruce bg-spruce-wash"
                  : "border-line bg-paper hover:border-spruce/40"
              }`}
            >
              <input
                type="radio"
                name="upi-app"
                checked={draft.defaultUpiApp === app.id}
                onChange={() => patch({ defaultUpiApp: app.id })}
                className="h-3.5 w-3.5 accent-[#2f6b4f]"
              />
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                style={{ background: app.tint }}
                aria-hidden
              >
                {app.letter}
              </span>
              <span className="text-[12.5px] text-ink">{app.name}</span>
            </label>
          ))}
        </div>
        {draft.defaultUpiApp !== "any" && (
          <Note>
            If that app is not installed, the phone has no way to tell the page — the button simply
            does nothing, and the payer has to switch to <em>Any UPI app</em>. Only pin a specific
            one if every phone paying refunds has it.
          </Note>
        )}
      </Section>

      <Section
        title="Ad-hoc payees"
        blurb="The pay desk can take a handle and an amount typed in by hand, for a payout with no order behind it."
      >
        <Toggle
          label="Allow payments to a hand-typed handle"
          hint="An ad-hoc payment skips the ledger entirely — no order, no approval by operations, no line items to check it against. It is still written to the audit trail, but it is the one path where the two-desk split does not apply. Off is the safer default for a desk that only ever refunds orders."
          value={draft.allowAdhocPayments}
          onChange={(allowAdhocPayments) => patch({ allowAdhocPayments })}
        />
        {draft.allowAdhocPayments && (
          <Note tone="warn">
            Ad-hoc payees remain admin-only regardless of this setting — accounts never sees the
            control. Turning this off removes it for admins too.
          </Note>
        )}
      </Section>
    </div>
  );
}
