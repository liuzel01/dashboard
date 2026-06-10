import axios from 'axios';

const api = axios.create({
  baseURL: '/api', // 使用相对路径，让 Vite 代理处理请求
});

let _environmentId: string | null = null;

/**
 * 设置后续 API 请求要使用的 environmentId。
 * @param environmentId - 要设置的环境ID，或 null 以清除它。
 */
export const setApiEnvironment = (environmentId: string | null) => {
  _environmentId = environmentId;
  // 为需要它的端点（如 jump-servers）设置一个默认 header
  if (environmentId) {
    api.defaults.headers.common['X-Target-Environment'] = environmentId;
  } else {
    delete api.defaults.headers.common['X-Target-Environment'];
  }
};

export const setAuthToken = (token: string | null) => {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
};

/**
 * 获取应用列表
 * @param params - 包含查询参数的对象, 例如 { name: 'filter-text' }
 */
export const getDeployments = async (params: { name?: string } = {}) => {
  if (!_environmentId) {
    throw new Error('Environment ID has not been set. Please call setApiEnvironment first.');
  }
  // axios 会自动将 `params` 对象序列化为 URL 查询字符串.
  // The environmentId is passed via the 'X-Target-Environment' header, set by setApiEnvironment.
  const response = await api.get('/deployments', { params });
  return response.data;
};

/**
 * 重启一个应用
 * @param name - 需要重启的应用名称
 */
export const restartDeployment = async (name: string) => {
  if (!_environmentId) {
    throw new Error('Environment ID has not been set. Please call setApiEnvironment first.');
  }
  // The environmentId is passed via the 'X-Target-Environment' header, set by setApiEnvironment.
  const response = await api.post(`/deployments/${name}/restart`);
  return response.data;
};

/**
 * 对指定标识符执行聚合查询
 * @param identifier - 要查询的ID (例如 UID, email, phone)
 * @param type - 标识符的类型
 */
export const aggregateQuery = async (
  identifier: string,
  type: 'UID' | 'EMAIL' | 'PHONE',
  tenantId?: number,
) => {
  const response = await api.post('/query/aggregate', {
    identifier,
    type,
    tenantId,
  });
  return response.data;
};

/**
 * 更新用户信息
 * @param uid - 用户ID
 * @param tenantId - 租户ID
 * @param data - 要更新的数据，例如 { email: 'new@email.com' }
 */
export const updateUser = async (
  uid: string,
  tenantId: number,
  data: { email?: string; tel?: string; tel_country_code?: string },
) => {
  const response = await api.patch(`/query/users/${uid}`, { ...data, tenantId });
  return response.data;
};

export const deactivateUser = async (uid: string, tenantId: number) => {
  const response = await api.post(`/query/users/${uid}/deactivate`, { tenantId });
  return response.data;
};

/**
 * 删除一个指定的 Redis 键
 * @param key - 要删除的键名
 */
export const deleteRedisKey = async (key: string) => {
  if (!_environmentId) {
    throw new Error('Environment ID has not been set.');
  }
  const response = await api.delete('/query/redis-key', { params: { key } });
  return response.data;
};

/**
 * 新增一个 Redis 键（字符串值）
 * @param key - 键名
 * @param value - 键值
 * @param ttlSeconds - 可选，过期秒数
 */
export const createRedisKey = async (key: string, value: string, ttlSeconds?: number) => {
  if (!_environmentId) {
    throw new Error('Environment ID has not been set.');
  }
  const payload: { key: string; value: string; ttlSeconds?: number } = { key, value };
  if (ttlSeconds !== undefined && ttlSeconds !== null) {
    payload.ttlSeconds = ttlSeconds;
  }
  const response = await api.post('/query/redis-key', payload);
  return response.data;
};

/**
 * 获取单个 Redis 键的信息（value + ttl）
 * @param key - 要查询的 Redis 键名
 */
export const getRedisKey = async (key: string) => {
  if (!_environmentId) {
    throw new Error('Environment ID has not been set.');
  }
  const response = await api.get('/query/redis-key', { params: { key } });
  return response.data;
};
/**
 * 获取指定用户的交易员信息（tiger.copy_trade_user_info）
 * @param uid - tbl_user.tenant_user_id
 */
