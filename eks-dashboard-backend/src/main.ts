import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OncallWebhookModule } from './oncall/oncall-webhook.module';

const getWebhookPort = () => Number(process.env.ONCALL_WEBHOOK_PORT || 62233);

const shouldStartWebhookListener = () => process.env.ONCALL_WEBHOOK_LISTENER_ENABLED === 'true';

const assertWebhookListenerConfiguration = () => {
  const tokenConfigured = String(process.env.ONCALL_ALERTMANAGER_BEARER_TOKEN || '').trim().length > 0;
  const insecureDevOptIn = process.env.ONCALL_ALLOW_INSECURE_WEBHOOK === 'true';
  if (!tokenConfigured && !insecureDevOptIn) {
    throw new Error('ONCALL_WEBHOOK_LISTENER_ENABLED=true requires ONCALL_ALERTMANAGER_BEARER_TOKEN');
  }
  const webhookPort = getWebhookPort();
  if (!Number.isInteger(webhookPort) || webhookPort < 1024 || webhookPort > 65535) {
    throw new Error('ONCALL_WEBHOOK_PORT must be an unprivileged TCP port between 1024 and 65535');
  }
};

// .env 文件现在由 AppModule 中导入的 @nestjs/config 模块加载。
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // // 启用代理信任，以便在 req.ip 中获取真实的客户端 IP
  // app.getHttpAdapter().getInstance().set('trust proxy', true);

  // 启用 CORS
  app.enableCors({
    origin: '*', // 在生产环境中，请指定您的前端域名
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Target-Environment', 'X-User-Id', 'X-Username', 'X-Dashboard-Approval-Token'],
  });
  await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');

  if (shouldStartWebhookListener()) {
    assertWebhookListenerConfiguration();
    const webhookApp = await NestFactory.create(OncallWebhookModule, { logger: ['log', 'warn', 'error'] });
    const webhookPort = getWebhookPort();
    await webhookApp.listen(webhookPort, '0.0.0.0');
    // This listener contains only GET /health/oncall and POST /api/oncall/alertmanager.
    // It is intended to be reachable exclusively from the Internal ALB target group.
    console.log(`Oncall webhook listener is running on port ${webhookPort}`);
  }
}
bootstrap();
