import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';

@Injectable()
export class CentralDatabaseService {
  private readonly logger = new Logger(CentralDatabaseService.name);
  private pool: mysql.Pool | null = null;

  constructor(private readonly config: ConfigService) {}

  private ensurePool() {
    if (this.pool) return;
    const host = this.config.get<string>('DB_HOST');
    const port = Number(this.config.get<string>('DB_PORT') || 3306);
    const user = this.config.get<string>('DB_USER');
    const password = this.config.get<string>('DB_PASSWORD');
    const database = this.config.get<string>('DB_DATABASE');

    if (!host || !user || !database) {
      this.logger.warn('Central DB envs missing: DB_HOST/DB_USER/DB_DATABASE');
    }

    this.pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      timezone: 'Z',
      dateStrings: true,
    });
  }

  async query<T = any>(sql: string, params: any[] = []) {
    this.ensurePool();
    const [rows] = await this.pool!.execute(sql, params);
    return rows as T;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}