export const getTraderInfo = async (uid: string, tenantId: number) => {
  const response = await api.get(`/query/users/${uid}/trader`, { params: { tenantId } });
  return response.data;
};

/**
 * 更新指定用户的交易员 nick_name 字段
 */
export const updateTraderNickName = async (uid: string, nickName: string, tenantId: number) => {
  const response = await api.patch(`/query/users/${uid}/trader`, { nick_name: nickName, tenantId });
  return response.data;
};

export const getOtcMerchantInfo = async (uid: string, tenantId: number) => {
  const response = await api.get(`/query/users/${uid}/otc-merchant`, { params: { tenantId } });
  return response.data;
};

export const updateOtcMerchantName = async (uid: string, name: string, tenantId: number) => {
  const response = await api.patch(`/query/users/${uid}/otc-merchant/name`, { name, tenantId });
  return response.data;
};

export const getAuthRecord = async (uid: string, tenantId: number, userId?: number) => {
  const response = await api.get(`/query/users/${uid}/auth-record`, { params: { tenantId, userId } });
  return response.data;
};

export const updateAuthRecord = async (
  uid: string,
  tenantId: number,
  data: { realName?: string; cardNo?: string; userId?: number },
) => {
  const response = await api.patch(`/query/users/${uid}/auth-record`, { tenantId, ...data });
  return response.data;
};

export const previewAiOpsSql = async (data: { question?: string; sql?: string; maxRows?: number }) => {
  const response = await api.post('/ai-ops/sql/preview', data);
  return response.data;
};

export const getAiOpsSqlAudit = async (page = 1, size = 20) => {
  const response = await api.get('/ai-ops/audit/sql', { params: { page, size } });
  return response.data;
};

/**
 * 获取当前环境的所有可管理平台
 */
export const getPlatforms = async () => {
  const response = await api.get('/security-groups/platforms');
  return response.data;
};

/**
 * 获取当前环境的所有租户
 */
export const getTenantsForEnvironment = async () => {
  if (!_environmentId) {
    throw new Error('Environment ID has not been set.');
  }
  const response = await api.get(`/environments/${_environmentId}/tenants`);
  return response.data;
};

// 环境管理（配置）
export const getEnvironmentConfigs = async () => {
  const response = await api.get('/environments/config');
  return response.data;
};

export const getEnvironmentConfig = async (id: string) => {
  const response = await api.get(`/environments/config/${id}`);
  return response.data;
};

export const createEnvironmentConfig = async (data: any) => {
  const response = await api.post('/environments/config', data);
  return response.data;
};

export const updateEnvironmentConfig = async (id: string, data: any) => {
  const response = await api.put(`/environments/config/${id}`, data);
  return response.data;
};


// Dashboard SiteConf
export const getDashboardSiteConfList = async (params: { page?: number; size?: number; keyword?: string; category?: string } = {}) => {
  const response = await api.get('/site-conf', { params });
  return response.data;
};

export const getDashboardSiteConfCategories = async () => {
  const response = await api.get('/site-conf/categories');
  return response.data;
};

export const saveDashboardSiteConf = async (data: {
  confKey: string;
  confValue: string;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  category?: string;
  description?: string;
  isSensitive?: boolean;
  isRuntimeEditable?: boolean;
  defaultValue?: string;
  validationJson?: string;
}) => {
  const response = await api.post('/site-conf', data);
  return response.data;
};

export const deleteDashboardSiteConf = async (confKey: string) => {
  const response = await api.delete(`/site-conf/${encodeURIComponent(confKey)}`);
  return response.data;
};

// S3 Upload
export const getS3Buckets = async () => {
  const response = await api.get('/s3/buckets');
  return response.data;
};


export const getS3Prefixes = async (bucket: string, prefix?: string) => {
  const response = await api.get('/s3/prefixes', { params: { bucket, prefix: prefix || '' } });
  return response.data;
};

export const checkS3ObjectExists = async (bucket: string, key: string) => {
  const response = await api.post('/s3/object-exists', { bucket, key });
  return response.data;
};

