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
export const aggregateQuery = async (identifier: string, type: 'UID' | 'EMAIL' | 'PHONE') => {
  const response = await api.post('/query/aggregate', { identifier, type });
  return response.data;
};

/**
 * 更新用户信息
 * @param uid - 用户ID
 * @param data - 要更新的数据，例如 { email: 'new@email.com' }
 */
export const updateUser = async (
  uid: string,
  data: { email?: string; tel?: string; tel_country_code?: string },
) => {
  const response = await api.patch(`/query/users/${uid}`, data);
  return response.data;
};

export const deactivateUser = async (uid: string) => {
  const response = await api.post(`/query/users/${uid}/deactivate`);
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
