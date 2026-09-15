import Link from "next/link";
import Image from "next/image";
import { auth } from "@/auth";
import { resolveInvite, INVITE_TTL_DAYS } from "@/lib/invites";
import { AcceptInviteButton } from "@/components/accept-invite-button";

const roleLabels: Record<string, string> = {
  owner: "Owner",
  event_manager: "Event Manager",
  gate_staff: "Gate Staff",
  finance: "Finance",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-ivory px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Image
            src="/logo.png"
            alt="Wetin Dey"
            width={48}
            height={48}
            className="mx-auto mb-4"
          />
        </div>
        <div className="bg-white border border-border rounded-2xl p-6">
          {children}
        </div>
      </div>
    </main>
  );
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const resolved = await resolveInvite(token);

  if (resolved.state !== "valid") {
    const messages = {
      missing: "This link is missing its invitation code.",
      unknown: "We couldn't find this invitation. The link may be wrong.",
      used: "This invitation has already been used.",
      expired: `Invitations expire after ${INVITE_TTL_DAYS} days. Ask whoever invited you to send a new one.`,
    } as const;

    return (
      <Shell>
        <h1 className="text-xl font-bold text-charcoal mb-1">
          Invitation unavailable
        </h1>
        <p className="text-secondary-text text-sm mb-6">
          {messages[resolved.state]}
        </p>
        <Link
          href="/"
          className="inline-block text-forest font-medium text-sm"
        >
          Go to Wetin Dey
        </Link>
      </Shell>
    );
  }

  const { email: inviteEmailRaw, role, contextName, kind } = resolved;
  const roleLabel = roleLabels[role] ?? role;
  const session = await auth();
  const signedInEmail = session?.user?.email?.toLowerCase();
  const inviteEmail = inviteEmailRaw.toLowerCase();
  const joining = kind === "event" ? "work on" : "join";

  const returnTo = `/team/accept-invite?token=${encodeURIComponent(token ?? "")}`;

  if (!signedInEmail) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-charcoal mb-1">
          You&apos;ve been invited
        </h1>
        <p className="text-secondary-text text-sm mb-6">
          You&apos;ve been invited to {joining}{" "}
          <strong className="text-charcoal">{contextName}</strong> as{" "}
          <strong className="text-charcoal">{roleLabel}</strong>. Sign in as{" "}
          {inviteEmailRaw} to accept.
        </p>
        <div className="space-y-3">
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(returnTo)}`}
            className="block w-full rounded-lg bg-forest text-ivory font-semibold py-2.5 text-center hover:bg-emerald transition-colors"
          >
            Log in to accept
          </Link>
          <Link
            href={`/signup?callbackUrl=${encodeURIComponent(returnTo)}`}
            className="block w-full rounded-lg border border-border py-2.5 text-center font-semibold text-charcoal hover:bg-ivory transition-colors"
          >
            Create an account
          </Link>
        </div>
      </Shell>
    );
  }

  if (signedInEmail !== inviteEmail) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-charcoal mb-1">
          Wrong account
        </h1>
        <p className="text-secondary-text text-sm mb-6">
          This invitation was sent to{" "}
          <strong className="text-charcoal">{inviteEmailRaw}</strong>, but
          you&apos;re signed in as{" "}
          <strong className="text-charcoal">{session?.user?.email}</strong>.
          Sign out and log back in with the invited address.
        </p>
        <Link href="/dashboard" className="text-forest font-medium text-sm">
          Back to dashboard
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-charcoal mb-1">
        {kind === "event" ? contextName : `Join ${contextName}`}
      </h1>
      <p className="text-secondary-text text-sm mb-6">
        You&apos;ve been invited as{" "}
        <strong className="text-charcoal">{roleLabel}</strong>.
      </p>
      <AcceptInviteButton token={token as string} />
    </Shell>
  );
}
