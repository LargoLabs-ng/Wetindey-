import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";

describe("csvCell", () => {
  it("quotes and escapes ordinary values", () => {
    expect(csvCell('A "quote"')).toBe('"A ""quote"""');
    expect(csvCell(25)).toBe('"25"');
  });

  it("neutralizes spreadsheet formulas in strings", () => {
    for (const value of ["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1)", " \t=1+1"]) {
      expect(csvCell(value)).toBe(`"'${value.replaceAll('"', '""')}"`);
    }
  });
});
