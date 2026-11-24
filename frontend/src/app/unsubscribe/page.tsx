import Link from "next/link";
import { UnsubscribeConfirm } from "@/components/unsubscribe-confirm";
import { WordMark } from "@/components/wordmark";
import { emailName, readUnsubscribeToken } from "@/lib/notifications/unsubscribe";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

/**
 * Opening the link changes nothing by itself. Many mail services open every
 * link in an email to check it, and that must not unsubscribe anyone, so the
 * change happens only when the person taps the button.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const check = readUnsubscribeToken(t);

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-lg items-center px-4 py-3">
          <WordMark />
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">
        {check.ok ? (
          <UnsubscribeConfirm token={t!} name={emailName(check.category)} />
        ) : (
          <div className="rounded-2xl border border-line bg-card p-5 sm:p-6">
            <h1 className="text-xl font-bold text-ink">
              {check.reason === "expired" ? "This link has expired" : "This link doesn't work"}
            </h1>
            <p className="mt-2 text-sm text-ink-2">
              Sign in and choose which emails you get in your notification settings.
            </p>
            <Link
              href="/profile/notifications"
              className="mt-5 inline-block rounded-xl bg-purple px-5 py-3 font-bold text-white"
            >
              Notification settings
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
