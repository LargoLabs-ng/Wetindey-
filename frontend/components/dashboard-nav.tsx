"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Finance is top-level, not buried inside an event. "How much can I
// withdraw" is never a question about one event, and the per-event payout
// page could never answer it.
const links = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/finance", label: "Finance" },
];

export function DashboardNav({ showCrm = false }: { showCrm?: boolean }) {
  const pathname = usePathname();
  const visibleLinks = showCrm
    ? [...links, { href: "/dashboard/crm", label: "CRM" }]
    : links;

  return (
    <nav className="flex items-center gap-1">
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
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
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
