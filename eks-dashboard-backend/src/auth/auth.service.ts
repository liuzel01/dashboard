import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import axios from 'axios';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AccessControlService } from '../access-control/access-control.service';

const verifyPassword = (password: string, stored: string) => {
  const [salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) return false;
  const computed = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return computed === hash;
};

@Injectable()
export class AuthService {
  private jwksClient: ReturnType<typeof jwksRsa> | null = null;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly config: ConfigService,
  ) {}

  private getJwtSecret() {
    return this.config.get<string>('AUTH_JWT_SECRET') || 'dev-secret';
  }

  private getJwtExpiresIn() {
    return this.config.get<string>('AUTH_JWT_EXPIRES_IN') || '7d';
  }

  private getKeycloakIssuer() {
    return this.config.get<string>('KEYCLOAK_ISSUER') || '';
  }

  private getKeycloakClientId() {
    return this.config.get<string>('KEYCLOAK_CLIENT_ID') || '';
  }

  private getKeycloakAllowedRedirectUris() {
    const list = this.config.get<string>('KEYCLOAK_REDIRECT_URIS') || '';
    const single = this.config.get<string>('KEYCLOAK_REDIRECT_URI') || '';
    const all = [...list.split(','), single]
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(all));
  }

  private getFrontendRedirectUris() {
    const list = this.config.get<string>('SSO_FRONTEND_REDIRECT_URIS') || '';
    const single = this.config.get<string>('SSO_FRONTEND_REDIRECT_URI') || '';
    const all = [...list.split(','), single]
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(all));
  }

  private getStateSecret() {
    return this.config.get<string>('AUTH_SSO_STATE_SECRET') || this.getJwtSecret();
  }

  private getKeycloakCallbackUri() {
    return (this.config.get<string>('KEYCLOAK_REDIRECT_URI') || '').trim();
  }

  private resolveFrontendRedirectUri(requested?: string) {
    const allowed = this.getFrontendRedirectUris();
    if (requested && requested.trim()) {
      const uri = requested.trim();
      if (allowed.length > 0 && !allowed.includes(uri)) {
        throw new BadRequestException('Invalid frontend redirect URI');
      }
      return uri;
    }
    if (allowed.length > 0) return allowed[0];
    return 'http://localhost:5173/sso/callback';
  }

  private signSsoState(frontendRedirectUri: string) {
    const nonce = randomBytes(12).toString('hex');
    return jwt.sign(
      { type: 'keycloak_state', nonce, frontendRedirectUri },
      this.getStateSecret(),
      { expiresIn: '10m' },
    );
  }

  private parseSsoState(state: string) {
    const decoded = jwt.verify(state, this.getStateSecret());
    if (typeof decoded !== 'object' || !decoded) {
      throw new BadRequestException('Invalid state');
    }
    const payload = decoded as { type?: unknown; frontendRedirectUri?: unknown };
    if (payload.type !== 'keycloak_state' || typeof payload.frontendRedirectUri !== 'string') {
      throw new BadRequestException('Invalid state');
    }
    return payload.frontendRedirectUri;
  }

  private buildFrontendRedirect(redirectUri: string, params: Record<string, string>) {
    const hash = new URLSearchParams(params).toString();
    return `${redirectUri}#${hash}`;
  }

  private getKeycloakJwksUri() {
    const explicit = this.config.get<string>('KEYCLOAK_JWKS_URI');
    if (explicit) return explicit;
    const issuer = this.getKeycloakIssuer();
    if (!issuer) return '';
    return `${issuer.replace(/\/+$/, '')}/protocol/openid-connect/certs`;
  }

  private getJwksClient() {
    if (this.jwksClient) return this.jwksClient;
    const jwksUri = this.getKeycloakJwksUri();
    if (!jwksUri) {
      throw new UnauthorizedException('Keycloak JWKS URI is not configured');
    }
    this.jwksClient = jwksRsa({
      jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
    return this.jwksClient;
  }

  signToken(payload: {
    sub: number;
    username: string;
    displayName?: string;
    email?: string;
    authSource?: 'local' | 'keycloak';
  }) {
    const expiresIn = this.getJwtExpiresIn();
    return jwt.sign(payload, this.getJwtSecret(), {
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    });
  }

  async verifyToken(token: string) {
    try {
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        throw new UnauthorizedException('Invalid token');
      }

      const issuer = this.getKeycloakIssuer();
      if (issuer && (decoded.payload as any)?.iss === issuer) {
        return await this.verifyKeycloakToken(token);
      }

      return this.verifyLocalToken(token);
    } catch (err) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private verifyLocalToken(token: string) {
    const decoded = jwt.verify(token, this.getJwtSecret());
    if (typeof decoded !== 'object' || decoded === null) {
      throw new UnauthorizedException('Invalid token');
    }
    const payload = decoded as jwt.JwtPayload & { sub?: unknown; username?: unknown };
    if (typeof payload.sub !== 'number' || typeof payload.username !== 'string') {
      throw new UnauthorizedException('Invalid token');
    }
    return {
      sub: payload.sub,
      username: payload.username,
      source: ((payload as any).authSource as 'local' | 'keycloak') || 'local',
      displayName: (payload as any).displayName || payload.username,
      email: (payload as any).email ? String((payload as any).email) : undefined,
    };
  }

  private async verifyKeycloakToken(token: string) {
    const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt | null;
    if (!decoded || typeof decoded === 'string') {
      throw new UnauthorizedException('Invalid token');
    }
    const kid = decoded.header?.kid;
    if (!kid) {
      throw new UnauthorizedException('Invalid token');
    }

    const client = this.getJwksClient();
    const signingKey = await client.getSigningKey(kid);
    const publicKey = signingKey.getPublicKey();
    const issuer = this.getKeycloakIssuer();
    const payload = jwt.verify(token, publicKey, {
      issuer: issuer || undefined,
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    const clientId = this.getKeycloakClientId();
    if (clientId) {
      const aud = payload.aud;
      const azp = (payload as any).azp;
      const audOk = Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
      const azpOk = azp === clientId;
      if (!audOk && !azpOk) {
        throw new UnauthorizedException('Invalid token audience');
      }
    }

    const username =
      (payload as any).preferred_username ||
      (payload as any).email ||
      payload.sub;
    const displayName =
      (payload as any).name ||
      (payload as any).given_name ||
      (payload as any).preferred_username ||
      (payload as any).email ||
      payload.sub;
    const email = (payload as any).email ? String((payload as any).email) : undefined;

    if (!username) {
      throw new UnauthorizedException('Token missing username');
    }

    return {
      sub: payload.sub as string,
      username: String(username),
      source: 'keycloak' as const,
      displayName: displayName ? String(displayName) : String(username),
      email,
    };
  }

  async login(usernameRaw: string, password: string) {
    const username = usernameRaw.trim();
    if (!username) throw new BadRequestException('用户名不能为空');

    const rows = await this.db.query<any[]>(
      'SELECT id, username, password_hash, status FROM users WHERE username = ? LIMIT 1',
      [username],
    );

    const user = rows?.[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('账号已被禁用');
    }

    await this.db.query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);

    const token = this.signToken({
      sub: user.id,
      username: user.username,
      displayName: user.username,
      authSource: 'local',
    });
    const me = await this.accessControl.getMe({ userId: user.id });

    return { token, user: me };
  }

  async exchangeKeycloakCode(params: { code: string; redirectUri: string; codeVerifier?: string }) {
    const issuer = this.getKeycloakIssuer();
    const clientId = this.getKeycloakClientId();
    const clientSecret = this.config.get<string>('KEYCLOAK_CLIENT_SECRET') || '';
    const allowedRedirects = this.getKeycloakAllowedRedirectUris();
    const tokenEndpoint = `${issuer.replace(/\/+$/, '')}/protocol/openid-connect/token`;

    if (!issuer || !clientId || !clientSecret) {
      throw new UnauthorizedException('Keycloak client is not configured');
    }
    if (allowedRedirects.length > 0 && !allowedRedirects.includes(params.redirectUri)) {
      throw new BadRequestException('Invalid redirect URI');
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    body.set('code', params.code);
    body.set('redirect_uri', params.redirectUri);
    if (params.codeVerifier) {
      body.set('code_verifier', params.codeVerifier);
    }

    const resp = await axios.post(tokenEndpoint, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });

    const accessToken = resp.data?.access_token as string | undefined;
    if (!accessToken) {
      throw new UnauthorizedException('Keycloak token missing');
    }

    const payload = await this.verifyKeycloakToken(accessToken);
    const user = await this.accessControl.ensureUserByUsername(payload.username, {
      displayName: payload.displayName,
    });
    await this.db.query('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);
    const token = this.signToken({
      sub: user.id,
      username: user.username,
      displayName: payload.displayName || payload.username,
      email: payload.email,
      authSource: 'keycloak',
    });
    const me = await this.accessControl.getMe({ userId: user.id });
    return { token, user: me };
  }

  buildKeycloakAuthorizeUrl(frontendRedirectUri?: string) {
    const issuer = this.getKeycloakIssuer();
    const clientId = this.getKeycloakClientId();
    const callbackUri = this.getKeycloakCallbackUri();
    const allowedRedirects = this.getKeycloakAllowedRedirectUris();
    const frontendRedirect = this.resolveFrontendRedirectUri(frontendRedirectUri);

    if (!issuer || !clientId || !callbackUri) {
      throw new UnauthorizedException('Keycloak client is not configured');
    }
    if (allowedRedirects.length > 0 && !allowedRedirects.includes(callbackUri)) {
      throw new BadRequestException('Backend callback URI is not in allowed redirect URIs');
    }

    const state = this.signSsoState(frontendRedirect);
    const nonce = randomBytes(12).toString('hex');
    const authUrl = new URL(`${issuer.replace(/\/+$/, '')}/protocol/openid-connect/auth`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('redirect_uri', callbackUri);
    authUrl.searchParams.set('nonce', nonce);
    return authUrl.toString();
  }

  async handleKeycloakCallback(params: {
    code?: string;
    state?: string;
    error?: string;
    errorDescription?: string;
  }) {
    let frontendRedirectUri = this.resolveFrontendRedirectUri();
    if (params.state) {
      try {
        frontendRedirectUri = this.parseSsoState(params.state);
      } catch {
        frontendRedirectUri = this.resolveFrontendRedirectUri();
      }
    }

    if (params.error) {
      return this.buildFrontendRedirect(frontendRedirectUri, {
        error: params.errorDescription || params.error,
      });
    }
    if (!params.code) {
      return this.buildFrontendRedirect(frontendRedirectUri, {
        error: 'Missing authorization code',
      });
    }
    if (!params.state) {
      return this.buildFrontendRedirect(frontendRedirectUri, {
        error: 'Missing state',
      });
    }

    try {
      const callbackUri = this.getKeycloakCallbackUri();
      this.parseSsoState(params.state);
      const result = await this.exchangeKeycloakCode({
        code: params.code,
        redirectUri: callbackUri,
      });
      return this.buildFrontendRedirect(frontendRedirectUri, { token: result.token });
    } catch (err: any) {
      return this.buildFrontendRedirect(frontendRedirectUri, {
        error: err?.response?.data?.error_description || err?.message || 'SSO login failed',
      });
    }
  }
}
