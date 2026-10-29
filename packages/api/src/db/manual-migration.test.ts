import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInMemoryDb } from "./index.js";
import { runSqlMigrations } from "./sqlmigrate.js";
import { resources, userResources, notificationPolicies } from "./schema.js";
it("upgrades 1.0.1 resources without losing records, assignments or policies", () => {
  const { db, sqlite } = createInMemoryDb();
  try {
    const folder = fileURLToPath(new URL("./migrations/", import.meta.url));
    sqlite.exec(
      "CREATE TABLE __applied_migrations(filename TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    for (const file of readdirSync(folder)
      .filter((f) => f.endsWith(".sql") && f < "0008")
      .sort()) {
      sqlite.exec(readFileSync(folder + file, "utf8"));
      sqlite
        .prepare("INSERT INTO __applied_migrations(filename) VALUES (?)")
        .run(file);
    }
    sqlite.exec(
      "INSERT INTO users(id,username,password_hash,role) VALUES(3,'existing','hash','user'); INSERT INTO resources(id,kind,title,expires_at) VALUES(42,'api','Existing API','2027-01-01'); INSERT INTO user_resources(user_id,resource_id) VALUES(3,42); INSERT INTO notification_policies(key,mode) VALUES('resource:42','disabled');",
    );
    runSqlMigrations(sqlite);
    runSqlMigrations(sqlite);
    expect(db.select().from(resources).get()).toMatchObject({
      id: 42,
      title: "Existing API",
      expiresAt: "2027-01-01",
      hostname: "",
      validFrom: null,
    });
    expect(db.select().from(userResources).all()).toEqual([
      { userId: 3, resourceId: 42 },
    ]);
    expect(db.select().from(notificationPolicies).get()?.mode).toBe("disabled");
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(
      db
        .insert(resources)
        .values({
          kind: "cert",
          title: "Internal SSL",
          hostname: "server.local",
          expiresAt: "2027-02-01",
        })
        .returning()
        .get()!.id,
    ).toBeGreaterThan(42);
  } finally {
    sqlite.close();
  }
});
