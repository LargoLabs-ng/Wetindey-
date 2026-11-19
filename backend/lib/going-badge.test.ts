import { describe, expect, it } from "vitest";
import { goingFloor, goingLabel, publicGoingFloor } from "./going-badge";

const TEDX = "2ff1e511-3d1e-4f1a-aa56-b40b991dfdd1";
const OTHER = "00000000-0000-4000-8000-000000000000";

describe("goingFloor", () => {
  it("hides the badge below 9", () => {
    for (const n of [0, 1, 5, 8]) expect(goingFloor(n)).toBeNull();
  });

  it("steps through 9, 20, 50, 100 and beyond", () => {
    const cases: Array<[number, number]> = [
      [9, 9], [19, 9], [20, 20], [49, 20], [50, 50], [99, 50],
      [100, 100], [199, 100], [200, 200], [499, 200], [500, 500],
      [999, 500], [1000, 1000], [2500, 2000], [7000, 5000], [12000, 10000],
    ];
    for (const [count, floor] of cases) expect(goingFloor(count)).toBe(floor);
  });

  it("never returns anything for nonsense counts", () => {
    expect(goingFloor(-3)).toBeNull();
    expect(goingFloor(Number.NaN)).toBeNull();
  });
});

describe("publicGoingFloor", () => {
  it("uses the real floor for ordinary events", () => {
    expect(publicGoingFloor(OTHER, 8)).toBeNull();
    expect(publicGoingFloor(OTHER, 19)).toBe(9);
    expect(publicGoingFloor(OTHER, 63)).toBe(50);
  });

  it("applies the TEDxUNIUYO floor, and climbs past it with real sales", () => {
    expect(publicGoingFloor(TEDX, 0)).toBe(80);
    expect(publicGoingFloor(TEDX, 19)).toBe(80);
    expect(publicGoingFloor(TEDX, 99)).toBe(80);
    expect(publicGoingFloor(TEDX, 100)).toBe(100);
  });
});

describe("goingLabel", () => {
  it("formats floors and stays silent without one", () => {
    expect(goingLabel(9)).toBe("9+ going");
    expect(goingLabel(80)).toBe("80+ going");
    expect(goingLabel(1000)).toBe("1,000+ going");
    expect(goingLabel(null)).toBeNull();
    expect(goingLabel(undefined)).toBeNull();
    expect(goingLabel(0)).toBeNull();
  });
});
