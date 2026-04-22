import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AgentDecryptProfile,
  AgentError,
  AgentRawConnectionConfig,
  AgentResolvedConnectionConfig,
} from './agent.types';

@Injectable()
export class AgentDecryptService {
  async decryptConfig(
    raw: AgentRawConnectionConfig,
    profile: AgentDecryptProfile,
    timeoutMs: number,
  ): Promise<AgentResolvedConnectionConfig> {
    return {
      mysql: {
        url: await this.decryptValue(raw.mysql.url, profile, timeoutMs),
        username: await this.decryptValue(
          raw.mysql.username,
          profile,
          timeoutMs,
        ),
        password: await this.decryptValue(
          raw.mysql.password,
          profile,
          timeoutMs,
        ),
      },
      redis: {
        host: await this.decryptValue(raw.redis.host, profile, timeoutMs),
        port: raw.redis.port,
        database: raw.redis.database,
        ssl: raw.redis.ssl,
        password: await this.decryptValue(
          raw.redis.password,
          profile,
          timeoutMs,
        ),
      },
      mongo: {
        uri: await this.decryptValue(raw.mongo.uri, profile, timeoutMs),
      },
    };
  }

  private async decryptValue(
    value: string,
    profile: AgentDecryptProfile,
    timeoutMs: number,
  ) {
    if (!value) return value;
    if (value.startsWith('plain://')) {
      return value.slice('plain://'.length);
    }
    if (profile.provider !== 'kms') {
      return value;
    }

    const prefix = profile.valuePrefix || 'kms://';
    if (!value.startsWith(prefix) && !profile.forceKmsForAll) {
      return value;
    }

    const payload = value.startsWith(prefix) ? value.slice(prefix.length) : value;
    return this.decryptViaAwsCli(payload, profile, timeoutMs);
  }

  private async decryptViaAwsCli(
    ciphertextBase64: string,
    profile: AgentDecryptProfile,
    timeoutMs: number,
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kms-'));
    const inputFile = path.join(dir, `${randomUUID()}.bin`);
    try {
      const blob = Buffer.from(ciphertextBase64, 'base64');
      fs.writeFileSync(inputFile, blob);

      const args = [
        'kms',
        'decrypt',
        '--ciphertext-blob',
        `fileb://${inputFile}`,
        '--output',
        'text',
        '--query',
        'Plaintext',
      ];

      if (profile.region) {
        args.push('--region', profile.region);
      }
      if (profile.kmsKeyAlias) {
        args.push('--key-id', profile.kmsKeyAlias);
      }
      const contextPairs = Object.entries(profile.kmsContext || {}).map(
        ([key, val]) => `${key}=${val}`,
      );
      if (contextPairs.length > 0) {
        args.push('--encryption-context', contextPairs.join(','));
      }

      const stdout = await this.runCommand('aws', args, timeoutMs);
      return Buffer.from(stdout.trim(), 'base64').toString('utf8');
    } catch (error) {
      throw new AgentError(
        'DECRYPT_FAILED',
        `Failed to decrypt KMS payload: ${String(error)}`,
      );
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    }
  }

  private runCommand(cmd: string, args: string[], timeoutMs: number) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let done = false;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        child.kill('SIGKILL');
        reject(new Error(`Command timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `Command exited with code ${code}: ${stderr.trim() || 'unknown error'}`,
            ),
          );
          return;
        }
        resolve(stdout);
      });
    });
  }
}

