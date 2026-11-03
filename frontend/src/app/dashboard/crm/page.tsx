import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import CrmClient from "./crm-client";

export default async function CrmPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const organization = await db.query.organizations.findFirst({
    where: eq(organizations.ownerId, session.user.id),
    columns: { id: true },
  });
  if (!organization) redirect("/dashboard");

  return <CrmClient />;
}
