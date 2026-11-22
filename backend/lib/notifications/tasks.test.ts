import { afterEach, describe, expect, it, vi } from "vitest";

const runWorker = vi.fn(async () => ({ events: { done: 0 }, deliveries: { sent: 0 } }));
const sweep = vi.fn(async () => ({ since: null, ordersRecovered: 0, payoutRequestsRecovered: 0, payoutUpdatesRecovered: 0 }));
vi.mock("./worker", () => ({ runWorker }));
vi.mock("./sweep", () => ({ runReconciliationSweep: sweep }));
vi.mock("./maintenance", () => ({ cleanUpOldNotifications: vi.fn(async () => ({})) }));
vi.mock("./health", () => ({ checkNotificationHealth: vi.fn(async () => ({ unhealthy: false })) }));

const { runNotificationTask } = await import("./tasks");

describe("runNotificationTask", () => {
  afterEach(() => {
    delete process.env.NOTIFICATIONS_ENABLED;
    vi.clearAllMocks();
  });

  it("does nothing while notifications are switched off", async () => {
    expect(await runNotificationTask("worker")).toMatchObject({ skipped: expect.stringContaining("switched off") });
    expect(runWorker).not.toHaveBeenCalled();
  });

  it("runs only the worker for a worker task", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    await runNotificationTask("worker", "admin-worker");
    expect(runWorker).toHaveBeenCalledWith({ source: "admin-worker" });
    expect(sweep).not.toHaveBeenCalled();
  });

  it("runs the sweep and then the worker for the daily task", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    await runNotificationTask("daily");
    expect(sweep).toHaveBeenCalledOnce();
    expect(runWorker).toHaveBeenCalledOnce();
  });

  it("leaves discovery for Phase 3", async () => {
    process.env.NOTIFICATIONS_ENABLED = "true";
    expect(await runNotificationTask("discovery-weekly")).toMatchObject({ skipped: expect.stringContaining("Phase 3") });
    expect(runWorker).not.toHaveBeenCalled();
  });
});
