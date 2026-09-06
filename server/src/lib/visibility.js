// What a normal admin is allowed to see of the super-admin's activity: nothing.
//
// Two kinds of surface, and they must be treated differently — the same rule on
// both would break the books:
//
//   Activity feeds (journal, notifications, dashboard) — the row is REMOVED.
//     Nothing depends on those rows adding up; they are a narrative.
//
//   Money ledgers (caisse, comptes tiers, rapports, reçus) — the row STAYS and
//     only the NAME is masked. `caisse_balances.balance` is a stored figure, not
//     a sum of whatever rows happen to be visible. Drop a super-admin deposit
//     from the list and a normal admin sees a balance that no longer matches the
//     movements beneath it — an unexplainable gap, in the one place where the
//     numbers have to tie out. In production the super-admin is also the FIRST
//     account, so the earliest movements are very likely theirs.
//
// Masking is applied centrally, by scrubbing the response on its way out, so a
// route added next month cannot forget it.

export const MASKED_NAME = 'Administration';

// Each exposed actor name, paired with the column carrying that actor's role.
// A query that selects the name must also select the role, or there is nothing
// to decide on — see assertActorRolesSelected() in the tests.
const ACTOR_FIELDS = {
  admin_name: 'admin_role',
  created_by_name: 'created_by_role',
  received_by_name: 'received_by_role',
  sent_by_name: 'sent_by_role',
  set_by_name: 'set_by_role',
};

export const isSuperadmin = (admin) => admin?.role === 'superadmin';

// SQL fragment: keep only rows whose actor is not a super-admin.
// NOT EXISTS rather than NOT IN, so a NULL actor (a deleted admin, or a system
// action) is kept instead of silently dropped by three-valued logic.
export const notSuperadmin = (actorColumn) =>
  `NOT EXISTS (SELECT 1 FROM admins sa WHERE sa.id = ${actorColumn} AND sa.role = 'superadmin')`;

// Walk a response and replace any super-admin name with a neutral label. The
// role field itself is removed on the way out — it exists only to make this
// decision and is not something a client needs.
export function scrubActors(value, viewerIsSuperadmin) {
  if (viewerIsSuperadmin || value == null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    for (const item of value) scrubActors(item, viewerIsSuperadmin);
    return value;
  }

  for (const [nameField, roleField] of Object.entries(ACTOR_FIELDS)) {
    if (roleField in value) {
      if (value[roleField] === 'superadmin' && value[nameField] != null) {
        value[nameField] = MASKED_NAME;
      }
      delete value[roleField];
    }
  }

  for (const key of Object.keys(value)) scrubActors(value[key], viewerIsSuperadmin);
  return value;
}

// Express middleware: scrub every JSON response for a non-super-admin viewer.
// Central on purpose — "the super-admin must not appear anywhere" cannot be
// upheld by remembering to filter at each of a dozen call sites.
export function scrubResponses(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(scrubActors(body, isSuperadmin(req.admin)));
  next();
}
