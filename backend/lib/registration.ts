/**
 * The extra questions an organiser puts on their own checkout form.
 *
 * Everything in this file is pure: definitions in, rows out. The route
 * handlers do the database work, and this does the deciding — which means
 * the awkward cases ("they ticked a box that no longer exists", "the field
 * was renamed while somebody had the form open") are testable without a
 * database and without a browser.
 *
 * The governing rule, and it decides almost every judgement call below:
 *
 *   A BAD ANSWER MUST NEVER COST A SALE THAT ISN'T THE BUYER'S FAULT.
 *
 * If the buyer got it wrong — skipped a required question, typed letters
 * into a number — say so plainly and let them fix it. If WE got it wrong, or
 * the organiser changed the form under them, take the money and keep the
 * answer we can. A student staring at "something went wrong" on a payment
 * page does not try again; they ask in the group chat whether the link is
 * broken, and four other people decide not to bother either.
 */

export type FieldKind =
  | "short_text"
  | "paragraph"
  | "choice"
  | "checkboxes"
  | "dropdown"
  | "number"
  | "phone"
  | "date";

export type RegistrationField = {
  id: string;
  label: string;
  kind: FieldKind;
  options: string[];
  required: boolean;
  position: number;
};

/** A field as the organiser's builder sends it — no id yet for a new one. */
export type FieldDraft = {
  id?: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  required?: boolean;
};

export type AnswerRow = {
  fieldId: string | null;
  label: string;
  value: string;
};

export const FIELD_KINDS: { value: FieldKind; label: string; hint: string }[] = [
  { value: "short_text", label: "Short answer", hint: "Matric number, nickname" },
  { value: "paragraph", label: "Paragraph", hint: "Anything longer" },
  { value: "choice", label: "Pick one", hint: "Radio buttons" },
  { value: "checkboxes", label: "Pick any", hint: "Tick as many as apply" },
  { value: "dropdown", label: "Dropdown", hint: "Same as pick one, in a list" },
  { value: "number", label: "Number", hint: "Level, age, table size" },
  { value: "phone", label: "Phone", hint: "A second number to reach them on" },
  { value: "date", label: "Date", hint: "Birthday, arrival day" },
];

const KIND_VALUES = FIELD_KINDS.map((k) => k.value);

/** The kinds where a list of options is the point. */
export const KINDS_WITH_OPTIONS: FieldKind[] = [
  "choice",
  "checkboxes",
  "dropdown",
];

export function hasOptions(kind: FieldKind): boolean {
  return KINDS_WITH_OPTIONS.includes(kind);
}

/**
 * Caps. Generous enough that nobody legitimate hits them, tight enough that
 * the guest-list export stays readable and a paste of somebody's entire
 * dissertation doesn't end up in a varchar.
 */
export const MAX_FIELDS = 12;
export const MAX_LABEL = 120;
export const MAX_OPTIONS = 20;
export const MAX_SHORT_ANSWER = 300;
export const MAX_PARAGRAPH = 2000;

// ── The organiser's side: validating the form they built ─────────────────

export type NormalizeResult =
  | { ok: true; fields: (FieldDraft & { options: string[]; required: boolean })[] }
  | { ok: false; error: string };

/**
 * Clean up and check a set of field definitions before they are saved.
 *
 * Strict here, on purpose — the opposite of the rule at the top. This is an
 * organiser at a keyboard who can see what they typed, and a question saved
 * with no label is a question four hundred people will be asked and none of
 * them will understand.
 */
export function normalizeFields(input: unknown): NormalizeResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: "Expected a list of questions." };
  }
  if (input.length > MAX_FIELDS) {
    return {
      ok: false,
      error: `That's more than ${MAX_FIELDS} questions. Checkout forms that long don't get filled in — they get abandoned.`,
    };
  }

  const out: (FieldDraft & { options: string[]; required: boolean })[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "One of the questions isn't readable." };
    }
    const f = raw as Record<string, unknown>;

    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (!label) {
      return { ok: false, error: "Every question needs a label." };
    }
    if (label.length > MAX_LABEL) {
      return {
        ok: false,
        error: `"${label.slice(0, 30)}…" is too long for a question label.`,
      };
    }

    // Two questions with the same label produce two identically-headed
    // columns in the export, and nobody can tell which is which afterwards.
    const key = label.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `You've asked "${label}" twice.` };
    }
    seen.add(key);

    const kind = (typeof f.kind === "string" ? f.kind : "short_text") as FieldKind;
    if (!KIND_VALUES.includes(kind)) {
      return { ok: false, error: `"${label}" has a question type we don't know.` };
    }

    let options: string[] = [];
    if (hasOptions(kind)) {
      const rawOptions = Array.isArray(f.options) ? f.options : [];
      options = rawOptions
        .map((o) => (typeof o === "string" ? o.trim() : ""))
        .filter(Boolean);

      // Deduplicate rather than reject: two identical options is a slip, and
      // silently keeping one is what the organiser meant.
      options = [...new Set(options)];

      if (options.length < 2) {
        return {
          ok: false,
          error: `"${label}" needs at least two options to choose between.`,
        };
      }
      if (options.length > MAX_OPTIONS) {
        return { ok: false, error: `"${label}" has too many options.` };
      }
    }

    out.push({
      id: typeof f.id === "string" && f.id ? f.id : undefined,
      label,
      kind,
      options,
      required: f.required === true,
    });
  }

  return { ok: true, fields: out };
}

