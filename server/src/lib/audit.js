// Append-only audit trail. Always called with the SAME client that is running
// the surrounding DB transaction, so the audit row commits atomically with the
// action it describes (or rolls back with it). Who did what, when.
export async function writeAudit(client, { adminId, action, entity, entityId, details, ip }) {
  await client.query(
    `INSERT INTO audit_log (admin_id, action, entity, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      adminId ?? null,
      action,
      entity ?? null,
      entityId != null ? String(entityId) : null,
      details ? JSON.stringify(details) : null,
      ip ?? null,
    ]
  );
}
