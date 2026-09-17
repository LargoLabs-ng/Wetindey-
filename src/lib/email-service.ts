import nodemailer from 'nodemailer';
import { SUPPORT_EMAIL } from './app-url';
import { BRAND_NAME } from './brand';

/**
 * Email service for sending transactional emails
 * Supports multiple providers: Resend, SendGrid, SMTP
 */

/**
 * An image or file carried with the message rather than linked from it.
 *
 * `contentId` is what makes an image render *inside* the body: the HTML
 * points at `cid:<contentId>` and the mail client resolves it against the
 * attached part. Data URIs (`<img src="data:image/png;base64,...">`) are
 * stripped by Gmail, Outlook and essentially every other major client, so
 * an inline attachment is the only reliable way to show a QR code in an
 * email.
 */
export interface EmailAttachment {
  filename: string;
  /** Raw base64 — no `data:` prefix. */
  base64: string;
  contentType: string;
  /** Set to render inline via `cid:`; omit for a plain attachment. */
  contentId?: string;
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

/**
 * Splits `data:image/png;base64,AAAA` into its parts.
 * Returns null for anything that isn't a base64 data URI.
 */
export function parseDataUrl(
  dataUrl: string
): { contentType: string; base64: string } | null {
  // [\s\S] rather than the `s` (dotAll) flag, which TypeScript rejects
  // below an es2018 target — and Next's default tsconfig targets es2017.
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  return { contentType: match[1], base64: match[2] };
}

// Initialize email transporter
let transporter: any = null;

function getTransporter() {
  if (transporter) return transporter;

  const emailProvider = process.env.EMAIL_PROVIDER || 'smtp';

  if (emailProvider === 'resend') {
    // Using Resend via nodemailer
    transporter = nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 587,
      auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY || '',
      },
    });
  } else if (emailProvider === 'sendgrid') {
    // Using SendGrid via nodemailer
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY || '',
      },
    });
  } else {
    // Using SMTP (Gmail, custom server, etc.)
    transporter = nodemailer.createTransport({
      service: process.env.SMTP_SERVICE || 'gmail',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASSWORD || '',
      },
    });
  }

  return transporter;
}

/**
 * Send email
 */
export type SendResult = { ok: boolean; error?: string };

/**
 * Resend over HTTPS rather than their SMTP relay.
 *
 * SMTP on port 587 is blocked by plenty of networks, keeps a connection
 * open (a poor fit for serverless functions), and reports failures as
 * opaque timeouts. The HTTP API returns a JSON error we can actually show
 * someone.
 */
async function sendViaResend(
  from: string,
  options: EmailOptions
): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY is not set." };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      // Resend's REST API is snake_case: content_id, not contentId (that
      // spelling belongs to their Node SDK). Getting this wrong silently
      // downgrades an inline image to a plain attachment.
      ...(options.attachments?.length
        ? {
            attachments: options.attachments.map((a) => ({
              filename: a.filename,
              content: a.base64,
              content_type: a.contentType,
              ...(a.contentId ? { content_id: a.contentId } : {}),
            })),
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, error: `Resend ${response.status}: ${body}` };
  }
  return { ok: true };
}

/**
 * Send an email. Returns why it failed rather than just false, so callers
 * can tell the user something useful — a silently swallowed error here is
 * how every invitation and ticket went missing without a trace.
 */
export async function sendEmailWithResult(
  options: EmailOptions
): Promise<SendResult> {
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";

  try {
    if ((process.env.EMAIL_PROVIDER || "smtp") === "resend") {
      const result = await sendViaResend(from, options);
      if (!result.ok) console.error("Email to " + options.to + " failed:", result.error);
      return result;
    }

    const transporter = getTransporter();
    await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      replyTo: options.replyTo || from,
      ...(options.attachments?.length
        ? {
            attachments: options.attachments.map((a) => ({
              filename: a.filename,
              content: Buffer.from(a.base64, "base64"),
              contentType: a.contentType,
              ...(a.contentId
                ? { cid: a.contentId, contentDisposition: "inline" as const }
                : {}),
            })),
          }
        : {}),
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Email to " + options.to + " failed:", message);
    return { ok: false, error: message };
  }
}

/** Backwards-compatible boolean wrapper. */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  return (await sendEmailWithResult(options)).ok;
}

/**
 * Send order confirmation with tickets and QR codes
 */
