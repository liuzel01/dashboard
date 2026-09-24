-- Account-scoped MFA (Google Authenticator / TOTP).
-- The columns were introduced for local admin login and are also used by the
-- self-service MFA enrollment flow for Keycloak/SSO users.
-- Safe to run once on environments where these columns do not exist.

ALTER TABLE `users`
  ADD COLUMN `mfa_enabled` tinyint(1) NOT NULL DEFAULT 0 AFTER `status`,
  ADD COLUMN `mfa_secret` varchar(255) DEFAULT NULL AFTER `mfa_enabled`,
  ADD COLUMN `mfa_confirmed_at` datetime DEFAULT NULL AFTER `mfa_secret`;
