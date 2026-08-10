-- Credential refs need the same lifecycle status semantics as accounts/domains.
-- Existing records are treated as active during rollout.
ALTER TABLE `credential_refs`
  ADD COLUMN `status` varchar(32) NOT NULL DEFAULT 'active' AFTER `owner`,
  ADD KEY `idx_credential_refs_status` (`status`);
