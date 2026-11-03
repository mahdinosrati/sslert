import { describe, it, expect } from "vitest";
import { createInMemoryDb } from "./index.js";
import { runSqlMigrations } from "./sqlmigrate.js";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
describe("1.0.8 upgrade", () => {
  it("preserves identities, grants and sessions while upgrading scheduling exactly once", () => {
    const { sqlite } = createInMemoryDb();
    try {
      const dir = fileURLToPath(new URL("./migrations/", import.meta.url));
      sqlite.exec(
        "CREATE TABLE __applied_migrations(filename TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)",
      );
      for (const file of readdirSync(dir)
        .filter((f) => f.endsWith(".sql") && f < "0011")
        .sort()) {
        sqlite.exec(readFileSync(dir + file, "utf8"));
        sqlite
          .prepare("INSERT INTO __applied_migrations(filename) VALUES (?)")
          .run(file);
      }
      sqlite.exec(
        "INSERT INTO users(id,username,password_hash,role,auth_source,can_edit) VALUES(1,'ad:admin','!','admin','ldap',1); INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('session',1,'2099-01-01'); INSERT INTO notification_policies(key,mode,connection_ids,thresholds) VALUES('global','disabled','[1]','[30,7,1,0]')",
      );
      runSqlMigrations(sqlite);
      expect(
        sqlite.prepare("SELECT role,can_edit,email FROM users").get(),
      ).toEqual({ role: "admin", can_edit: 1, email: "" });
      expect(sqlite.prepare("SELECT count(*) n FROM sessions").get()).toEqual({
        n: 1,
      });
      expect(
        sqlite
          .prepare(
            "SELECT mode,connection_ids,thresholds,schedule_mode FROM notification_policies",
          )
          .get(),
      ).toEqual({
        mode: "disabled",
        connection_ids: "[1]",
        thresholds: "[30,20,10,7,6,5,4,3,2,1,0]",
        schedule_mode: "milestones",
      });
      sqlite.exec("UPDATE notification_policies SET thresholds='[10,0]'");
      runSqlMigrations(sqlite);
      expect(
        sqlite.prepare("SELECT thresholds FROM notification_policies").get(),
      ).toEqual({ thresholds: "[10,0]" });
    } finally {
      sqlite.close();
    }
  });
});
