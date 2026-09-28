"use client";

import type { FieldKind } from "@/lib/registration";

/**
 * The organiser's extra questions, as the buyer sees them.
 *
 * Kept as its own component because the checkout panel is already long and
 * this is the part most likely to grow. Light-theme classes throughout: this
 * renders inside the buy box on the public event page, which is a card on
 * cream regardless of the site theme.
 */

export type PublicField = {
  id: string;
  label: string;
  kind: FieldKind;
  options: string[] | null;
  required: boolean;
};

export type AnswerMap = Record<string, string | string[]>;

const control =
  "w-full rounded-lg border border-line px-3 py-2.5 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-purple";

export function RegistrationAnswersForm({
  fields,
  values,
  onChange,
}: {
  fields: PublicField[];
  values: AnswerMap;
  onChange: (fieldId: string, value: string | string[]) => void;
}) {
  if (!fields.length) return null;

  return (
    <div className="space-y-3 rounded-xl bg-cream-2 p-3">
      {fields.map((f) => {
        const options = f.options ?? [];
        const value = values[f.id];

        return (
          <div key={f.id}>
            <label className="mb-1 block text-xs font-semibold text-ink-2">
              {f.label}
              {/* The asterisk is the convention people already read. The word
                  "optional" on everything else would be four extra lines of
                  text on a form somebody is trying to get through. */}
              {f.required && <span className="text-coral"> *</span>}
            </label>

            {f.kind === "paragraph" && (
              <textarea
                rows={3}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(f.id, e.target.value)}
                className={control}
              />
            )}

            {(f.kind === "short_text" ||
              f.kind === "number" ||
              f.kind === "phone" ||
              f.kind === "date") && (
              <input
                type={
                  f.kind === "number"
                    ? "number"
                    : f.kind === "phone"
                      ? "tel"
                      : f.kind === "date"
                        ? "date"
                        : "text"
                }
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(f.id, e.target.value)}
                className={control}
              />
            )}

            {f.kind === "dropdown" && (
              <select
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(f.id, e.target.value)}
                className={control}
              >
                <option value="">Choose…</option>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}

            {f.kind === "choice" && (
              <div className="space-y-1.5">
                {options.map((o) => (
                  <label
                    key={o}
                    className="flex cursor-pointer items-center gap-2 text-sm text-ink"
                  >
                    <input
                      type="radio"
                      name={f.id}
                      checked={value === o}
                      onChange={() => onChange(f.id, o)}
                      className="accent-[#6C3CFF]"
                    />
                    {o}
                  </label>
                ))}
              </div>
            )}

            {f.kind === "checkboxes" && (
              <div className="space-y-1.5">
                {options.map((o) => {
                  const picked = Array.isArray(value) ? value : [];
                  return (
                    <label
                      key={o}
                      className="flex cursor-pointer items-center gap-2 text-sm text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={picked.includes(o)}
                        onChange={(e) =>
                          onChange(
                            f.id,
                            e.target.checked
                              ? [...picked, o]
                              : picked.filter((p) => p !== o)
                          )
                        }
                        className="accent-[#6C3CFF]"
                      />
                      {o}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Whether every required question has something in it.
 *
 * Checked on the page so the buyer is told before they are sent to Paystack,
 * not after. The server checks again — this is a courtesy, not the gate.
 */
export function missingRequired(
  fields: PublicField[],
  values: AnswerMap
): string | null {
  for (const f of fields) {
    if (!f.required) continue;
    const v = values[f.id];
    const filled = Array.isArray(v) ? v.length > 0 : String(v ?? "").trim().length > 0;
    if (!filled) return f.label;
  }
  return null;
}
