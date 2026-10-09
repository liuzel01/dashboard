import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import * as mysql from 'mysql2/promise';
import { PlatformDatabaseService } from './platform-database.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const DEFAULT_PERMISSIONS = [
  { key: 'menu:environments', name: '环境管理' },
  { key: 'menu:site-conf', name: 'siteconf 配置' },
  { key: 'menu:s3-upload', name: 'S3 上传' },
  { key: 'menu:deployments', name: 'EKS 部署' },
  { key: 'menu:jump-servers', name: 'Windows 跳板机' },
  { key: 'menu:data-query', name: '查询中心' },
  { key: 'menu:security-groups', name: '安全组管理' },
  { key: 'menu:asset-management', name: '资产管理' },
  { key: 'menu:cert-study', name: '证书题库' },
  { key: 'menu:lines', name: '线路总览' },
  { key: 'menu:line-onboarding', name: '新增线路向导' },
  { key: 'menu:admin-site-onboarding', name: '管理端网站 Ingress' },
  { key: 'menu:site-monitors', name: '站点监控' },
  { key: 'menu:monitoring-requests', name: '监控资源申请' },
  { key: 'menu:cicd-runs', name: 'CI/CD 执行中心' },
  { key: 'cicd-config:manage', name: 'CI/CD 目录与连接诊断' },
  { key: 'monitoring-requests:approve', name: '监控资源申请审批' },
  { key: 'monitoring-requests:manage', name: '监控资源申请管理' },
  { key: 'menu:access-control', name: '账号管理' },
  { key: 'menu:ai-ops', name: 'AI 运维' },
  { key: 'menu:ssl-certificates', name: 'SSL证书申请' },
  { key: 'menu:kms-values', name: 'KMS 配置加解密' },
  { key: 'menu:oncall', name: 'Oncall 告警' },
  { key: 'menu:signal-monitor', name: 'Signal Monitor' },
  { key: 'aiops:qa', name: 'AI 问答' },
  { key: 'aiops:sql:generate', name: 'AI SQL 生成' },
  { key: 'aiops:incident:analyze', name: '故障定位分析' },
  { key: 'aiops:slowlog:analyze', name: '慢查询分析' },
  { key: 'aiops:notify:lark', name: 'AI 告警推送 Lark' },
];

const generatePassword = () => {
  const raw = randomBytes(9).toString('base64');
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, '');
  if (cleaned.length >= 10) return cleaned.slice(0, 10);
  return `${cleaned}${randomBytes(4).toString('hex')}`.slice(0, 10);
};

const hashPassword = (password: string) => {
  const salt = randomBytes(8).toString('hex');
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `${salt}$${hash}`;
};

@Injectable()
export class AccessControlService {
  constructor(private readonly db: PlatformDatabaseService) {}

  private async getUserById(id: number) {
    const rows = await this.db.query<any[]>(
      'SELECT id, username, display_name, status, last_login_at FROM users WHERE id = ? LIMIT 1',
      [
      id,
      ],
    );
    return rows?.[0] || null;
  }

  private async getUserByUsername(username: string) {
    const rows = await this.db.query<any[]>(
      'SELECT id, username, display_name, status, last_login_at FROM users WHERE username = ? LIMIT 1',
      [username],
    );
    return rows?.[0] || null;
  }

  private async getDefaultUser() {
    const rows = await this.db.query<any[]>(
      "SELECT id, username, display_name, status, last_login_at FROM users WHERE status = 'active' ORDER BY id ASC LIMIT 1",
    );
    if (rows?.[0]) return rows[0];
    const fallback = await this.db.query<any[]>(
      'SELECT id, username, display_name, status, last_login_at FROM users ORDER BY id ASC LIMIT 1',
    );
    return fallback?.[0] || null;
  }