// ── The buyer's side: validating what they typed ─────────────────────────

export type SubmittedAnswer = {
  fieldId: string;
  value: string | string[] | number | null;
};

export type ValidateResult =
  | { ok: true; rows: AnswerRow[] }
  | { ok: false; error: string };

function asText(value: SubmittedAnswer["value"]): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(", ");
  return String(value).trim();
}

/**
 * Check a buyer's answers against the questions as they stand right now.
 *
 * Returns the rows to write. Unanswered optional questions produce no row at
 * all rather than an empty one — "they didn't say" and "they said nothing"
 * are the same fact, and one of them costs a database row per order.
 */
export function validateAnswers(
  fields: RegistrationField[],
  submitted: unknown
): ValidateResult {
  const byId = new Map(fields.map((f) => [f.id, f]));

  const list: SubmittedAnswer[] = Array.isArray(submitted)
    ? (submitted as SubmittedAnswer[]).filter(
        (a) => a && typeof a === "object" && typeof a.fieldId === "string"
      )
    : [];

  // Last one wins, so a form that somehow posts a field twice doesn't
  // produce two rows in the export.
  const given = new Map<string, SubmittedAnswer>();
  for (const a of list) given.set(a.fieldId, a);

  const rows: AnswerRow[] = [];

  for (const field of [...fields].sort((a, b) => a.position - b.position)) {
    const raw = given.get(field.id);
    const text = asText(raw?.value ?? null);

    if (!text) {
      if (field.required) {
        return { ok: false, error: `${field.label} is required.` };
      }
      continue;
    }

    const cap = field.kind === "paragraph" ? MAX_PARAGRAPH : MAX_SHORT_ANSWER;
    if (text.length > cap) {
      return { ok: false, error: `Your answer to "${field.label}" is too long.` };
    }

    if (field.kind === "number" && !Number.isFinite(Number(text))) {
      return { ok: false, error: `${field.label} should be a number.` };
    }

    if (field.kind === "date" && Number.isNaN(Date.parse(text))) {
      return { ok: false, error: `${field.label} should be a date.` };
    }

    if (field.kind === "phone") {
      const digits = text.replace(/\D/g, "");
      if (digits.length < 7) {
        return { ok: false, error: `${field.label} doesn't look like a phone number.` };
      }
    }

    if (hasOptions(field.kind) && field.options.length) {
      const chosen = field.kind === "checkboxes" ? text.split(",").map((s) => s.trim()) : [text];
      const unknown = chosen.filter((c) => !field.options.includes(c));
      if (unknown.length) {
        // The organiser edited the options while this person had the page
        // open. Their fault, not the buyer's, and the rule at the top of the
        // file applies: keep what still makes sense and let the sale through.
        const kept = chosen.filter((c) => field.options.includes(c));
        if (!kept.length && field.required) {
          return {
            ok: false,
            error: `The choices for "${field.label}" changed. Reload the page and pick again.`,
          };
        }
        if (!kept.length) continue;
        rows.push({ fieldId: field.id, label: field.label, value: kept.join(", ") });
        continue;
      }
    }

    // `label` is copied, not referenced. If the organiser renames this
    // question tomorrow, what this person was actually asked today does not
    // change underneath them.
    rows.push({ fieldId: field.id, label: field.label, value: text });
  }

  return { ok: true, rows };
}

/**
 * Turn per-order answers into the columns a CSV export wants.
 *
 * Column order comes from the questions as they are configured now, then any
 * label that only exists in old answers — a question since deleted or
 * renamed still has answers, and dropping that column would quietly discard
 * data somebody collected on purpose.
 */
export function answerColumns(
  fields: { label: string; position: number }[],
  answers: { label: string }[]
): string[] {
  const live = [...fields]
    .sort((a, b) => a.position - b.position)
    .map((f) => f.label);
  const seen = new Set(live);
  const orphans: string[] = [];
  for (const a of answers) {
    if (!seen.has(a.label)) {
      seen.add(a.label);
      orphans.push(a.label);
    }
  }
  return [...live, ...orphans];
}
