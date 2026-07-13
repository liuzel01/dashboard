import React, { useState, useContext, useEffect, useCallback } from 'react';
import { useRef } from 'react';
import {
  Input,
  InputNumber,
  Tabs,
  Spin,
  Card,
  Descriptions,
  Alert,
  Empty,
  Space,
  Button,
  Modal,
  App,
  Form,
  Select,
  Dropdown,
  Tag,
  Menu,
} from 'antd';
import { DownOutlined } from '@ant-design/icons';
import {
  aggregateQuery,
  createRedisKey,
  updateUser,
  deactivateUser,
  deleteRedisKey,
  getTenantsForEnvironment,
  getRedisKey,
  getTraderInfo,
  getOtcMerchantInfo,
  updateTraderNickName,
  updateOtcMerchantName,
  disableOtcUserTrade,
  enableOtcUserTrade,
  getAuthRecord,
  updateAuthRecord,
} from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';
import PlaceholderPage from './PlaceholderPage';

const { Search } = Input;
const { TabPane } = Tabs;

// 模拟数据结构
interface UserInfo {
  tenant_user_id?: string | number;
  tenant_id?: number;
  email?: string | null;
  tel?: string | null;
  tel_country_code?: string | null;
  [key: string]: unknown;
}

interface RedisData {
  key: string; // The key name
  ttl: number; // The TTL in seconds
  value?: string | object | null;
}

type AggregateResult = {
  mysql?: { data?: UserInfo | null };
  redis?: { data?: RedisData[] | null };
};

type RedisKeyResult = {
  key: string;
  value?: string | object | null;
  ttlSeconds?: number;
  ttl?: number;
};