  private async ensureDefaultPermissions() {
    const existing = await this.db.query<{ key: string }[]>('SELECT `key` FROM permissions');
    const existingKeys = new Set(existing.map((row) => row.key));
    const missing = DEFAULT_PERMISSIONS.filter((p) => !existingKeys.has(p.key));

    if (missing.length > 0) {
      const valuesSql = missing.map(() => '(?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())').join(',');
      const params: any[] = [];
      missing.forEach((p) => {
        params.push(p.key, p.name);
      });

      await this.db.query(
        `INSERT INTO permissions (\`key\`, name, created_at, updated_at) VALUES ${valuesSql}`,
        params,
      );
    }

  }

  async listPermissions() {
    await this.ensureDefaultPermissions();
    return this.db.query(
      `SELECT id, \`key\`, name, created_at, updated_at
       FROM permissions
       WHERE \`key\` <> ?
       ORDER BY
         CASE WHEN \`key\` LIKE 'menu:%' THEN 0 ELSE 1 END ASC,
         \`key\` ASC`,
      ['aiops:sql:execute'],
    );
  }

  async ensureUserByUsername(usernameRaw: string, opts?: { displayName?: string }) {
    const username = usernameRaw.trim();
    const displayName = opts?.displayName?.trim() || null;
    if (!username) {
      throw new BadRequestException('用户名不能为空');
    }
    const existing = await this.getUserByUsername(username);
    if (existing) {
      if (existing.status && existing.status !== 'active') {
        throw new UnauthorizedException('账号已被禁用');
      }
      if (displayName && existing.display_name !== displayName) {
        await this.db.query(
          'UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
          [displayName, existing.id],
        );
        existing.display_name = displayName;
      }
      return existing;
    }
    const initialPassword = generatePassword();
    const passwordHash = hashPassword(initialPassword);
    const result = await this.db.query<mysql.ResultSetHeader>(
      'INSERT INTO users (username, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
      [username, displayName || username, passwordHash, 'active'],
    );
    return { id: result.insertId, username, display_name: displayName || username, status: 'active' };
  }

  async getMe(params?: { userId?: number; username?: string; allowDefaultUser?: boolean; allowBootstrap?: boolean }) {
    await this.ensureDefaultPermissions();
    let user: any = null;
    const explicitUserId = params?.userId && !Number.isNaN(params.userId);
    const explicitUsername = params?.username && params.username.trim() !== '';

    if (explicitUserId) {
      user = await this.getUserById(params!.userId!);
      if (!user) throw new NotFoundException('用户不存在');
    } else if (explicitUsername) {
      user = await this.getUserByUsername(params!.username!.trim());
      if (!user) throw new NotFoundException('用户不存在');
    } else if (params?.allowDefaultUser) {
      user = await this.getDefaultUser();
    }

    if (!user) {
      if (params?.allowBootstrap) {
        const perms = await this.listPermissions();
        return {
          id: null,
          username: 'bootstrap',
          roles: [],
          permissions: perms.map((p: any) => p.key),
          bootstrap: true,
        };
      }
      throw new NotFoundException('用户不存在');
    }

    const roles = await this.db.query<{ id: number; name: string }[]>(
      'SELECT r.id, r.name FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id ASC',
      [user.id],
    );

    const permissions = await this.db.query<{ key: string }[]>(
      `SELECT DISTINCT p.\`key\`
       FROM permissions p
       INNER JOIN role_permissions rp ON rp.permission_id = p.id
       INNER JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = ?
       ORDER BY p.id ASC`,
      [user.id],
    );

    return {
      id: user.id,
      username: user.username,
      display_name: user.display_name || user.username,
      status: user.status,
      last_login_at: user.last_login_at,
      roles,
      permissions: permissions.map((p) => p.key),
    };
  }

