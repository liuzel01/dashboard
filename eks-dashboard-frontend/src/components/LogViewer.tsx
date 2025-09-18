import React, { useEffect, useState, useRef } from 'react';
import { Modal, Spin, Alert, Button, Space } from 'antd';
import { io } from 'socket.io-client';
import { FullscreenOutlined, FullscreenExitOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { AnsiUp } from 'ansi_up';

interface LogViewerProps {
  deploymentName: string;
  environmentId: string;
  visible: boolean;
  onClose: () => void;
}

const ansiUp = new AnsiUp();

export const LogViewer: React.FC<LogViewerProps> = ({
  deploymentName,
  environmentId,
  visible,
  onClose,
}) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isMaximized, setIsMaximized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 确保所有必要信息都存在时才连接
    if (visible && deploymentName && environmentId) {
      setLogs([]);
      setError(null);
      setIsConnected(false);
      setIsAutoScrollEnabled(true); // 每次打开时重置为自动滚动

      // 通过调用不带 URL 的 io()，它将自动连接到提供网页的服务器。
      // Vite 的代理配置将处理 WebSocket 连接的转发。
      const newSocket = io({
        transports: ['websocket'],
      });

      newSocket.on('connect', () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        // 发送一个包含 deploymentName 和 environmentId 的对象
        newSocket.emit('get-logs', { deploymentName, environmentId });
      });

      newSocket.on('log-chunk', (chunk: string) => {
        setLogs((prevLogs) => [...prevLogs, chunk]);
      });

      newSocket.on('log-error', (errorMessage: string) => {
        setError(errorMessage);
      });

      newSocket.on('log-end', (endMessage: string) => {
        setLogs((prevLogs) => [...prevLogs, `\n--- ${endMessage} ---\n`]);
      });

      newSocket.on('disconnect', () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
      });

      // 组件卸载时断开连接
      return () => {
        newSocket.disconnect();
      };
    } else if (visible) {
      // 如果弹窗可见但缺少必要信息，则显示错误
      setError('无法获取日志：缺少环境或应用名称。');
    }
  }, [visible, deploymentName, environmentId]);

  // 自动滚动到日志底部
  useEffect(() => {
    // 仅当自动滚动启用时才执行
    if (isAutoScrollEnabled && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isAutoScrollEnabled]);

  const handleScroll = () => {
    if (logContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
      // 添加一个小的容差值（例如 5px），以应对可能的像素计算不精确问题
      const isScrolledToBottom = scrollHeight - scrollTop <= clientHeight + 5;

      if (isScrolledToBottom) {
        // 如果用户滚动到底部，则重新启用自动滚动
        if (!isAutoScrollEnabled) {
          setIsAutoScrollEnabled(true);
        }
      } else {
        // 如果用户向上滚动，则禁用自动滚动
        if (isAutoScrollEnabled) {
          setIsAutoScrollEnabled(false);
        }
      }
    }
  };

  const scrollToBottomAndResume = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      if (!isAutoScrollEnabled) {
        setIsAutoScrollEnabled(true);
      }
    }
  };

  const renderLogs = () => {
    if (!isConnected && !error && logs.length === 0) {
      return <Spin tip="正在连接日志服务..." />;
    }
    if (error) {
      return <Alert message="日志错误" description={error} type="error" showIcon />;
    }
    if (logs.length === 0 && isConnected && !error) {
      return <Spin tip="正在等待日志流..." />;
    }
    // 使用 AnsiUp 将带颜色的日志文本转换为 HTML
    // 逐行渲染，而不是拼接成一个大字符串，以获得更好的性能和未来的可扩展性
    return (
      <pre>
        {logs.map((log, index) => (
          <span key={index} dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(log) }} />
        ))}
      </pre>
    );
  };

  const modalTitle = (
    <div style={{ width: '100%', cursor: 'move' }}>
      <Space>
        <span>{`应用日志: ${deploymentName}`}</span>
        <Button
          icon={isMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={() => setIsMaximized(!isMaximized)}
          type="text"
        />
      </Space>
    </div>
  );

  return (
    <Modal
      title={modalTitle}
      open={visible}
      onCancel={onClose}
      footer={null}
      width={isMaximized ? '100%' : '80vw'}
      style={isMaximized ? { top: 0, padding: 0, maxWidth: '100vw', height: '100vh' } : {}}
      bodyStyle={{ padding: 0, height: isMaximized ? 'calc(100vh - 55px)' : '60vh', position: 'relative' }}
      destroyOnClose // 关闭时销毁 Modal 里的子元素，确保下次打开是全新的
    >
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        style={{
          height: isMaximized ? '100%' : '60vh',
          overflowY: 'auto',
          background: '#000',
          color: '#fff',
          padding: '10px',
          fontFamily: 'monospace',
        }}
      >
        {renderLogs()}
      </div>
      {!isAutoScrollEnabled && (
        <Button
          type="primary"
          shape="circle"
          icon={<ArrowDownOutlined />}
          onClick={scrollToBottomAndResume}
          style={{
            position: 'absolute',
            bottom: '24px',
            right: '24px',
            zIndex: 10,
          }}
          title="滚动到底部并恢复自动滚动"
        />
      )}
    </Modal>
  );
};