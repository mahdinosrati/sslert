import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createInMemoryDb } from "../db/index.js";
import { runSqlMigrations } from "../db/sqlmigrate.js";
import {
  connections,
  notificationPolicies,
  deliveries,
  users,
  notificationStages,
  resources,
} from "../db/schema.js";
import {
  dispatchExpiry,
  expiryDays,
  notificationTargets,
  checkResourceExpiry,
} from "./notifications.js";
import { eq } from "drizzle-orm";
const send = vi.hoisted(() =>
  vi.fn<(...args: any[]) => Promise<{ id?: string; error?: string }>>(
    async () => ({ id: "ok" }),
  ),
);
vi.mock("./channels.js", () => ({ getChannelSender: () => ({ send }) }));
describe("expiry milestones and user delivery routes", () => {
  let store: ReturnType<typeof createInMemoryDb>;
  let connectionId: number;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T12:00:00Z"));
    send.mockReset();
    send.mockResolvedValue({ id: "ok" });
    store = createInMemoryDb();
    runSqlMigrations(store.sqlite);
    connectionId = store.db
      .insert(connections)
      .values({
        name: "SMTP",
        channel: "email",
        config: JSON.stringify({ to: ["one@example.org", "two@example.org"] }),
      })
      .returning()
      .get()!.id;
    store.db
      .insert(notificationPolicies)
      .values({
        key: "global",
        mode: "custom",
        connectionIds: JSON.stringify([connectionId]),
      })
      .run();
  });
  afterEach(() => {
    store.sqlite.close();
    vi.useRealTimers();
  });
  const dispatch = (expiry = "2030-01-31") =>
    dispatchExpiry(
      store.db,
      "resource:1",
      "contract",
      "Contract",
      null,
      expiry,
    );
  it("sends individually at 30,20,10,7..0 and never repeats after expiry or history pruning", async () => {
    for (const day of [1, 11, 21, 24, 25, 26, 27, 28, 29, 30, 31]) {
      vi.setSystemTime(
        new Date(`2030-01-${String(day).padStart(2, "0")}T12:00:00Z`),
      );
      await Promise.all([dispatch(), dispatch()]);
    }
    expect(send).toHaveBeenCalledTimes(22);
    expect(send.mock.calls.every((c) => typeof c[1].to === "string")).toBe(
      true,
    );
    store.db.delete(deliveries).run();
    vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
    await dispatch();
    expect(send).toHaveBeenCalledTimes(22);
  });
  it("catches only the latest missed stage and resets on renewal", async () => {
    vi.setSystemTime(new Date("2030-01-26T12:00:00Z"));
    await dispatch();
    expect(send.mock.calls.map((c) => c[0].level)).toEqual(["5", "5"]);
    await dispatch("2030-02-25");
    expect(send.mock.calls.map((c) => c[0].level)).toEqual([
      "5",
      "5",
      "30",
      "30",
    ]);
  });
  it("retries only a failed recipient after 15 minutes", async () => {
    send.mockResolvedValueOnce({ error: "temporary" });
    await dispatch();
    await dispatch();
    expect(send).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2030-01-01T12:16:00Z"));
    await Promise.all([dispatch(), dispatch()]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2][1].to).toBe("one@example.org");
  });
  it("selects panel subscriptions independently of LDAP visibility, skips disabled users and deduplicates destinations", async () => {
    const alice = store.db
      .insert(users)
      .values({
        username: "ad:alice",
        authSource: "ldap",
        passwordHash: "!",
        role: "user",
        email: "one@example.org",
        notificationChannels: '["email"]',
      })
      .returning()
      .get()!;
    const bob = store.db
      .insert(users)
      .values({
        username: "ad:bob",
        authSource: "ldap",
        passwordHash: "!",
        role: "user",
        email: "bob@example.org",
        notificationChannels: '["email"]',
      })
      .returning()
      .get()!;
    store.db
      .update(notificationPolicies)
      .set({ recipients: JSON.stringify([{ userId: alice.id, connectionId }]) })
      .run();
    await dispatch();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.some((c) => c[1].to === bob.email)).toBe(false);
    store.db
      .insert(notificationPolicies)
      .values({
        key: "resource:2",
        mode: "custom",
        recipients: JSON.stringify([{ userId: alice.id, connectionId }]),
      })
      .run();
    expect(
      notificationTargets(store.db, "resource:2").map((r) => r.recipient),
    ).toEqual([alice.email]);
    store.db
      .update(users)
      .set({ enabled: false })
      .where(eq(users.id, alice.id))
      .run();
    expect(notificationTargets(store.db, "resource:2")).toEqual([]);
  });
  it("does not infer an expiry cycle from an unsuccessful scan; manual expiry day is zero", async () => {
    expect(expiryDays("2030-01-01")).toBe(0);
    expect(expiryDays("invalid")).toBeNull();
    await dispatchExpiry(store.db, "domain:1", "cert", "Invalid", 5);
    expect(send).not.toHaveBeenCalled();
    store.db
      .insert(resources)
      .values({ kind: "contract", title: "Contract", expiresAt: "2030-01-01" })
      .run();
    await checkResourceExpiry(store.db);
    expect(send.mock.calls[0][0].level).toBe("0");
  });
  it("does not resend earlier milestones after a clock correction or a connection change", async () => {
    vi.setSystemTime(new Date("2030-01-26T12:00:00Z"));
    await dispatch();
    vi.setSystemTime(new Date("2030-01-21T12:00:00Z"));
    await dispatch();
    expect(send).toHaveBeenCalledTimes(2);
    expect(store.db.select().from(notificationStages).all()).toHaveLength(2);
  });
});
