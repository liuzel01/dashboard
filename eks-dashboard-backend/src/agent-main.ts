import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Request, Response, NextFunction } from 'express';
import { AgentModule } from './agent/agent.module';
import { AgentMetricsService } from './agent/agent-metrics.service';

function normalizeRoute(request: Request): string {
  if (request.route?.path) return request.baseUrl + request.route.path;
  return request.path;
}

async function bootstrap() {
  const app = await NestFactory.create(AgentModule);
  const metrics = app.get(AgentMetricsService);
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.path === '/metrics') return next();
    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      metrics.observeHttpRequest(
        request.method,
        normalizeRoute(request),
        response.statusCode,
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000,
      );
    });
    next();
  });
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
      'X-User-Id',
      'X-Username',
    ],
  });
  const port = Number(process.env.PORT || 8080);
  await app.listen(port, '0.0.0.0');
  new Logger('AgentBootstrap').log(
    `dashboard-db-gateway-agent listening on ${port}`,
  );
}

void bootstrap();