export const uploadS3Object = async (
  bucket: string,
  key: string,
  file: File,
  onProgress?: (percent: number) => void,
) => {
  const contentType = file.type || 'application/octet-stream';
  const presignedResp = await api.post('/s3/presigned-upload', {
    bucket,
    key,
    contentType,
  });

  await axios.put(presignedResp.data.uploadUrl, file, {
    headers: { 'Content-Type': presignedResp.data.contentType || contentType },
    onUploadProgress: (evt) => {
      if (!evt.total) return;
      const percent = Math.round((evt.loaded / evt.total) * 100);
      onProgress?.(percent);
    },
  });

  return {
    ok: true,
    bucket,
    key,
    expiresIn: presignedResp.data.expiresIn,
  };
};


// Audit Logs
export const getAuditLogs = async (params: any) => {
  const response = await api.get('/audit-logs', { params });
  return response.data;
};

export const deleteOldAuditLogs = async () => {
  const response = await api.post('/audit-logs/cleanup');
  return response.data;
};

/**
 * 获取当前环境 LB 的安全组规则
 */
export const getSecurityGroupRules = async (loadBalancerArn: string) => {
  const response = await api.get('/security-groups/rules', {
    params: { loadBalancerArn },
  });
  return response.data;
};

/**
 * 添加一条新的安全组入站规则
 */
export const addSecurityGroupRule = async (
  loadBalancerArn: string,
  rule: {
    protocol: string;
    fromPort: number;
    toPort: number;
    cidrIp: string;
    description?: string;
  },
) => {
  const response = await api.post('/security-groups/rules', rule, {
    params: { loadBalancerArn },
  });
  return response.data;
};

/**
 * 移除一条安全组规则
 */
export const removeSecurityGroupRule = async (loadBalancerArn: string, rule: any) => {
  const response = await api.delete('/security-groups/rules', {
    data: { loadBalancerArn, rule },
  });
  return response.data;
};

/**
 * 获取指定安全组的规则
 */
export const getRulesForSg = async (groupId: string) => {
  const response = await api.get(`/security-groups/by-id/${groupId}/rules`);
  return response.data;
};

/**
 * 向指定安全组添加一条规则
 */
export const addRuleToSg = async (
  groupId: string,
  rule: {
    protocol: string;
    fromPort: number;
    toPort: number;
    cidrIp: string;
    description?: string;
  },
) => {
  const response = await api.post(`/security-groups/by-id/${groupId}/rules`, rule);
  return response.data;
};

/**
 * 从指定安全组移除一条规则
 */
export const removeRuleFromSg = async (groupId: string, rule: any) => {
  const response = await api.delete(`/security-groups/by-id/${groupId}/rules`, { data: rule });
  return response.data;
};

/**
 * 获取 Windows 跳板机列表
 */
export const getJumpServers = async () => {
  const response = await api.get('/jump-servers');
  return response.data;
};

/**
 * 重置并获取 Windows 跳板机密码
 * @param instanceId - 实例ID
 */
export const resetJumpServerPassword = async (instanceId: string) => {
  const response = await api.post(`/jump-servers/${instanceId}/reset-password`);
  return response.data;
};

/**
 * 获取线路列表
 * @param params - 包含分页和租户ID的参数
 */
export const getLines = async (params: { page: number; size: number; tenantId: number; lineUrl?: string }) => {
  const response = await api.get('/lines', { params });
  return response.data;
};

export const getLineInventory = async (params: {
  page?: number;
  size?: number;
  tenantId?: number;
  status?: boolean;
  lineUrl?: string;
  provider?: 'aliyun_dcdn' | 'aws_global' | 'aliyun_esa' | 'unknown';
  availability?: 'up' | 'down' | 'unknown';
  certExpireDaysLt?: number;
  refresh?: boolean;
}) => {
  const response = await api.get('/lines/inventory', { params });
  return response.data;
};

export const verifyExternalLine = async (lineUrl: string) => {
  const response = await api.get('/lines/external/check', {
    params: { lineUrl },
  });
  return response.data;
};

export const registerSuperAdminLine = async (data: {
  lineUrl: string;
  otcUrl?: string;
  zh: string;
  en: string;
  status: boolean;
  tenantId: number;
  mode?: 'detect' | 'update';
  verifyConnectivity?: boolean;
}) => {
  const response = await api.post('/lines/super-admin/register', data);
  return response.data;
};

