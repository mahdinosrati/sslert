import {it,expect} from "vitest";
import {createInMemoryDb} from "./index.js";
import {runSqlMigrations} from "./sqlmigrate.js";
it("resets legacy LDAP grants once and preserves later panel grants",()=>{
 const {sqlite}=createInMemoryDb();try{
 runSqlMigrations(sqlite);
 sqlite.exec("DELETE FROM __applied_migrations WHERE filename='0010_ldap_viewers_sessions.sql'; INSERT INTO users(id,username,password_hash,role,auth_source,can_create,can_edit,can_test) VALUES(1,'local','hash','admin','local',1,1,1),(2,'ad:alice','!directory','admin','ldap',1,1,1); INSERT INTO sessions(token_hash,user_id,expires_at) VALUES('test',2,'2099-01-01'); INSERT INTO api_tokens(token_hash,label,user_id) VALUES('token','test',2);");
 runSqlMigrations(sqlite);
 expect(sqlite.prepare("SELECT role,can_create,can_edit,can_test FROM users WHERE id=2").get()).toEqual({role:'user',can_create:0,can_edit:0,can_test:0});
 expect(sqlite.prepare("SELECT role FROM users WHERE id=1").get()).toEqual({role:'admin'});
 expect(sqlite.prepare("SELECT * FROM sessions").all()).toHaveLength(0);
 expect(sqlite.prepare("SELECT * FROM api_tokens").all()).toHaveLength(0);
 sqlite.exec("UPDATE users SET role='admin',can_edit=1 WHERE id=2");runSqlMigrations(sqlite);
 expect(sqlite.prepare("SELECT role,can_edit FROM users WHERE id=2").get()).toEqual({role:'admin',can_edit:1});
 }finally{sqlite.close()}
});
