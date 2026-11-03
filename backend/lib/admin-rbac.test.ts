import { describe, expect, it } from "vitest";
import {
  defaultRoleHasPermission,
  isAdminRole,
} from "./admin-rbac";

describe("default administrative roles", () => {
  it("keeps platform configuration and role changes exclusive to Super Admin", () => {
    expect(defaultRoleHasPermission("super_admin", "settings.manage")).toBe(true);
    expect(defaultRoleHasPermission("super_admin", "roles.manage")).toBe(true);
    expect(defaultRoleHasPermission("admin", "settings.manage")).toBe(false);
    expect(defaultRoleHasPermission("admin", "roles.manage")).toBe(false);
  });

  it("separates financial access from event moderation", () => {
    expect(defaultRoleHasPermission("finance_admin", "refunds.manage")).toBe(true);
    expect(defaultRoleHasPermission("finance_admin", "events.edit")).toBe(false);
    expect(defaultRoleHasPermission("event_moderator", "events.publish")).toBe(true);
    expect(defaultRoleHasPermission("event_moderator", "finance.view")).toBe(false);
  });

  it("does not recognize unconfigured role names", () => {
    expect(isAdminRole("support_admin")).toBe(true);
    expect(isAdminRole("owner")).toBe(false);
  });
});
