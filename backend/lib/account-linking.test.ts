import { describe, expect, it } from "vitest";
import { decideGoogleLink } from "./account-linking";

describe("decideGoogleLink", () => {
  it("refuses a Google sign-in whose email Google hasn't confirmed", () => {
    expect(decideGoogleLink({ googleEmailVerified: false, existing: null })).toBe("deny");
    expect(
      decideGoogleLink({
        googleEmailVerified: false,
        existing: { hasPassword: true, emailVerified: true },
      })
    ).toBe("deny");
  });

  it("allows a brand-new account", () => {
    expect(decideGoogleLink({ googleEmailVerified: true, existing: null })).toBe("allow");
  });

  it("drops a password nobody ever confirmed (the takeover case)", () => {
    expect(
      decideGoogleLink({
        googleEmailVerified: true,
        existing: { hasPassword: true, emailVerified: false },
      })
    ).toBe("allow-drop-password");
  });

  it("keeps a password whose owner confirmed the email", () => {
    expect(
      decideGoogleLink({
        googleEmailVerified: true,
        existing: { hasPassword: true, emailVerified: true },
      })
    ).toBe("allow");
  });

  it("allows an existing Google-only account", () => {
    expect(
      decideGoogleLink({
        googleEmailVerified: true,
        existing: { hasPassword: false, emailVerified: true },
      })
    ).toBe("allow");
  });
});
