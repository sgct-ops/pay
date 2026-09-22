"use client";

import { useMemo, useState } from "react";
import { ALL_STAGES, DEFAULT_EXCLUSIONS, type ExclusionRule } from "@/lib/sheet/types";
import { matchesExclusion } from "@/lib/sheet/transform";
import type { AppSettings } from "@/lib/settings";
import { Note, Section, SecondaryButton } from "@/components/admin/controls";

/**
 * The rules the Return Prime transform runs on.
 *
 * These were regexes in the source. They are here because they are business
 * decisions — which return stages count, and which notes mean "not a payout" —
 * and the person who makes those decisions should not need a deploy to change
 * one. The tester at the bottom exists because a phrase that looks obvious
 * ("credit") quietly excludes half an export, and the only honest way to know
 * is to paste a real note in and look.
 */
export function TransformTab({
  draft,
  patch,
}: {
  draft: AppSettings;
  patch: (change: Partial<AppSettings>) => void;
}) {
  const [probe, setProbe] = useState("");

  const hit = useMemo(() => {
    if (!probe.trim()) return null;
    return draft.exclusions.find((r) => r.enabled && matchesExclusion(probe, r)) ?? null;
  }, [probe, draft.exclusions]);

  const setRule = (id: string, change: Partial<ExclusionRule>) =>
    patch({ exclusions: draft.exclusions.map((r) => (r.id === id ? { ...r, ...change } : r)) });

  const addRule = () =>
    patch({
      exclusions: [
        ...draft.exclusions,
        {
          id: `rule-${Date.now().toString(36)}`,
          phrase: "",
          reason: "not a refund",
          wholeWord: false,
          enabled: true,
        },
      ],
    });

  const removeRule = (id: string) =>
    patch({ exclusions: draft.exclusions.filter((r) => r.id !== id) });

  const toggleStage = (stage: string, on: boolean) =>
    patch({
      defaultStages: on
        ? Array.from(new Set([...draft.defaultStages, stage]))
        : draft.defaultStages.filter((s) => s !== stage),
    });

  return (
    <div className="space-y-4">
      <Section
        title="Default return stages"
        blurb="Which values of Return Prime's status column an upload keeps. These are the boxes already ticked when the upload screen opens; whoever is uploading can still change them for one file."
      >
        <div className="flex flex-wrap gap-2">
          {ALL_STAGES.map((s) => (
            <label
              key={s}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] capitalize transition ${
                draft.defaultStages.includes(s)
                  ? "border-spruce/30 bg-spruce-wash text-spruce"
                  : "border-line bg-paper text-ink-3"
              }`}
            >
              <input
                type="checkbox"
                checked={draft.defaultStages.includes(s)}
                onChange={(e) => toggleStage(s, e.target.checked)}
                className="h-3.5 w-3.5 accent-[#2f6b4f]"
              />
              {s}
            </label>
          ))}
        </div>
        {!draft.defaultStages.length && (
          <Note tone="bad">
            With no stages kept, every upload reads as empty. Tick at least one.
          </Note>
        )}
        {draft.defaultStages.includes("requested") && (
          <Note tone="warn">
            Keeping <em>requested</em> pulls in returns the warehouse has not seen yet. They will
            need holding rather than approving.
          </Note>
        )}
      </Section>

      <Section
        title="Lines that are not payouts"
        blurb="A line matching one of these is kept on the order and shown with its reason, but left out of the payable total. Matching is case-insensitive against the note in refund_additional_details."
        aside={
          <div className="flex gap-2">
            <SecondaryButton
              onClick={() => patch({ exclusions: DEFAULT_EXCLUSIONS })}
              title="Restore the six rules the app ships with"
            >
              Restore defaults
            </SecondaryButton>
            <SecondaryButton onClick={addRule}>Add a rule</SecondaryButton>
          </div>
        }
      >
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="hidden gap-3 border-b border-line-soft bg-sunk/60 px-3 py-2 text-[10.5px] uppercase tracking-[0.06em] text-ink-3 sm:flex">
            <span className="w-8 shrink-0">On</span>
            <span className="flex-1">Phrase in the note</span>
            <span className="flex-1">Shown as the reason</span>
            <span className="w-[92px] shrink-0">Whole word</span>
            <span className="w-12 shrink-0" />
          </div>

          {!draft.exclusions.length && (
            <p className="px-3 py-5 text-[12.5px] text-ink-3">
              No exclusions. Every line with a positive amount will count toward the payable total.
            </p>
          )}

          {draft.exclusions.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2 last:border-0 sm:flex-nowrap sm:gap-3"
            >
              <input
                type="checkbox"
                aria-label={`Enable "${rule.phrase}"`}
                checked={rule.enabled}
                onChange={(e) => setRule(rule.id, { enabled: e.target.checked })}
                className="h-4 w-4 shrink-0 rounded-[3px] accent-[#2f6b4f] sm:w-8"
              />
              <input
                value={rule.phrase}
                onChange={(e) => setRule(rule.id, { phrase: e.target.value })}
                placeholder="store credit"
                className={`min-w-[140px] flex-1 rounded-md border bg-paper px-2 py-1.5 text-[12.5px] focus:outline-none ${
                  rule.phrase.trim().length < 3
                    ? "border-clay"
                    : "border-line focus:border-spruce"
                } ${rule.enabled ? "" : "opacity-50"}`}
              />
              <input
                value={rule.reason}
                onChange={(e) => setRule(rule.id, { reason: e.target.value })}
                placeholder="settled as store credit"
                className={`min-w-[140px] flex-1 rounded-md border border-line bg-paper px-2 py-1.5 text-[12.5px] focus:border-spruce focus:outline-none ${
                  rule.enabled ? "" : "opacity-50"
                }`}
              />
              <label
                className="flex w-[92px] shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-2"
                title="On: the phrase must stand as its own word. Off: it matches inside longer words, which is what makes “exchang” catch both exchange and exchanged."
              >
                <input
                  type="checkbox"
                  checked={rule.wholeWord}
                  onChange={(e) => setRule(rule.id, { wholeWord: e.target.checked })}
                  className="h-3.5 w-3.5 accent-[#5a5f7a]"
                />
                exact
              </label>
              <button
                onClick={() => removeRule(rule.id)}
                className="w-12 shrink-0 text-right text-[12px] text-ink-3 hover:text-clay"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <Note>
          A phrase is matched literally — punctuation and symbols included, never as a regular
          expression — so nothing typed here can accidentally match everything.
        </Note>
      </Section>

      <Section
        title="Try a note"
        blurb="Paste a real refund_additional_details value from an export and see which rule, if any, would take the line out of the total."
      >
        <textarea
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          rows={2}
          placeholder="e.g. size issue, adjusted in another product, rahul.verma@okaxis"
          className="w-full rounded-lg border border-line bg-paper p-3 font-mono text-[12px] focus:border-spruce focus:outline-none"
        />
        {probe.trim() &&
          (hit ? (
            <Note tone="warn">
              Excluded — <span className="font-semibold">{hit.reason}</span>, matched on &ldquo;
              {hit.phrase}&rdquo;.
            </Note>
          ) : (
            <Note tone="good">
              Counted. No rule matches this note, so a line carrying it goes into the payable total.
            </Note>
          ))}
      </Section>

      <Section
        title="What is not editable here"
        blurb="Three parts of the transform are structural rather than policy, and changing them belongs in a pull request with the fixture test beside it."
      >
        <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
          <li>
            <span className="font-medium text-ink">The manual-UPI filter.</span> Only rows where{" "}
            <code className="font-mono text-[11.5px]">requested_refund_mode</code> is{" "}
            <code className="font-mono text-[11.5px]">others</code> are kept, and never one already{" "}
            <code className="font-mono text-[11.5px]">refunded</code>.
          </li>
          <li>
            <span className="font-medium text-ink">Handle recovery.</span> A UPI handle is{" "}
            <code className="font-mono text-[11.5px]">something@bank</code> where the bank part has
            no dots — the single rule separating <code className="font-mono text-[11.5px]">
              rahul.verma@okaxis
            </code>{" "}
            from <code className="font-mono text-[11.5px]">rahul@gmail.com</code>.
          </li>
          <li>
            <span className="font-medium text-ink">Combining lines per order.</span> Orders are
            keyed by order number, which is what makes overlapping exports safe.
          </li>
        </ul>
      </Section>
    </div>
  );
}
