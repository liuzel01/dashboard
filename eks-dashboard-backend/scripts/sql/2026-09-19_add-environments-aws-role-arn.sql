-- Run once after checking the column does not already exist.
ALTER TABLE environments_config
  ADD COLUMN aws_role_arn VARCHAR(2048) NULL AFTER aws_profile;
