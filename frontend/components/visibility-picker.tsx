"use client";

import { Globe, Link2 } from "lucide-react";
import type { EventVisibility } from "@/lib/event-visibility";

const OPTIONS: {
  value: EventVisibility;
  label: string;
  hint: string;
  Icon: typeof Globe;
}[] = [
  {
    value: "public",
    label: "Public",
    hint: "Listed on Wetin Dey and can show up in Google.",
    Icon: Globe,
  },
  {
    value: "unlisted",
    label: "Unlisted",
    hint: "Only people with the link can find it. Not listed on Wetin Dey or in search engines.",
    Icon: Link2,
  },
];

/**
 * "Who can find this event?" — Public or Unlisted.
 *
 * Unlisted is not private: anyone with the link can open the page and buy a
 * ticket. It only stays out of discovery and search engines.
 */
export function VisibilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: EventVisibility;
  onChange: (next: EventVisibility) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="font-bold text-on-dark">Who can find this event?</legend>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(({ value: v, label, hint, Icon }) => {
          const selected = value === v;
          return (
            <label
              key={v}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                selected
                  ? "border-purple bg-purple/10"
                  : "border-line-dark hover:border-on-dark-3"
              }`}
            >
              <input
                type="radio"
                name="event-visibility"
                value={v}
                checked={selected}
                onChange={() => onChange(v)}
                className="mt-1 accent-[#6C3CFF]"
              />
              <span>
                <span className="flex items-center gap-1.5 font-semibold text-on-dark">
                  <Icon className="h-4 w-4" />
                  {label}
                </span>
                <span className="mt-1 block text-sm text-on-dark-2">{hint}</span>
              </span>
            </label>
          );
        })}
      </div>
      {value === "unlisted" && (
        <p className="mt-3 text-xs text-on-dark-3">
          Anyone you send the link to can open it and buy a ticket, and they
          can pass it on.
        </p>
      )}
    </fieldset>
  );
}