export const getSuperAdminLines = async (params: {
  page?: number;
  size?: number;
  lineUrl?: string;
  tenantId?: number;
}) => {
  const response = await api.get('/lines/super-admin/list', { params });
  return response.data;
};

export const getIngressOriginCandidates = async (params?: { keyword?: string }) => {
  const response = await api.get('/lines/ingress/origin-candidates', { params });
  return response.data;
};

export const getIngressSourceCandidatesForLineOnboarding = async (data: {
  environmentId: string;
  namespace: string;
  keyword?: string;
}) => {
  const response = await api.post('/lines/ingress/source-candidates', data);
  return response.data;
};

export const resolveIngressSourceForLineOnboarding = async (data: {
  environmentId: string;
  namespace: string;
  lineUrl?: string;
  keyword?: string;
}) => {
  const response = await api.post('/lines/ingress/resolve-source', data);
  return response.data;
};

export const previewCloneIngressForLineOnboarding = async (data: {
  environmentId: string;
  namespace: string;
  sourceIngressName: string;
  newHost: string;
  newIngressName?: string;
  tlsSecretMode?: 'new' | 'reuse' | 'custom';
  tlsSecretName?: string;
}) => {
  const response = await api.post('/lines/ingress/clone-preview', data);
  return response.data;
};

export const cloneIngressForLineOnboarding = async (data: {
  environmentId: string;
  namespace: string;
  sourceIngressName: string;
  newHost: string;
  newIngressName?: string;
  tlsSecretMode?: 'new' | 'reuse' | 'custom';
  tlsSecretName?: string;
  confirmed?: boolean;
}) => {
  const response = await api.post('/lines/ingress/clone', data);
  return response.data;
};

export const applyTenantDomainForLineOnboarding = async (data: {
  environmentId: string;
  tenantId: number;
  domain: string;
}) => {
  const response = await api.post('/lines/tenant-domain/apply', data);
  return response.data;
};

export const provisionDcdnDomain = async (data: {
  domainName: string;
  originDomain: string;
  scope?: 'global' | 'domestic' | 'overseas';
}) => {
  const response = await api.post('/lines/dcdn/provision', data);
  return response.data;
};

export const getDcdnDomainStatus = async (domainName: string) => {
  const response = await api.get('/lines/dcdn/status', {
    params: { domainName, _ts: Date.now() },
  });
  return response.data;
};

export const getDcdnCasCertificates = async (rootDomain: string, targetDomain?: string) => {
  const response = await api.get('/lines/dcdn/cas-certificates', {
    params: { rootDomain, targetDomain, _ts: Date.now() },
  });
  return response.data;
};


export const previewRoute53CnameForLineOnboarding = async (data: {
  rootDomain: string;
  domainName: string;
  cnameValue: string;
  hostedZoneId?: string;
}) => {
  const response = await api.post('/lines/route53/cname/preview', data);
  return response.data;
};

export const syncRoute53CnameForLineOnboarding = async (data: {
  rootDomain: string;
  domainName: string;
  cnameValue: string;
  hostedZoneId?: string;
  confirmed: boolean;
}) => {
  const response = await api.post('/lines/route53/cname/sync', data);
  return response.data;
};

export const previewDcdnSslSyncForLine = async (data: { lineUrl: string; namespace?: string }) => {
  const response = await api.post('/lines/dcdn/ssl-sync/preview', data);
  return response.data;
};

export const syncDcdnSslForLine = async (data: { lineUrl: string; namespace?: string }) => {
  const response = await api.post('/lines/dcdn/ssl-sync', data);
  return response.data;
};

export const applyDcdnSecurity = async (data: {
  domainName: string;
  sslPub?: string;
  sslPri?: string;
  certName?: string;
  certSource?: 'k8s-secret' | 'cas' | 'upload';
  tlsSecretName?: string;
  tlsSecretNamespace?: string;
  casCertificateId?: number;
  casCertificateName?: string;
  enableWebsocket?: boolean;
  enableWaf?: boolean;
  websocketOriginScheme?: 'http' | 'https' | 'follow';
  websocketHeartbeat?: number;
  enableCache?: boolean;
}) => {
  const response = await api.post('/lines/dcdn/security/apply', data);
  return response.data;
};

