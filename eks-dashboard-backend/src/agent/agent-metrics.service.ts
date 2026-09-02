import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

@Injectable()
export class AgentMetricsService {
  private readonly registry = new Registry();
  private readonly agentUp = new Gauge({
    name: 'dashboard_db_gateway_agent_up',
    help: 'Whether dashboard-db-gateway-agent is running and able to serve its metrics endpoint.',
    registers: [this.registry],
    collect() { this.set(1); },
  });
  private readonly httpRequestsTotal = new Counter<'method' | 'route' | 'status_code'>({
    name: 'dashboard_db_gateway_agent_http_requests_total',
    help: 'Total HTTP requests handled by dashboard-db-gateway-agent.',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });
  private readonly httpRequestDurationSeconds = new Histogram<'method' | 'route' | 'status_code'>({
    name: 'dashboard_db_gateway_agent_http_request_duration_seconds',
    help: 'HTTP request duration in seconds for dashboard-db-gateway-agent.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'dashboard_db_gateway_agent_' });
  }

  async render(): Promise<{ contentType: string; body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }

  observeHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }
}
