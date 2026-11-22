import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "./safe-redirect";

describe("safeCallbackPath", () => {
  it("keeps an ordinary path, with its query and hash", () => {
    expect(safeCallbackPath("/events/tedx?tier=abc&qty=2&buy=1", "/")).toBe(
      "/events/tedx?tier=abc&qty=2&buy=1"
    );
    expect(safeCallbackPath("/my-events#upcoming", "/")).toBe("/my-events#upcoming");
  });

  it("falls back when there is nothing usable", () => {
    expect(safeCallbackPath(null, "/dashboard")).toBe("/dashboard");
    expect(safeCallbackPath(undefined, "/")).toBe("/");
    expect(safeCallbackPath("", "/")).toBe("/");
    expect(safeCallbackPath("events/tedx", "/")).toBe("/");
  });

  it("refuses every way of naming another site", () => {
    for (const bad of [
      "//evil.example",
      "//evil.example/events",
      "/\\evil.example",
      "/\\/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/\tevil.example",
      " //evil.example",
    ]) {
      expect(safeCallbackPath(bad, "/")).toBe("/");
    }
  });
});