// Site Monitors
export const getSiteMonitors = async (tenantId?: number) => {
  if (!_environmentId) {
    throw new Error('Environment ID has not been set.');
  }
  const response = await api.get('/site-monitors', {
    params: tenantId !== undefined ? { tenantId } : undefined,
    headers: { 'X-Target-Environment': _environmentId },
  });
  return response.data;
};

export const createSiteMonitor = async (data: {
  name: string;
  host: string;
  port: number;
  isHttps: boolean;
  environmentLabel?: string;
  notes?: string;
  tenantId?: number;
  acceptableStatusCodes?: string;
}) => {
  const response = await api.post('/site-monitors', data, {
    headers: { 'X-Target-Environment': _environmentId },
  });
  return response.data;
};

export const deleteSiteMonitor = async (id: number) => {
  const response = await api.delete(`/site-monitors/${id}`, {
    headers: { 'X-Target-Environment': _environmentId },
  });
  return response.data;
};

export const checkSiteMonitor = async (id: number) => {
  const response = await api.post(`/site-monitors/${id}/check`, undefined, {
    headers: { 'X-Target-Environment': _environmentId },
  });
  return response.data;
};

export const updateSiteMonitor = async (id: number, data: Partial<{ tenantId: number; name: string; host: string; port: number; isHttps: boolean; notes: string; acceptableStatusCodes: string }>) => {
  const response = await api.patch(`/site-monitors/${id}`, data, {
    headers: { 'X-Target-Environment': _environmentId },
  });
  return response.data;
};

export const getSiteMonitorById = async (id: number) => {
  if (!_environmentId) throw new Error('Environment ID has not been set.');
  const response = await api.get(`/site-monitors/${id}`, {
    headers: { 'X-Target-Environment': _environmentId },
  });
  return response.data;
};

// Alerts config APIs
export const getAlertConfig = async () => {
  if (!_environmentId) throw new Error('Environment ID has not been set.');
  const resp = await api.get('/alerts/config', { headers: { 'X-Target-Environment': _environmentId } });
  return resp.data;
};

export const saveAlertConfig = async (data: { lark_webhook_url?: string | null; failure_threshold?: number | null; cooldown_minutes?: number | null; probe_timeout_ms?: number | null; acceptable_status_codes?: string | null }) => {
  if (!_environmentId) throw new Error('Environment ID has not been set.');
  const resp = await api.post('/alerts/config', data, { headers: { 'X-Target-Environment': _environmentId } });
  return resp.data;
};

export const testAlert = async () => {
  if (!_environmentId) throw new Error('Environment ID has not been set.');
  const resp = await api.post('/alerts/test', undefined, { headers: { 'X-Target-Environment': _environmentId } });
  return resp.data;
};

export type CertStudyQuestionOption = {
  key: string;
  text: string;
};

export type CertStudyQuestionNote = {
  id: number;
  question_id: number;
  user_id: number | null;
  note_type: string;
  title: string | null;
  content: string;
  url: string | null;
  created_at: string;
  updated_at: string;
};

export type CertStudyQuestionReview = {
  status: 'new' | 'reviewing' | 'uncertain' | 'mastered' | 'archived' | string;
  isImportant: boolean;
  myFinalAnswer: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  reviewCount: number;
  wrongCount: number;
  correctStreak: number;
  lastResult: 'correct' | 'wrong' | 'uncertain' | 'skipped' | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
};

export type CertStudyQuestionListItem = {
  id: number;
  examCode: string;
  source: string;
  sourceUrl: string | null;
  sourceQuestionNo: string | null;
  sourceTopic: string | null;
  domain: string | null;
  stem: string;
  sourceAnswer: string | null;
  explanation: string | null;
  rawHtml: string | null;
  createdAt: string;
  updatedAt: string;
  review: CertStudyQuestionReview;
  tags: string[];
};

