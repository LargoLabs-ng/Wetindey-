import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { NotificationList } from "@/components/notification-list";
import { WordMark } from "@/components/wordmark";

export const metadata = { title: "Notifications · Wetin Dey" };

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fnotifications");

  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <WordMark />
          <Link href="/dashboard" className="text-sm font-semibold text-purple">
            Dashboard
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-4 text-2xl font-bold text-ink">Notifications</h1>
        <NotificationList />
      </main>
    </div>
  );
}
