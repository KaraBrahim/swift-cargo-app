// Notifications — "what other admins did". Derived from audit_log rather than a
// separate feed table: the audit log already records every mutation with its
// actor and already syncs across sites, so a colleague's action at the other
// office shows up here once it replicates. The only stored state is a per-admin
// read cursor (notification_cursor).
import { getPool } from '../../db/pool.js';
import { notSuperadmin } from '../../lib/visibility.js';

// Sign-ins/outs are not "activity" worth surfacing — same exclusion the
// dashboard feed uses.
//
// The super-admin is excluded outright: a normal admin is notified of what the
// OTHER normal admins are doing, never of what the super-admin does. The
// super-admin's own feed is built by superadminFilter() below, which keeps
// everything.
const ACTIVITY_FILTER = `al.admin_id <> $1 AND al.action NOT LIKE 'auth.%'`;
const filterFor = (viewerIsSuperadmin) =>
  viewerIsSuperadmin ? ACTIVITY_FILTER : `${ACTIVITY_FILTER} AND ${notSuperadmin('al.admin_id')}`;

async function cursorFor(db, adminId) {
  const { rows } = await db.query('SELECT last_seen_id FROM notification_cursor WHERE admin_id = $1', [adminId]);
  return Number(rows[0]?.last_seen_id ?? 0);
}

export async function listNotifications(adminId, { limit = 20, isSuper = false } = {}, db = getPool()) {
  const cursor = await cursorFor(db, adminId);
  const { rows } = await db.query(
    `SELECT al.id, al.action, al.entity, al.entity_id, al.details, al.created_at,
            a.full_name AS admin_name, a.role AS admin_role, (al.id > $2) AS unread
       FROM audit_log al
       LEFT JOIN admins a ON a.id = al.admin_id
      WHERE ${filterFor(isSuper)}
      ORDER BY al.id DESC
      LIMIT $3`,
    [adminId, cursor, limit]
  );
  return { notifications: rows, cursor };
}

export async function unreadCount(adminId, isSuper = false, db = getPool()) {
  const cursor = await cursorFor(db, adminId);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM audit_log al WHERE ${filterFor(isSuper)} AND al.id > $2`,
    [adminId, cursor]
  );
  return rows[0].n;
}

// Mark everything up to the current newest activity as seen.
export async function markSeen(adminId, isSuper = false, db = getPool()) {
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(al.id), 0) AS max_id FROM audit_log al WHERE ${filterFor(isSuper)}`,
    [adminId]
  );
  const maxId = Number(rows[0].max_id);
  await db.query(
    `INSERT INTO notification_cursor (admin_id, last_seen_id) VALUES ($1, $2)
     ON CONFLICT (admin_id) DO UPDATE SET last_seen_id = GREATEST(notification_cursor.last_seen_id, EXCLUDED.last_seen_id)`,
    [adminId, maxId]
  );
  return { lastSeenId: maxId };
}
