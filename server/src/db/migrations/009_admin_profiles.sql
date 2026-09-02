-- Swift Cargo — admin profile fields for the Utilisateurs screen.
-- Deliberately NO role/permission column: the SRS states all four admins share
-- one permission level with no hierarchy. Every user action is audited instead.
ALTER TABLE admins
  ADD COLUMN email         TEXT,
  ADD COLUMN phone         TEXT,
  ADD COLUMN last_login_at TIMESTAMPTZ;
