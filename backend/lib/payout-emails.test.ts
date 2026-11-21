import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const { adminNewRequestEmail, bankChangedEmail, organiserStatusEmail } = await import("./payout-emails");

const base = {
  organisation: "Prosper Francis Events",
  amount: 71250,
  bankName: "Access Bank",
  accountNumber: "0123456789",
  note: null,
  paymentReference: null,
};

describe("payout emails", () => {
  it("admin alert links to the request and carries no bank details", () => {
    const e = adminNewRequestEmail({
      payoutId: "abc-123",
      organisation: "Prosper Francis Events",
      amount: 71250,
      requestedBy: "Prosper Francis",
      available: 71250,
    });
    expect(e.subject).toBe("Payout request: ₦71,250.00 from Prosper Francis Events");
    expect(e.html).toContain("/admin/payouts/abc-123");
    expect(e.html).not.toContain("0123456789");
  });

  it("approved, paid, rejected and failed each say what happened, with the account masked", () => {
    const approved = organiserStatusEmail({ ...base, status: "approved" });
    const paid = organiserStatusEmail({ ...base, status: "paid", paymentReference: "NIP-0001" });
    const rejected = organiserStatusEmail({ ...base, status: "rejected", note: "Name doesn't match the account." });
    const failed = organiserStatusEmail({ ...base, status: "failed", note: "Bank returned it." });

    expect(approved.subject).toBe("Your ₦71,250.00 payout has been approved");
    expect(paid.subject).toBe("₦71,250.00 has been sent to your bank");
    expect(paid.html).toContain("NIP-0001");
    expect(rejected.subject).toContain("wasn't approved");
    expect(rejected.html).toContain("back in your available balance");
    expect(failed.html).toContain("still set aside");

    for (const e of [approved, paid, failed]) expect(e.html).toContain("····\u00a06789");
    for (const e of [approved, paid, rejected, failed]) {
      expect(e.html).not.toContain("0123456789");
      expect(e.html).toContain("/dashboard/finance");
    }
  });

  it("escapes anything an organiser or admin typed", () => {
    const e = organiserStatusEmail({
      ...base,
      organisation: "Rock & <Roll>",
      status: "rejected",
      note: "<script>alert(1)</script>",
    });
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;script&gt;");
    expect(e.html).toContain("Rock &amp; &lt;Roll&gt;");
  });

  it("bank change notice shows before and after, last four digits only", () => {
    const changed = bankChangedEmail({
      organisation: "Kleenicks",
      changedAt: new Date("2026-11-21T12:00:00Z"),
      before: { bankName: "GTBank", accountNumber: "0011223344" },
      after: { bankName: "Opay", accountName: "Ada Okafor", accountNumber: "8012345678" },
    });
    expect(changed.subject).toBe("Your payout bank account was changed");
    expect(changed.html).toContain("GTBank ····\u00a03344");
    expect(changed.html).toContain("Opay ····\u00a05678");
    expect(changed.html).not.toContain("8012345678");
    expect(changed.html).toContain("Wasn't you?");

    const added = bankChangedEmail({
      organisation: "Kleenicks",
      changedAt: new Date(),
      before: null,
      after: { bankName: "Opay", accountName: "Ada Okafor", accountNumber: "8012345678" },
    });
    expect(added.subject).toBe("Payout bank account added");
    expect(added.html).not.toContain("Before:");
  });
});
