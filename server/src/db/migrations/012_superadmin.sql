-- Swift Cargo — introduce a super-admin role.
-- Overrides the earlier "4 equal admins" model at the client's request: a single
-- super-admin (own password) has full control, including CRUD of admin accounts.
-- The four office admins keep identical permissions to each other but can no
-- longer manage user accounts.
ALTER TABLE admins
  ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin'));
