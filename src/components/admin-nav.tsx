"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Admin navigation.
 *
 * The console had none: every screen was reachable only from cards on the
 * dashboard, and Departments was not on any of them — the only way in was to
 * type the URL. This lives in the layout so every admin page carries it.
 *
 * Departments shows its pending count, because that queue fills up on its own
 * as students sign up. A number nobody can see is a number nobody acts on.
 */
const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/departments", label: "Departments", countKey: "pending" },
];

export function AdminNav() {
  const pathname = usePathname();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    fetch("/api/admin/departments")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPending(d.counts?.pending ?? 0))
      .catch(() => {});
  }, [pathname]);

  return (
    <nav
      className="border-b"
      style={{
        borderColor: "var(--color-line)",
        backgroundColor: "var(--color-ivory-2)",
      }}
    >
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        {LINKS.map(({ href, label, countKey }) => {
          // /admin must match exactly or it lights up on every child route.
          const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="relative whitespace-nowrap px-3 py-3 text-sm font-semibold transition-colors"
              style={{
                color: active ? "var(--color-purple)" : "var(--color-stone)",
                boxShadow: active ? "inset 0 -2px 0 0 var(--color-purple)" : undefined,
              }}
            >
              {label}
              {countKey && pending > 0 && (
                <span
                  className="ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white"
                  style={{ backgroundColor: "var(--color-purple)" }}
                >
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
