import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as mysql from 'mysql2/promise';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: mysql.Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    // 从环境变量创建连接池，如果环境变量不存在，则使用你提供的默认值
    this.pool = mysql.createPool({
      host: this.configService.get<string>('DB_HOST', 'your_database_host'),
      user: this.configService.get<string>('DB_USER', 'your_username'),
      password: this.configService.get<string>('DB_PASSWORD', 'your_password'),
      database: this.configService.get<string>('DB_DATABASE', 'spot'),
      port: this.configService.get<number>('DB_PORT', 3306),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    this.logger.log('Database connection pool created.');
  }

  async onModuleDestroy() {
    await this.pool.end();
    this.logger.log('Database connection pool closed.');
  }

  async findUserByUid(uid: string): Promise<any | null> {
    const sql = 'SELECT * FROM `tbl_user` WHERE `tenant_user_id` = ?';
    try {
      const [rows] = await this.pool.execute(sql, [uid]);
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    } catch (error) {
      this.logger.error(`Error querying user by UID ${uid}:`, error);
      throw error; // 向上抛出错误，让上层服务处理
    }
  }

  async updateUserByUid(
    uid: string,
    data: { [key: string]: any },
  ): Promise<mysql.ResultSetHeader> {
    const fields = Object.keys(data);
    if (fields.length === 0) {
      throw new Error('No fields to update.');
    }

    const setClause = fields.map((key) => `\`${key}\` = ?`).join(', ');
    const values = [...fields.map((key) => data[key]), uid];

    const sql = `UPDATE \`tbl_user\` SET ${setClause} WHERE \`tenant_user_id\` = ?`;

    const [result] = await this.pool.execute(sql, values);
    return result as mysql.ResultSetHeader;
  }
}
