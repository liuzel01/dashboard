#!/usr/bin/env node

/*
 * Runs on the Dashboard EC2 host to verify the complete production credential
 * path: instance profile -> environment target role -> KMS Encrypt/Decrypt.
 * It deliberately prints neither credentials nor plaintext/ciphertext.
 */
require('dotenv').config();

const { randomUUID } = require('crypto');
const mysql = require('mysql2/promise');
const { DecryptCommand, EncryptCommand, KMSClient } = require('@aws-sdk/client-kms');
const { fromInstanceMetadata, fromTemporaryCredentials } = require('@aws-sdk/credential-providers');

const KMS_CONFIGURATIONS = {
  hashex: { keyAlias: 'alias/kms-eks-hash', keyId: 'arn:aws:kms:ap-east-1:290368114919:key/83e9cdb2-a10e-49f3-9998-74c1f0a6bc9a', context: { Environment: 'hash', Source: 'backend', DataType: 'config-password' } },
  mgbx: { keyAlias: 'alias/kms-eks-mgbx', keyId: 'arn:aws:kms:ap-southeast-1:931324892624:key/7dc0ce50-e5a3-40a8-8ba3-cba434cc3ef7', context: { Environment: 'mega', Source: 'backend', DataType: 'config-password' } },
  icoin: { keyAlias: 'alias/kms-eks-newicoin', keyId: 'arn:aws:kms:ap-southeast-1:412235698072:key/27d8eb92-0774-4014-8b6d-8c3818c262f1', context: { Environment: 'icoin', Source: 'backend', DataType: 'config-password' } },
  tb: { keyAlias: 'alias/kms-eks-vlink', keyId: 'arn:aws:kms:ap-southeast-1:249563934516:key/fd39ad0b-0fff-48ac-ab9c-38a1a431ca5d', context: { Environment: 'vlink', Source: 'backend', DataType: 'config-password' } },
};

function environmentIdFromArgs() {
  const index = process.argv.indexOf('--environment');
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : 'hashex';
}

async function main() {
  const environmentId = environmentIdFromArgs();
  const configuration = KMS_CONFIGURATIONS[environmentId];
  if (!configuration) throw new Error(`No KMS configuration for environment ${environmentId}.`);
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  try {
    const [rows] = await connection.execute('SELECT aws_role_arn, aws_region FROM environments_config WHERE environment_id = ? LIMIT 1', [environmentId]);
    const roleArn = String(rows[0]?.aws_role_arn || '').trim();
    if (!roleArn) throw new Error(`Environment ${environmentId} has no aws_role_arn.`);
    const region = String(rows[0]?.aws_region || '').trim();
    if (!region) throw new Error(`Environment ${environmentId} has no aws_region.`);
    const credentials = fromTemporaryCredentials({
      masterCredentials: fromInstanceMetadata({ maxRetries: 1, timeout: 1_000 }),
      clientConfig: { region: process.env.AWS_STS_REGION || 'ap-southeast-1' },
      params: { RoleArn: roleArn, RoleSessionName: 'dashboard-kms-verifier' },
    });
    const kms = new KMSClient({ region, credentials });
    const sentinel = Buffer.from(`dashboard-kms-verifier:${randomUUID()}`, 'utf8');
    const encrypted = await kms.send(new EncryptCommand({ KeyId: configuration.keyId, Plaintext: sentinel, EncryptionContext: configuration.context }));
    if (!encrypted.CiphertextBlob) throw new Error('KMS Encrypt returned no ciphertext.');
    const decrypted = await kms.send(new DecryptCommand({ KeyId: configuration.keyId, CiphertextBlob: encrypted.CiphertextBlob, EncryptionContext: configuration.context }));
    if (!decrypted.Plaintext || !Buffer.from(decrypted.Plaintext).equals(sentinel)) throw new Error('KMS Decrypt round-trip verification failed.');
    console.log(JSON.stringify({ environmentId, targetRoleArn: roleArn, keyAlias: configuration.keyAlias, keyId: configuration.keyId, region, encryptionContext: configuration.context, roundTripSucceeded: true }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ roundTripSucceeded: false, error: error?.message || String(error) }));
  process.exitCode = 1;
});
