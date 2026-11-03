ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN mobile TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN telegram_id TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN notification_channels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE notification_policies ADD COLUMN recipients TEXT NOT NULL DEFAULT '[]';
ALTER TABLE notification_policies ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'milestones';
UPDATE notification_policies SET thresholds='[30,20,10,7,6,5,4,3,2,1,0]';
ALTER TABLE deliveries ADD COLUMN recipient TEXT NOT NULL DEFAULT '';
ALTER TABLE deliveries ADD COLUMN expiry_cycle TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS notification_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_key TEXT NOT NULL,
  source TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  expiry_cycle TEXT NOT NULL,
  stage INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  UNIQUE(target_key, source, channel, recipient, expiry_cycle, stage)
);