export const getCertStudyQuestions = async (params: {
  examCode?: string;
  keyword?: string;
  status?: string;
  important?: 0 | 1;
  source?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
}) => {
  const response = await api.get('/cert-study/questions', { params });
  return response.data as {
    exam: { id: number; code: string; name: string; provider: string };
    pagination: { page: number; pageSize: number; total: number };
    statusSummary: Record<string, number>;
    availableTags: string[];
    items: CertStudyQuestionListItem[];
  };
};

export const getCertStudyQuestionDetail = async (id: number) => {
  const response = await api.get(`/cert-study/questions/${id}`);
  return response.data as {
    question: CertStudyQuestionListItem;
    options: CertStudyQuestionOption[];
    notes: CertStudyQuestionNote[];
  };
};

export const createCertStudyQuestion = async (data: {
  examCode?: string;
  source: string;
  sourceUrl?: string;
  sourceQuestionNo?: string;
  sourceTopic?: string;
  domain?: string;
  stem: string;
  options: Record<string, string>;
  sourceAnswer?: string;
  explanation?: string;
  rawHtml?: string;
  tags?: string[];
}) => {
  const response = await api.post('/cert-study/questions', data);
  return response.data as { created: boolean; questionId: number };
};

export const updateCertStudyQuestion = async (
  id: number,
  data: {
    source?: string;
    sourceUrl?: string;
    sourceQuestionNo?: string;
    sourceTopic?: string;
    domain?: string;
    stem?: string;
    options?: Record<string, string>;
    sourceAnswer?: string;
    explanation?: string;
    rawHtml?: string;
    tags?: string[];
  },
) => {
  const response = await api.patch(`/cert-study/questions/${id}`, data);
  return response.data as { ok: boolean; questionId: number };
};

export const updateCertStudyReview = async (
  id: number,
  data: {
    status?: 'new' | 'reviewing' | 'uncertain' | 'mastered' | 'archived';
    isImportant?: boolean;
    myFinalAnswer?: string;
    confidence?: 'low' | 'medium' | 'high';
    lastResult?: 'correct' | 'wrong' | 'uncertain' | 'skipped';
    nextReviewAt?: string | null;
  },
) => {
  const response = await api.patch(`/cert-study/questions/${id}/review`, data);
  return response.data as { ok: boolean };
};

export const createCertStudyNote = async (
  questionId: number,
  data: { noteType: string; title?: string; content: string; url?: string },
) => {
  const response = await api.post(`/cert-study/questions/${questionId}/notes`, data);
  return response.data as { ok: boolean; noteId: number };
};

export const updateCertStudyNote = async (
  noteId: number,
  data: { noteType?: string; title?: string; content?: string; url?: string },
) => {
  const response = await api.patch(`/cert-study/notes/${noteId}`, data);
  return response.data as { ok: boolean; noteId: number };
};

export const deleteCertStudyNote = async (noteId: number) => {
  const response = await api.delete(`/cert-study/notes/${noteId}`);
  return response.data as { ok: boolean; noteId: number };
};

export const importCertStudyManual = async (data: {
  examCode?: string;
  source: string;
  sourceUrl?: string;
  sourceQuestionNo?: string;
  sourceTopic?: string;
  domain?: string;
  stem: string;
  options: Record<string, string>;
  sourceAnswer?: string;
  explanation?: string;
  rawHtml?: string;
  tags?: string[];
}) => {
  const response = await api.post('/cert-study/import/manual', data);
  return response.data as {
    total: number;
    imported: number;
    duplicated: number;
    failed: number;
    items: Array<{ index: number; questionId?: number; created?: boolean; error?: string }>;
  };
};

export const importCertStudyJson = async (items: Array<{
  examCode?: string;
  source: string;
  sourceUrl?: string;
  sourceQuestionNo?: string;
  sourceTopic?: string;
  domain?: string;
  stem: string;
  options: Record<string, string>;
  sourceAnswer?: string;
  explanation?: string;
  rawHtml?: string;
  tags?: string[];
}>) => {
  const response = await api.post('/cert-study/import/json', { items });
  return response.data as {
    total: number;
    imported: number;
    duplicated: number;
    failed: number;
    items: Array<{ index: number; questionId?: number; created?: boolean; error?: string }>;
  };
};

