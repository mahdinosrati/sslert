import {it,expect} from "vitest";
import {readFileSync,readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createInMemoryDb} from "./index.js";
import {runSqlMigrations} from "./sqlmigrate.js";
it("preserves records, assignments and IDs while expiring old sessions",()=>{
 const {sqlite}=createInMemoryDb();try{
  const folder=fileURLToPath(new URL("./migrations/",import.meta.url));sqlite.exec("CREATE TABLE __applied_migrations(filename TEXT PRIMARY KEY, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)");
  for(const file of readdirSync(folder).filter(f=>f.endsWith(".sql")&&f<"0009").sort()){sqlite.exec(readFileSync(folder+file,"utf8"));sqlite.prepare("INSERT INTO __applied_migrations(filename) VALUES (?)").run(file)}
  sqlite.exec("INSERT INTO users(id,username,password_hash,role) VALUES(8,'existing','hash','admin'); INSERT INTO resources(id,kind,title,hostname,serial,valid_from,expires_at) VALUES(44,'cert','Internal','internal.example','123','2026-01-01','2027-01-01'); INSERT INTO resources(id,kind,title) VALUES(100,'license','Deleted'); DELETE FROM resources WHERE id=100; INSERT INTO user_resources(user_id,resource_id) VALUES(8,44); INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('session',8,'2027-01-01');");
  runSqlMigrations(sqlite);runSqlMigrations(sqlite);
  expect(sqlite.prepare("SELECT * FROM resources WHERE id=44").get()).toMatchObject({hostname:"internal.example",serial:"123",valid_from:"2026-01-01",contract_number:""});
  expect(sqlite.prepare("SELECT * FROM users WHERE id=8").get()).toMatchObject({auth_source:"local",password_hash:"hash"});expect(sqlite.prepare("SELECT * FROM user_resources").all()).toHaveLength(1);expect(sqlite.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
  expect(sqlite.prepare("INSERT INTO resources(kind,title,contract_number,expires_at) VALUES('contract','Support','C-1','2027-01-01')").run().lastInsertRowid).toBe(101);
  expect(sqlite.prepare("SELECT * FROM sqlite_sequence WHERE name='resources'").all()).toHaveLength(1);expect(sqlite.pragma("foreign_key_check")).toEqual([]);
 }finally{sqlite.close()}
});
