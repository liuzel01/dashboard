import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { Table, Input, Button, App, Spin, Space, Alert } from 'antd';
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
  images?: string;
  creationTimestamp?: string;
}

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
          // 提示用户重启成功，并提供一个手动查看日志的按钮，避免Pod还未就绪时查看日志出错
          message.info({
            content: (
              <span>
                应用 "{deploymentName}" 重启指令已发送。请稍后
                <Button type="link" style={{ padding: '0 5px' }} onClick={() => handleViewLogs(deploymentName)}>
                  查看日志
                </Button>
                。
              </span>
            ),
            duration: 10,
          });
        } catch (error: any) {
          console.error('[Restart] Caught an error:', error);
          const errorMessage = error.response?.data?.message || error.message;
          message.error(`重启失败: ${errorMessage}`);
        } finally {
          console.log(`[Restart] Resetting loading state for ${deploymentName}`);
          setRestarting(null);
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
