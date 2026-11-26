import { describe, expect, it } from "vitest";
import { categoryKey, categoryLabel, groupCategories } from "./categories";

describe("categoryKey", () => {
  it("ignores case, spacing and stray punctuation", () => {
    for (const v of ["Party", "party", " PARTY ", "Party.", "party!!"]) {
      expect(categoryKey(v)).toBe("party");
    }
    expect(categoryKey("Conference.")).toBe("conference");
    expect(categoryKey("  Tech   Talks ")).toBe("tech talk");
  });

  it("folds simple plurals", () => {
    expect(categoryKey("Parties")).toBe("party");
    expect(categoryKey("Seminars")).toBe("seminar");
    expect(categoryKey("Seminar")).toBe("seminar");
  });

  it("leaves words that only look plural alone", () => {
    expect(categoryKey("Bus")).toBe("bus");
    expect(categoryKey("Class")).toBe("class");
    expect(categoryKey("Sports")).toBe("sport");
  });

  it("treats & and 'and' the same", () => {
    expect(categoryKey("Arts & Culture")).toBe(categoryKey("arts and culture"));
  });

  it("has no key for empty values", () => {
    expect(categoryKey(null)).toBe("");
    expect(categoryKey("  ...  ")).toBe("");
  });
});

describe("categoryLabel", () => {
  it("tidies without changing the words", () => {
    expect(categoryLabel(" Conference. ")).toBe("Conference");
    expect(categoryLabel("Tech   Talks")).toBe("Tech Talks");
  });
});

describe("groupCategories", () => {
  it("groups spellings and names each group by its most common one", () => {
    const groups = groupCategories([
      "Party", "party", "Party", "Parties", "Seminar", "seminars.", null, "",
    ]);
    expect(groups).toEqual([
      { key: "party", name: "Party", count: 4 },
      { key: "seminar", name: "Seminar", count: 2 },
    ]);
  });

  it("breaks ties towards a capitalised spelling, so the name is stable", () => {
    expect(groupCategories(["party", "Party"])[0].name).toBe("Party");
    expect(groupCategories(["Parties", "Party", "party"])[0].name).toBe("Party");
  });
});
