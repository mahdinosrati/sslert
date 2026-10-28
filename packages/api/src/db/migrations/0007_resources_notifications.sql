CREATE TABLE IF NOT EXISTS resources (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('license','api')),
 title TEXT NOT NULL,
 provider TEXT NOT NULL DEFAULT '',
 owner TEXT NOT NULL DEFAULT '',
 notes TEXT NOT NULL DEFAULT '',
 expires_at TEXT,
 enabled INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_resources (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,resource_id)
);
CREATE TABLE IF NOT EXISTS connections (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 channel TEXT NOT NULL,
 config TEXT NOT NULL DEFAULT '{}',
 enabled INTEGER NOT NULL DEFAULT 1,
 shared INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notification_policies (
 key TEXT PRIMARY KEY,
 mode TEXT NOT NULL DEFAULT 'inherit',
 connection_ids TEXT NOT NULL DEFAULT '[]',
 thresholds TEXT NOT NULL DEFAULT '[30,7,1,0]',
 repeat_hours INTEGER NOT NULL DEFAULT 24
);
CREATE TABLE IF NOT EXISTS deliveries (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 target_key TEXT NOT NULL,
 source TEXT NOT NULL,
 connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
 level TEXT NOT NULL,
 status TEXT NOT NULL,
 error TEXT,
 created_at TEXT NOT NULL,
 is_test INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS deliveries_dedup ON deliveries(target_key,source,connection_id,level,created_at);
