import { isPlatformAdmin } from "@/lib/authz";
import { AdminNav } from "@/components/admin-nav";
import AdminLoginForm from "./login-form";

/**
 * Keep every admin page behind the authorization gate while letting the
 * dashboard root offer a sign-in screen to unauthenticated visitors.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return <AdminLoginForm />;
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-ivory)" }}>
      <AdminNav />
      {children}
    </div>
  );
}
