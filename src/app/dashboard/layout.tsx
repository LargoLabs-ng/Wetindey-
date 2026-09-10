import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasDashboardAccess } from "@/lib/authz";
import { SignOutButton } from "@/components/sign-out-button";
import { DashboardNav } from "@/components/dashboard-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Gate staff have no business in here — send them to the scanner.
  if (session?.user?.id && !(await hasDashboardAccess(session.user.id))) {
    redirect("/checkin");
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line-dark bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <Image
                src="/logo-reversed.png"
                alt=""
                width={64}
                height={64}
                priority
                className="h-9 w-9 rounded-lg object-contain"
              />
              <span className="font-bold tracking-tight text-on-dark">
                Ticket Buddy
              </span>
            </Link>
            <div className="hidden sm:block">
              <DashboardNav />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-on-dark-2 sm:inline">
              {session?.user?.name}
            </span>
            <SignOutButton />
          </div>
        </div>

        <div className="border-t border-line-dark px-4 py-2 sm:hidden">
          <DashboardNav />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
