import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/authz";
import { AdminNav } from "@/components/admin-nav";

/**
 * Server-side gate for every /admin page. Renders 404 (not 403) for
 * non-admins so the console's existence isn't advertised.
 *
 * Worth knowing when debugging: a 404 here means "not an admin", not
 * "route missing" — which is exactly how it looks from the outside.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isPlatformAdmin())) notFound();
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-ivory)" }}>
      <AdminNav />
      {children}
    </div>
  );
}
