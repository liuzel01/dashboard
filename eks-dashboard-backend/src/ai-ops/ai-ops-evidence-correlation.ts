export type CorrelationEvidence = {
  evidenceId: string;
  timestamp: string;
  labels: Record<string, string>;
  line: string;
  jobId?: number;
};

export type CorrelationEntity = {
  type: string;
  value: string;
  normalizedValue: string;
  role: string | null;
  confidence: 'low' | 'medium' | 'high';
  evidenceIds: string[];
  jobIds: number[];
  metadata: Record<string, string>;
};

export type CorrelationRelation = {
  source: { type: string; normalizedValue: string; role: string | null };
  relation: string;
  target: { type: string; normalizedValue: string; role: string | null };
  confidence: 'low' | 'medium' | 'high';
  evidenceIds: string[];
  jobIds: number[];
};

type EntityCandidate = Omit<CorrelationEntity, 'evidenceIds' | 'jobIds'>;

const normalize = (type: string, value: string) => {
  const trimmed = value.trim().replace(/^["']|["',;)\]}]+$/g, '');
  if (['email', 'domain', 'host'].includes(type)) return trimmed.toLowerCase();
  if (type === 'phone') return trimmed.replace(/[\s()+-]/g, '');
  return trimmed;
};

const relationName = (left: EntityCandidate, right: EntityCandidate) => {
  const types = new Set([left.type, right.type]);
  if (types.has('user_id') && types.has('tenant_id')) return 'belongs_to';
  if (types.has('user_id') && types.has('email')) return 'uses';
  if (types.has('user_id') && types.has('phone')) return 'uses';
  if (
    types.has('ip') &&
    (types.has('host') || types.has('domain')) &&
    [left.role, right.role].some((role) =>
      ['xff', 'direct', 'reported'].includes(role || ''),
    )
  )
    return 'accessed';
  if (
    left.type === 'ip' &&
    right.type === 'ip' &&
    [left.role, right.role].some((role) =>
      ['xff', 'direct', 'reported'].includes(role || ''),
    ) &&
    [left.role, right.role].includes('peer')
  )
    return 'forwarded_via';
  if (types.has('trace_id') && types.has('service')) return 'observed_in';
  if (types.has('order_id') && types.has('user_id')) return 'belongs_to';
  return 'co_occurs_with';
};

const candidatesForEvidence = (evidence: CorrelationEvidence) => {
  const candidates = new Map<string, EntityCandidate>();
  const add = (
    type: string,
    value: string,
    role: string | null,
    confidence: EntityCandidate['confidence'] = 'medium',
    metadata: Record<string, string> = {},
  ) => {
    const normalizedValue = normalize(type, value);
    if (!normalizedValue) return;
    const key = `${type}:${role || ''}:${normalizedValue}`;
    if (!candidates.has(key)) {
      candidates.set(key, {
        type,
        value: value.trim(),
        normalizedValue,
        role,
        confidence,
        metadata,
      });
    }
  };
  const line = evidence.line || '';
  const matchKeyValues = (
    regex: RegExp,
    type: string,
    role: string | null,
    confidence: EntityCandidate['confidence'] = 'high',
  ) => {
    for (const match of line.matchAll(regex))
      add(type, match[1], role, confidence);
  };

  matchKeyValues(
    /\b(?:xff|x_forwarded_for|x-forwarded-for)["']?\s*[=:]\s*["']?((?:\d{1,3}\.){3}\d{1,3})/gi,
    'ip',
    'xff',
  );
  matchKeyValues(
    /\b(?:remote_addr|source_ip|real_ip)["']?\s*[=:]\s*["']?((?:\d{1,3}\.){3}\d{1,3})/gi,
    'ip',
    'direct',
  );
  matchKeyValues(
    /\bip["']?\s*[=:]\s*["']?((?:\d{1,3}\.){3}\d{1,3})/gi,
    'ip',
    'reported',
    'medium',
  );
  matchKeyValues(
    /\b(?:clientip|client_ip|proxy_ip)["']?\s*[=:]\s*["']?((?:\d{1,3}\.){3}\d{1,3})/gi,
    'ip',
    'peer',
  );
  matchKeyValues(
    /\b(?:upstreamhost|upstream_addr)["']?\s*[=:]\s*["']?((?:\d{1,3}\.){3}\d{1,3})(?::\d+)?/gi,
    'ip',
    'upstream',
  );
  matchKeyValues(
    /\b(?:nginx_host|pod_ip)["']?\s*[=:]\s*["']?((?:\d{1,3}\.){3}\d{1,3})/gi,
    'ip',
    'workload',
  );
  matchKeyValues(
    /\b(?:userId|user_id|uid)["']?\s*[=:]\s*["']?([0-9]{4,24})/gi,
    'user_id',
    null,
  );
  matchKeyValues(
    /\b(?:tenantId|tenant_id|tenant)["']?\s*[=:]\s*["']?([0-9]{1,16})/gi,
    'tenant_id',
    null,
  );
  matchKeyValues(
    /\b(?:traceId|trace_id|traceparent)["']?\s*[=:]\s*["']?([a-z0-9_-]{8,128})/gi,
    'trace_id',
    null,
  );
  matchKeyValues(
    /\b(?:orderNo|order_no|orderId|order_id)["']?\s*[=:]\s*["']?([a-z0-9_-]{6,128})/gi,
    'order_id',
    null,
  );
  matchKeyValues(
    /\b(?:tel|phone|mobile)["']?\s*[=:]\s*["']?(\+?[0-9][0-9\s()+-]{5,20})/gi,
    'phone',
    null,
  );
  for (const match of line.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi))
    add('email', match[0], null, 'high');
  matchKeyValues(
    /(?:"host"|\bhost["']?|server_name["']?)\s*[=:]\s*["']?([a-z0-9.-]+\.[a-z]{2,})/gi,
    'host',
    'request',
  );

  for (const [key, value] of Object.entries(evidence.labels || {})) {
    if (!value) continue;
    if (['service_name', 'service', 'app'].includes(key))
      add('service', value, key, 'high', { source: 'label' });
    if (['namespace', 'namespace_name'].includes(key))
      add('namespace', value, key, 'high', { source: 'label' });
    if (['pod', 'pod_name'].includes(key))
      add('k8s_workload', value, 'pod', 'high', { source: 'label' });
  }

  // Keep otherwise unknown IP addresses searchable without assigning a false role.
  for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g))
    add('ip', match[0], 'unclassified', 'low');
  return [...candidates.values()];
};

export const buildEvidenceGraph = (evidence: CorrelationEvidence[]) => {
  const entityMap = new Map<string, CorrelationEntity>();
  const relationMap = new Map<string, CorrelationRelation>();
  for (const item of evidence) {
    const candidates = candidatesForEvidence(item).slice(0, 24);
    for (const candidate of candidates) {
      const key = `${candidate.type}:${candidate.normalizedValue}`;
      const entity = entityMap.get(key) || {
        ...candidate,
        evidenceIds: [],
        jobIds: [],
      };
      if (
        entity.role &&
        candidate.role &&
        candidate.role !== 'unclassified' &&
        entity.role !== candidate.role
      ) {
        const roles = new Set(
          String(entity.metadata.roles || entity.role)
            .split(',')
            .filter(Boolean),
        );
        roles.add(candidate.role);
        entity.role = 'multiple';
        entity.metadata.roles = [...roles].sort().join(',');
      }
      if (
        entity.evidenceIds.length < 50 &&
        !entity.evidenceIds.includes(item.evidenceId)
      )
        entity.evidenceIds.push(item.evidenceId);
      if (item.jobId && !entity.jobIds.includes(item.jobId))
        entity.jobIds.push(item.jobId);
      entityMap.set(key, entity);
    }
    const relationCandidates = candidates
      .filter(
        (candidate) => !['namespace', 'k8s_workload'].includes(candidate.type),
      )
      .slice(0, 10);
    for (
      let leftIndex = 0;
      leftIndex < relationCandidates.length;
      leftIndex += 1
    ) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < relationCandidates.length;
        rightIndex += 1
      ) {
        const left = relationCandidates[leftIndex];
        const right = relationCandidates[rightIndex];
        if (left.normalizedValue === right.normalizedValue) continue;
        const relation = relationName(left, right);
        const key = `${left.type}:${left.normalizedValue}:${relation}:${right.type}:${right.normalizedValue}`;
        const current =
          relationMap.get(key) ||
          ({
            source: {
              type: left.type,
              normalizedValue: left.normalizedValue,
              role: left.role,
            },
            relation,
            target: {
              type: right.type,
              normalizedValue: right.normalizedValue,
              role: right.role,
            },
            confidence: relation === 'co_occurs_with' ? 'low' : 'medium',
            evidenceIds: [],
            jobIds: [],
          } satisfies CorrelationRelation);
        if (
          current.evidenceIds.length < 30 &&
          !current.evidenceIds.includes(item.evidenceId)
        )
          current.evidenceIds.push(item.evidenceId);
        if (item.jobId && !current.jobIds.includes(item.jobId))
          current.jobIds.push(item.jobId);
        relationMap.set(key, current);
      }
    }
  }
  const entities = [...entityMap.values()]
    .map((entity) => ({
      ...entity,
      jobIds: entity.jobIds.sort((a, b) => a - b),
    }))
    .sort(
      (left, right) =>
        right.jobIds.length - left.jobIds.length ||
        right.evidenceIds.length - left.evidenceIds.length,
    )
    .slice(0, 500);
  const relations = [...relationMap.values()]
    .map((relation) => ({
      ...relation,
      jobIds: relation.jobIds.sort((a, b) => a - b),
    }))
    .sort(
      (left, right) =>
        Number(left.relation === 'co_occurs_with') -
          Number(right.relation === 'co_occurs_with') ||
        right.jobIds.length - left.jobIds.length ||
        right.evidenceIds.length - left.evidenceIds.length,
    )
    .slice(0, 1000);
  return { entities, relations };
};

export const selectRepresentativeEvidence = (
  evidence: CorrelationEvidence[],
  entities: CorrelationEntity[],
  relations: CorrelationRelation[],
  limit = 60,
) => {
  const byId = new Map(evidence.map((item) => [item.evidenceId, item]));
  const selected = new Map<string, CorrelationEvidence>();
  const add = (id: string) => {
    const item = byId.get(id);
    if (item && selected.size < limit) selected.set(id, item);
  };
  for (const jobId of [
    ...new Set(evidence.map((item) => item.jobId).filter(Boolean)),
  ]) {
    evidence
      .filter((item) => item.jobId === jobId)
      .slice(0, 3)
      .forEach((item) => add(item.evidenceId));
  }
  for (const entity of entities) {
    entity.evidenceIds.slice(0, 2).forEach(add);
    if (selected.size >= limit) break;
  }
  for (const relation of relations) {
    relation.evidenceIds.slice(0, 1).forEach(add);
    if (selected.size >= limit) break;
  }
  return [...selected.values()];
};
