import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AgentModule } from './agent/agent.module';

async function bootstrap() {
  const app = await NestFactory.create(AgentModule);
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Environment-Id',
      'X-Request-Id',
      'X-Agent-Token',
    ],
  });
  const port = Number(process.env.PORT || 8080);
  await app.listen(port, '0.0.0.0');
  new Logger('AgentBootstrap').log(
    `dashboard-db-gateway-agent listening on ${port}`,
  );
}

void bootstrap();