export async function sendOrderConfirmation(data: {
  attendeeEmail: string;
  attendeeFirstName: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventVenue: string;
  eventCity: string;
  tickets: Array<{
    id: string;
    attendeeName: string;
    qrCode: string; // base64 data URL
    ticketType: string;
  }>;
  orderId: string;
  totalAmount: number;
}): Promise<boolean> {
  const subject = `Your tickets for ${data.eventTitle} are ready! 🎉`;

  // Every QR travels as an inline attachment referenced by `cid:`. It used
  // to be inlined as a base64 data URI, which Gmail strips — the buyer got
  // a broken-image placeholder where their ticket should have been. If the
  // QR somehow isn't a data URI we fall back to using it as a src directly
  // rather than dropping the image entirely.
  const attachments: EmailAttachment[] = [];

  const ticketsHtml = data.tickets
    .map((ticket, index) => {
      const parsed = parseDataUrl(ticket.qrCode);
      let imgSrc = ticket.qrCode;

      if (parsed) {
        const contentId = `qr-${ticket.id}`;
        attachments.push({
          filename: `ticket-${index + 1}-qr.png`,
          base64: parsed.base64,
          contentType: parsed.contentType,
          contentId,
        });
        imgSrc = `cid:${contentId}`;
      }

      return `
    <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 16px; background-color: #ffffff;">
      <p style="color: #6b7280; font-size: 12px; margin: 0 0 8px 0;">Ticket for</p>
      <h3 style="color: #12372a; margin: 0 0 12px 0; font-size: 18px;">${ticket.attendeeName}</h3>
      <p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">${ticket.ticketType}</p>

      <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; text-align: center; margin: 16px 0;">
        <img src="${imgSrc}" alt="QR code for ${ticket.attendeeName}" width="200" height="200" style="width: 200px; height: 200px; margin: 0 auto; display: block;" />
      </div>

      <p style="color: #6b7280; font-size: 12px; margin: 0; text-align: center;">
        Show this QR code at the event entrance
      </p>
    </div>
  `;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif; line-height: 1.5; color: #333; }
          a { color: #12372a; text-decoration: none; }
        </style>
      </head>
      <body style="background-color: #f9f9f9; padding: 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden;">
          <!-- Header -->
          <div style="background-color: #12372a; padding: 32px 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Your Tickets Are Ready! 🎉</h1>
          </div>

          <!-- Content -->
          <div style="padding: 32px 20px;">
            <p style="color: #374151; margin: 0 0 16px 0;">Hi ${data.attendeeFirstName},</p>

            <p style="color: #6b7280; margin: 0 0 24px 0;">
              Your tickets for <strong>${data.eventTitle}</strong> are confirmed and ready to use. Download or screenshot your QR codes below—you'll need them to enter the event.
            </p>

            <!-- Event Details -->
            <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin-bottom: 24px;">
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">
                <strong>Event Details</strong>
              </p>
              <p style="color: #374151; margin: 0 0 4px 0;">${data.eventTitle}</p>
              <p style="color: #6b7280; font-size: 13px; margin: 0;">
                ${data.eventDate} at ${data.eventTime}<br>
                ${data.eventVenue}, ${data.eventCity}
              </p>
            </div>

            <!-- Tickets -->
            <p style="color: #6b7280; font-size: 14px; margin: 0 0 16px 0;">
              <strong>Your Tickets</strong>
            </p>

            ${ticketsHtml}

            <!-- Instructions -->
            <div style="background-color: #dbeafe; border-left: 4px solid #0284c7; padding: 12px 16px; border-radius: 4px; margin: 24px 0;">
              <p style="color: #075985; font-size: 14px; margin: 0;">
                <strong>How to use your QR code:</strong><br>
                1. Open this email on your phone or print it out<br>
                2. Show your QR code at the event entrance<br>
                3. Our staff will scan it to verify you're all set
              </p>
              <p style="color: #075985; font-size: 12px; margin: 8px 0 0 0;">
                Can't see the code above? Each one is also attached to this email as a PNG.
              </p>
            </div>

            <!-- Support -->
            <p style="color: #6b7280; font-size: 13px; margin: 24px 0 0 0; border-top: 1px solid #e5e7eb; padding-top: 20px;">
              ${SUPPORT_EMAIL ? `Questions? Contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>` : "Questions? Reply to this email."}
            </p>

            <p style="color: #9ca3af; font-size: 12px; margin: 12px 0 0 0;">
              Order #${data.orderId} | Total: ₦${data.totalAmount.toLocaleString()}
            </p>
          </div>

          <!-- Footer -->
          <div style="background-color: #f9fafb; padding: 20px; text-align: center; border-top: 1px solid #e5e7eb;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              © ${BRAND_NAME} — your plug for what’s happening.
            </p>
          </div>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    to: data.attendeeEmail,
    subject,
    html,
    attachments,
  });
}

/**
 * Send event reminder email
 */
export async function sendEventReminder(data: {
  attendeeEmail: string;
  attendeeFirstName: string;
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventVenue: string;
}): Promise<boolean> {
  const subject = `Reminder: ${data.eventTitle} is ${data.eventDate} 🎟️`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif; line-height: 1.5; color: #333; background-color: #f9f9f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; padding: 32px 20px;">
          <h2 style="color: #12372a; margin: 0 0 16px 0;">Event Reminder</h2>

          <p style="color: #374151; margin: 0 0 16px 0;">Hi ${data.attendeeFirstName},</p>

          <p style="color: #6b7280; margin: 0 0 24px 0;">
            This is a friendly reminder that <strong>${data.eventTitle}</strong> is happening soon!
          </p>

          <div style="background-color: #f3f4f6; padding: 16px; border-radius: 6px; margin-bottom: 24px;">
            <p style="color: #374151; margin: 0 0 8px 0;"><strong>${data.eventTitle}</strong></p>
            <p style="color: #6b7280; font-size: 14px; margin: 0;">
              📅 ${data.eventDate}<br>
              🕐 ${data.eventTime}<br>
              📍 ${data.eventVenue}
            </p>
          </div>

          <p style="color: #6b7280; margin: 0;">
            Make sure you have your QR ticket ready. See you there!
          </p>

          <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0 0; border-top: 1px solid #e5e7eb; padding-top: 20px;">
            © ${BRAND_NAME}
          </p>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    to: data.attendeeEmail,
    subject,
    html,
  });
}
