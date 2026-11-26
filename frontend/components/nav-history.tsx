"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Remembers whether this browser tab has moved between pages *inside* the
 * app since it was loaded, so a Back button can decide between "go back"
 * and "go somewhere sensible".
 *
 * It's a plain module variable on purpose. A full page load — opening a
 * shared WhatsApp link, a refresh, arriving from Google — starts it again
 * at zero, and in each of those cases going "back" would leave Wetin Dey
 * (or do nothing), so the button should take people to Discover instead.
 * Moving between pages inside the app doesn't reload, so the count grows.
 */
let inAppNavigations = 0;
let lastPath: string | null = null;

export function NavHistory() {
  const pathname = usePathname();
  useEffect(() => {
    if (lastPath !== null && lastPath !== pathname) inAppNavigations += 1;
    lastPath = pathname;
  }, [pathname]);
  return null;
}

/** True when the previous page in this tab was a page of this app. */
export function cameFromInsideApp(): boolean {
  return inAppNavigations > 0;
}
