/**
 * Payout emails.
 *
 *   - admins (ADMIN_EMAILS) when an organiser asks for money
 *   - the organiser when their request is approved, paid, rejected or failed
 *   - the organisation owner whenever its payout bank details change
 *
 * A failed email never blocks or undoes the action that triggered it: every
 * sender catches and logs. Routes call these through `after()`, so the
 * person clicking does not wait on the mail provider.
 *
 * Account numbers in emails are always masked to the last four digits:
 * email gets forwarded, screenshotted and read on shared phones. The full
 * number lives behind the admin screen's permission check, not in inboxes.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, payouts, users } from "@/db/schema";
import { appUrl, SUPPORT_EMAIL } from "@/lib/app-url";
import { BRAND_NAME } from "@/lib/brand";
import { escapeHtml, sendEmailWithResult } from "@/lib/email-service";

// ── Pure builders (tested) ──────────────────────────────────────────────

export const nairaText = (n: number) =>
  `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const last4 = (accountNumber: string | null | undefined) =>
  // A non-breaking space keeps "···· 6789" on one line on a phone.
  accountNumber ? `····\u00a0${accountNumber.slice(-4)}` : "····";

export type BuiltEmail = { subject: string; html: string };

function layout(input: { heading: string; sub?: string; body: string; cta?: { href: string; label: string } }): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#333;background-color:#f9f9f9;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;">
    <div style="background-color:#0F0B1A;padding:28px 20px;">
      <h1 style="color:#ffffff;margin:0;font-size:22px;">${input.heading}</h1>
      ${input.sub ? `<p style="color:#A8A2BD;margin:8px 0 0 0;font-size:14px;">${input.sub}</p>` : ""}
    </div>
    <div style="padding:28px 20px;color:#374151;font-size:15px;">
      ${input.body}
      ${
        input.cta
          ? `<p style="margin:24px 0 0 0;"><a href="${input.cta.href}" style="display:inline-block;background-color:#6C3CFF;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600;">${input.cta.label}</a></p>`
          : ""
      }
    </div>
    <div style="background-color:#f9fafb;padding:18px 20px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">© ${BRAND_NAME} — your plug for what's happening.</p>
    </div>
  </div>
</body></html>`;
}

const support = () =>
  SUPPORT_EMAIL
    ? `<a href="mailto:${SUPPORT_EMAIL}" style="color:#6C3CFF;">${SUPPORT_EMAIL}</a>`
    : `${BRAND_NAME} support`;

const box = (inner: string, accent = "#6C3CFF", bg = "#EFE9FF") =>
  `<div style="background-color:${bg};border-left:4px solid ${accent};padding:14px 16px;border-radius:4px;margin:16px 0;">${inner}</div>`;

export function adminNewRequestEmail(d: {
  payoutId: string;
  organisation: string;
  amount: number;
  requestedBy: string;
  available: number | null;
}): BuiltEmail {
  const org = escapeHtml(d.organisation);
  return {
    subject: `Payout request: ${nairaText(d.amount)} from ${d.organisation}`,
    html: layout({
      heading: `${nairaText(d.amount)} payout requested`,
      sub: `${org} · requested by ${escapeHtml(d.requestedBy)}`,
      body: `<p style="margin:0 0 12px 0;">A new organiser payout request is waiting for review.</p>
        ${d.available === null ? "" : `<p style="margin:0;color:#6b7280;font-size:14px;">Their settled balance available when they asked: <strong>${nairaText(d.available)}</strong>.</p>`}
        <p style="margin:12px 0 0 0;color:#6b7280;font-size:14px;">Bank details are on the request page, behind the admin sign-in.</p>`,
      cta: { href: appUrl(`/admin/payouts/${d.payoutId}`), label: "Review the request" },
    }),
  };
}

export type OrganiserStatus = "approved" | "paid" | "rejected" | "failed";

export function organiserStatusEmail(d: {
  status: OrganiserStatus;
  organisation: string;
  amount: number;
  bankName: string | null;
  accountNumber: string | null;
  note: string | null;
  paymentReference: string | null;
}): BuiltEmail {
  const amount = nairaText(d.amount);
  const to = `${escapeHtml(d.bankName ?? "your bank")} ${last4(d.accountNumber)}`;
  const finance = { href: appUrl("/dashboard/finance"), label: "Open Finance" };
  const note = d.note ? escapeHtml(d.note) : null;

  switch (d.status) {
    case "approved":
      return {
        subject: `Your ${amount} payout has been approved`,
        html: layout({
          heading: "Payout approved",
          sub: escapeHtml(d.organisation),
          body: `<p style="margin:0;">Your request for <strong>${amount}</strong> has been approved. We'll send it to ${to} and email you again once the transfer has gone through.</p>`,
          cta: finance,
        }),
      };
    case "paid":
      return {
        subject: `${amount} has been sent to your bank`,
        html: layout({
          heading: `${amount} is on its way`,
          sub: escapeHtml(d.organisation),
          body: `<p style="margin:0;">We've sent your payout to ${to}.</p>
            ${box(`<p style="margin:0;color:#0F0B1A;"><strong>Transfer reference:</strong> ${escapeHtml(d.paymentReference ?? "—")}</p>
              <p style="margin:6px 0 0 0;color:#55506B;font-size:14px;">Banks sometimes take a little while to show it. If it hasn't arrived by the next working day, contact ${support()} with this reference.</p>`)}`,
          cta: finance,
        }),
      };
    case "rejected":
      return {
        subject: `Your ${amount} payout request wasn't approved`,
        html: layout({
          heading: "Payout request not approved",
          sub: escapeHtml(d.organisation),
          body: `<p style="margin:0;">We couldn't approve your request for <strong>${amount}</strong>. The amount is back in your available balance.</p>
            ${note ? box(`<p style="margin:0 0 4px 0;color:#6b7280;font-size:13px;"><strong>Reason</strong></p><p style="margin:0;color:#374151;">${note}</p>`, "#9ca3af", "#f3f4f6") : ""}
            <p style="margin:0;color:#6b7280;font-size:14px;">You can fix anything needed and request again from your Finance page.</p>`,
          cta: finance,
        }),
      };
    case "failed":
      return {
        subject: `We couldn't complete your ${amount} transfer yet`,
        html: layout({
          heading: "Transfer didn't go through",
          sub: escapeHtml(d.organisation),
          body: `<p style="margin:0;">Our transfer of <strong>${amount}</strong> to ${to} didn't go through. Your money is safe and still set aside for you; we'll try again or contact you.</p>
            ${note ? box(`<p style="margin:0;color:#374151;">${note}</p>`, "#9ca3af", "#f3f4f6") : ""}
            <p style="margin:0;color:#6b7280;font-size:14px;">Please check that your bank details on the Finance page are correct.</p>`,
          cta: finance,
        }),
      };
  }
}

export function bankChangedEmail(d: {
  organisation: string;
  changedAt: Date;
  before: { bankName: string | null; accountNumber: string | null } | null;
  after: { bankName: string; accountName: string; accountNumber: string };
}): BuiltEmail {
  const when = d.changedAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
  const was = d.before?.accountNumber
    ? `${escapeHtml(d.before.bankName ?? "")} ${last4(d.before.accountNumber)}`
    : null;
  const now = `${escapeHtml(d.after.bankName)} ${last4(d.after.accountNumber)} (${escapeHtml(d.after.accountName)})`;
  return {
    subject: was ? "Your payout bank account was changed" : "Payout bank account added",
    html: layout({
      heading: was ? "Payout bank account changed" : "Payout bank account added",
      sub: escapeHtml(d.organisation),
      body: `<p style="margin:0;">On ${escapeHtml(when)}, the account ${BRAND_NAME} pays your ticket money into was ${was ? "changed" : "set"}.</p>
        ${box(`${was ? `<p style="margin:0;color:#55506B;font-size:14px;">Before: ${was}</p>` : ""}<p style="margin:${was ? "6px" : "0"} 0 0 0;color:#0F0B1A;"><strong>Now: ${now}</strong></p>`)}
        <p style="margin:0;color:#b91c1c;font-size:14px;"><strong>Wasn't you?</strong> Change your password straight away and contact ${support()} before requesting any payout.</p>`,
      cta: { href: appUrl("/dashboard/finance"), label: "Check your Finance page" },
    }),
  };
}

// ── Senders (load, build, send; never throw) ────────────────────────────

function adminRecipients(): string[] {
  return [
    ...new Set(
      (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@"))
    ),
  ];
}

const displayName = (u: { firstName: string | null; lastName: string | null; name: string | null; email: string }) =>
  [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.name || u.email;

async function loadPayout(payoutId: string) {
  const [row] = await db
    .select({
      id: payouts.id,
      status: payouts.status,
      amount: payouts.netAmount,
      bankName: payouts.bankName,
      accountNumber: payouts.bankAccountNumber,
      note: payouts.note,
      paymentReference: payouts.paymentReference,
      availableAtRequest: payouts.availableAtRequest,
      requestedBy: payouts.requestedBy,
      organisation: organizations.name,
      ownerId: organizations.ownerId,
    })
    .from(payouts)
    .innerJoin(organizations, eq(organizations.id, payouts.organizationId))
    .where(eq(payouts.id, payoutId))
    .limit(1);
  return row ?? null;
}

async function loadUser(id: string | null) {
  if (!id) return null;
  const [u] = await db
    .select({ email: users.email, firstName: users.firstName, lastName: users.lastName, name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return u ?? null;
}

export async function notifyAdminsOfPayoutRequest(payoutId: string): Promise<void> {
  try {
    const recipients = adminRecipients();
    if (recipients.length === 0) return;
    const p = await loadPayout(payoutId);
    if (!p) return;
    const requester = await loadUser(p.requestedBy);
    const email = adminNewRequestEmail({
      payoutId,
      organisation: p.organisation,
      amount: Number(p.amount),
      requestedBy: requester ? displayName(requester) : "the organiser",
      available: p.availableAtRequest === null ? null : Number(p.availableAtRequest),
    });
    for (const to of recipients) await sendEmailWithResult({ to, ...email });
  } catch (error) {
    console.error("Could not email admins about payout request", payoutId, error);
  }
}

export async function notifyOrganiserOfPayoutStatus(payoutId: string): Promise<void> {
  try {
    const p = await loadPayout(payoutId);
    if (!p || !["approved", "paid", "rejected", "failed"].includes(p.status)) return;
    const [owner, requester] = await Promise.all([loadUser(p.ownerId), loadUser(p.requestedBy)]);
    const recipients = [...new Set([owner?.email, requester?.email].filter((e): e is string => Boolean(e)))];
    const email = organiserStatusEmail({
      status: p.status as OrganiserStatus,
      organisation: p.organisation,
      amount: Number(p.amount),
      bankName: p.bankName,
      accountNumber: p.accountNumber,
      note: p.note,
      paymentReference: p.paymentReference,
    });
    for (const to of recipients) await sendEmailWithResult({ to, ...email });
  } catch (error) {
    console.error("Could not email organiser about payout", payoutId, error);
  }
}

export async function notifyBankDetailsChanged(input: {
  organizationId: string;
  before: { bankName: string | null; accountNumber: string | null } | null;
  after: { bankName: string; accountName: string; accountNumber: string };
}): Promise<void> {
  try {
    const [org] = await db
      .select({ name: organizations.name, ownerId: organizations.ownerId })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);
    if (!org) return;
    const owner = await loadUser(org.ownerId);
    if (!owner?.email) return;
    const email = bankChangedEmail({
      organisation: org.name,
      changedAt: new Date(),
      before: input.before,
      after: input.after,
    });
    await sendEmailWithResult({ to: owner.email, ...email });
  } catch (error) {
    console.error("Could not email bank-change notice for", input.organizationId, error);
  }
}