  async listRoles() {
    await this.ensureDefaultPermissions();
    const roles = await this.db.query<any[]>(
      `SELECT r.id, r.name, r.description, r.created_at, r.updated_at, COUNT(ur.user_id) AS user_count
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id
       GROUP BY r.id
       ORDER BY
         CASE
           WHEN LOWER(r.name) = 'admin' THEN 0
           WHEN r.name = '管理员' THEN 1
           WHEN r.name = '运维' THEN 2
           ELSE 3
         END ASC,
         r.id ASC`,
    );

    const perms = await this.db.query<{ role_id: number; permission_id: number }[]>(
      'SELECT role_id, permission_id FROM role_permissions',
    );
    const permMap = new Map<number, number[]>();
    perms.forEach((row) => {
      const list = permMap.get(row.role_id) ?? [];
      list.push(row.permission_id);
      permMap.set(row.role_id, list);
    });

    return roles.map((role) => ({
      ...role,
      user_count: Number(role.user_count || 0),
      permission_ids: permMap.get(role.id) ?? [],
    }));
  }

  async listUsers() {
    const rows = await this.db.query<any[]>(
      `SELECT u.id, u.username, u.display_name, u.status, u.last_login_at, u.created_at, u.updated_at,
              CASE WHEN u.mfa_enabled = 1 AND u.mfa_secret IS NOT NULL THEN 1 ELSE 0 END AS mfa_enabled,
              CASE WHEN u.mfa_enabled = 0 AND u.mfa_secret IS NOT NULL THEN 1 ELSE 0 END AS mfa_pending,
              GROUP_CONCAT(r.id ORDER BY r.id) AS role_ids,
              GROUP_CONCAT(r.name ORDER BY r.name) AS role_names
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       GROUP BY u.id
       ORDER BY u.id DESC`,
    );

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      display_name: row.display_name || row.username,
      status: row.status,
      last_login_at: row.last_login_at,
      mfa_enabled: Number(row.mfa_enabled || 0) === 1,
      mfa_pending: Number(row.mfa_pending || 0) === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      role_ids: row.role_ids ? String(row.role_ids).split(',').map((v) => Number(v)) : [],
      role_names: row.role_names ? String(row.role_names).split(',') : [],
    }));
  }

  async createUser(dto: CreateUserDto) {
    const username = dto.username.trim();
    const displayName = dto.displayName?.trim();
    if (!username) {
      throw new BadRequestException('用户名不能为空');
    }

    return this.db.withTransaction(async (conn) => {
      const [exists] = await conn.execute<any[]>('SELECT id FROM users WHERE username = ? LIMIT 1', [
        username,
      ]);
      if (Array.isArray(exists) && exists.length > 0) {
        throw new BadRequestException('用户名已存在');
      }

      const initialPassword = dto.password?.trim() || generatePassword();
      const passwordHash = hashPassword(initialPassword);
      const status = dto.status ?? 'active';

      const [result] = await conn.execute<mysql.ResultSetHeader>(
        'INSERT INTO users (username, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
        [username, displayName || username, passwordHash, status],
      );

      const userId = result.insertId;
      if (dto.roleIds && dto.roleIds.length > 0) {
        const valuesSql = dto.roleIds.map(() => '(?, ?)').join(',');
        const params: any[] = [];
        dto.roleIds.forEach((roleId) => {
          params.push(userId, roleId);
        });
        await conn.execute(
          `INSERT INTO user_roles (user_id, role_id) VALUES ${valuesSql}`,
          params,
        );
      }

      return {
        id: userId,
        initialPassword: dto.password ? undefined : initialPassword,
      };
    });
  }

  async updateUser(id: number, dto: UpdateUserDto) {
    return this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<any[]>('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new NotFoundException('用户不存在');
      }

      const fields: string[] = [];
      const params: any[] = [];
      if (dto.username !== undefined) {
        const name = dto.username.trim();
        if (!name) throw new BadRequestException('用户名不能为空');
        const [dup] = await conn.execute<any[]>(
          'SELECT id FROM users WHERE username = ? AND id <> ? LIMIT 1',
          [name, id],
        );
        if (Array.isArray(dup) && dup.length > 0) {
          throw new BadRequestException('用户名已存在');
        }
        fields.push('username = ?');
        params.push(name);
      }

      if (dto.displayName !== undefined) {
        fields.push('display_name = ?');
        params.push(dto.displayName.trim() || null);
      }

      if (dto.status !== undefined) {
        fields.push('status = ?');
        params.push(dto.status);
      }

      if (fields.length > 0) {
        params.push(id);
        await conn.execute(
          `UPDATE users SET ${fields.join(', ')}, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
          params,
        );
      }

      if (dto.roleIds !== undefined) {
        await conn.execute('DELETE FROM user_roles WHERE user_id = ?', [id]);
        if (dto.roleIds.length > 0) {
          const valuesSql = dto.roleIds.map(() => '(?, ?)').join(',');
          const roleParams: any[] = [];
          dto.roleIds.forEach((roleId) => {
            roleParams.push(id, roleId);
          });
          await conn.execute(
            `INSERT INTO user_roles (user_id, role_id) VALUES ${valuesSql}`,
            roleParams,
          );
        }
      }

      return { ok: true };
    });
  }

  async resetPassword(id: number, password?: string) {
    return this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<any[]>(
        'SELECT id, username FROM users WHERE id = ? LIMIT 1',
        [id],
      );
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new NotFoundException('用户不存在');
      }
      const target = rows[0];
      if (String(target.username || '').toLowerCase() !== 'admin') {
        throw new BadRequestException('仅 admin 账号支持重置密码');
      }

      const nextPassword = password?.trim() || generatePassword();
      const passwordHash = hashPassword(nextPassword);
      await conn.execute('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [
        passwordHash,
        id,
      ]);

      return { password: password ? undefined : nextPassword };
    });
  }

  async createRole(dto: CreateRoleDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('角色名不能为空');

    const [exists] = await this.db.query<any[]>('SELECT id FROM roles WHERE name = ? LIMIT 1', [
      name,
    ]);
    if (Array.isArray(exists) && exists.length > 0) {
      throw new BadRequestException('角色名已存在');
    }

    const result = await this.db.query<mysql.ResultSetHeader>(
      'INSERT INTO roles (name, description, created_at, updated_at) VALUES (?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())',
      [name, dto.description?.trim() || null],
    );

    return { id: result.insertId };
  }

  async updateRole(id: number, dto: UpdateRoleDto) {
    const fields: string[] = [];
    const params: any[] = [];

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('角色名不能为空');
      const [dup] = await this.db.query<any[]>(
        'SELECT id FROM roles WHERE name = ? AND id <> ? LIMIT 1',
        [name, id],
      );
      if (Array.isArray(dup) && dup.length > 0) {
        throw new BadRequestException('角色名已存在');
      }
      fields.push('name = ?');
      params.push(name);
    }

    if (dto.description !== undefined) {
      fields.push('description = ?');
      params.push(dto.description?.trim() || null);
    }

    if (fields.length === 0) return { ok: true };
    params.push(id);

    await this.db.query(
      `UPDATE roles SET ${fields.join(', ')}, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      params,
    );

    return { ok: true };
  }

  async deleteRole(id: number) {
    const [rows] = await this.db.query<any[]>(
      'SELECT COUNT(*) AS cnt FROM user_roles WHERE role_id = ?',
      [id],
    );
    const count = Number(rows?.[0]?.cnt || 0);
    if (count > 0) {
      throw new BadRequestException('该角色仍被用户使用，无法删除');
    }

    await this.db.query('DELETE FROM roles WHERE id = ?', [id]);
    return { ok: true };
  }

  async updateRolePermissions(id: number, dto: UpdateRolePermissionsDto) {
    return this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<any[]>('SELECT id FROM roles WHERE id = ? LIMIT 1', [id]);
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new NotFoundException('角色不存在');
      }

      await conn.execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
      if (dto.permissionIds.length > 0) {
        const valuesSql = dto.permissionIds.map(() => '(?, ?)').join(',');
        const params: any[] = [];
        dto.permissionIds.forEach((permId) => {
          params.push(id, permId);
        });
        await conn.execute(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ${valuesSql}`,
          params,
        );
      }
      return { ok: true };
    });
  }
}
