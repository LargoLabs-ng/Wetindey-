import { notFound } from "next/navigation";
import { isPlatformAdmin } from "@/lib/authz";

/**
 * Server-side gate for every /admin page. Renders 404 (not 403) for
 * non-admins so the console's existence isn't advertised.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isPlatformAdmin())) notFound();
  return <>{children}</>;
}
