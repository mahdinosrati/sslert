CREATE TEMP TABLE saved_contract_sequence AS SELECT seq FROM sqlite_sequence WHERE name='resources';
CREATE TABLE resources_v3 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('license','api','domain','cert','contract')),
 title TEXT NOT NULL,
 provider TEXT NOT NULL DEFAULT '',
 owner TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 expires_at TEXT,
 enabled INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 hostname TEXT NOT NULL DEFAULT '',
 serial TEXT NOT NULL DEFAULT '',
 valid_from TEXT,
 contract_number TEXT NOT NULL DEFAULT ''
);
INSERT INTO resources_v3(id,kind,title,provider,owner,notes,expires_at,enabled,created_at,hostname,serial,valid_from)
 SELECT id,kind,title,provider,owner,notes,expires_at,enabled,created_at,hostname,serial,valid_from FROM resources;
CREATE TEMP TABLE saved_contract_assignments AS SELECT user_id,resource_id FROM user_resources;
DROP TABLE resources;
ALTER TABLE resources_v3 RENAME TO resources;
UPDATE sqlite_sequence SET seq = MAX(seq,COALESCE((SELECT MAX(seq) FROM saved_contract_sequence),0)) WHERE name='resources';
INSERT INTO sqlite_sequence(name,seq) SELECT 'resources',COALESCE((SELECT MAX(seq) FROM saved_contract_sequence),0) WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='resources');
DROP TABLE saved_contract_sequence;
INSERT INTO user_resources(user_id,resource_id) SELECT user_id,resource_id FROM saved_contract_assignments;
DROP TABLE saved_contract_assignments;
ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN ldap_id TEXT;
ALTER TABLE users ADD COLUMN ldap_checked_at TEXT;
CREATE UNIQUE INDEX users_ldap_identity ON users(ldap_id);
