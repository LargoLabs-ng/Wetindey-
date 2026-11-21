import { describe, expect, it } from "vitest";
import {
  allowedActions,
  nextStatus,
  PAYOUT_ACTIONS,
  PAYOUT_STATUSES,
  validateAction,
} from "./payout-lifecycle";

describe("payout lifecycle", () => {
  it("follows pending → approved → processing → paid", () => {
    expect(nextStatus("pending", "approve")).toBe("approved");
    expect(nextStatus("approved", "process")).toBe("processing");
    expect(nextStatus("processing", "mark_paid")).toBe("paid");
  });

  it("requires approval before processing", () => {
    expect(nextStatus("pending", "process")).toBeNull();
    expect(nextStatus("pending", "mark_paid")).toBeNull();
  });

  it("never lets approval mark a payout paid", () => {
    expect(nextStatus("pending", "approve")).not.toBe("paid");
    expect(nextStatus("approved", "mark_paid")).toBeNull();
  });

  it("handles failed transfers: retry or reject", () => {
    expect(nextStatus("processing", "mark_failed")).toBe("failed");
    expect(nextStatus("failed", "process")).toBe("processing");
    expect(nextStatus("failed", "reject")).toBe("rejected");
    expect(nextStatus("failed", "mark_paid")).toBeNull();
  });

  it("allows rejection from pending, approved and failed only", () => {
    expect(nextStatus("pending", "reject")).toBe("rejected");
    expect(nextStatus("approved", "reject")).toBe("rejected");
    expect(nextStatus("processing", "reject")).toBeNull();
  });

  it("treats paid and rejected as final", () => {
    for (const action of PAYOUT_ACTIONS) {
      expect(nextStatus("paid", action)).toBeNull();
      expect(nextStatus("rejected", action)).toBeNull();
    }
    expect(allowedActions("paid")).toEqual([]);
    expect(allowedActions("rejected")).toEqual([]);
  });

  it("lists the buttons for each status", () => {
    expect(allowedActions("pending")).toEqual(["approve", "reject"]);
    expect(allowedActions("approved")).toEqual(["process", "reject"]);
    expect(allowedActions("processing")).toEqual(["mark_paid", "mark_failed"]);
    expect(allowedActions("failed")).toEqual(["process", "reject"]);
  });

  it("matches the full table of allowed moves exactly", () => {
    const allowed = new Set([
      "pending:approve", "pending:reject",
      "approved:process", "approved:reject",
      "processing:mark_paid", "processing:mark_failed",
      "failed:process", "failed:reject",
    ]);
    for (const status of PAYOUT_STATUSES) {
      for (const action of PAYOUT_ACTIONS) {
        expect(nextStatus(status, action) !== null, `${status}:${action}`).toBe(
          allowed.has(`${status}:${action}`)
        );
      }
    }
  });
});

describe("validateAction", () => {
  it("requires a rejection reason of at least 10 characters", () => {
    expect(validateAction("pending", { action: "reject" }).ok).toBe(false);
    expect(validateAction("pending", { action: "reject", reason: "  too short " }).ok).toBe(false);
    const ok = validateAction("pending", { action: "reject", reason: "Bank details don't match the organiser name." });
    expect(ok.ok && ok.value.organiserNote).toBe("Bank details don't match the organiser name.");
  });

  it("requires a transfer reference to mark paid, trimmed", () => {
    expect(validateAction("processing", { action: "mark_paid" }).ok).toBe(false);
    expect(validateAction("processing", { action: "mark_paid", paymentReference: " 12 " }).ok).toBe(false);
    const ok = validateAction("processing", { action: "mark_paid", paymentReference: "  NIP/000123  " });
    expect(ok.ok && ok.value.paymentReference).toBe("NIP/000123");
    expect(ok.ok && ok.value.to).toBe("paid");
  });

  it("clears the organiser-facing note on approve, retry and paid", () => {
    for (const [from, action] of [["pending", "approve"], ["failed", "process"]] as const) {
      const r = validateAction(from, { action });
      expect(r.ok && r.value.organiserNote).toBeNull();
    }
  });

  it("explains why a final request cannot change", () => {
    const r = validateAction("paid", { action: "mark_paid", paymentReference: "REF-0001" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/already paid/);
  });
});
