import {
  buildEvidenceGraph,
  CorrelationEvidence,
} from './ai-ops-evidence-correlation';

type QueryStatistic = {
  serviceName: string | null;
  queryTexts: string[];
  matchingLines: number | null;
  sampledLines: number;
  truncated: boolean | null;
  samplingStrategy?: 'latest' | 'time-sliced';
  timeSlices?: number;
};

type CategoryStatistic = {
  key: string;
  label: string;
  matchingLines: number | null;
};

const topValues = (values: string[], limit = 30) =>
  [...new Set(values.filter(Boolean))].sort().slice(0, limit);

const lineValues = (line: string, patterns: RegExp[]) => {
  const values: string[] = [];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      if (match[1]) values.push(match[1].replace(/^['"]|['",;]+$/g, ''));
    }
  }
  return values;
};

export const buildInvestigationEvidenceMatrix = (
  evidence: CorrelationEvidence[],
  queryStatistics: QueryStatistic[] = [],
  categoryStatistics: CategoryStatistic[] = [],
) => {
  const graph = buildEvidenceGraph(evidence);
  const timestamps = evidence
    .map((item) => item.timestamp)
    .filter(Boolean)
    .sort();
  const paths: string[] = [];
  const statuses: string[] = [];
  const requestIds: string[] = [];
  const sessions: string[] = [];
  const outcomeSignals = new Map<
    string,
    { key: string; label: string; evidenceIds: string[] }
  >();
  const addOutcome = (key: string, label: string, evidenceId: string) => {
    const current = outcomeSignals.get(key) || { key, label, evidenceIds: [] };
    if (!current.evidenceIds.includes(evidenceId))
      current.evidenceIds.push(evidenceId);
    outcomeSignals.set(key, current);
  };
  for (const item of evidence) {
    paths.push(
      ...lineValues(item.line, [
        /\b(?:request_uri|requestUri|path|uri)["']?\s*[=:]\s*["']?([^\s"',}]+)/gi,
        /"(?:request|url)"\s*:\s*"(?:[A-Z]+\s+)?([^\s?"]+)/gi,
      ]),
    );
    statuses.push(
      ...lineValues(item.line, [
        /\b(?:status|status_code|http_status)["']?\s*[=:]\s*["']?(\d{3})/gi,
      ]),
    );
    requestIds.push(
      ...lineValues(item.line, [
        /\b(?:request_id|requestId|req_id)["']?\s*[=:]\s*["']?([a-z0-9_-]{6,128})/gi,
      ]),
    );
    sessions.push(
      ...lineValues(item.line, [
        /\b(?:session_id|sessionId|asi_uuid|uuid)["']?\s*[=:]\s*["']?([a-z0-9_-]{6,128})/gi,
      ]),
    );
    const line = item.line || '';
    const statusValues = lineValues(line, [
      /\b(?:status|status_code|http_status)["']?\s*[=:]\s*["']?(\d{3})/gi,
    ]);
    if (statusValues.some((value) => /^2\d\d$/.test(value)))
      addOutcome('http_2xx', 'HTTP 2xx 响应', item.evidenceId);
    if (statusValues.some((value) => /^4\d\d$/.test(value)))
      addOutcome('http_4xx', 'HTTP 4xx 响应', item.evidenceId);
    if (statusValues.some((value) => /^5\d\d$/.test(value)))
      addOutcome('http_5xx', 'HTTP 5xx 响应', item.evidenceId);
    if (/\b(?:success|succeeded|completed)\b|成功|已完成/i.test(line))
      addOutcome('success_keyword', '日志包含成功语义', item.evidenceId);
    if (
      /\b(?:failed|failure|rejected|denied|error)\b|失败|拒绝|错误/i.test(line)
    )
      addOutcome('failure_keyword', '日志包含失败语义', item.evidenceId);
  }
  const entityGroups = Object.fromEntries(
    [
      'ip',
      'user_id',
      'tenant_id',
      'email',
      'phone',
      'host',
      'domain',
      'trace_id',
      'order_id',
      'service',
    ].map((type) => [
      type,
      graph.entities
        .filter((entity) => entity.type === type)
        .slice(0, 50)
        .map((entity) => ({
          value: entity.normalizedValue,
          role: entity.role,
          confidence: entity.confidence,
          evidenceCount: entity.evidenceIds.length,
          evidenceIds: entity.evidenceIds.slice(0, 5),
          jobIds: entity.jobIds,
        })),
    ]),
  );
  const measuredCounts = queryStatistics
    .filter((item) => item.matchingLines !== null)
    .map((item) => Number(item.matchingLines));
  const truncatedQueries = queryStatistics.filter(
    (item) => item.truncated,
  ).length;
  const timeSlicedQueries = queryStatistics.filter(
    (item) => item.samplingStrategy === 'time-sliced',
  ).length;
  return {
    coverage: {
      firstSeen: timestamps[0] || null,
      lastSeen: timestamps[timestamps.length - 1] || null,
      evidenceCount: evidence.length,
      largestMeasuredQuery:
        measuredCounts.length > 0 ? Math.max(...measuredCounts) : null,
      truncatedQueries,
      timeSlicedQueries,
      queryCount: queryStatistics.length,
    },
    entities: entityGroups,
    requests: {
      hosts: (entityGroups.host || []).map((item: any) => item.value),
      paths: topValues(paths, 50),
      statusCodes: topValues(statuses, 20),
      requestIds: topValues(requestIds, 30),
      sessionIds: topValues(sessions, 30),
    },
    behaviors: categoryStatistics.map((item) => ({
      key: item.key,
      label: item.label,
      matchingLines: item.matchingLines,
    })),
    outcomeSignals: [...outcomeSignals.values()].map((item) => ({
      ...item,
      evidenceCount: item.evidenceIds.length,
      evidenceIds: item.evidenceIds.slice(0, 10),
    })),
    measurements: queryStatistics.map((item) => ({
      serviceName: item.serviceName,
      queryTexts: item.queryTexts,
      matchingLines: item.matchingLines,
      sampledLines: item.sampledLines,
      truncated: item.truncated,
      samplingStrategy: item.samplingStrategy || 'latest',
      timeSlices: item.timeSlices || 1,
    })),
    limitations: [
      ...(truncatedQueries > 0
        ? ['部分查询仅保留代表性证据，精确总量来自 Loki 聚合测量。']
        : []),
      ...((entityGroups.ip || []).length > 0
        ? [
            'IP 可能经过 CDN、代理或 NAT；矩阵保留日志字段角色，不自动认定为真实终端地址。',
          ]
        : []),
      '日志中的请求、检查或预绑定记录不自动等同于业务操作最终成功。',
    ],
  };
};
