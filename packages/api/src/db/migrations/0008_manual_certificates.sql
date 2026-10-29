-- Rebuild the CHECK constraint without losing existing assignments.
CREATE TABLE resources_v2 (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('license','api','domain','cert')),
 title TEXT NOT NULL,
 provider TEXT NOT NULL DEFAULT '',
 owner TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 expires_at TEXT,
 enabled INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 hostname TEXT NOT NULL DEFAULT '',
 serial TEXT NOT NULL DEFAULT '',
 valid_from TEXT
);
INSERT INTO resources_v2(id,kind,title,provider,owner,notes,expires_at,enabled,created_at)
 SELECT id,kind,title,provider,owner,notes,expires_at,enabled,created_at FROM resources;
CREATE TEMP TABLE saved_resource_assignments AS SELECT user_id,resource_id FROM user_resources;
DROP TABLE resources;
ALTER TABLE resources_v2 RENAME TO resources;
INSERT INTO user_resources(user_id,resource_id) SELECT user_id,resource_id FROM saved_resource_assignments;
DROP TABLE saved_resource_assignments;
