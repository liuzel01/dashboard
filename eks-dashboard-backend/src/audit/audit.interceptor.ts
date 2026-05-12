import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import type { Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { AuditService } from './audit.service';
import { resolveAuditRule } from './audit.mapper';

const extractIp = (req: Request) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
};

const getUserFromRequest = (req: Request) => {
  const anyReq = req as any;
  const user = anyReq.user || anyReq.auth || anyReq.currentUser || null;
  const body = anyReq.body || {};
  const auth = String(req.headers.authorization || '');
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const decoded = token ? jwt.decode(token) as any : null;

  return {
    id: user?.id ?? user?.userId ?? user?.sub ?? decoded?.sub ?? null,
    username: user?.username ?? decoded?.username ?? decoded?.preferred_username ?? decoded?.email ?? body?.username ?? null,
    displayName:
      user?.displayName ??
      user?.display_name ??
      decoded?.displayName ??
      decoded?.display_name ??
      decoded?.name ??
      decoded?.username ??
      decoded?.preferred_username ??
      decoded?.email ??
      body?.username ??
      null,
  };
};

const buildRequestSummary = (req: Request) => {
  const anyReq = req as any;
  const summary: Record<string, unknown> = {};
  if (Object.keys(anyReq.query || {}).length > 0) summary.query = anyReq.query;
  if (Object.keys(anyReq.body || {}).length > 0) summary.body = anyReq.body;
  if (anyReq.file) {
    summary.file = {
      originalname: anyReq.file.originalname,
      mimetype: anyReq.file.mimetype,
      size: anyReq.file.size,
    };
  }
  return summary;
};

const buildResponseSummary = (data: unknown) => {
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) return { type: 'array', length: data.length };
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    const summary: Record<string, unknown> = {};
    for (const key of ['ok', 'id', 'username', 'bucket', 'key', 'exists', 'total', 'page', 'pageSize', 'deleted']) {
      if (key in obj) summary[key] = obj[key];
    }
    summary.keys = keys.slice(0, 20);
    if (keys.length > 20) summary.truncatedKeys = keys.length - 20;
    return summary;
  }
  return data;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const method = req.method.toUpperCase();
    const path = (req.path || req.url || '').replace(/^\/api/, '').split('?')[0] || '/';
    const rule = resolveAuditRule(method, path, { body: (req as any).body, query: req.query });
    if (!rule) return next.handle();

    const started = Date.now();
    const user = getUserFromRequest(req);
    const base = {
      actorUserId: user.id ? Number(user.id) : null,
      actorUsername: user.username,
      actorDisplayName: user.displayName,
      environmentId: String(req.headers['x-target-environment'] || '') || null,
      method,
      path,
      menuKey: rule.menuKey,
      action: rule.action,
      actionName: rule.actionName,
      targetType: rule.targetType,
      targetId: rule.resourceId,
      requestSummary: buildRequestSummary(req),
      ip: extractIp(req),
      userAgent: String(req.headers['user-agent'] || '') || null,
      traceId: String(req.headers['x-request-id'] || req.headers['x-trace-id'] || '') || null,
    };

    return next.handle().pipe(
      tap((data) => {
        this.audit.record({
          ...base,
          status: 'success',
          statusCode: res.statusCode,
          responseSummary: buildResponseSummary(data),
          durationMs: Date.now() - started,
        });
      }),
      catchError((err) => {
        const statusCode = Number(err?.status || err?.statusCode || res.statusCode || 500);
        this.audit.record({
          ...base,
          status: 'failed',
          statusCode,
          errorMessage: err?.message ? String(err.message) : String(err),
          durationMs: Date.now() - started,
        });
        return throwError(() => err);
      }),
    );
  }
}
