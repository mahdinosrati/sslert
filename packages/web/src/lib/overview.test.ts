import { describe, it, expect } from "vitest";
import { buildOverview, inRange, hostCount, needsAction } from "./overview";
import type { Resource } from "../pages/Resources";
const now = Date.parse("2026-10-01T00:00:00Z");
const resource = (
  id: number,
  expiresAt: string | null,
  extra = {},
): Resource => ({
  id,
  title: "Record " + id,
  kind: "license",
  hostname: "",
  serial: "",
  validFrom: null,
  provider: "",
  owner: "",
  notes: "",
  expiresAt,
  enabled: true,
  ...extra,
});
describe("dashboard overview", () => {
  it("keeps time bins disjoint at 7, 8, 30, 31, 60, 61 and 90 days", () => {
    const records = [7, 8, 30, 31, 60, 61, 90].map((day, i) =>
      resource(
        i + 1,
        new Date(now + (day - 1) * 86400000).toISOString().slice(0, 10),
      ),
    );
    const rows = buildOverview([], records, {}, now);
    expect(
      [0, 1, 2, 3].map((i) => rows.filter((r) => inRange(r, i)).length),
    ).toEqual([1, 2, 2, 2]);
    for (const r of rows)
      expect([0, 1, 2, 3].filter((i) => inRange(r, i))).toHaveLength(1);
  });
  it("separates hosts and records and flags alert gaps, errors and unknown checks", () => {
    const rows = buildOverview(
      [
        {
          domain: {
            id: 1,
            hostname: "INTERNAL.EXAMPLE",
            enabled: true,
            port: 443,
            createdAt: "",
            updatedAt: "",
          },
          lastCheck: null,
        },
      ],
      [
        resource(1, "2027-01-01", {
          hostname: "internal.example.",
          kind: "cert",
        }),
        resource(2, null),
        resource(3, "2026-09-01", { enabled: false }),
      ],
      { "resource:1": false },
      now,
    );
    expect(rows).toHaveLength(5);
    expect(hostCount(rows)).toBe(1);
    expect(rows.filter(needsAction)).toHaveLength(3);
    expect(rows[3].status).toBe("No expiry");
    expect(rows[4].status).toBe("Disabled");
    expect(inRange(rows[4], 0)).toBe(false);
  });
  it("does not label unavailable coverage as disabled", () => {
    const [r] = buildOverview([], [resource(1, "2027-01-01")], undefined, now);
    expect(r.alert).toBeUndefined();
    expect(needsAction(r)).toBe(false);
  });
});
