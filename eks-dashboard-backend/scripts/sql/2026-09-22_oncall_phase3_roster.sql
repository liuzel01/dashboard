ALTER TABLE `oncall_identity_bindings`
  ADD COLUMN `email` VARCHAR(320) NOT NULL AFTER `level`;

ALTER TABLE `oncall_identity_bindings`
  DROP INDEX `uniq_oncall_identity_binding`,
  ADD UNIQUE KEY `uniq_oncall_identity_binding` (`environment_id`, `level`, `email`);
