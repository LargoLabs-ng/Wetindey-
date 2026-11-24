import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { NotificationSettings } from "@/components/notification-settings";
import { WordMark } from "@/components/wordmark";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fprofile%2Fnotifications");

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <WordMark />
          <Link href="/notifications" className="text-sm font-semibold text-purple">
            Notifications
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Link href="/profile" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Profile
        </Link>
        <h1 className="text-2xl font-bold text-ink">Notification settings</h1>
        <p className="mb-5 mt-1 text-sm text-ink-2">Choose what reaches you, and where. Changes save straight away.</p>
        <NotificationSettings />
      </main>
    </div>
  );
}
