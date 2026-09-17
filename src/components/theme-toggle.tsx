"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_KEY } from "@/lib/theme";

/**
 * Light / dark switch for the consumer surfaces.
 *
 * All this does is set `data-wd-theme` on <html>; globals.css does the rest.
 * Light is the absence of the attribute rather than a value of its own, so a
 * page that renders before any JavaScript has run is already light — there is
 * no moment of dark flashing to white — and dark is strictly opt-in.
 *
 * The choice is remembered per browser. It is a display preference, not
 * account data, so it never goes near the database.
 */
export function ThemeToggle({
  className = "",
  // "glass" is for a toggle sitting on event artwork rather than on a page
  // surface. It is a prop rather than extra classes because two competing
  // border-colour utilities in one class string resolve by CSS source order,
  // not by the order you wrote them — so the override is a coin toss.
  variant = "default",
}: {
  className?: string;
  variant?: "default" | "glass";
}) {
  // Starts null rather than guessing. The server has no idea what this reader
  // picked last time, so rendering a definite icon on the first pass would
  // mean rendering the wrong one half the time and having React complain
  // about it on hydration.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.dataset.wdTheme === "dark");
  }, []);

  const flip = () => {
    const next = !dark;
    setDark(next);

    if (next) {
      document.documentElement.dataset.wdTheme = "dark";
    } else {
      delete document.documentElement.dataset.wdTheme;
    }

    // Both values are written, not just the non-default one: storing nothing
    // for light would make "I chose light" indistinguishable from "I have
    // never been here", which matters the day the default changes again.
    // Private browsing and blocked site data make this throw — losing the
    // preference is a small thing, taking the page down over it is not.
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* not worth reporting */
    }
  };

  const base =
    variant === "glass"
      ? "inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-inset ring-white/25 backdrop-blur transition-opacity hover:opacity-85"
      : "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-2 transition-colors hover:text-ink";

  // Before the effect runs we know neither the state nor the right icon, so
  // the button holds its space and stays inert for that one frame.
  if (dark === null) {
    return <span aria-hidden="true" className={`${base} ${className}`} />;
  }

  // The icon shows the destination, not the current state: on a light page it
  // offers the moon.
  const label = dark ? "Switch to light" : "Switch to dark";

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      title={label}
      className={`${base} ${className}`}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
