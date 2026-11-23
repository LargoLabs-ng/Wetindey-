"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBell } from "@/components/notification-bell";

/**
 * Admin navigation.
 *
 * The console had none: every screen was reachable only from cards on the
 * dashboard, and Departments was not on any of them — the only way in was to
 * type the URL. This lives in the layout so every admin page carries it.
 *
 * Departments and Payouts show their pending counts, because those queues
 * fill up on their own. A number nobody can see is a number nobody acts on.
 */
const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/departments", label: "Departments", countKey: "departments" },
  { href: "/admin/payouts", label: "Payouts", countKey: "payouts" },
  { href: "/admin/payment-reviews", label: "Payment reviews" },
  { href: "/admin/notifications", label: "Notifications" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  const [counts, setCounts] = useState({ departments: 0, payouts: 0 });

  useEffect(() => {
    fetch("/api/admin/departments")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCounts((c) => ({ ...c, departments: d.counts?.pending ?? 0 })))
      .catch(() => {});
    // Payout requests waiting for a first look. The badge counts pending
    // only: approved and processing ones are already in someone's hands.
    fetch("/api/admin/payouts?countsOnly=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCounts((c) => ({ ...c, payouts: d.counts?.pending ?? 0 })))
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
      <div className="mx-auto flex max-w-7xl items-center px-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {LINKS.map((link) => {
          const { href, label } = link;
          const count = "countKey" in link ? counts[link.countKey] : 0;
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
              {count > 0 && (
                <span
                  className="ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white"
                  style={{ backgroundColor: "var(--color-purple)" }}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      {/* Outside the scrolling strip, so its dropdown isn't clipped. */}
      <div className="shrink-0 pl-2">
        <NotificationBell tone="light" />
      </div>
      </div>
    </nav>
  );
}
