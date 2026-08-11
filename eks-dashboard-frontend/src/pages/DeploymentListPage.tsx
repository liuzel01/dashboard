import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { Table, Input, Button, App, Spin, Space, Alert, Tag, Modal, Select, Descriptions, Tooltip, Typography } from 'antd';
import { ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { LogViewer } from '../components/LogViewer';
import { getDeployments, restartDeployment, getDeploymentImageHistory, rollbackDeploymentImages, type DeploymentImageHistory } from '../services/api';
import { EnvironmentContext } from '../contexts/EnvironmentContext';

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

  const [allDeployments, setAllDeployments] = useState<Deployment[]>([]);
  const [filterInput, setFilterInput] = useState('kylin-price-kylin-price-impl');
  const [filter, setFilter] = useState('kylin-price-kylin-price-impl');
  const [loading, setLoading] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [imageHistoryTarget, setImageHistoryTarget] = useState<string | null>(null);
  const [imageHistory, setImageHistory] = useState<DeploymentImageHistory | null>(null);
  const [imageHistoryLoading, setImageHistoryLoading] = useState(false);
  const [selectedImageVersionId, setSelectedImageVersionId] = useState<string | null>(null);
  const [rollbackConfirmation, setRollbackConfirmation] = useState('');
  const [rollingBack, setRollingBack] = useState(false);

  // 日志查看器弹窗的状态
  const [logViewerVisible, setLogViewerVisible] = useState(false);
  const [logTarget, setLogTarget] = useState<string | null>(null);

  const fetchDeployments = useCallback((name: string) => {
    if (!currentEnvironment) {
      return;
    }
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    getDeployments({ name })
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
        const errorMessage = error.response?.data?.message || error.message;
        message.error(`获取应用列表失败: ${errorMessage}`);
      })
      .finally(() => {
        if (requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      });
  }, [currentEnvironment, message]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilter(filterInput);
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [filterInput]);

  useEffect(() => {
    // 当环境或过滤器变化时重新获取
    if (currentEnvironment) {
      fetchDeployments(filter);
      return;
    }
    setAllDeployments([]);
  }, [fetchDeployments, currentEnvironment, filter]);

  // “查看日志”按钮点击处理
  const handleViewLogs = (deploymentName: string | undefined) => {
    if (!deploymentName) {
      message.error('无法查看日志：应用名称未知。');
      return;
    }
    setLogTarget(deploymentName);
    setLogViewerVisible(true);
  };

  const trackRestartProgress = useCallback(
    async (deploymentName: string) => {
      let finalDeployment: Deployment | undefined;
      let finalPhase: RolloutPhase = 'unknown';
      const maxAttempts = 40;
      const intervalMs = 3000;

      for (let i = 0; i < maxAttempts; i += 1) {
        const latest = await getDeployments({ name: deploymentName });
        const target = Array.isArray(latest)
          ? latest.find((item) => item.name === deploymentName)
          : undefined;
        if (target) {
          finalDeployment = target;
          setAllDeployments((prev) =>
            prev.map((item) =>
              item.name === deploymentName ? target : item,
            ),
          );
          finalPhase = getRolloutPhase(target);
          if (finalPhase === 'completed' || finalPhase === 'failed') {
            break;
          }
        }
        await sleep(intervalMs);
      }

      if (finalPhase === 'completed') {
        message.success(`应用 "${deploymentName}" 已完成重启。`);
      } else if (finalPhase === 'failed') {
        message.error(
          `应用 "${deploymentName}" 重启失败：${finalDeployment?.progressingReason || 'Kubernetes 回滚/发布状态异常'}`,
        );
      } else {
        message.warning(
          `应用 "${deploymentName}" 重启状态仍在进行中，请稍后查看“状态”列确认。`,
        );
      }
    },
    [message],
  );

  // “重启”按钮点击处理
  const handleRestart = (deploymentName: string | undefined) => {
    if (!deploymentName) {
      message.error('无法重启：应用名称未知。');
      console.error('Attempted to restart a deployment with an undefined name.');
      return;
    }

    modal.confirm({
      title: '确认重启',
      content: `你确定要重启应用 "${deploymentName}" 吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        console.log(`[Restart] User confirmed. Restarting ${deploymentName}...`);
        setRestarting(deploymentName);
        try {
          await restartDeployment(deploymentName);
          message.loading({
            content: `应用 "${deploymentName}" 已发送重启指令，正在后台跟踪重启进度...`,
            duration: 2,
          });
          void trackRestartProgress(deploymentName);
        } catch (error: any) {
          console.error('[Restart] Caught an error:', error);
          const errorMessage = error.response?.data?.message || error.message;
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

  const handleOpenImageHistory = async (deploymentName: string | undefined) => {
    if (!deploymentName) { message.error('无法查看镜像历史：应用名称未知。'); return; }
    setImageHistoryTarget(deploymentName); setImageHistory(null); setSelectedImageVersionId(null); setRollbackConfirmation(''); setImageHistoryLoading(true);
    try {
      const history = await getDeploymentImageHistory(deploymentName);
      setImageHistory(history);
      const recommended = history.imageVersions.find((item) => !item.isCurrent);
      setSelectedImageVersionId(recommended?.id ?? null);
      if (!recommended) message.warning('未找到可用于回退的历史镜像版本。');
    } catch (error: any) {
      message.error(`获取镜像历史失败: ${error.response?.data?.message || error.message}`);
    } finally { setImageHistoryLoading(false); }
  };

  const handleRollbackImages = async () => {
    if (!imageHistoryTarget || !imageHistory || selectedImageVersionId === null) return;
    const target = imageHistory.imageVersions.find((item) => item.id === selectedImageVersionId);
    if (!target) return;
    setRollingBack(true);
    try {
      await rollbackDeploymentImages(imageHistoryTarget, target.images);
      message.loading({ content: `应用 "${imageHistoryTarget}" 已开始回退镜像，正在跟踪发布状态...`, duration: 2 });
      setImageHistoryTarget(null);
      void trackRestartProgress(imageHistoryTarget);
    } catch (error: any) {
      message.error(`镜像回退失败: ${error.response?.data?.message || error.message}`);
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
      render: (_: any, record: Deployment) => `${record.availableReplicas || 0}/${record.replicas ?? 0}`,
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
      render: (_: any, record: Deployment) => {
        const phase = getRolloutPhase(record);
        const desired = record.replicas ?? 0;
        const ready = record.readyReplicas ?? 0;
        const updated = record.updatedReplicas ?? 0;
        const unavailable = record.unavailableReplicas ?? 0;
        if (phase === 'completed') return <Space size={6}><Tag color="success">已完成</Tag><span>{`${ready}/${desired}`}</span></Space>;
        if (phase === 'failed') return <Tooltip title={record.progressingReason || 'Progressing=False'}><Tag color="error">发布异常</Tag></Tooltip>;
        return <Tooltip title={`ready ${ready}/${desired}, updated ${updated}/${desired}, unavailable ${unavailable}`}><Tag color="processing">发布中</Tag></Tooltip>;
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
      render: (_: any, record: Deployment) => (
        <Space size={4}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRestart(record.name)} loading={restarting === record.name}>重启</Button>
          <Button size="small" onClick={() => handleOpenImageHistory(record.name)}>镜像回退</Button>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => handleViewLogs(record.name)}>日志</Button>
        </Space>
      ),
    },
  ];

  if (!currentEnvironment) {
    return <Alert message="请先在页面顶部选择一个项目环境" type="info" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Space style={{ marginBottom: 20 }}>
        <Input
          placeholder="按名称模糊筛选..."
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
          style={{ width: 400 }}
          allowClear
        />
      </Space>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Spin spinning={loading}>
          <Table
            columns={columns}
            dataSource={allDeployments}
            rowKey="name"
            tableLayout="fixed"
            scroll={{ x: 1550 }}
            pagination={{ showSizeChanger: true, showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items` }}
          />
        </Spin>
      </div>

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
          deploymentName={logTarget}
          visible={logViewerVisible}
          onClose={() => setLogViewerVisible(false)}
        />
      )}
    </div>
  );
};


export default DeploymentListPage;
