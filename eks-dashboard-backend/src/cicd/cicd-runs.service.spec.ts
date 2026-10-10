import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CicdRunsService } from './cicd-runs.service';

const actor = {
  userId: 7,
  username: 'operator',
  permissions: ['menu:cicd-runs', 'cicd-runs:execute-build'],
};

const context = {
  executor_key: 'hash-jenkins',
  provider_type: 'JENKINS',
  baseUrl: 'https://jenkins.example.com',
  username: 'bot',
  apiToken: 'secret',
  timeoutMs: 15_000,
  job_name_pattern: null,
};

const createService = () => {
  const db = { query: jest.fn() };
  const auth = { verifyToken: jest.fn() };
  const access = { ensureUserByUsername: jest.fn(), getMe: jest.fn() };
  const siteConf = { getString: jest.fn(), getNumber: jest.fn() };
  const spotPublish = { catalog: jest.fn() };
  const service = new CicdRunsService(
    db as never,
    auth as never,
    access as never,
    siteConf as never,
    spotPublish as never,
  );
  return { service, db, auth, access };
};

describe('CicdRunsService', () => {
  it('encodes each Jenkins folder segment and rejects traversal', () => {
    const { service } = createService();
    const jobPath = (service as unknown as { jobPath(value: string): string })
      .jobPath.bind(service);

    expect(jobPath('folder name/backend/api')).toBe(
      '/job/folder%20name/job/backend/job/api',
    );
    expect(() => jobPath('folder/../api')).toThrow('Jenkins Job 路径无效');
  });

  it('rejects an actor without the requested execution permission', async () => {
    const { service, auth, access } = createService();
    auth.verifyToken.mockResolvedValue({ sub: 7, username: 'operator' });
    access.getMe.mockResolvedValue({
      id: 7,
      username: 'operator',
      permissions: ['menu:cicd-runs'],
    });

    await expect(
      service.actor('Bearer token', 'cicd-runs:execute-build'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns an existing run for a repeated client request without contacting Jenkins', async () => {
    const { service, db } = createService();
    jest.spyOn(service, 'actor').mockResolvedValue(actor);
    const existing = {
      run_id: 'run-existing',
      client_request_id: 'request-1',
      parameters_json: '{"BRANCH":"main"}',
      status: 'QUEUED',
    };
    db.query.mockResolvedValueOnce([existing]);
    const request = jest.spyOn(
      service as unknown as { request(...args: unknown[]): Promise<unknown> },
      'request',
    );

    await expect(
      service.trigger('Bearer token', {
        environmentId: 'hashex',
        actionType: 'BUILD_DEPLOY',
        jobName: 'hash-service',
        clientRequestId: 'request-1',
      }),
    ).resolves.toMatchObject({
      run_id: 'run-existing',
      parameters: { BRANCH: 'main' },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500])(
    'rejects Jenkins job validation HTTP %s before creating a run',
    async (status) => {
      const { service, db } = createService();
      jest.spyOn(service, 'actor').mockResolvedValue(actor);
      db.query.mockResolvedValueOnce([]);
      jest
        .spyOn(
          service as unknown as {
            executionContext(...args: unknown[]): Promise<unknown>;
          },
          'executionContext',
        )
        .mockResolvedValue(context);
      jest
        .spyOn(
          service as unknown as {
            request(...args: unknown[]): Promise<unknown>;
          },
          'request',
        )
        .mockResolvedValue({ status });

      await expect(
        service.trigger('Bearer token', {
          environmentId: 'hashex',
          actionType: 'BUILD_DEPLOY',
          jobName: 'hash-service',
          clientRequestId: `request-${status}`,
        }),
      ).rejects.toEqual(
        new ServiceUnavailableException(
          `Jenkins Job 校验失败（HTTP ${status}）`,
        ),
      );
      expect(
        db.query.mock.calls.some(([sql]) =>
          String(sql).includes('INSERT INTO cicd_runs'),
        ),
      ).toBe(false);
    },
  );

  it('returns a distinct not-found error for a missing Jenkins job', async () => {
    const { service, db } = createService();
    jest.spyOn(service, 'actor').mockResolvedValue(actor);
    db.query.mockResolvedValueOnce([]);
    jest
      .spyOn(
        service as unknown as {
          executionContext(...args: unknown[]): Promise<unknown>;
        },
        'executionContext',
      )
      .mockResolvedValue(context);
    jest
      .spyOn(
        service as unknown as { request(...args: unknown[]): Promise<unknown> },
        'request',
      )
      .mockResolvedValue({ status: 404 });

    await expect(
      service.trigger('Bearer token', {
        environmentId: 'hashex',
        actionType: 'BUILD_DEPLOY',
        jobName: 'missing-service',
        clientRequestId: 'request-404',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks a second active run for the same environment, executor and job', async () => {
    const { service, db } = createService();
    jest.spyOn(service, 'actor').mockResolvedValue(actor);
    db.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ run_id: 'run-active' }]);
    jest
      .spyOn(
        service as unknown as {
          executionContext(...args: unknown[]): Promise<unknown>;
        },
        'executionContext',
      )
      .mockResolvedValue(context);
    jest
      .spyOn(
        service as unknown as { request(...args: unknown[]): Promise<unknown> },
        'request',
      )
      .mockResolvedValue({
        status: 200,
        data: { buildable: true, color: 'blue', property: [] },
      });

    await expect(
      service.trigger('Bearer token', {
        environmentId: 'hashex',
        actionType: 'BUILD_DEPLOY',
        jobName: 'hash-service',
        clientRequestId: 'request-concurrent',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['crumb failure', { status: 403 }, 'Jenkins crumb 获取失败'],
    [
      'queue response without location',
      { status: 200, data: { crumbRequestField: 'Jenkins-Crumb', crumb: 'c' } },
      'Jenkins 未接受构建请求（HTTP 201）',
    ],
  ])('marks the run failed after %s', async (_name, secondResponse, message) => {
    const { service, db } = createService();
    jest.spyOn(service, 'actor').mockResolvedValue(actor);
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('client_request_id')) return [];
      if (sql.includes("status IN ('TRIGGERING'")) return [];
      return { affectedRows: 1 };
    });
    jest
      .spyOn(
        service as unknown as {
          executionContext(...args: unknown[]): Promise<unknown>;
        },
        'executionContext',
      )
      .mockResolvedValue(context);
    const request = jest
      .spyOn(
        service as unknown as { request(...args: unknown[]): Promise<unknown> },
        'request',
      )
      .mockResolvedValueOnce({
        status: 200,
        data: { buildable: true, color: 'blue', property: [] },
      })
      .mockResolvedValueOnce(secondResponse);
    if (_name === 'queue response without location') {
      request.mockResolvedValueOnce({ status: 201, headers: {} });
    }

    await expect(
      service.trigger('Bearer token', {
        environmentId: 'hashex',
        actionType: 'BUILD_DEPLOY',
        jobName: 'hash-service',
        clientRequestId: `request-${_name}`,
      }),
    ).rejects.toThrow(message);
    expect(
      db.query.mock.calls.some(
        ([sql, values]) =>
          String(sql).includes("SET status='FAILURE'") &&
          String((values as unknown[])?.[0]).includes(message),
      ),
    ).toBe(true);
  });

  it('reconciles a queued run through build assignment to success', async () => {
    const { service, db } = createService();
    let row: Record<string, unknown> = {
      run_id: 'run-1',
      environment_id: 'hashex',
      action_type: 'BUILD_DEPLOY',
      executor_key: 'hash-jenkins',
      job_name: 'folder/service',
      queue_id: 42,
      build_number: null,
      status: 'QUEUED',
      parameters_json: '{}',
    };
    db.query.mockImplementation(async (sql: string, values?: unknown[]) => {
      if (sql.includes('SELECT r.*')) return [{ ...row }];
      if (sql.includes('SET build_number=')) {
        row = {
          ...row,
          build_number: values?.[0],
          build_url: values?.[1],
          status: 'RUNNING',
        };
      }
      if (sql.includes('SET status=?,build_url=')) {
        row = {
          ...row,
          status: values?.[0],
          build_url: values?.[1],
          duration_ms: values?.[2],
        };
      }
      return { affectedRows: 1 };
    });
    jest
      .spyOn(
        service as unknown as {
          executionContext(...args: unknown[]): Promise<unknown>;
        },
        'executionContext',
      )
      .mockResolvedValue(context);
    const request = jest
      .spyOn(
        service as unknown as { request(...args: unknown[]): Promise<unknown> },
        'request',
      )
      .mockResolvedValueOnce({
        status: 200,
        data: { executable: { number: 9, url: 'https://jenkins/job/9/' } },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          building: false,
          result: 'SUCCESS',
          url: 'https://jenkins/job/9/',
          duration: 1234,
        },
      });

    await expect(service.refreshInternal('run-1')).resolves.toMatchObject({
      build_number: 9,
      status: 'SUCCESS',
      duration_ms: 1234,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      context,
      'get',
      '/queue/item/42/api/json',
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      context,
      'get',
      '/job/folder/job/service/9/api/json?tree=building,result,url,timestamp,duration',
    );
  });

  it('uses the progressive log cursor and redacts secrets', async () => {
    const { service, db } = createService();
    jest.spyOn(service, 'actor').mockResolvedValue(actor);
    db.query.mockResolvedValue([
      {
        run_id: 'run-1',
        environment_id: 'hashex',
        action_type: 'BUILD_DEPLOY',
        job_name: 'service',
        build_number: 3,
        parameters_json: '{}',
      },
    ]);
    jest
      .spyOn(
        service as unknown as {
          executionContext(...args: unknown[]): Promise<unknown>;
        },
        'executionContext',
      )
      .mockResolvedValue(context);
    const request = jest
      .spyOn(
        service as unknown as { request(...args: unknown[]): Promise<unknown> },
        'request',
      )
      .mockResolvedValue({
        status: 200,
        data: 'token=plain-text\n',
        headers: { 'x-text-size': '44', 'x-more-data': 'true' },
      });

    await expect(service.log('Bearer token', 'run-1', 12)).resolves.toEqual({
      text: 'token=[REDACTED]\n',
      nextStart: 44,
      hasMore: true,
    });
    expect(request).toHaveBeenCalledWith(
      context,
      'get',
      '/job/service/3/logText/progressiveText?start=12',
      { responseType: 'text' },
    );
  });

  it('reports a Jenkins cancellation failure without marking the run cancelled', async () => {
    const { service, db } = createService();
    jest.spyOn(service, 'actor').mockResolvedValue(actor);
    db.query.mockResolvedValue([
      {
        run_id: 'run-1',
        environment_id: 'hashex',
        action_type: 'BUILD_DEPLOY',
        job_name: 'service',
        queue_id: 42,
        status: 'QUEUED',
        parameters_json: '{}',
      },
    ]);
    jest
      .spyOn(
        service as unknown as {
          executionContext(...args: unknown[]): Promise<unknown>;
        },
        'executionContext',
      )
      .mockResolvedValue(context);
    jest
      .spyOn(
        service as unknown as { request(...args: unknown[]): Promise<unknown> },
        'request',
      )
      .mockResolvedValueOnce({
        status: 200,
        data: { crumbRequestField: 'Jenkins-Crumb', crumb: 'crumb' },
      })
      .mockResolvedValueOnce({ status: 403 });

    await expect(service.cancel('Bearer token', 'run-1')).rejects.toEqual(
      new ServiceUnavailableException('Jenkins 取消失败（HTTP 403）'),
    );
    expect(
      db.query.mock.calls.some(([sql]) =>
        String(sql).includes("SET status='CANCELLED'"),
      ),
    ).toBe(false);
  });
});