// Access control (users/roles/permissions)
export const getAccessUsers = async () => {
  const response = await api.get('/users');
  return response.data;
};

export const createAccessUser = async (data: { username: string; displayName?: string; password?: string; status?: 'active' | 'disabled'; roleIds?: number[] }) => {
  const response = await api.post('/users', data);
  return response.data;
};

export const updateAccessUser = async (id: number, data: { username?: string; displayName?: string; status?: 'active' | 'disabled'; roleIds?: number[] }) => {
  const response = await api.patch(`/users/${id}`, data);
  return response.data;
};

export const resetAccessUserPassword = async (id: number, password?: string) => {
  const response = await api.post(`/users/${id}/reset-password`, { password });
  return response.data;
};

export const getAccessRoles = async () => {
  const response = await api.get('/roles');
  return response.data;
};

export const createAccessRole = async (data: { name: string; description?: string }) => {
  const response = await api.post('/roles', data);
  return response.data;
};

export const updateAccessRole = async (id: number, data: { name?: string; description?: string }) => {
  const response = await api.patch(`/roles/${id}`, data);
  return response.data;
};

export const deleteAccessRole = async (id: number) => {
  const response = await api.delete(`/roles/${id}`);
  return response.data;
};

export const updateAccessRolePermissions = async (id: number, permissionIds: number[]) => {
  const response = await api.put(`/roles/${id}/permissions`, { permissionIds });
  return response.data;
};

export const getAccessPermissions = async () => {
  const response = await api.get('/permissions');
  return response.data;
};

// Asset management
export type AssetListParams = {
  keyword?: string;
  status?: string;
  provider?: string;
  type?: string;
  environment?: string;
  tenant?: string;
  owner?: string;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
};

