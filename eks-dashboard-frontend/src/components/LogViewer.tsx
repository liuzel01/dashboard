import React, { useEffect, useState, useRef } from 'react';
import { Modal, Spin, Alert, Button, Space } from 'antd';
import { io, Socket } from 'socket.io-client';
import { FullscreenOutlined, FullscreenExitOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { AnsiUp } from 'ansi_up';

interface LogViewerProps {
  deploymentName: string;
  environmentId: string;
  visible: boolean;
  onClose: () => void;
}

const ansiUp = new AnsiUp();

interface ViteMetaEnv {
  VITE_SOCKET_URL?: string;
}

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
  const [currentCandidate, setCurrentCandidate] = useState<string | null>(null);
  const [suppressErrorsUntil, setSuppressErrorsUntil] = useState<number | null>(null);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 确保所有必要信息都存在时才连接
    if (visible && deploymentName && environmentId) {
  setLogs([]);
  setError(null);
  // Suppress showing transient connection errors for a short window
  // while we try multiple candidates / retries. This improves UX when
  // backend or proxy is still warming up after deploy/restart.
  setSuppressErrorsUntil(Date.now() + 5000);
  setLastErrorMessage(null);
      setIsConnected(false);
      setIsAutoScrollEnabled(true); // 每次打开时重置为自动滚动

  const socketUrl = (import.meta as unknown as { env?: ViteMetaEnv })?.env?.VITE_SOCKET_URL;
  const pageOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  // Use configured VITE_SOCKET_URL, otherwise prefer the page origin so
  // production frontends don't attempt to connect to the user's localhost.
  const backendFallback = socketUrl || pageOrigin;
      const candidates: (string | undefined)[] = [undefined, socketUrl, backendFallback];

      let connected = false;
      let stopped = false;
      let activeSocket: Socket | null = null;

      const tryConnect = async (candidate?: string): Promise<Socket> => {
        if (stopped || connected) throw new Error('stopped_or_connected');
        // allow polling as a fallback transport when websocket handshake fails
        const transports = ['polling', 'websocket'];
        const socket = candidate
          ? io(candidate, { path: '/socket.io', transports })
          : io({ path: '/socket.io', transports });
        setCurrentCandidate(candidate ?? '页面代理(default)');

        const timeout = setTimeout(() => {
          if (!connected) {
            try {
              socket.disconnect();
            } catch {
              // ignore disconnect errors
            }
          }
        }, 4000);

        socket.on('connect', () => {
          clearTimeout(timeout);
          connected = true;
          activeSocket = socket;
          console.log('WebSocket connected via', candidate ?? 'default/proxy');
          setIsConnected(true);
          setError(null);
          socket.emit('get-logs', { deploymentName, environmentId });
        });

        socket.on('connect_error', (err: unknown) => {
          console.warn('WebSocket connect_error via', candidate ?? 'default/proxy', err);
          const candidateLabel = candidate ?? '页面代理';
          const localhostHint = candidate && /localhost|127\.0\.0\.1/.test(candidate)
            ? '（请注意：浏览器中的 localhost 指向客户端机器，部署到服务器时应使用服务的公网地址或页面域名）'
            : '';
          const msg = `无法连接日志服务（尝试 ${candidateLabel} 失败）。${candidate ? '请检查后端是否监听该地址。' : '请检查 Vite 代理配置或后端。'}${localhostHint}`;
          setLastErrorMessage(msg);
          // only surface to UI after suppression window
          if (!connected && (!suppressErrorsUntil || Date.now() >= suppressErrorsUntil)) {
            setError(msg);
          }
        });

        socket.on('connect_timeout', (timeout) => {
          console.warn('connect_timeout', candidate, timeout);
          const msg = `连接超时（尝试 ${candidate ?? '页面代理'}）`;
          setLastErrorMessage(msg);
          if (!connected && (!suppressErrorsUntil || Date.now() >= suppressErrorsUntil)) {
            setError(msg);
          }
        });

        socket.on('error', (err: unknown) => {
          console.warn('socket error', candidate, err);
          const msg = `Socket 错误（${candidate ?? '页面代理'}）：${String(err)}`;
          setLastErrorMessage(msg);
          if (!connected && (!suppressErrorsUntil || Date.now() >= suppressErrorsUntil)) {
            setError(msg);
          }
        });

        socket.io?.on('reconnect_attempt', (attempt) => {
          console.log('reconnect attempt', attempt);
        });

        socket.on('disconnect', () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
        });

        socket.on('log-chunk', (chunk: string) => setLogs((prev) => [...prev, chunk]));
        socket.on('log-error', (msg: string) => setError(msg));
        socket.on('log-end', (m: string) => setLogs((prev) => [...prev, `\n--- ${m} ---\n`]));

        return socket;
      };

      (async () => {
        let socketInstance: Socket | null = null;
        for (const c of candidates) {
          if (stopped || connected) break;
          try {
            console.log('尝试连接日志服务，候选地址：', c ?? '页面代理（默认）');
            socketInstance = await tryConnect(c);

            // wait up to ~4.2s for connection
            let waited = 0;
            while (!connected && waited < 4200) {
              // wait in loop for connection
              await new Promise((r) => setTimeout(r, 200));
              waited += 200;
            }

            if (connected) {
              // activeSocket 已设置为成功的 socket
              break;
            }
          } catch (e) {
            console.warn('connect attempt failed', c, e);
          }

          // If this attempt didn't succeed, ensure the instance is disconnected.
          try {
            if (socketInstance && socketInstance.disconnect) socketInstance.disconnect();
          } catch {
            // ignore
          }
        }
        // after trying all candidates, if not connected, surface the last error
        if (!connected) {
          if (lastErrorMessage) setError(lastErrorMessage);
          else setError('无法连接日志服务（所有候选地址均失败）。');
        }
      })();

      // cleanup
      return () => {
        stopped = true;
        setIsConnected(false);
        try {
          if (activeSocket && activeSocket.disconnect) activeSocket.disconnect();
        } catch {
          // ignore
        }
        setCurrentCandidate(null);
      };
    } else if (visible) {
      // 如果弹窗可见但缺少必要信息，则显示错误
      setError('无法获取日志：缺少环境或应用名称。');
    }
  }, [visible, deploymentName, environmentId, lastErrorMessage, suppressErrorsUntil]);

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
      const desc = currentCandidate
        ? `${error}（尝试地址：${currentCandidate}）`
        : error;
      return <Alert message="日志错误" description={desc} type="error" showIcon />;
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
      // AntD v5 deprecates `bodyStyle` in favor of `styles` for specific parts.
      styles={{ body: { padding: 0, height: isMaximized ? 'calc(100vh - 55px)' : '60vh', position: 'relative' } }}
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