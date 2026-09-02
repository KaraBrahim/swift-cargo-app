-- Swift Cargo — notifications read cursor.
-- Notifications are derived from audit_log (another admin's activity); the only
-- stored state is a per-admin "last seen" marker. It is a per-machine UX
-- convenience, so it is intentionally NOT synced (no uuid/origin_site, absent
-- from nodeSetup's OPERATIONAL list).
CREATE TABLE notification_cursor (
  admin_id     INTEGER PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
  last_seen_id BIGINT NOT NULL DEFAULT 0
);
