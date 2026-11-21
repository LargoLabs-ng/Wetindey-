import { getSessionUserId, hasAdminPermission, isUuid } from "@/lib/authz";

/**
 * Who may see or act on payout requests.
 *
 * Uses the existing admin roles (migration 0018 + 0024): `payouts.view` to
 * see requests and full bank details, `payouts.manage` to act. In v1 only
 * Super Admin holds them; ADMIN_EMAILS addresses count as Super Admin, as
 * everywhere else. Failing answers 404, like the other admin routes, so the
 * routes do not advertise themselves.
 */
export async function requirePayoutPermission(
  permission: "payouts.view" | "payouts.manage"
): Promise<{ ok: true; userId: string } | { ok: false; status: number; error: string }> {
  if (!(await hasAdminPermission(permission))) {
    return { ok: false, status: 404, error: "Not found" };
  }
  const userId = await getSessionUserId();
  if (!userId || !isUuid(userId)) {
    return { ok: false, status: 401, error: "Sign in again." };
  }
  return { ok: true, userId };
}
