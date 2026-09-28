import { describe, expect, it } from "vitest";
import { describeChanges, type NotifiableDetails } from "./notify-change";

const BASE: NotifiableDetails = {
  startDatetime: new Date("2026-12-12T19:00:00Z"),
  endDatetime: new Date("2026-12-12T23:00:00Z"),
  venueName: "Main Auditorium",
  venueAddress: "Etta Agbor Road",
  city: "Calabar",
};

const at = (iso: string) => new Date(iso);

describe("describeChanges — what's worth an email", () => {
  it("says nothing when nothing moved", () => {
    expect(describeChanges(BASE, { ...BASE })).toEqual([]);
  });

  it("ignores a re-save where only the representation differs", () => {
    // Same instant, one as a Date and one as the ISO string the API parses.
    const after = { ...BASE, startDatetime: "2026-12-12T19:00:00.000Z" };
    expect(describeChanges(BASE, after)).toEqual([]);
  });

  it("ignores whitespace somebody's keyboard added", () => {
    const after = { ...BASE, venueName: "  Main Auditorium  " };
    expect(describeChanges(BASE, after)).toEqual([]);
  });

  it("catches a moved start time", () => {
    const after = { ...BASE, startDatetime: at("2026-12-13T19:00:00Z") };
    const changes = describeChanges(BASE, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].label).toBe("Starts");
    expect(changes[0].from).not.toBe(changes[0].to);
  });

  it("catches a moved venue", () => {
    const after = { ...BASE, venueName: "Sports Complex" };
    const changes = describeChanges(BASE, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      label: "Venue",
      from: "Main Auditorium",
      to: "Sports Complex",
    });
  });

  it("reports several changes at once, in a readable order", () => {
    const after = {
      ...BASE,
      startDatetime: at("2026-12-13T19:00:00Z"),
      venueName: "Sports Complex",
      city: "Ikom",
    };
    expect(describeChanges(BASE, after).map((c) => c.label)).toEqual([
      "Starts",
      "Venue",
      "City",
    ]);
  });

  it("phrases an empty field as not announced yet, rather than blank", () => {
    const before = { ...BASE, venueName: null };
    const changes = describeChanges(before, BASE);
    expect(changes[0].from).toBe("not announced yet");
    expect(changes[0].to).toBe("Main Auditorium");
  });

  it("handles a venue being cleared", () => {
    const changes = describeChanges(BASE, { ...BASE, venueName: "   " });
    expect(changes[0].to).toBe("not announced yet");
  });

  it("treats a date arriving for the first time as a change", () => {
    const before = { ...BASE, startDatetime: null };
    const changes = describeChanges(before, BASE);
    expect(changes).toHaveLength(1);
    expect(changes[0].from).toBe("not announced yet");
  });

  it("says nothing when both sides have no date", () => {
    const blank = { ...BASE, startDatetime: null, endDatetime: null };
    expect(describeChanges(blank, { ...blank })).toEqual([]);
  });

  it("does not fire on a title or description edit", () => {
    // Neither is part of NotifiableDetails at all — this test exists to fail
    // loudly if somebody widens the type without thinking about the inbox.
    const after = { ...BASE } as NotifiableDetails & { title?: string };
    after.title = "A completely new name";
    expect(describeChanges(BASE, after)).toEqual([]);
  });

  it("survives an unparseable date without inventing a change", () => {
    const after = { ...BASE, startDatetime: "not a date" };
    const changes = describeChanges(BASE, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].to).toBe("not announced yet");
  });
});

// The provisional date is real data that nobody has been shown. These are
// the tests that stop it reaching an inbox.
describe("describeChanges — provisional dates and venues", () => {
  const TBA: NotifiableDetails = { ...BASE, dateTbd: true, venueTbd: true };

  it("says nothing when a provisional date is shuffled around", () => {
    const after = { ...TBA, startDatetime: at("2027-01-20T19:00:00Z") };
    expect(describeChanges(TBA, after)).toEqual([]);
  });

  it("never prints the provisional date itself", () => {
    const after = { ...TBA, city: "Ikom" };
    const changes = describeChanges(TBA, after);
    expect(changes).toHaveLength(1);
    expect(JSON.stringify(changes)).not.toContain("December");
  });

  it("sends exactly one change when the date is confirmed", () => {
    const confirmed = { ...TBA, dateTbd: false };
    const changes = describeChanges(TBA, confirmed);
    expect(changes.map((c) => c.label)).toEqual(["Starts", "Ends"]);
    expect(changes[0].from).toBe("not announced yet");
    expect(changes[0].to).toContain("December");
  });

  it("sends a change when the venue is confirmed", () => {
    const confirmed = { ...TBA, venueTbd: false };
    const changes = describeChanges(TBA, confirmed);
    expect(changes.map((c) => c.label)).toEqual(["Venue", "Address"]);
    expect(changes[0].to).toBe("Main Auditorium");
  });

  it("treats going back to unconfirmed as a change too", () => {
    const changes = describeChanges(BASE, { ...BASE, dateTbd: true });
    expect(changes.map((c) => c.label)).toEqual(["Starts", "Ends"]);
    expect(changes[0].to).toBe("not announced yet");
  });

  it("still reports a city change while the venue is provisional", () => {
    // "Somewhere in Calabar, venue TBA" is useful; the city is not hidden.
    const changes = describeChanges(TBA, { ...TBA, city: "Ikom" });
    expect(changes).toEqual([
      { label: "City", from: "Calabar", to: "Ikom" },
    ]);
  });

  it("confirms date and venue together in one email", () => {
    const changes = describeChanges(TBA, {
      ...TBA,
      dateTbd: false,
      venueTbd: false,
    });
    expect(changes.map((c) => c.label)).toEqual([
      "Starts",
      "Ends",
      "Venue",
      "Address",
    ]);
  });
});
