import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * The gate shell. Deliberately has no navigation: someone handed a phone at
 * the door should be able to reach the scanner and nothing else.
 */
export default async function CheckInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/checkin");

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line-dark">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Image
              src="/logo-reversed.png"
              alt=""
              width={64}
              height={64}
              priority
              className="h-9 w-9 rounded-lg object-contain"
            />
            <div>
              <p className="font-bold leading-tight tracking-tight text-on-dark">
                Check-in
              </p>
              <p className="text-xs text-on-dark-2">{session.user.name}</p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
