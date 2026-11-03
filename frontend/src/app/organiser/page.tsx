import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BarChart3, QrCode, Ticket } from "lucide-react";
import { auth } from "@/auth";
import { hasDashboardAccess } from "@/lib/authz";
import { WordMark } from "@/components/wordmark";

export default async function OrganiserLandingPage() {
  const session = await auth();
  if (session?.user?.id) {
    if (await hasDashboardAccess(session.user.id)) redirect("/dashboard");
    redirect("/checkin");
  }

  return (
    <main className="min-h-screen bg-cream text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <WordMark />
          <div className="flex items-center gap-3">
            <Link
              href="/organiser/login"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/organiser/register"
              className="rounded-lg bg-purple px-4 py-2 text-sm font-semibold text-white hover:bg-purple-deep"
            >
              Create account
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-purple">
            Wetin Dey for organisers
          </p>
          <h1 className="mt-4 max-w-2xl text-4xl font-extrabold tracking-tight sm:text-6xl">
            Your event deserves a smooth door and a full room.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-8 text-ink-2">
            Create your event, set up ticket tiers, share one link, and keep an
            eye on sales and check-ins from one place.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/organiser/register"
              className="inline-flex items-center gap-2 rounded-xl bg-purple px-5 py-3 font-semibold text-white hover:bg-purple-deep"
            >
              Start hosting <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/organiser/login"
              className="rounded-xl border border-line px-5 py-3 font-semibold text-ink hover:bg-surface-2"
            >
              I already have an account
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              icon: Ticket,
              title: "Tickets that fit your event",
              text: "Create ticket tiers with prices, quantities, and Early Bird offers.",
            },
            {
              icon: BarChart3,
              title: "Sales at a glance",
              text: "See ticket sales, revenue, and event performance using your real records.",
            },
            {
              icon: QrCode,
              title: "Easy door check-in",
              text: "Give every ticket a QR code your team can scan at the door.",
            },
            {
              icon: ArrowRight,
              title: "One public event link",
              text: "Share your page so people can discover the event and buy tickets.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <article
              key={title}
              className="rounded-2xl border border-line bg-card p-5 shadow-sm"
            >
              <span className="inline-flex rounded-xl bg-purple-soft p-2.5 text-purple">
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="mt-4 font-bold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-2">{text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
