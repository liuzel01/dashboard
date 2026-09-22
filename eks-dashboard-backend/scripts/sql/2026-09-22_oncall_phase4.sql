ALTER TABLE `oncall_notification_records`
  ADD COLUMN `provider_message_id` VARCHAR(256) DEFAULT NULL AFTER `idempotency_key`;
