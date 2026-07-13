import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { Table, Input, Button, App, Spin, Space, Alert, Tag } from 'antd';
import { ReloadOutlined, FileTextOutlined } from '@ant-design/icons';
import { LogViewer } from '../components/LogViewer';
import { getDeployments, restartDeployment } from '../services/api';
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

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: '30%' },
    {
      title: '副本',
      dataIndex: 'replicas',
      key: 'replicas',
      render: (_: any, record: Deployment) =>
        `${record.availableReplicas || 0}/${record.replicas}`,
    },
    { title: '镜像', dataIndex: 'images', key: 'images', width: '40%' },
    {
      title: '最近重启时间',
      dataIndex: 'lastRestartAt',
      key: 'lastRestartAt',
      render: (ts?: string | null) => (ts ? new Date(ts).toLocaleString() : '-'),
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: Deployment) => {
        const phase = getRolloutPhase(record);
        const desired = record.replicas ?? 0;
        const ready = record.readyReplicas ?? 0;
        const updated = record.updatedReplicas ?? 0;
        const unavailable = record.unavailableReplicas ?? 0;

        if (phase === 'completed') {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="success">已完成</Tag>
              <span>{`ready ${ready}/${desired}, updated ${updated}/${desired}`}</span>
            </Space>
          );
        }

        if (phase === 'failed') {
          return (
            <Space direction="vertical" size={0}>
              <Tag color="error">异常</Tag>
              <span>{record.progressingReason || 'Progressing=False'}</span>
            </Space>
          );
        }

        return (
          <Space direction="vertical" size={0}>
            <Tag color="processing">进行中</Tag>
            <span>{`ready ${ready}/${desired}, updated ${updated}/${desired}, unavailable ${unavailable}`}</span>
          </Space>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      render: (ts?: string) => (ts ? new Date(ts).toLocaleString() : '-'),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Deployment) => (
        <Space size="middle">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => handleRestart(record.name)}
            loading={restarting === record.name}
          >
            重启
          </Button>
          <Button
            icon={<FileTextOutlined />}
            onClick={() => handleViewLogs(record.name)}
          >
            日志
          </Button>
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
            // 显式配置分页，以确保在数据量少于一页时也显示分页器，保持UI一致性
            pagination={{ showSizeChanger: true, showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} items` }}
          />
        </Spin>
      </div>

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
