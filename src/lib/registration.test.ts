import { describe, expect, it } from "vitest";
import {
  MAX_FIELDS,
  answerColumns,
  normalizeFields,
  validateAnswers,
  type RegistrationField,
} from "./registration";

function field(over: Partial<RegistrationField> = {}): RegistrationField {
  return {
    id: "f1",
    label: "Matric number",
    kind: "short_text",
    options: [],
    required: false,
    position: 0,
    ...over,
  };
}

describe("normalizeFields — the organiser's form", () => {
  it("keeps a plain question", () => {
    const r = normalizeFields([{ label: " Matric number ", kind: "short_text" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields[0].label).toBe("Matric number");
      expect(r.fields[0].required).toBe(false);
    }
  });

  it("refuses a question with no label", () => {
    expect(normalizeFields([{ label: "   ", kind: "short_text" }]).ok).toBe(false);
  });

  it("refuses the same question twice, whatever the casing", () => {
    const r = normalizeFields([
      { label: "Matric number", kind: "short_text" },
      { label: "MATRIC NUMBER", kind: "short_text" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("refuses a choice with fewer than two options", () => {
    const r = normalizeFields([
      { label: "Shirt size", kind: "dropdown", options: ["M"] },
    ]);
    expect(r.ok).toBe(false);
  });

  it("silently drops a duplicated option rather than rejecting the field", () => {
    const r = normalizeFields([
      { label: "Shirt size", kind: "dropdown", options: ["M", "L", "M", " "] },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields[0].options).toEqual(["M", "L"]);
  });

  it("ignores options on a kind that has none", () => {
    const r = normalizeFields([
      { label: "Matric number", kind: "short_text", options: ["a", "b"] },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields[0].options).toEqual([]);
  });

  it("caps the number of questions", () => {
    const many = Array.from({ length: MAX_FIELDS + 1 }, (_, i) => ({
      label: `Q${i}`,
      kind: "short_text" as const,
    }));
    expect(normalizeFields(many).ok).toBe(false);
  });

  it("refuses anything that isn't a list", () => {
    expect(normalizeFields({ label: "x" }).ok).toBe(false);
    expect(normalizeFields(null).ok).toBe(false);
  });
});

describe("validateAnswers — the buyer's form", () => {
  it("writes the label as a snapshot, not a reference", () => {
    const f = field({ label: "Matric number" });
    const r = validateAnswers([f], [{ fieldId: "f1", value: "CS/2021/044" }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rows).toEqual([
        { fieldId: "f1", label: "Matric number", value: "CS/2021/044" },
      ]);
    }
  });

  it("skips an unanswered optional question instead of storing an empty row", () => {
    const r = validateAnswers([field()], []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([]);
  });

  it("names the question when a required one is blank", () => {
    const r = validateAnswers([field({ required: true })], [
      { fieldId: "f1", value: "  " },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Matric number");
  });

  it("ignores an answer to a question that no longer exists", () => {
    const r = validateAnswers([field()], [{ fieldId: "gone", value: "x" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([]);
  });

  it("joins checkboxes into one readable value", () => {
    const f = field({ kind: "checkboxes", options: ["Jollof", "Fried", "Salad"] });
    const r = validateAnswers([f], [{ fieldId: "f1", value: ["Jollof", "Salad"] }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].value).toBe("Jollof, Salad");
  });

  it("rejects a number that isn't one", () => {
    const f = field({ kind: "number", label: "Level" });
    expect(validateAnswers([f], [{ fieldId: "f1", value: "four hundred" }]).ok).toBe(
      false
    );
    expect(validateAnswers([f], [{ fieldId: "f1", value: "400" }]).ok).toBe(true);
  });

  it("rejects a phone number with too few digits", () => {
    const f = field({ kind: "phone", label: "Second number" });
    expect(validateAnswers([f], [{ fieldId: "f1", value: "0803" }]).ok).toBe(false);
    expect(
      validateAnswers([f], [{ fieldId: "f1", value: "0803 123 4567" }]).ok
    ).toBe(true);
  });

  it("rejects a date that isn't one", () => {
    const f = field({ kind: "date", label: "Arriving" });
    expect(validateAnswers([f], [{ fieldId: "f1", value: "soonish" }]).ok).toBe(false);
    expect(validateAnswers([f], [{ fieldId: "f1", value: "2026-12-12" }]).ok).toBe(
      true
    );
  });

  // The rule the whole file is built around: an organiser editing the form
  // must not break a checkout somebody already has open.
  it("keeps the options that still exist when the organiser edits them mid-sale", () => {
    const f = field({ kind: "checkboxes", options: ["Jollof", "Salad"] });
    const r = validateAnswers([f], [
      { fieldId: "f1", value: ["Jollof", "Fried"] }, // Fried was just deleted
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0].value).toBe("Jollof");
  });

  it("lets an optional question through when every choice vanished", () => {
    const f = field({ kind: "choice", options: ["A", "B"] });
    const r = validateAnswers([f], [{ fieldId: "f1", value: "C" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([]);
  });

  it("asks again, rather than failing silently, when a required choice vanished", () => {
    const f = field({ kind: "choice", options: ["A", "B"], required: true });
    const r = validateAnswers([f], [{ fieldId: "f1", value: "C" }]);
    expect(r.ok).toBe(false);
  });

  it("returns rows in the organiser's order, not the buyer's post order", () => {
    const fields = [
      field({ id: "b", label: "Second", position: 1 }),
      field({ id: "a", label: "First", position: 0 }),
    ];
    const r = validateAnswers(fields, [
      { fieldId: "b", value: "2" },
      { fieldId: "a", value: "1" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => x.label)).toEqual(["First", "Second"]);
  });

  it("survives junk where a list of answers should be", () => {
    expect(validateAnswers([field()], "nope").ok).toBe(true);
    expect(validateAnswers([field()], null).ok).toBe(true);
    expect(validateAnswers([field()], [null, 7, { fieldId: 3 }]).ok).toBe(true);
  });

  it("takes the last answer when one question is posted twice", () => {
    const r = validateAnswers([field()], [
      { fieldId: "f1", value: "first" },
      { fieldId: "f1", value: "second" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(1);
    if (r.ok) expect(r.rows[0].value).toBe("second");
  });
});

describe("answerColumns — the export header", () => {
  it("uses the organiser's current order", () => {
    const cols = answerColumns(
      [
        { label: "Second", position: 1 },
        { label: "First", position: 0 },
      ],
      []
    );
    expect(cols).toEqual(["First", "Second"]);
  });

  it("keeps a column for answers to a question since deleted", () => {
    const cols = answerColumns([{ label: "First", position: 0 }], [
      { label: "Shirt size" },
      { label: "First" },
      { label: "Shirt size" },
    ]);
    expect(cols).toEqual(["First", "Shirt size"]);
  });
});
