import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import * as net from 'net';
import { EnvironmentsService } from '../environments/environments.service';
import { TunnelManagerService } from '../tunnel/tunnel-manager.service';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pools = new Map<string, mysql.Pool>();

  constructor(
    private readonly environmentsService: EnvironmentsService,
    private readonly tunnelManager: TunnelManagerService,
  ) {}

  async onModuleDestroy() {
    this.logger.log('Closing all database connection pools...');
    for (const pool of this.pools.values()) {
      await pool.end();
    }
    this.pools.clear();
    this.logger.log('All database connection pools closed.');
  }

  private async getPool(environmentId: string): Promise<mysql.Pool> {
    if (this.pools.has(environmentId)) {
      return this.pools.get(environmentId)!;
    }

    // Get potentially proxied DB config. This will establish an SSH tunnel if needed.
    const env = this.environmentsService.getEnvironmentById(environmentId)!;
    if (!env) throw new Error(`Environment ${environmentId} not found`);

    let dbConfig = env.database!;
    // If jump server exists, request a tunnel via TunnelManager
    if (env.jumpServer) {
      const forwards = [
        {
          name: 'mysql',
          dstHost: env.database!.host,
          dstPort: env.database!.port,
        },
      ];
      const tunnel = await this.tunnelManager.getTunnel(
        environmentId,
        forwards,
      );
      const localPort = tunnel.localPorts['mysql'];
      dbConfig = { ...dbConfig, host: tunnel.localHost, port: localPort };
    }

    const pool = mysql.createPool({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      port: dbConfig.port,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // Verify the pool can obtain a connection. This avoids returning a pool
    // while the SSH tunnel exists but the local forwarded port isn't yet
    // accepting connections (race condition leading to ECONNREFUSED).
    const maxAttempts = 5;
    let attempt = 0;
    const backoff = (n: number) => 100 * Math.pow(2, n); // 100ms,200ms,400ms...
    let lastError: unknown = null;

    const extractErrorMessage = (e: unknown): string => {
      if (e === null || e === undefined) return 'Unknown error';
      if (typeof e === 'string') return e;
      if (e instanceof Error) return e.message;
      try {
        return JSON.stringify(e);
      } catch {
        return String(e);
      }
    };

    while (attempt < maxAttempts) {
      try {
        const conn = await pool.getConnection();
        // immediately release; we just wanted to confirm connectivity
        conn.release();
        // Also verify TCP-level connectivity to the configured host:port
        const waitForTcp = (host: string, port: number, timeoutMs = 3000) =>
          new Promise<void>((resolve, reject) => {
            const socket = new net.Socket();
            let settled = false;
            const timer = setTimeout(() => {
              settled = true;
              socket.destroy();
              reject(new Error('Timeout waiting for TCP connect'));
            }, timeoutMs);

            socket.once('error', (err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              socket.destroy();
              reject(err);
            });

            socket.connect(port, dbConfig.host, () => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              socket.end();
              resolve();
            });
          });

        await waitForTcp(dbConfig.host, dbConfig.port, 3000);
        this.pools.set(environmentId, pool);
        this.logger.log(
          `Database connection pool created for environment "${environmentId}".`,
        );
        return pool;
      } catch (err: unknown) {
        lastError = err;
        attempt += 1;
        const waitMs = backoff(attempt);
        this.logger.warn(
          `Initial DB connection attempt ${attempt} for env "${environmentId}" failed: ${extractErrorMessage(err)}; retrying in ${waitMs}ms...`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    // If we reach here, the pool couldn't establish a connection. Close it
    // to avoid leaking resources and surface a clear error to the caller.
    try {
      await pool.end();
    } catch {
      // ignore
    }
    const errMsg = extractErrorMessage(lastError);
    this.logger.error(
      `Failed to create DB pool for env "${environmentId}": ${errMsg}`,
    );
    throw new Error(`Failed to create DB pool: ${errMsg}`);
  }

  async findUserByUid(
    environmentId: string,
    uid: string,
    tenantId?: number,
  ): Promise<Record<string, unknown> | null> {
    const pool = await this.getPool(environmentId);
    let sql = 'SELECT * FROM `tbl_user` WHERE `tenant_user_id` = ?';
    const params: (string | number)[] = [uid];

    if (tenantId) {
      sql += ' AND `tenant_id` = ?';
      params.push(tenantId);
    }

    try {
      const [rows] = await pool.execute(sql, params);
      return Array.isArray(rows) && rows.length > 0
        ? (rows[0] as Record<string, unknown>)
        : null;
    } catch (error: unknown) {
      const msg = (error instanceof Error && error.message) || String(error);
      this.logger.error(
        `Error querying user by UID ${uid} in env ${environmentId}: ${msg}`,
      );
      throw error;
    }
  }

  async updateUserByUid(
    environmentId: string,
    uid: string,
    tenantId: number,
    data: { [key: string]: unknown },
  ): Promise<mysql.ResultSetHeader> {
    const pool = await this.getPool(environmentId);
    const fields = Object.keys(data);
    if (fields.length === 0) {
      throw new Error('No fields to update.');
    }

    const setClause = fields.map((key) => `\`${key}\` = ?`).join(', ');
    // Explicitly map unknown values to allowed parameter types for mysql2
    const fieldValues: (string | number | null)[] = fields.map((key) => {
      const v = data[key];
      if (v === null || v === undefined) return null;
      if (typeof v === 'number' || typeof v === 'string') return v;
      return String(v);
    });
    const values = [...fieldValues, uid, tenantId];
    const sql = `UPDATE \`tbl_user\` SET ${setClause} WHERE \`tenant_user_id\` = ? AND \`tenant_id\` = ?`;

    const [result] = await pool.execute(sql, values);
    return result as mysql.ResultSetHeader;
  }

  /**
   * Run an arbitrary parameterized query against the environment's database.
   * Returns the raw result from mysql2 (rows or ResultSetHeader).
   */
  async runQuery(environmentId: string, sql: string, params: any[] = []) {
    const pool = await this.getPool(environmentId);
    const res = await pool.execute(sql, params);
    return res;
  }
}
