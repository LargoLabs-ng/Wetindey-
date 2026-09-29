import { describe, expect, it } from "vitest";
import { bannerSlides, isSafeHttpUrl, safeHttpUrl, youtubeId } from "./media";

describe("youtubeId — the shapes people actually paste", () => {
  const ID = "dQw4w9WgXcQ";

  it("takes the phone share-sheet link", () => {
    expect(youtubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(youtubeId(`https://youtu.be/${ID}?t=42`)).toBe(ID);
  });

  it("takes the desktop watch link, tracking parameters and all", () => {
    expect(youtubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(
      youtubeId(`https://www.youtube.com/watch?v=${ID}&list=PLxyz&index=3&t=9s`)
    ).toBe(ID);
  });

  it("takes an embed URL copied from another site", () => {
    expect(youtubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube-nocookie.com/embed/${ID}?rel=0`)).toBe(ID);
  });

  it("takes Shorts, live and the old /v/ form", () => {
    expect(youtubeId(`https://youtube.com/shorts/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(youtubeId(`https://www.youtube.com/v/${ID}`)).toBe(ID);
  });

  it("copes with m., no protocol, and stray whitespace", () => {
    expect(youtubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeId(`youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(youtubeId(`  https://youtu.be/${ID}  `)).toBe(ID);
  });

  it("takes a bare id", () => {
    expect(youtubeId(ID)).toBe(ID);
  });

  it("refuses everything else", () => {
    expect(youtubeId("")).toBeNull();
    expect(youtubeId("https://vimeo.com/123456")).toBeNull();
    expect(youtubeId("https://www.youtube.com/playlist?list=PLxyz")).toBeNull();
    expect(youtubeId("https://www.youtube.com/@somechannel")).toBeNull();
    expect(youtubeId("not a url at all")).toBeNull();
    expect(youtubeId("https://youtu.be/tooshort")).toBeNull();
  });

  // A lookalike domain must not be treated as YouTube — the embed would be
  // somebody else's iframe on the organiser's page.
  it("refuses a lookalike host", () => {
    expect(youtubeId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});

describe("bannerSlides", () => {
  it("puts the cover first", () => {
    const slides = bannerSlides("https://img/cover.jpg", [
      { kind: "image", url: "https://img/two.jpg" },
    ]);
    expect(slides[0]).toEqual({ kind: "image", url: "https://img/cover.jpg" });
    expect(slides).toHaveLength(2);
  });

  it("works with no cover", () => {
    expect(bannerSlides(null, [{ kind: "image", url: "https://img/a.jpg" }])).toEqual([
      { kind: "image", url: "https://img/a.jpg" },
    ]);
  });

  it("works with no gallery", () => {
    expect(bannerSlides("https://img/cover.jpg", null)).toHaveLength(1);
    expect(bannerSlides(null, null)).toEqual([]);
  });

  it("stores a youtube slide as the id, not the link", () => {
    const slides = bannerSlides(null, [
      { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ?t=5" },
    ]);
    expect(slides).toEqual([{ kind: "youtube", url: "dQw4w9WgXcQ" }]);
  });

  it("drops a youtube link it can't parse rather than showing a blank frame", () => {
    const slides = bannerSlides(null, [
      { kind: "youtube", url: "https://vimeo.com/1" },
      { kind: "image", url: "https://img/a.jpg" },
    ]);
    expect(slides).toEqual([{ kind: "image", url: "https://img/a.jpg" }]);
  });

  it("drops duplicates, including the cover repeated in the gallery", () => {
    const slides = bannerSlides("https://img/cover.jpg", [
      { kind: "image", url: "https://img/cover.jpg" },
      { kind: "youtube", url: "https://youtu.be/dQw4w9WgXcQ" },
      { kind: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    ]);
    expect(slides).toHaveLength(2);
  });

  it("ignores junk entries", () => {
    const slides = bannerSlides(null, [
      { kind: "image", url: "   " },
      null as never,
      { kind: "image", url: "https://img/a.jpg" },
    ]);
    expect(slides).toEqual([{ kind: "image", url: "https://img/a.jpg" }]);
  });
});

// The check that `z.string().url()` isn't. Every one of these parses as a
// URL; only two of them are safe to put in an href.
describe("isSafeHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isSafeHttpUrl("https://example.com/a.png")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
    expect(isSafeHttpUrl("  https://example.com  ")).toBe(true);
  });

  it("refuses javascript:, which is the whole point", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("  javascript:alert(1)")).toBe(false);
  });

  it("refuses the other schemes that parse cleanly", () => {
    expect(isSafeHttpUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpUrl("mailto:someone@example.com")).toBe(false);
  });

  it("refuses non-strings and blanks", () => {
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
    expect(isSafeHttpUrl("   ")).toBe(false);
    expect(isSafeHttpUrl("not a url")).toBe(false);
  });
});

describe("safeHttpUrl", () => {
  it("returns the trimmed url when safe, null otherwise", () => {
    expect(safeHttpUrl("  https://example.com  ")).toBe("https://example.com");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});
