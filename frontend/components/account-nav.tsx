"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Menu, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The account links every attendee-side page shares: home, Discover, event
 * pages and My events.
 *
 * Everyone:   Discover (except on Discover itself).
 * Signed out: Sign in, Sign up, Host an event.
 * Signed in:  My events, Profile, Sign out, and one organiser link —
 *             "Organiser mode" for people who already run or work on an
 *             event, "Host an event" for everyone else.
 *
 * Mobile first: one menu button that opens a panel. From the `sm` width up
 * the links sit inline. The theme switch lives here too, so a page header is
 * just the wordmark (or a Back button) and this.
 *
 * Signing in from any page comes back to that page.
 */
export function AccountNav({
  variant = "default",
}: {
  /** "glass" sits on event artwork, like the event page's Back button. */
  variant?: "default" | "glass";
}) {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [organises, setOrganises] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/api/account/nav", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setOrganises(d?.organises === true);
      })
      .catch(() => {
        // Falls back to "Host an event", which still lands organisers on
        // their dashboard via /organiser.
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  // Close the panel on Escape or a tap outside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Come back to exactly this page (with its filters) after signing in. The
  // href carries the path for no-JS and middle-click; the click handler adds
  // the query string, which isn't known while rendering on the server.
  const returnHere = (base: "/login" | "/signup") => ({
    href: pathname === "/" ? base : `${base}?callbackUrl=${encodeURIComponent(pathname)}`,
    onClick: (e: React.MouseEvent) => {
      setOpen(false);
      const here = `${window.location.pathname}${window.location.search}`;
      if (here === "/") return;
      e.preventDefault();
      router.push(`${base}?callbackUrl=${encodeURIComponent(here)}`);
    },
  });

  const organiserLabel = signedIn && organises ? "Organiser mode" : "Host an event";
  const showDiscover = pathname !== "/discover";

  const glass = variant === "glass";
  const inlineLink = glass
    ? "rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-black/60"
    : "rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:text-ink";
  const primaryLink = glass
    ? "rounded-full bg-purple px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-purple-deep"
    : "rounded-lg bg-purple px-3.5 py-2 text-sm font-semibold text-white hover:bg-purple-deep";
  const menuButton = glass
    ? "inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur"
    : "inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-ink transition-colors hover:bg-surface-2";
  const panelLink =
    "block w-full rounded-lg px-3 py-3 text-left text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink";

  const doSignOut = () => {
    setOpen(false);
    void signOut({ callbackUrl: "/" });
  };

  return (
    <div ref={wrapper} className="relative flex items-center gap-2">
      {/* ── sm and up: inline ─────────────────────────────────────── */}
      <nav aria-label="Account" className="hidden items-center gap-2 sm:flex">
        <ThemeToggle variant={glass ? "glass" : "default"} className="mr-1" />
        {showDiscover && (
          <Link href="/discover" className={inlineLink}>
            Discover
          </Link>
        )}
        {signedIn ? (
          <>
            <Link href="/my-events" className={inlineLink}>
              My events
            </Link>
            <Link href="/profile" className={inlineLink}>
              Profile
            </Link>
            <button type="button" onClick={doSignOut} className={inlineLink}>
              Sign out
            </button>
          </>
        ) : status === "unauthenticated" ? (
          <>
            <Link {...returnHere("/login")} className={inlineLink}>
              Sign in
            </Link>
            <Link {...returnHere("/signup")} className={inlineLink}>
              Sign up
            </Link>
          </>
        ) : null}
        <Link href="/organiser" className={primaryLink}>
          {organiserLabel}
        </Link>
      </nav>

      {/* ── Phone: one button, one panel ───────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className={`${menuButton} sm:hidden`}
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div
          id="account-menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-line bg-cream p-2 shadow-lg sm:hidden"
        >
          <div className="flex items-center justify-between border-b border-line px-3 pb-2 pt-1">
            <span className="text-sm font-semibold text-ink">Menu</span>
            <ThemeToggle />
          </div>
          <div className="mt-1 flex flex-col">
            {showDiscover && (
              <Link href="/discover" onClick={() => setOpen(false)} className={panelLink}>
                Discover
              </Link>
            )}
            {signedIn ? (
              <>
                <Link href="/my-events" onClick={() => setOpen(false)} className={panelLink}>
                  My events
                </Link>
                <Link href="/profile" onClick={() => setOpen(false)} className={panelLink}>
                  Profile
                </Link>
              </>
            ) : status === "unauthenticated" ? (
              <>
                <Link {...returnHere("/login")} className={panelLink}>
                  Sign in
                </Link>
                <Link {...returnHere("/signup")} className={panelLink}>
                  Sign up
                </Link>
              </>
            ) : null}
            <Link
              href="/organiser"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-lg bg-purple px-3.5 py-3 text-center text-sm font-semibold text-white hover:bg-purple-deep"
            >
              {organiserLabel}
            </Link>
            {signedIn && (
              <button type="button" onClick={doSignOut} className={`${panelLink} mt-1`}>
                Sign out
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
