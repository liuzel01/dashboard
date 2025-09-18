import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Target-Environment'],
  });
  await app.listen(3000, '0.0.0.0');
}
bootstrap();
