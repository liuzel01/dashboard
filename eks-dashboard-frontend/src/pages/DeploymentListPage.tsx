import React, { useState, useEffect, useCallback, useContext, useRef, useMemo } from 'react';
import { Input, Button, App, Spin, Space, Alert, Modal, Select, Descriptions, Tooltip, Typography } from 'antd';
import { ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { LogViewer } from '../components/LogViewer';
import { getDeployments, getDeploymentNamespaces, restartDeployment, getDeploymentImageHistory, rollbackDeploymentImages, getDeploymentRolloutStatus, type DeploymentImage, type DeploymentImageHistory, type DeploymentRolloutDiagnostic } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContextValue';
import { FilterBar, MetricGrid, OpsTable, PageHeader, StatusBadge } from '../components/ops';

// 定义 Deployment 对象的接口
interface Deployment {
  name?: string;
  namespace?: string;
  replicas?: number;
  availableReplicas?: number;
  readyReplicas?: number;
  updatedReplicas?: number;
  unavailableReplicas?: number;
  generation?: number;
  observedGeneration?: number;
  progressingStatus?: 'True' | 'False' | 'Unknown' | null;
  progressingReason?: string | null;
  availableStatus?: 'True' | 'False' | 'Unknown' | null;
  availableReason?: string | null;
  lastRestartAt?: string | null;
  images?: string;
  creationTimestamp?: string;
}

type RolloutPhase = 'completed' | 'in_progress' | 'failed' | 'unknown';
type OperationName = '重启' | '镜像回退' | '故障回退';
type RolloutOperationState = {
  phase: 'completed' | 'progressing' | 'blocked' | 'failed';
  operationName: OperationName;
  diagnostics: DeploymentRolloutDiagnostic[];
  previousImages?: DeploymentImage[];
};
type RecoveryRequest = {
  environmentId: string;
  deploymentName: string;
  namespace: string;
  previousImages: DeploymentImage[];
  targetGeneration?: number | null;
};

const getRolloutPhase = (deployment: Deployment): RolloutPhase => {
  const desired = deployment.replicas ?? 0;
  const updated = deployment.updatedReplicas ?? 0;
  const ready = deployment.readyReplicas ?? 0;
  const available = deployment.availableReplicas ?? 0;
  const unavailable = deployment.unavailableReplicas ?? 0;
  const generation = deployment.generation ?? 0;
  const observedGeneration = deployment.observedGeneration ?? 0;
  const isObserved = generation <= observedGeneration;

  if (
    deployment.progressingStatus === 'False' ||
    deployment.progressingReason === 'ProgressDeadlineExceeded'
  ) {
    return 'failed';
  }

  if (desired === 0) {
    return 'completed';
  }

  if (
    isObserved &&
    updated >= desired &&
    ready >= desired &&
    available >= desired &&
    unavailable === 0 &&
    deployment.availableStatus === 'True'
  ) {
    return 'completed';
  }

  if (
    !isObserved ||
    updated < desired ||
    ready < desired ||
    available < desired ||
    unavailable > 0 ||
    deployment.availableStatus !== 'True'
  ) {
    return 'in_progress';
  }

  return 'unknown';
};

const { Text } = Typography;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const DeploymentListPage: React.FC = () => {
  const { modal, message } = App.useApp();
  const { currentEnvironment } = useContext(EnvironmentContext);
  const requestSeqRef = useRef(0);
  const currentEnvironmentIdRef = useRef<string | null>(null);
  const blockedPromptedRef = useRef(new Set<string>());

  const [allDeployments, setAllDeployments] = useState<Deployment[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>(['default']);
  const [namespace, setNamespace] = useState('default');
  const [namespaceEnvironmentId, setNamespaceEnvironmentId] = useState<string | null>(null);
  const [namespacesLoading, setNamespacesLoading] = useState(false);
  const [filterInput, setFilterInput] = useState('kylin-price-kylin-price-impl');
  const [filter, setFilter] = useState('kylin-price-kylin-price-impl');
  const [searchRevision, setSearchRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [imageHistoryTarget, setImageHistoryTarget] = useState<string | null>(null);
  const [imageHistory, setImageHistory] = useState<DeploymentImageHistory | null>(null);
  const [imageHistoryLoading, setImageHistoryLoading] = useState(false);
  const [selectedImageVersionId, setSelectedImageVersionId] = useState<string | null>(null);
  const [rollbackConfirmation, setRollbackConfirmation] = useState('');
  const [rollingBack, setRollingBack] = useState(false);
  const [rolloutOperations, setRolloutOperations] = useState<Record<string, RolloutOperationState>>({});
  const [recoveryRequest, setRecoveryRequest] = useState<RecoveryRequest | null>(null);

  // 日志查看器弹窗的状态
  const [logViewerVisible, setLogViewerVisible] = useState(false);
  const [logTarget, setLogTarget] = useState<{ name: string; namespace: string } | null>(null);

  const rolloutOperationKey = (environmentId: string, targetNamespace: string, deploymentName: string) =>
    `${environmentId}:${targetNamespace}:${deploymentName}`;

  useEffect(() => {
    currentEnvironmentIdRef.current = currentEnvironment?.id || null;
    requestSeqRef.current += 1;
    setRolloutOperations({});
    blockedPromptedRef.current.clear();
    setRestarting(null);
    setNamespace('default');
    setNamespaceEnvironmentId(currentEnvironment?.id || null);
    setNamespaces(['default']);
    setImageHistoryTarget(null);
    setLogTarget(null);
  }, [currentEnvironment?.id]);

  useEffect(() => {
    if (!currentEnvironment) return;
    let cancelled = false;
    setNamespacesLoading(true);
    getDeploymentNamespaces()
      .then((items) => {
        if (cancelled) return;
        setNamespaces(Array.from(new Set(['default', ...items])).sort((left, right) => left.localeCompare(right)));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const errorMessage = (error as ApiError).response?.data?.message || (error as ApiError).message;
        message.error(`获取命名空间失败: ${errorMessage || '未知错误'}`);
      })
      .finally(() => {
        if (!cancelled) setNamespacesLoading(false);
      });
    return () => { cancelled = true; };
  }, [currentEnvironment?.id, message]);

  const fetchDeployments = useCallback((name: string) => {
    if (!currentEnvironment) {
      return;
    }
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setLoadError(null);
    getDeployments({ name, namespace })
      .then((data) => {
        if (requestSeq !== requestSeqRef.current) {
          return;
        }
        setAllDeployments(data);
      })
      .catch((error) => {
        if (requestSeq !== requestSeqRef.current) {
          return;
        }
        console.error('获取应用列表失败:', error);
        const errorMessage = (error as ApiError).response?.data?.message || (error as ApiError).message;
        setLoadError(errorMessage || '获取应用列表失败');
        message.error(`获取应用列表失败: ${errorMessage}`);
      })
      .finally(() => {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      });
  }, [currentEnvironment, message, namespace]);

  useEffect(() => {
    // 仅在首次加载、环境切换或用户明确提交搜索时请求。
    if (currentEnvironment && namespaceEnvironmentId === currentEnvironment.id) {
      fetchDeployments(filter);
      return;
    }
    setAllDeployments([]);
    setRolloutOperations({});
  }, [fetchDeployments, currentEnvironment, filter, namespace, namespaceEnvironmentId, searchRevision]);

  const handleSearch = (value: string) => {
    const keyword = value.trim();
    setFilterInput(value);
    setFilter(keyword);
    // 即使关键词未变化，也允许用户手动刷新当前结果。
    setSearchRevision((revision) => revision + 1);
  };

  // “查看日志”按钮点击处理
  const handleViewLogs = (deploymentName: string | undefined, deploymentNamespace?: string) => {
    if (!deploymentName) {
      message.error('无法查看日志：应用名称未知。');
      return;
    }
    setLogTarget({ name: deploymentName, namespace: deploymentNamespace || namespace });
    setLogViewerVisible(true);
  };

  const trackRolloutProgress = useCallback(
    async (
      deploymentName: string,
      targetNamespace: string,
      operationName: OperationName,
      targetGeneration?: number | null,
      previousImages?: DeploymentImage[],
      offerRecovery = false,
    ) => {
      const environmentId = currentEnvironment?.id;
      if (!environmentId) return;
      let finalDeployment: Deployment | undefined;
      let finalPhase: 'completed' | 'progressing' | 'blocked' | 'failed' = 'progressing';
      let failureMessage = '';
      const intervalMs = 3000;
      let maxAttempts = 40;
      const operationKey = `${environmentId}:${targetNamespace}:${deploymentName}:${targetGeneration || 'current'}:${operationName}`;
      const stateKey = rolloutOperationKey(environmentId, targetNamespace, deploymentName);
      blockedPromptedRef.current.delete(operationKey);

      for (let i = 0; i < maxAttempts; i += 1) {
        if (currentEnvironmentIdRef.current !== environmentId) return;
        const status = await getDeploymentRolloutStatus(deploymentName, targetGeneration, targetNamespace);
        if (currentEnvironmentIdRef.current !== environmentId) return;
        maxAttempts = Math.max(
          maxAttempts,
          Math.ceil((status.progressDeadlineSeconds * 1000) / intervalMs) + 1,
        );
        const target = status.deployment;
        if (target?.name) {
          finalDeployment = target;
          setAllDeployments((prev) =>
            prev.map((item) =>
              item.name === deploymentName && item.namespace === targetNamespace ? { ...item, ...target } : item,
            ),
          );
          finalPhase = status.phase;
          failureMessage = status.diagnostics[0]?.message || status.diagnostics[0]?.reason || '';
          setRolloutOperations((prev) => ({
            ...prev,
            [stateKey]: {
              phase: status.phase,
              operationName,
              diagnostics: status.diagnostics,
              previousImages,
            },
          }));
          if (
            status.phase === 'blocked' &&
            offerRecovery &&
            previousImages?.length &&
            !blockedPromptedRef.current.has(operationKey)
          ) {
            blockedPromptedRef.current.add(operationKey);
            const diagnostic = status.diagnostics[0];
            const detail = diagnostic
              ? `${diagnostic.reason}: ${diagnostic.message}`
              : 'Kubernetes 正在报告启动或发布阻塞信号。';
            modal.confirm({
              title: `应用 "${deploymentName}" 发布受阻`,
              content: (
                <Space direction="vertical" size={4}>
                  <Text>检测到 Kubernetes 原始诊断，但尚未确认终态发布失败：</Text>
                  <Text type="warning" code>{detail}</Text>
                  <Text>可继续等待服务自行恢复，或回退到本次发布前的镜像版本。</Text>
                </Space>
              ),
              okText: '回退到发布前镜像',
              cancelText: '继续等待',
              okButtonProps: { danger: true },
              onOk: () => setRecoveryRequest({
                environmentId,
                deploymentName,
                namespace: targetNamespace,
                previousImages,
                targetGeneration: status.targetGeneration,
              }),
            });
          }
          if (finalPhase === 'completed' || finalPhase === 'failed') {
            break;
          }
        }
        await sleep(intervalMs);
      }

      if (finalPhase === 'completed') {
        message.success(`应用 "${deploymentName}" 已完成${operationName}。`);
      } else if (finalPhase === 'failed') {
        message.error(
          `应用 "${deploymentName}" ${operationName}失败：${failureMessage || finalDeployment?.progressingReason || 'Kubernetes 发布状态异常'}`,
        );
        if (offerRecovery && previousImages?.length) {
          modal.confirm({
            title: `应用 "${deploymentName}" 发布失败`,
            content: (
              <Space direction="vertical" size={4}>
                <Text>检测到 Kubernetes 原始错误：</Text>
                <Text type="danger" code>{failureMessage || 'Kubernetes 发布状态异常'}</Text>
                <Text>是否回退到本次发布前的镜像版本？</Text>
              </Space>
            ),
            okText: '回退到发布前镜像',
            cancelText: '暂不处理',
            okButtonProps: { danger: true },
            onOk: () => setRecoveryRequest({ environmentId, deploymentName, namespace: targetNamespace, previousImages }),
          });
        }
      } else {
        message.warning(
          `应用 "${deploymentName}" ${operationName}${finalPhase === 'blocked' ? '受阻' : '仍在进行中'}；Kubernetes 尚未报告终态失败，请稍后查看“状态”列。`,
        );
      }
    },
    [currentEnvironment?.id, message, modal],
  );

  useEffect(() => {
    if (!recoveryRequest) return;
    if (recoveryRequest.environmentId !== currentEnvironmentIdRef.current) {
      setRecoveryRequest(null);
      return;
    }
    let cancelled = false;
    const recover = async () => {
      try {
        const current = await getDeploymentRolloutStatus(
          recoveryRequest.deploymentName,
          recoveryRequest.targetGeneration,
          recoveryRequest.namespace,
        );
        if (recoveryRequest.environmentId !== currentEnvironmentIdRef.current) return;
        if (current.phase === 'completed') {
          message.success(`应用 "${recoveryRequest.deploymentName}" 已自行恢复，无需回退镜像。`);
          return;
        }
        setRolloutOperations((prev) => ({
          ...prev,
          [rolloutOperationKey(recoveryRequest.environmentId, recoveryRequest.namespace, recoveryRequest.deploymentName)]: {
            phase: 'progressing',
            operationName: '故障回退',
            diagnostics: [],
          },
        }));
        const result = await rollbackDeploymentImages(
          recoveryRequest.deploymentName,
          recoveryRequest.previousImages,
          recoveryRequest.namespace,
        );
        if (!cancelled) {
          message.loading({
            content: `应用 "${recoveryRequest.deploymentName}" 正在回退到发布前镜像...`,
            duration: 2,
          });
          void trackRolloutProgress(
            recoveryRequest.deploymentName,
            recoveryRequest.namespace,
            '故障回退',
            result.targetGeneration,
          );
        }
      } catch (error: unknown) {
        if (!cancelled) {
          const errorMessage = (error as ApiError).response?.data?.message || (error as ApiError).message;
          message.error(`回退到发布前镜像失败: ${errorMessage}`);
        }
      } finally {
        if (!cancelled) setRecoveryRequest(null);
      }
    };
    void recover();
    return () => { cancelled = true; };
  }, [message, recoveryRequest, trackRolloutProgress]);

  // “重启”按钮点击处理
  const handleRestart = (deploymentName: string | undefined, deploymentNamespace?: string) => {
    if (!deploymentName) {
      message.error('无法重启：应用名称未知。');
      console.error('Attempted to restart a deployment with an undefined name.');
      return;
    }
    const targetNamespace = deploymentNamespace || namespace;

    modal.confirm({
      title: '确认重启',
      content: `你确定要重启应用 "${deploymentName}" 吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        console.log(`[Restart] User confirmed. Restarting ${deploymentName}...`);
        setRestarting(deploymentName);
        try {
          const result = await restartDeployment(deploymentName, targetNamespace);
          message.loading({
            content: `应用 "${deploymentName}" 已发送重启指令，正在后台跟踪重启进度...`,
            duration: 2,
          });
          void trackRolloutProgress(deploymentName, targetNamespace, '重启', result.targetGeneration);
        } catch (error: unknown) {
          console.error('[Restart] Caught an error:', error);
          const errorMessage = (error as ApiError).response?.data?.message || (error as ApiError).message;
          message.error(`重启失败: ${errorMessage}`);
        } finally {
          console.log(`[Restart] Resetting loading state for ${deploymentName}`);
          setRestarting(null);
          void fetchDeployments(filter);
        }
      },
      onCancel: () => {
        console.log('[Restart] User cancelled.');
      },
    });
  };

  const handleOpenImageHistory = async (deploymentName: string | undefined, deploymentNamespace?: string) => {
    if (!deploymentName) { message.error('无法查看镜像历史：应用名称未知。'); return; }
    setImageHistoryTarget(deploymentName); setImageHistory(null); setSelectedImageVersionId(null); setRollbackConfirmation(''); setImageHistoryLoading(true);
    try {
      const history = await getDeploymentImageHistory(deploymentName, deploymentNamespace || namespace);
      setImageHistory(history);
      const recommended = history.imageVersions.find((item) => !item.isCurrent);
      setSelectedImageVersionId(recommended?.id ?? null);
      if (!recommended) message.warning('未找到可用于回退的历史镜像版本。');
    } catch (error: unknown) {
      message.error(`获取镜像历史失败: ${(error as ApiError).response?.data?.message || (error as ApiError).message}`);
    } finally { setImageHistoryLoading(false); }
  };

  const handleRollbackImages = async () => {
    if (!imageHistoryTarget || !imageHistory || selectedImageVersionId === null) return;
    const target = imageHistory.imageVersions.find((item) => item.id === selectedImageVersionId);
    if (!target) return;
    setRollingBack(true);
    try {
      const result = await rollbackDeploymentImages(imageHistoryTarget, target.images, imageHistory.namespace || namespace);
      message.loading({ content: `应用 "${imageHistoryTarget}" 已开始回退镜像，正在跟踪发布状态...`, duration: 2 });
      setImageHistoryTarget(null);
      void trackRolloutProgress(
        imageHistoryTarget,
        imageHistory.namespace || namespace,
        '镜像回退',
        result.targetGeneration,
        result.previousImages,
        true,
      );
    } catch (error: unknown) {
      message.error(`镜像回退失败: ${(error as ApiError).response?.data?.message || (error as ApiError).message}`);
    } finally { setRollingBack(false); void fetchDeployments(filter); }
  };

  const columns = [
    {
      title: '服务名称',
      dataIndex: 'name',
      key: 'name',
      width: 290,
      fixed: 'left' as const,
      ellipsis: true,
      render: (value?: string) => <Tooltip title={value}><Text ellipsis style={{ maxWidth: 270, display: 'block' }}>{value || '-'}</Text></Tooltip>,
    },
    {
      title: '运行副本',
      key: 'replicas',
      width: 100,
      fixed: 'left' as const,
      align: 'center' as const,
      render: (_: unknown, record: Deployment) => `${record.availableReplicas || 0}/${record.replicas ?? 0}`,
    },
    {
      title: '当前镜像',
      dataIndex: 'images',
      key: 'images',
      width: 390,
      ellipsis: true,
      render: (value?: string) => <Tooltip title={value}><Text code ellipsis style={{ maxWidth: 370, display: 'block' }}>{value || '-'}</Text></Tooltip>,
    },
    {
      title: '发布状态',
      key: 'status',
      width: 190,
      render: (_: unknown, record: Deployment) => {
        const operation = record.name && currentEnvironment?.id
          ? rolloutOperations[rolloutOperationKey(currentEnvironment.id, record.namespace || namespace, record.name)]
          : undefined;
        if (operation?.phase === 'failed') {
          const diagnostic = operation.diagnostics[0];
          const detail = diagnostic
            ? `${diagnostic.reason}: ${diagnostic.message}`
            : 'Kubernetes 已报告发布错误';
          return <Tooltip title={detail}><StatusBadge status="failed" label="发布失败" /></Tooltip>;
        }
        if (operation?.phase === 'progressing') {
          const diagnostic = operation.diagnostics[0];
          return <Tooltip title={diagnostic ? `${diagnostic.reason}: ${diagnostic.message}` : `${operation.operationName}正在核查 Kubernetes 发布状态`}><StatusBadge status="progressing" label="发布中" /></Tooltip>;
        }
        if (operation?.phase === 'blocked') {
          const diagnostic = operation.diagnostics[0];
          const detail = diagnostic
            ? `${diagnostic.reason}: ${diagnostic.message}`
            : 'Kubernetes 报告暂态诊断，Dashboard 正在继续跟踪';
          return <Tooltip title={detail}><StatusBadge status="blocked" label="发布受阻" /></Tooltip>;
        }
        const phase = getRolloutPhase(record);
        const desired = record.replicas ?? 0;
        const ready = record.readyReplicas ?? 0;
        const updated = record.updatedReplicas ?? 0;
        const unavailable = record.unavailableReplicas ?? 0;
        if (phase === 'completed') return <Space size={6}><StatusBadge status="completed" /><span>{`${ready}/${desired}`}</span></Space>;
        if (phase === 'failed') return <Tooltip title={record.progressingReason || 'Progressing=False'}><StatusBadge status="failed" label="发布异常" /></Tooltip>;
        return <Tooltip title={`ready ${ready}/${desired}, updated ${updated}/${desired}, unavailable ${unavailable}`}><StatusBadge status="in_progress" label="发布中" /></Tooltip>;
      },
    },
    {
      title: '最近重启',
      dataIndex: 'lastRestartAt',
      key: 'lastRestartAt',
      width: 175,
      render: (ts?: string | null) => (ts ? new Date(ts).toLocaleString() : '-'),
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      width: 175,
      render: (ts?: string) => (ts ? new Date(ts).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 230,
      fixed: 'right' as const,
      align: 'center' as const,
      render: (_: unknown, record: Deployment) => (
        <Space size={4}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRestart(record.name, record.namespace)} loading={restarting === record.name}>重启</Button>
          <Button size="small" onClick={() => handleOpenImageHistory(record.name, record.namespace)}>镜像回退</Button>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => handleViewLogs(record.name, record.namespace)}>日志</Button>
        </Space>
      ),
    },
  ];

  const summaryItems = useMemo(() => {
    const summary = { completed: 0, progressing: 0, blocked: 0, failed: 0 };
    allDeployments.forEach((deployment) => {
      const operation = deployment.name && currentEnvironment
        ? rolloutOperations[rolloutOperationKey(currentEnvironment.id, deployment.namespace || namespace, deployment.name)]
        : undefined;
      const phase = operation?.phase === 'progressing' ? 'progressing' : operation?.phase || getRolloutPhase(deployment);
      if (phase === 'completed') summary.completed += 1;
      else if (phase === 'failed') summary.failed += 1;
      else if (phase === 'blocked') summary.blocked += 1;
      else summary.progressing += 1;
    });
    return [
      { key: 'completed', label: '已完成', value: summary.completed, valueStyle: { color: '#389e0d' } },
      { key: 'progressing', label: '发布中', value: summary.progressing, valueStyle: { color: '#1677ff' } },
      { key: 'blocked', label: '发布受阻', value: summary.blocked, valueStyle: { color: '#d48806' } },
      { key: 'failed', label: '发布异常', value: summary.failed, valueStyle: { color: '#cf1322' } },
    ];
  }, [allDeployments, currentEnvironment, rolloutOperations]);

  if (!currentEnvironment) {
    return <Alert message="请先在页面顶部选择一个项目环境" type="info" />;
  }

  return (
    <div>
      <PageHeader
        title="EKS 部署"
        description="查看工作负载副本、镜像与发布状态；重启和镜像回退仍按既有确认与跟踪流程执行。"
        environmentName={currentEnvironment.name}
      />
      <FilterBar
        actions={<Button onClick={() => handleSearch(filterInput)} loading={loading}>刷新</Button>}
      >
        <Select
          showSearch
          optionFilterProp="label"
          value={namespace}
          loading={namespacesLoading}
          onChange={(value) => {
            setNamespace(value);
            setAllDeployments([]);
            setRolloutOperations({});
            setImageHistoryTarget(null);
            setLogTarget(null);
          }}
          options={namespaces.map((item) => ({ value: item, label: item }))}
          style={{ width: 240, maxWidth: '100%' }}
          placeholder="选择命名空间"
        />
        <Input.Search
          placeholder="按名称模糊筛选..."
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          onSearch={handleSearch}
          style={{ width: 400, maxWidth: '100%' }}
          allowClear
          enterButton
        />
      </FilterBar>
      <MetricGrid items={summaryItems} loading={loading} />
      <OpsTable
        columns={columns}
        dataSource={allDeployments}
        loading={loading}
        rowKey={(record) => `${record.namespace || namespace}/${record.name || ''}`}
        tableLayout="fixed"
        scroll={{ x: 1550 }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items` }}
        error={loadError}
        onRetry={() => fetchDeployments(filter)}
      />

      <Modal
        title={imageHistoryTarget ? `镜像历史与回退：${imageHistoryTarget}` : '镜像历史与回退'}
        open={Boolean(imageHistoryTarget)} width={860} destroyOnHidden
        onCancel={() => setImageHistoryTarget(null)} okText="仅回退镜像" cancelText="取消"
        confirmLoading={rollingBack}
        okButtonProps={{ danger: true, disabled: !imageHistory || selectedImageVersionId === null || rollbackConfirmation !== imageHistoryTarget }}
        onOk={handleRollbackImages}
      >
        <Spin spinning={imageHistoryLoading}>
          {imageHistory && <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert type="warning" showIcon message="此操作只更新容器镜像，不会回退环境变量、资源规格、探针或其他 Pod Template 配置。" />
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="当前镜像">{imageHistory.currentImages.map((item) => `${item.name}: ${item.image}`).join('；')}</Descriptions.Item>
            </Descriptions>
            <div>
              <div style={{ marginBottom: 8 }}>选择历史镜像版本（默认：上一不同镜像）</div>
              <Select style={{ width: '100%' }} value={selectedImageVersionId ?? undefined} placeholder="没有可回退的历史版本" onChange={setSelectedImageVersionId}
                options={imageHistory.imageVersions.filter((item) => !item.isCurrent).map((item) => ({ value: item.id, label: `${item.images.map((image) => `${image.name}: ${image.image}`).join(' | ')} · 最近 Revision ${item.revisions[0]?.revision ?? '-'} · ${item.revisions[0]?.createdAt ? new Date(item.revisions[0].createdAt).toLocaleString() : '时间未知'}` }))} />
            </div>
            {selectedImageVersionId !== null && (() => {
              const target = imageHistory.imageVersions.find((item) => item.id === selectedImageVersionId);
              return target ? <Descriptions size="small" bordered column={1} title="目标镜像">
                <Descriptions.Item label="镜像">{target.images.map((item) => `${item.name}: ${item.image}`).join('；')}</Descriptions.Item>
                <Descriptions.Item label="关联 Revision">{target.revisions.map((item) => item.revision).join('、')}</Descriptions.Item>
                <Descriptions.Item label="ReplicaSet">{target.revisions.map((item) => item.replicaSetName).join('、')}</Descriptions.Item>
              </Descriptions> : null;
            })()}
            <Input value={rollbackConfirmation} onChange={(event) => setRollbackConfirmation(event.target.value)} placeholder={`请输入服务名 ${imageHistoryTarget} 以确认`} />
          </Space>}
        </Spin>
      </Modal>

      {logTarget && (
        <LogViewer
          environmentId={currentEnvironment!.id}
          deploymentName={logTarget.name}
          namespace={logTarget.namespace}
          visible={logViewerVisible}
          onClose={() => setLogViewerVisible(false)}
        />
      )}
    </div>
  );
};


export default DeploymentListPage;