const DataQueryPage: React.FC = () => {
  const { message, modal } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [redisData, setRedisData] = useState<RedisData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false); // 用于判断是否执行过搜索
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [traderInfo, setTraderInfo] = useState<Record<string, unknown> | null>(null);
  const [isTraderEditVisible, setIsTraderEditVisible] = useState(false);
  const [traderEditLoading, setTraderEditLoading] = useState(false);
  const [traderLoading, setTraderLoading] = useState(false);
  const [traderDetailVisible, setTraderDetailVisible] = useState(false);
  const [traderForm] = Form.useForm();
  const [otcMerchantInfo, setOtcMerchantInfo] = useState<Record<string, unknown> | null>(null);
  const [otcLoading, setOtcLoading] = useState(false);
  const [otcDetailVisible, setOtcDetailVisible] = useState(false);
  const [isOtcEditVisible, setIsOtcEditVisible] = useState(false);
  const [otcEditLoading, setOtcEditLoading] = useState(false);
  const [otcForm] = Form.useForm();
  const [authRecordInfo, setAuthRecordInfo] = useState<Record<string, unknown> | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authDetailVisible, setAuthDetailVisible] = useState(false);
  const [isAuthEditVisible, setIsAuthEditVisible] = useState(false);
  const [authEditLoading, setAuthEditLoading] = useState(false);
  const [authForm] = Form.useForm();
  const [lastSearchTerm, setLastSearchTerm] = useState('');
  const [tenants, setTenants] = useState<{ id: number; name: string }[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<number | undefined>(
    undefined,
  );
  const currentTenantRef = useRef<number | undefined>(selectedTenantId);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [isCreateRedisModalVisible, setIsCreateRedisModalVisible] = useState(false);
  const [creatingRedisKey, setCreatingRedisKey] = useState(false);
  const [redisMatchId, setRedisMatchId] = useState<string | null>(null);
  const [redisCreateForm] = Form.useForm();
  const storedTab = typeof window !== 'undefined' ? sessionStorage.getItem('dataQueryActiveTab') : null;
  const [activeTabKey, setActiveTabKey] = useState<string>(storedTab ?? '1');

  // Persist active tab so component remounts (e.g., due to route/state) won't reset it
  useEffect(() => {
    try {
      sessionStorage.setItem('dataQueryActiveTab', activeTabKey);
    } catch {
      // ignore
    }
  }, [activeTabKey]);

  const fetchTenants = useCallback(async () => {
    if (currentEnvironment) {
      setTenantsLoading(true);
      try {
        const data = await getTenantsForEnvironment();
        setTenants(data || []);
        // 如果有租户列表，默认选中第一个，否则清空
        setSelectedTenantId(data?.length > 0 ? data[0].id : undefined);
      } catch (e) {
  // Log to console for diagnostics and show a user-friendly message
  console.error('fetchTenants error', e);
        message.error('获取租户列表失败');
        setTenants([]);
        setSelectedTenantId(undefined);
      } finally {
        setTenantsLoading(false);
      }
    } else {
      setTenants([]);
      setSelectedTenantId(undefined);
    }
  }, [currentEnvironment, message]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  // keep a ref in sync so callbacks always read latest tenant id
  useEffect(() => {
    currentTenantRef.current = selectedTenantId;
  }, [selectedTenantId]);

  const onSearch = async (value: string) => {
    if (!value.trim()) return;

    setLastSearchTerm(value);
    setActiveTabKey('1');
    setLoading(true);
    setSearched(true);
    setError(null);

    try {
      const isNumeric = /^\d+$/.test(value);
      if (!isNumeric) {
        const tenantFromRef = currentTenantRef.current;
        const results = await aggregateQuery(value, 'UID', tenantFromRef);
        const res = results as unknown as AggregateResult;
        setUserInfo(res.mysql?.data || null);
        setRedisData(res.redis?.data || null);
        setRedisMatchId(null);
        setTraderInfo(null);
        setOtcMerchantInfo(null);
        return;
      }

      const uid = value.trim();
      const tenantFromRef = currentTenantRef.current;
      let mysqlUserId: string | number | null = null;
      let redisKeyHints: RedisData[] = [];

      if (!tenantFromRef) {
        message.error('查询前请先选择租户。');
        setUserInfo(null);
        setRedisData(null);
        setRedisMatchId(null);
        setTraderInfo(null);
        setOtcMerchantInfo(null);
        return;
      }

      try {
        const results = await aggregateQuery(uid, 'UID', tenantFromRef);
        const res = results as unknown as AggregateResult;
        const mysqlData = res.mysql?.data || null;
        setUserInfo(mysqlData);
        const redisDataFromAggregate = res.redis?.data;
        redisKeyHints = Array.isArray(redisDataFromAggregate) ? redisDataFromAggregate : [];
        if (
          mysqlData &&
          typeof mysqlData === 'object' &&
          'id' in mysqlData &&
          (mysqlData as { id?: unknown }).id !== undefined &&
          (mysqlData as { id?: unknown }).id !== null
        ) {
          mysqlUserId = (mysqlData as { id: string | number }).id;
        }
      } catch {
        setUserInfo(null);
      }

      try {
        setTraderLoading(true);
        setTraderInfo(null);
        const trader = await getTraderInfo(uid, tenantFromRef);
        setTraderInfo(trader || null);
      } catch (err) {
        const axiosError = err as { response?: { status?: number } };
        if (axiosError.response?.status !== 404) {
          console.warn('getTraderInfo failed', err);
        }
        setTraderInfo(null);
      } finally {
        setTraderLoading(false);
      }

      try {
        setOtcLoading(true);
        setOtcMerchantInfo(null);
        const otc = await getOtcMerchantInfo(uid, tenantFromRef);
        setOtcMerchantInfo(otc || null);
      } catch (err) {
        const axiosError = err as { response?: { status?: number } };
        if (axiosError.response?.status !== 404) {
          console.warn('getOtcMerchantInfo failed', err);
        }
        setOtcMerchantInfo(null);
      } finally {
        setOtcLoading(false);
      }

      try {
        setAuthLoading(true);
        setAuthRecordInfo(null);
        const auth = await getAuthRecord(
          uid,
          tenantFromRef,
          mysqlUserId !== null && mysqlUserId !== undefined ? Number(mysqlUserId) : undefined,
        );
        setAuthRecordInfo(auth || null);
      } catch (err) {
        const axiosError = err as { response?: { status?: number } };
        if (axiosError.response?.status !== 404) {
          console.warn('getAuthRecord failed', err);
        }
        setAuthRecordInfo(null);
      } finally {
        setAuthLoading(false);
      }

      if (mysqlUserId === undefined || mysqlUserId === null) {
        setRedisMatchId(null);
        setRedisData([]);
      } else {
        const matchId = String(mysqlUserId);
        setRedisMatchId(matchId);
        const redisItems = await Promise.all(
          redisKeyHints.map(async (hint) => {
            try {
              const redisRes = await getRedisKey(hint.key);
              const r = redisRes as unknown as RedisKeyResult;
              const ttlVal = r.ttlSeconds ?? r.ttl ?? hint.ttl ?? -2;
              if (ttlVal === -2) return null;
              return {
                key: r.key || hint.key,
                ttl: ttlVal,
                value: r.value ?? null,
              } as RedisData;
            } catch (err) {
              const e = err as { response?: { status?: number } };
              if (e?.response?.status === 404) return null;
              return { key: hint.key, ttl: hint.ttl, value: null } as RedisData;
            }
          }),
        );
        setRedisData(redisItems.filter((item): item is RedisData => item !== null));
      }
    } catch (err) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      const errorMessage = errObj?.response?.data?.message || errObj?.message || String(err);
      setError(`查询失败: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const showEditModal = () => {
    if (userInfo) {
      form.setFieldsValue({
        email: userInfo.email || '',
        tel: userInfo.tel || '',
        tel_country_code: userInfo.tel_country_code || '',
      });
      setIsEditModalVisible(true);
    }
  };

  const handleEditFormFinish = async (values: {
    email: string;
    tel: string;
    tel_country_code: string;
  }) => {
    if (!userInfo?.tenant_user_id || !userInfo?.tenant_id) {
      message.error('无法更新：缺少用户信息或租户ID。');
      return;
    }

    setEditLoading(true);

  const dataToUpdate: Record<string, string | undefined> = {};

    // Compare form values with original userInfo and send only changed fields.
    // This prevents re-validating unchanged but currently invalid fields (e.g., a deactivated email).
    if (values.email !== (userInfo.email || '')) {
      dataToUpdate.email = values.email;
    }
    if (values.tel !== (userInfo.tel || '')) {
      dataToUpdate.tel = values.tel;
    }
    if (values.tel_country_code !== (userInfo.tel_country_code || '')) {
      dataToUpdate.tel_country_code = values.tel_country_code;
    }

    if (Object.keys(dataToUpdate).length === 0) {
      message.info('未检测到任何更改。');
      setEditLoading(false);
      setIsEditModalVisible(false);
      return;
    }

    try {
      // The backend service will handle converting empty strings to null.
      await updateUser(String(userInfo.tenant_user_id), userInfo.tenant_id, dataToUpdate);
      message.success('用户信息更新成功！');
      setIsEditModalVisible(false);
      await onSearch(lastSearchTerm); // 重新获取数据以刷新页面
    } catch (err) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      const errorMessage = errObj?.response?.data?.message || errObj?.message || String(err);
      message.error(`更新失败: ${errorMessage}`);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeactivate = async () => {
    if (!userInfo?.tenant_user_id || !userInfo?.tenant_id) {
      message.error('无法注销：缺少用户信息或租户ID。');
      return;
    }
    try {
  await deactivateUser(String(userInfo.tenant_user_id), userInfo.tenant_id);
      message.success('账号已成功注销！');
      onSearch(lastSearchTerm); // 重新获取数据以刷新页面
    } catch (err) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      const errorMessage = errObj?.response?.data?.message || errObj?.message || String(err);
      message.error(`注销失败: ${errorMessage}`);
    }
  };

  const showDisableOtcTradeConfirm = () => {
    if (!userInfo?.tenant_user_id) {
      message.error('无法禁用 OTC 交易：缺少用户 UID。');
      return;
    }
    modal.confirm({
      title: '确认禁用 OTC 交易？',
      content: `是否确定要将用户 ${userInfo.tenant_user_id} 的 OTC 交易状态设为禁用？`,
      okText: '确认禁用',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await disableOtcUserTrade(String(userInfo.tenant_user_id));
          message.success('OTC 交易已成功禁用！');
        } catch (err) {
          const errObj = err as { response?: { data?: { message?: string } }; message?: string };
          const errorMessage = errObj?.response?.data?.message || errObj?.message || String(err);
          message.error(`禁用 OTC 交易失败: ${errorMessage}`);
        }
      },
    });
  };

  const showEnableOtcTradeConfirm = () => {
    if (!userInfo?.tenant_user_id) {
      message.error('无法解除禁用 OTC 交易：缺少用户 UID。');
      return;
    }
    modal.confirm({
      title: '确认解除禁用 OTC 交易？',
      content: `是否确定要将用户 ${userInfo.tenant_user_id} 的 OTC 交易状态恢复为启用？`,
      okText: '确认解除禁用',
      okType: 'primary',
      cancelText: '取消',
      onOk: async () => {
        try {
          await enableOtcUserTrade(String(userInfo.tenant_user_id));
          message.success('OTC 交易已成功恢复启用！');
        } catch (err) {
          const errObj = err as { response?: { data?: { message?: string } }; message?: string };
          const errorMessage = errObj?.response?.data?.message || errObj?.message || String(err);
          message.error(`解除禁用 OTC 交易失败: ${errorMessage}`);
        }
      },
    });
  };

  const showDeactivateConfirm = () => {
    modal.confirm({
      title: '确认注销账号？',
      content: `你确定要注销用户 ${userInfo?.tenant_user_id} 吗？此操作会将用户的邮箱和电话标记为已删除，但不会物理删除记录。`,
      okText: '确认注销',
      okType: 'danger',
      cancelText: '取消',
      onOk: handleDeactivate,
    });
  };

  const formatDuration = (ttlInSeconds: number): string => {
    if (ttlInSeconds === -2) return '键不存在';
    if (ttlInSeconds === -1) return '无过期时间';
    if (ttlInSeconds === 0) return '已过期';
    const hours = Math.floor(ttlInSeconds / 3600);
    const minutes = Math.floor((ttlInSeconds % 3600) / 60);
    const seconds = ttlInSeconds % 60;
    return `${hours}小时 ${minutes}分钟 ${seconds}秒`;
  };

  const formatGenericTtl = (ttlInSeconds: number): string => {
    if (ttlInSeconds === -2) return '键不存在';
    if (ttlInSeconds === -1) return '永久（无过期）';
    if (ttlInSeconds === 0) return '已过期';
    return `${ttlInSeconds} 秒`;
  };

  const isResetPassKey = (key: string): boolean =>
    key.startsWith('reset_pass_forbid_succ');

  const ttlDisplay = (item: RedisData): { label: string; text: string } => {
    if (isResetPassKey(item.key)) {
      return { label: '剩余时间', text: formatDuration(item.ttl) };
    }
    return { label: 'TTL', text: formatGenericTtl(item.ttl) };
  };

  const handleDeleteRedisKey = (key: string) => {
    modal.confirm({
      title: '确认删除 Redis 键？',
      content: `你确定要删除键 "${key}" 吗？此操作可能会立即解除相关限制。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeletingKey(key);
        try {
          await deleteRedisKey(key);
          message.success(`键 "${key}" 已成功删除！`);
          await onSearch(lastSearchTerm); // 重新获取数据以刷新页面
        } catch (err) {
          const errObj = err as { response?: { data?: { message?: string } }; message?: string };
          const errorMessage = errObj?.response?.data?.message || errObj?.message || String(err);
          message.error(`删除失败: ${errorMessage}`);
        } finally {
          setDeletingKey(null);
        }
      },
    });
  };

  const handleCreateRedisKey = async (values: {
    key: string;
    value: string;
    ttlSeconds?: number;
  }) => {
    setCreatingRedisKey(true);
    try {
      const key = values.key.trim();
      await createRedisKey(key, values.value, values.ttlSeconds);
      message.success(`键 "${key}" 创建成功`);
      setIsCreateRedisModalVisible(false);
      redisCreateForm.resetFields();
      if (lastSearchTerm.trim()) {
        await onSearch(lastSearchTerm);
        setActiveTabKey('2');
      }
    } catch (err) {
      const errObj = err as { response?: { data?: { message?: string } }; message?: string };
      const errorMessage = errObj?.response?.data?.message || errObj?.message || String(err);
      message.error(`新增失败: ${errorMessage}`);
    } finally {
      setCreatingRedisKey(false);
    }
  };

  const renderResults = () => {
    if (loading) {
      return <div style={{ textAlign: 'center', marginTop: 50 }}><Spin size="large" tip="正在聚合查询..." /></div>;
    }

    if (error) {
      return <Alert message="查询出错" description={error} type="error" showIcon />;
    }

    // 首次进入页面或未搜索时，显示提示信息
    if (!searched) {
      return <Alert message="请输入UID、手机号或邮箱等标识符进行统一查询。" type="info" showIcon />;
    }

    const userActionsMenu = (
      <Menu>
        <Menu.Item key="edit" onClick={showEditModal}>
          编辑信息
        </Menu.Item>
        <Menu.Item key="disable-otc" danger onClick={showDisableOtcTradeConfirm}>
          禁用 OTC 交易
        </Menu.Item>
        <Menu.Item key="enable-otc" onClick={showEnableOtcTradeConfirm}>
          解除禁用 OTC 交易
        </Menu.Item>
        <Menu.Item key="deactivate" danger onClick={showDeactivateConfirm}>
          注销账号
        </Menu.Item>
      </Menu>
    );

    return (
      <Tabs activeKey={activeTabKey} onChange={(k) => setActiveTabKey(k)} type="card">
        <TabPane tab="用户基本信息 (MySQL)" key="1">
          {userInfo ? (
            <>
            <Card
              title="用户详情 (spot.tbl_user)"
              extra={
                <Dropdown overlay={userActionsMenu}>
                  <Button>操作 <DownOutlined /></Button>
                </Dropdown>
              }
            >
              <Descriptions bordered column={1}>
                <Descriptions.Item label="UID">{userInfo.tenant_user_id || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Tenant ID">{userInfo.tenant_id || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Email">{userInfo.email || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Telephone">{userInfo.tel || 'N/A'}</Descriptions.Item>
                <Descriptions.Item label="Telephone Country Code">{userInfo.tel_country_code || 'N/A'}</Descriptions.Item>

              </Descriptions>
              <Button
                type="link"
                style={{ marginTop: '16px', paddingLeft: 0 }}
                onClick={() => setIsDetailModalVisible(true)}
              >
                查看全部字段
              </Button>
            </Card>
            {/* Trader info section - rendered after the user details card so it can show independently */}
            <div style={{ marginTop: 16 }}>
              <Card
                title="交易员信息 (tiger.copy_trade_user_info)"
                extra={
                  traderInfo ? (
                    <Dropdown overlay={
                      <Menu>
                        <Menu.Item key="edit" onClick={() => {
                          traderForm.setFieldsValue({ nick_name: traderInfo?.nick_name ?? '' });
                          setIsTraderEditVisible(true);
                        }}>
                          编辑信息
                        </Menu.Item>
                      </Menu>
                    }>
                      <Button>操作 <DownOutlined /></Button>
                    </Dropdown>
                  ) : null
                }
              >
                <Spin spinning={traderLoading} tip="正在查询交易员信息...">
                  {traderInfo ? (
                    <div>
                      <Descriptions bordered column={1}>
                        {(() => {
                          const commonKeys = ['user_id', 'nick_name', 'id', 'status', 'create_time'];
                          const entries = Object.entries(traderInfo);
                          const shown: [string, unknown][] = [];
                          for (const k of commonKeys) {
                            if (k in (traderInfo as Record<string, unknown>)) {
                              shown.push([k, (traderInfo as Record<string, unknown>)[k]]);
                            }
                          }
                          if (shown.length === 0) {
                            for (let i = 0; i < Math.min(3, entries.length); i++) shown.push(entries[i]);
                          }
                          return shown.map(([k, v]) => (
                            <Descriptions.Item key={k} label={k}>{v == null ? 'N/A' : String(v)}</Descriptions.Item>
                          ));
                        })()}
                      </Descriptions>
                      <div style={{ marginTop: 12 }}>
                        <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setTraderDetailVisible(true)}>查看全部字段</Button>
                      </div>
                    </div>
                  ) : (
                    <Empty description="无交易员信息" />
                  )}
                </Spin>
              </Card>
            </div>

            <div style={{ marginTop: 16 }}>
              <Card
                title="OTC商家信息 (otc.tbl_otc_merchant)"
                extra={
                  otcMerchantInfo ? (
                    <Dropdown
                      overlay={
                        <Menu>
                          <Menu.Item
                            key="edit"
                            onClick={() => {
                              otcForm.setFieldsValue({ name: otcMerchantInfo?.name ?? '' });
                              setIsOtcEditVisible(true);
                            }}
                          >
                            编辑信息
                          </Menu.Item>
                        </Menu>
                      }
                    >
                      <Button>操作 <DownOutlined /></Button>
                    </Dropdown>
                  ) : null
                }
              >
                <Spin spinning={otcLoading} tip="正在查询OTC商家信息...">
                  {otcMerchantInfo ? (
                    <div>
                      <Descriptions bordered column={1}>
                        <Descriptions.Item label="user_id">{otcMerchantInfo.user_id == null ? 'N/A' : String(otcMerchantInfo.user_id)}</Descriptions.Item>
                        <Descriptions.Item label="name">{otcMerchantInfo.name == null || otcMerchantInfo.name === '' ? 'N/A' : String(otcMerchantInfo.name)}</Descriptions.Item>
                        <Descriptions.Item label="level">{otcMerchantInfo.level == null ? 'N/A' : String(otcMerchantInfo.level)}</Descriptions.Item>
                      </Descriptions>
                      <div style={{ marginTop: 12 }}>
                        <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setOtcDetailVisible(true)}>查看全部字段</Button>
                      </div>
                    </div>
                  ) : (
                    <Empty description="无OTC商家信息" />
                  )}
                </Spin>
              </Card>
            </div>

            <div style={{ marginTop: 16 }}>
              <Card
                title="用户认证信息"
                extra={
                  authRecordInfo ? (
                    <Dropdown
                      overlay={
                        <Menu>
                          <Menu.Item
                            key="edit"
                            onClick={() => {
                              authForm.setFieldsValue({
                                realName: authRecordInfo?.realName ?? '',
                                cardNo: authRecordInfo?.cardNo ?? '',
                              });
                              setIsAuthEditVisible(true);
                            }}
                          >
                            编辑信息
                          </Menu.Item>
                        </Menu>
                      }
                    >
                      <Button>操作 <DownOutlined /></Button>
                    </Dropdown>
                  ) : null
                }
              >
                <Spin spinning={authLoading} tip="正在查询用户认证信息...">
                  {authRecordInfo ? (
                    <div>
                      <Descriptions bordered column={1}>
                        <Descriptions.Item label="realName">{authRecordInfo.realName == null || authRecordInfo.realName === '' ? 'N/A' : String(authRecordInfo.realName)}</Descriptions.Item>
                        <Descriptions.Item label="cardNo">{authRecordInfo.cardNo == null || authRecordInfo.cardNo === '' ? 'N/A' : String(authRecordInfo.cardNo)}</Descriptions.Item>
                        <Descriptions.Item label="idType">{authRecordInfo.idType == null ? 'N/A' : String(authRecordInfo.idType)}</Descriptions.Item>
                      </Descriptions>
                      <div style={{ marginTop: 12 }}>
                        <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setAuthDetailVisible(true)}>查看全部字段</Button>
                      </div>
                    </div>
                  ) : (
                    <Empty description="无用户认证信息" />
                  )}
                </Spin>
              </Card>
            </div>
            </>
          ) : ( <Empty description="无用户基本信息" /> )}
        </TabPane>
        <TabPane tab="缓存数据 (Redis)" key="2">
          <Card
            title={redisMatchId ? `包含 ID ${redisMatchId} 的缓存键` : '缓存键'}
            extra={
              <Button type="primary" onClick={() => setIsCreateRedisModalVisible(true)}>
                新增缓存键
              </Button>
            }
          >
            {redisData && redisData.length > 0 ? (
              <Descriptions bordered column={1} size="small">
                {redisData.map((item) => (
                  <Descriptions.Item key={item.key} label={item.key}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ flex: 1, marginRight: 12 }}>
                        {item.value == null ? (
                          <span style={{ color: '#888' }}>（空）</span>
                        ) : Array.isArray(item.value) ? (
                          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                            {JSON.stringify(item.value, null, 2)}
                          </pre>
                        ) : typeof item.value === 'object' ? (
                          // If object has few keys, render inline, else pretty-print JSON
                          Object.keys(item.value).length <= 5 ? (
                            <span>
                              {Object.entries(item.value)
                                .map(([k, v]) => `${k}: ${String(v)}`)
                                .join(' | ')}
                            </span>
                          ) : (
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                              {JSON.stringify(item.value, null, 2)}
                            </pre>
                          )
                        ) : (
                          <span>{String(item.value)}</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Tag color={item.ttl > 0 ? 'blue' : item.ttl === -1 ? 'green' : 'default'}>
                            {ttlDisplay(item).label}: {ttlDisplay(item).text}
                          </Tag>
                          <span style={{ color: '#666', fontSize: 12 }}>({item.ttl} 秒)</span>
                        </div>
                        <Button
                          type="link"
                          danger
                          onClick={() => handleDeleteRedisKey(item.key)}
                          loading={deletingKey === item.key}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ) : (
              <Empty description="无缓存数据" />
            )}
          </Card>
        </TabPane>
        <TabPane tab="其他信息 (Mongo)" key="3">
          <PlaceholderPage />
        </TabPane>
      </Tabs>
    );
  };

  return (
    <div>
      <Space style={{ marginBottom: 24 }}>
        <Search
          placeholder="输入UID、手机号、邮箱等进行统一查询..."
          enterButton="查询"
          size="large"
          onSearch={onSearch}
          loading={loading}
          style={{ width: 400 }}
          allowClear
        />
        {tenants.length > 0 && (
          <Select
            value={selectedTenantId}
            onChange={setSelectedTenantId}
            options={tenants.map((t) => ({ label: t.name, value: t.id }))}
            style={{ width: 120 }}
            loading={tenantsLoading}
            placeholder="选择租户"
          />
        )}
      </Space>
      <div>
        {renderResults()}
      </div>
      <Modal
        title="编辑用户信息"
        open={isEditModalVisible}
        onCancel={() => setIsEditModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleEditFormFinish} style={{ marginTop: 24 }} autoComplete="off">
          <Form.Item name="email" label="邮箱">
            <Input placeholder="留空以清除邮箱" />
          </Form.Item>
          <Form.Item name="tel" label="电话">
            <Input placeholder="留空以清除电话和国家代码" />
          </Form.Item>
          <Form.Item
            name="tel_country_code"
            label="电话国家代码"
          >
            <Input placeholder="例如: 86" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={editLoading}>
              保存
            </Button>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="新增 Redis 键"
        open={isCreateRedisModalVisible}
        onCancel={() => setIsCreateRedisModalVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={redisCreateForm}
          layout="vertical"
          onFinish={handleCreateRedisKey}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="key"
            label="Key"
            rules={[{ required: true, message: '请输入 Redis key' }]}
          >
            <Input placeholder="例如: reset_pass_forbid_succ1039256" />
          </Form.Item>
          <Form.Item
            name="value"
            label="Value"
            rules={[{ required: true, message: '请输入 Redis value' }]}
          >
            <Input.TextArea rows={4} placeholder="字符串内容（可填 JSON 字符串）" />
          </Form.Item>
          <Form.Item name="ttlSeconds" label="TTL（秒，可选）">
            <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="不填则不过期" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={creatingRedisKey}>
              确认新增
            </Button>
          </Form.Item>
        </Form>
      </Modal>
      {/* 编辑交易员 nick_name 模态框 */}
      <Modal
        title="编辑交易员昵称"
        open={isTraderEditVisible}
        onCancel={() => setIsTraderEditVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={traderForm} layout="vertical" onFinish={async (vals: { nick_name: string }) => {
          if (!userInfo?.tenant_user_id) {
            message.error('缺少用户 UID，无法更新');
            return;
          }
          setTraderEditLoading(true);
          try {
            const tenantIdForCall = userInfo.tenant_id || currentTenantRef.current!;
            await updateTraderNickName(String(userInfo.tenant_user_id), vals.nick_name, tenantIdForCall!);
            message.success('交易员昵称更新成功');
            setIsTraderEditVisible(false);
            const t = await getTraderInfo(String(userInfo.tenant_user_id), tenantIdForCall!);
            setTraderInfo(t || null);
          } catch (err) {
            const e = err as { response?: { data?: { message?: string } }; message?: string };
            const msg = e?.response?.data?.message || e?.message || String(err);
            message.error(`更新失败: ${msg}`);
          } finally {
            setTraderEditLoading(false);
          }
        }}>
          <Form.Item name="nick_name" label="nick_name">
            <Input />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={traderEditLoading}>保存</Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑OTC商家名称"
        open={isOtcEditVisible}
        onCancel={() => setIsOtcEditVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={otcForm}
          layout="vertical"
          onFinish={async (vals: { name?: string }) => {
            if (!userInfo?.tenant_user_id) {
              message.error('缺少用户 UID，无法更新');
              return;
            }
            setOtcEditLoading(true);
            try {
              const tenantIdForCall = userInfo.tenant_id || currentTenantRef.current!;
              await updateOtcMerchantName(
                String(userInfo.tenant_user_id),
                vals.name ?? '',
                tenantIdForCall!,
              );
              message.success('OTC商家名称更新成功');
              setIsOtcEditVisible(false);
              const o = await getOtcMerchantInfo(String(userInfo.tenant_user_id), tenantIdForCall!);
              setOtcMerchantInfo(o || null);
            } catch (err) {
              const e = err as { response?: { data?: { message?: string } }; message?: string };
              const msg = e?.response?.data?.message || e?.message || String(err);
              message.error(`更新失败: ${msg}`);
            } finally {
              setOtcEditLoading(false);
            }
          }}
        >
          <Form.Item name="name" label="name">
            <Input placeholder="允许为空" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={otcEditLoading}>保存</Button>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑用户认证信息"
        open={isAuthEditVisible}
        onCancel={() => setIsAuthEditVisible(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={authForm}
          layout="vertical"
          onFinish={async (vals: { realName?: string; cardNo?: string }) => {
            if (!userInfo?.tenant_user_id) {
              message.error('缺少用户 UID，无法更新');
              return;
            }
            if ((vals.realName ?? '') === '' && (vals.cardNo ?? '') === '') {
              message.error('realName 和 cardNo 不能同时为空');
              return;
            }
            setAuthEditLoading(true);
            try {
              const tenantIdForCall = userInfo.tenant_id || currentTenantRef.current!;
              await updateAuthRecord(String(userInfo.tenant_user_id), tenantIdForCall!, {
                userId: userInfo.id ? Number(userInfo.id) : undefined,
                realName: vals.realName,
                cardNo: vals.cardNo,
              });
              message.success('用户认证信息更新成功');
              setIsAuthEditVisible(false);
              const auth = await getAuthRecord(
                String(userInfo.tenant_user_id),
                tenantIdForCall!,
                userInfo.id ? Number(userInfo.id) : undefined,
              );
              setAuthRecordInfo(auth || null);
            } catch (err) {
              const e = err as { response?: { data?: { message?: string } }; message?: string };
              const msg = e?.response?.data?.message || e?.message || String(err);
              message.error(`更新失败: ${msg}`);
            } finally {
              setAuthEditLoading(false);
            }
          }}
        >
          <Form.Item name="realName" label="realName">
            <Input placeholder="允许为空" />
          </Form.Item>
          <Form.Item name="cardNo" label="cardNo">
            <Input placeholder="允许为空" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={authEditLoading}>保存</Button>
          </Form.Item>
        </Form>
      </Modal>
      {/* 交易员全部字段 Modal */}
      {traderInfo && (
        <Modal
          title="交易员所有字段信息"
          open={traderDetailVisible}
          onCancel={() => setTraderDetailVisible(false)}
          footer={[
            <Button key="back" onClick={() => setTraderDetailVisible(false)}>关闭</Button>,
          ]}
          width={800}
        >
          <Descriptions bordered column={1} size="small" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {Object.entries(traderInfo).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>{String(value)}</Descriptions.Item>
            ))}
          </Descriptions>
        </Modal>
      )}
      {otcMerchantInfo && (
        <Modal
          title="OTC商家全部字段信息"
          open={otcDetailVisible}
          onCancel={() => setOtcDetailVisible(false)}
          footer={[
            <Button key="back" onClick={() => setOtcDetailVisible(false)}>关闭</Button>,
          ]}
          width={800}
        >
          <Descriptions bordered column={1} size="small" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {Object.entries(otcMerchantInfo).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>{value == null ? 'N/A' : String(value)}</Descriptions.Item>
            ))}
          </Descriptions>
        </Modal>
      )}
      {authRecordInfo && (
        <Modal
          title="用户认证全部字段信息"
          open={authDetailVisible}
          onCancel={() => setAuthDetailVisible(false)}
          footer={[
            <Button key="back" onClick={() => setAuthDetailVisible(false)}>关闭</Button>,
          ]}
          width={800}
        >
          <Descriptions bordered column={1} size="small" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {Object.entries(authRecordInfo).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>{value == null ? 'N/A' : String(value)}</Descriptions.Item>
            ))}
          </Descriptions>
        </Modal>
      )}
      {userInfo && (
        <Modal
          title="用户所有字段信息"
          open={isDetailModalVisible}
          onCancel={() => setIsDetailModalVisible(false)}
          footer={[
            <Button key="back" onClick={() => setIsDetailModalVisible(false)}>
              关闭
            </Button>,
          ]}
          width={800}
        >
          <Descriptions bordered column={1} size="small" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {Object.entries(userInfo).map(([key, value]) => (
              <Descriptions.Item key={key} label={key}>{String(value)}</Descriptions.Item>
            ))}
          </Descriptions>
        </Modal>
      )}
    </div>
  );
};

export default DataQueryPage;
