"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Finance is top-level, not buried inside an event. "How much can I
// withdraw" is never a question about one event, and the per-event payout
// page could never answer it.
const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/finance", label: "Finance" },
];

export function DashboardNav({
  showCrm = false,
  showSettings = false,
}: {
  showCrm?: boolean;
  /** Organisation owners only: the organisation's name, logo and team. */
  showSettings?: boolean;
}) {
  const pathname = usePathname();
  const visibleLinks = [
    ...links,
    ...(showCrm ? [{ href: "/dashboard/crm", label: "CRM" }] : []),
    ...(showSettings ? [{ href: "/dashboard/settings", label: "Settings" }] : []),
  ];

  // Scrolls sideways rather than wrapping when five links don't fit a phone,
  // and brings the current page's link into view so it is never half cut off.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  return (
    <nav ref={nav} className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
      {visibleLinks.map((link) => {
        const active =
          link.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-surface-2 text-on-dark"
                : "text-on-dark-2 hover:bg-surface hover:text-on-dark"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