export type AssetAccount = {
  id: number;
  account_name: string;
  account_type: string;
  provider: string | null;
  login_url: string | null;
  account_identifier: string | null;
  owner: string | null;
  department: string | null;
  usage_scope: string | null;
  environment_scope: string | null;
  credential_ref_id: number | null;
  mfa_enabled: number | boolean;
  status: string;
  remark: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetResource = {
  id: number;
  resource_name: string;
  resource_type: string;
  provider: string | null;
  account_id: number | null;
  resource_identifier: string | null;
  console_url: string | null;
  environment: string | null;
  tenant: string | null;
  business: string | null;
  usage_desc: string | null;
  owner: string | null;
  status: string;
  remark: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetDomain = {
  id: number;
  domain: string;
  root_domain: string | null;
  provider: string | null;
  account_id: number | null;
  resource_id: number | null;
  icp_status: string;
  icp_entity: string | null;
  dns_provider: string | null;
  cdn_provider: string | null;
  environment: string | null;
  tenant: string | null;
  business: string | null;
  usage_desc: string | null;
  owner: string | null;
  status: string;
  remark: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CredentialRef = {
  id: number;
  ref_name: string;
  ref_type: string;
  storage_type: string;
  storage_path: string | null;
  related_account_id: number | null;
  visibility_level: string | null;
  owner: string | null;
  remark: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetChangeLog = {
  id: number;
  asset_type: string;
  asset_id: number | null;
  action: string;
  before_data?: Record<string, unknown> | null;
  after_data?: Record<string, unknown> | null;
  operator: string | null;
  remark: string | null;
  created_at: string;
};

export type WangsuCdnDomainPreviewItem = {
  domain: string;
  domainId?: string;
  cname?: string;
  serviceType?: string;
  status?: string;
  cdnServiceStatus?: string;
  enabled?: string;
  lastModified?: string;
  billingAreas?: string;
  provider: 'wangsu';
  raw: Record<string, unknown>;
};

export type WangsuCdnDomainPreviewResponse = {
  provider: 'wangsu';
  endpoint: string;
  fetchedAt: string;
  total: number;
  items: WangsuCdnDomainPreviewItem[];
};


export type AssetListResponse<T> = {
  items: T[];
  pagination: { page: number; pageSize: number; total: number };
};

export const getAssetOverview = async () => {
  const response = await api.get('/assets/overview');
  return response.data as {
    accounts: { total: number; byStatus: Record<string, number> };
    resources: { total: number; byStatus: Record<string, number> };
    domains: { total: number; byStatus: Record<string, number> };
    credentialRefs: { total: number; byStatus: Record<string, number> };
    missingOwners: { accounts: number; resources: number; domains: number; credentialRefs: number; total: number };
    recentChanges: AssetChangeLog[];
  };
};

export const getAssetAccounts = async (params: AssetListParams = {}) => {
  const response = await api.get('/assets/accounts', { params });
  return response.data as AssetListResponse<AssetAccount>;
};

export const createAssetAccount = async (data: Partial<AssetAccount>) => {
  const response = await api.post('/assets/accounts', data);
  return response.data;
};

export const updateAssetAccount = async (id: number, data: Partial<AssetAccount>) => {
  const response = await api.patch(`/assets/accounts/${id}`, data);
  return response.data;
};

export const deleteAssetAccount = async (id: number) => {
  const response = await api.delete(`/assets/accounts/${id}`);
  return response.data;
};

export const restoreAssetAccount = async (id: number) => {
  const response = await api.post(`/assets/accounts/${id}/restore`);
  return response.data;
};

export const getAssetResources = async (params: AssetListParams = {}) => {
  const response = await api.get('/assets/resources', { params });
  return response.data as AssetListResponse<AssetResource>;
};

export const createAssetResource = async (data: Partial<AssetResource>) => {
  const response = await api.post('/assets/resources', data);
  return response.data;
};

export const updateAssetResource = async (id: number, data: Partial<AssetResource>) => {
  const response = await api.patch(`/assets/resources/${id}`, data);
  return response.data;
};

export const deleteAssetResource = async (id: number) => {
  const response = await api.delete(`/assets/resources/${id}`);
  return response.data;
};

export const restoreAssetResource = async (id: number) => {
  const response = await api.post(`/assets/resources/${id}/restore`);
  return response.data;
};

export const getAssetDomains = async (params: AssetListParams = {}) => {
  const response = await api.get('/assets/domains', { params });
  return response.data as AssetListResponse<AssetDomain>;
};

export const createAssetDomain = async (data: Partial<AssetDomain>) => {
  const response = await api.post('/assets/domains', data);
  return response.data;
};

export const updateAssetDomain = async (id: number, data: Partial<AssetDomain>) => {
  const response = await api.patch(`/assets/domains/${id}`, data);
  return response.data;
};

export const deleteAssetDomain = async (id: number) => {
  const response = await api.delete(`/assets/domains/${id}`);
  return response.data;
};

export const restoreAssetDomain = async (id: number) => {
  const response = await api.post(`/assets/domains/${id}/restore`);
  return response.data;
};

export const getCredentialRefs = async (params: AssetListParams = {}) => {
  const response = await api.get('/assets/credential-refs', { params });
  return response.data as AssetListResponse<CredentialRef>;
};

export const createCredentialRef = async (data: Partial<CredentialRef>) => {
  const response = await api.post('/assets/credential-refs', data);
  return response.data;
};

export const updateCredentialRef = async (id: number, data: Partial<CredentialRef>) => {
  const response = await api.patch(`/assets/credential-refs/${id}`, data);
  return response.data;
};

export const deleteCredentialRef = async (id: number) => {
  const response = await api.delete(`/assets/credential-refs/${id}`);
  return response.data;
};

export const restoreCredentialRef = async (id: number) => {
  const response = await api.post(`/assets/credential-refs/${id}/restore`);
  return response.data;
};

export const getAssetChangeLogs = async (params: { assetType?: string; assetId?: number; action?: string; page?: number; pageSize?: number } = {}) => {
  const response = await api.get('/assets/change-logs', { params });
  return response.data as AssetListResponse<AssetChangeLog>;
};

export const previewWangsuCdnDomains = async () => {
  const response = await api.get('/assets/cdn/wangsu/domains/preview');
  return response.data as WangsuCdnDomainPreviewResponse;
};

// Auth / Me
export const getMe = async () => {
  const response = await api.get('/me');
  return response.data;
};

export const login = async (data: { username: string; password: string; otpCode?: string }) => {
  const response = await api.post('/auth/login', data);
  return response.data;
};
