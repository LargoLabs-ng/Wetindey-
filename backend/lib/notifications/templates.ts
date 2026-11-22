/**
 * The one email layout every notification uses: phone-first, plain, on brand.
 *
 * Everything that came from a person (event titles, names) must already be
 * plain text; this escapes it. Links are built by the caller with appUrl().
 */
import { BRAND_NAME } from "@/lib/brand";
import { escapeHtml } from "@/lib/email-service";

export type EmailBlock = {
  /** Shown in the inbox list next to the subject on most mail apps. */
  preheader?: string;
  title: string;
  paragraphs: string[];
  cta?: { label: string; url: string } | null;
  /** Small print under the button. */
  footnote?: string;
};

export function renderEmail(block: EmailBlock): string {
  const paragraphs = block.paragraphs
    .map((p) => `<p style="margin: 0 0 14px 0;">${escapeHtml(p)}</p>`)
    .join("");
  const cta = block.cta
    ? `<p style="margin: 8px 0 22px 0;"><a href="${escapeHtml(block.cta.url)}" style="display: inline-block; background: #6c3cff; color: #ffffff; text-decoration: none; font-weight: 700; padding: 12px 22px; border-radius: 10px;">${escapeHtml(block.cta.label)}</a></p>`
    : "";
  const footnote = block.footnote
    ? `<p style="margin: 0; font-size: 13px; color: #6b6780;">${escapeHtml(block.footnote)}</p>`
    : "";
  const preheader = block.preheader
    ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(block.preheader)}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1f1a2e; background-color: #f8f7f3; margin: 0; padding: 24px 12px;">
    ${preheader}
    <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 28px 22px;">
      <h1 style="margin: 0 0 16px 0; font-size: 20px; line-height: 1.3;">${escapeHtml(block.title)}</h1>
      ${paragraphs}
      ${cta}
      ${footnote}
      <p style="margin: 24px 0 0 0; font-size: 12px; color: #9a96a8;">© ${escapeHtml(BRAND_NAME)}</p>
    </div>
  </body>
</html>`;
}
