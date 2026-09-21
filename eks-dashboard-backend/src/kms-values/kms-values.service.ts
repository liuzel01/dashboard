import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { fromInstanceMetadata, fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { verifySync } from 'otplib';
import { AccessControlService } from '../access-control/access-control.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { EnvironmentsService } from '../environments/environments.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';

const MENU_PERMISSION = 'menu:kms-values';
const PREFIX = '{kms-app}';
type KmsConfiguration = { keyAlias: string; keyId: string; context: Record<string, string> };
const KMS_CONFIGURATIONS: Record<string, KmsConfiguration> = {
  hashex: { keyAlias: 'alias/kms-eks-hash', keyId: 'arn:aws:kms:ap-east-1:290368114919:key/83e9cdb2-a10e-49f3-9998-74c1f0a6bc9a', context: { Environment: 'hash', Source: 'backend', DataType: 'config-password' } },
  mgbx: { keyAlias: 'alias/kms-eks-mgbx', keyId: 'arn:aws:kms:ap-southeast-1:931324892624:key/7dc0ce50-e5a3-40a8-8ba3-cba434cc3ef7', context: { Environment: 'mega', Source: 'backend', DataType: 'config-password' } },
  icoin: { keyAlias: 'alias/kms-eks-newicoin', keyId: 'alias/kms-eks-newicoin', context: { Environment: 'icoin', Source: 'backend', DataType: 'config-password' } },
  tb: { keyAlias: 'alias/kms-eks-vlink', keyId: 'alias/kms-eks-vlink', context: { Environment: 'vlink', Source: 'backend', DataType: 'config-password' } },
};
type Actor = { userId: number; username: string; displayName?: string | null; permissions: string[]; mfaEnabled?: boolean; mfaSecret?: string | null };

@Injectable()
export class KmsValuesService {
  constructor(private readonly auth: AuthService, private readonly access: AccessControlService, private readonly audit: AuditService, private readonly environments: EnvironmentsService, private readonly db: PlatformDatabaseService) {}
  async resolveActorFromAuthorization(authorization?: string): Promise<Actor> {
    if (!String(authorization || '').toLowerCase().startsWith('bearer ')) throw new UnauthorizedException('Missing token');
    const payload = await this.auth.verifyToken(String(authorization).slice(7).trim());
    const userId = payload.source === 'keycloak' || typeof payload.sub !== 'number'
      ? (await this.access.ensureUserByUsername(payload.username, { displayName: payload.displayName })).id
      : Number(payload.sub);
    const me = await this.access.getMe({ userId });
    const rows = await this.db.query<any[]>('SELECT mfa_enabled, mfa_secret, display_name FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows[0] || {};
    const actor: Actor = { userId: Number(me.id), username: String(me.username || payload.username || ''), displayName: String(user.display_name || me.display_name || me.username || ''), permissions: Array.isArray(me.permissions) ? me.permissions.map(String) : [], mfaEnabled: Number(user.mfa_enabled || 0) === 1 && !!user.mfa_secret, mfaSecret: user.mfa_secret ? String(user.mfa_secret) : null };
    if (!actor.permissions.includes(MENU_PERMISSION)) throw new ForbiddenException(`Missing permissions: ${MENU_PERMISSION}`);
    return actor;
  }
  async getConfiguration(environmentId: string) {
    const configuration = KMS_CONFIGURATIONS[environmentId];
    if (!configuration) return { supported: false, environmentId, reason: '当前环境尚未配置 KMS 变量值加解密。' };
    const env = await this.environments.getEnvironmentConfigById(environmentId);
    if (!env) throw new NotFoundException(`Environment "${environmentId}" not found`);
    return {
      supported: true,
      environmentId,
      keyAlias: configuration.keyAlias,
      keyId: configuration.keyId,
      region: env.aws_region,
      encryptionContext: configuration.context,
      ciphertextPrefix: PREFIX,
      targetRoleConfigured: !!String(env.aws_role_arn || '').trim(),
    };
  }
  private async client(environmentId: string) {
    const configuration = KMS_CONFIGURATIONS[environmentId];
    if (!configuration) throw new BadRequestException(`环境 ${environmentId} 尚未配置 KMS 变量值加解密。`);
    const env = await this.environments.getEnvironmentConfigById(environmentId);
    if (!env) throw new NotFoundException(`Environment "${environmentId}" not found`);
    const roleArn = String(env.aws_role_arn || '').trim();
    if (!roleArn) throw new BadRequestException(`环境 ${environmentId} 未配置 aws_role_arn。`);
    const region = String(env.aws_region || '').trim();
    if (!region) throw new BadRequestException(`环境 ${environmentId} 未配置 aws_region。`);
    const credentials = fromTemporaryCredentials({ masterCredentials: fromInstanceMetadata({ maxRetries: 1, timeout: 1_000 }), clientConfig: { region: process.env.AWS_STS_REGION || 'ap-southeast-1' }, params: { RoleArn: roleArn, RoleSessionName: `dashboard-kms-${environmentId}` } });
    return { client: new KMSClient({ region, credentials }), configuration };
  }
  private assertMfa(actor: Actor, code: string) {
    if (!actor.mfaEnabled || !actor.mfaSecret) throw new BadRequestException('当前账号未启用 Google Authenticator MFA');
    if (!verifySync({ strategy: 'totp', secret: actor.mfaSecret, token: String(code || '').replace(/\s+/g, ''), epochTolerance: 0 })) throw new UnauthorizedException('Google 验证码错误');
  }
  private digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private async record(actor: Actor, action: string, environmentId: string, input: string, configuration: KmsConfiguration, meta: { ip?: string | null; userAgent?: string | null }) {
    await this.audit.record({ actorUserId: actor.userId, actorUsername: actor.username, actorDisplayName: actor.displayName || actor.username, method: 'POST', path: `/kms-values/${action}`, menuKey: MENU_PERMISSION, action: `kmsValues.${action}`, actionName: action === 'encrypt' ? 'KMS 加密变量值' : 'KMS 解密变量值', targetType: 'kms_value', targetId: configuration.keyId, requestSummary: { environmentId, keyId: configuration.keyId, inputSha256: this.digest(input) }, responseSummary: { ok: true }, status: 'success', statusCode: 200, ip: meta.ip || null, userAgent: meta.userAgent || null });
  }
  async encrypt(actor: Actor, input: { environmentId: string; value: string }, meta: { ip?: string | null; userAgent?: string | null }) {
    const value = String(input.value || '');
    if (Buffer.byteLength(value, 'utf8') > 4096) throw new BadRequestException('变量值超过 KMS Encrypt 的 4096 字节上限。');
    try {
      const { client, configuration } = await this.client(input.environmentId);
      const out = await client.send(new EncryptCommand({ KeyId: configuration.keyId, Plaintext: Buffer.from(value, 'utf8'), EncryptionContext: configuration.context }));
      if (!out.CiphertextBlob) throw new ServiceUnavailableException('KMS 未返回密文');
      await this.record(actor, 'encrypt', input.environmentId, value, configuration, meta);
      return { value: `${PREFIX}${Buffer.from(out.CiphertextBlob).toString('base64')}`, prefix: PREFIX, keyId: configuration.keyId };
    } catch (error: any) { throw new BadRequestException(`KMS 加密失败：${error?.name || 'UnknownError'}: ${error?.message || String(error)}`); }
  }
  async decrypt(actor: Actor, input: { environmentId: string; value: string; otpCode: string }, meta: { ip?: string | null; userAgent?: string | null }) {
    this.assertMfa(actor, input.otpCode);
    const value = String(input.value || '').trim();
    if (!value.startsWith(PREFIX)) throw new BadRequestException(`密文必须以 ${PREFIX} 开头。`);
    let blob: Buffer; try { blob = Buffer.from(value.slice(PREFIX.length), 'base64'); } catch { throw new BadRequestException('密文不是有效 Base64。'); }
    try {
      const { client, configuration } = await this.client(input.environmentId);
      const out = await client.send(new DecryptCommand({ KeyId: configuration.keyId, CiphertextBlob: blob, EncryptionContext: configuration.context }));
      if (!out.Plaintext) throw new ServiceUnavailableException('KMS 未返回明文');
      const plain = Buffer.from(out.Plaintext).toString('utf8');
      await this.record(actor, 'decrypt', input.environmentId, value, configuration, meta);
      return { value: plain };
    } catch (error: any) { throw new BadRequestException(`KMS 解密失败：${error?.name || 'UnknownError'}: ${error?.message || String(error)}`); }
  }
}
