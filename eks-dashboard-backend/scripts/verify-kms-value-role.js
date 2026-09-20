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

const KMS = {
  keyAlias: 'alias/kms-eks-hash',
  keyArn: 'arn:aws:kms:ap-east-1:290368114919:key/83e9cdb2-a10e-49f3-9998-74c1f0a6bc9a',
  region: 'ap-east-1',
  context: { Environment: 'hash', Source: 'backend', DataType: 'config-password' },
};

function environmentIdFromArgs() {
  const index = process.argv.indexOf('--environment');
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : 'hashex';
}

async function main() {
  const environmentId = environmentIdFromArgs();
  if (environmentId !== 'hashex') throw new Error('This verifier currently supports only --environment hashex.');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  try {
    const [rows] = await connection.execute('SELECT aws_role_arn FROM environments_config WHERE environment_id = ? LIMIT 1', [environmentId]);
    const roleArn = String(rows[0]?.aws_role_arn || '').trim();
    if (!roleArn) throw new Error(`Environment ${environmentId} has no aws_role_arn.`);
    const credentials = fromTemporaryCredentials({
      masterCredentials: fromInstanceMetadata({ maxRetries: 1, timeout: 1_000 }),
      clientConfig: { region: process.env.AWS_STS_REGION || 'ap-southeast-1' },
      params: { RoleArn: roleArn, RoleSessionName: 'dashboard-kms-verifier' },
    });
    const kms = new KMSClient({ region: KMS.region, credentials });
    const sentinel = Buffer.from(`dashboard-kms-verifier:${randomUUID()}`, 'utf8');
    const encrypted = await kms.send(new EncryptCommand({ KeyId: KMS.keyArn, Plaintext: sentinel, EncryptionContext: KMS.context }));
    if (!encrypted.CiphertextBlob) throw new Error('KMS Encrypt returned no ciphertext.');
    const decrypted = await kms.send(new DecryptCommand({ KeyId: KMS.keyArn, CiphertextBlob: encrypted.CiphertextBlob, EncryptionContext: KMS.context }));
    if (!decrypted.Plaintext || !Buffer.from(decrypted.Plaintext).equals(sentinel)) throw new Error('KMS Decrypt round-trip verification failed.');
    console.log(JSON.stringify({ environmentId, targetRoleArn: roleArn, keyAlias: KMS.keyAlias, keyArn: KMS.keyArn, region: KMS.region, encryptionContext: KMS.context, roundTripSucceeded: true }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ roundTripSucceeded: false, error: error?.message || String(error) }));
  process.exitCode = 1;
});
