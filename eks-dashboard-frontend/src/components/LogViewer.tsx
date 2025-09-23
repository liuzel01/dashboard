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

// Vite env is accessed dynamically below; we will treat it as a map of strings.

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
  // keep refs for suppression/last error so we don't need to include them
  // in the connection effect dependency array
  const suppressErrorsUntilRef = useRef<number | null>(null);
  const lastErrorMessageRef = useRef<string | null>(null);
  // Use refs to hold the latest values so we don't need to include them
  // in the useEffect dependency array (which would cause reconnect loops
  // when we update these states inside the effect).
  const logContainerRef = useRef<HTMLDivElement>(null);
  // throttleCounts used to limit console spamming per candidate
  // throttleCounts used to limit console spamming per candidate
  // key -> count; we keep a low cap to avoid spamming proxy/backend logs
  const throttleCountsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    // 确保所有必要信息都存在时才连接
    if (visible && deploymentName && environmentId) {
  // Read Vite env in a safe way and derive configurable constants early
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> })?.env || {};
  const isDev = !!viteEnv.DEV;
  const socketUrl = viteEnv.VITE_SOCKET_URL as string | undefined;
  // Configurable parameters (can be set via Vite env variables)
  const SUPPRESS_MS = Number(viteEnv.VITE_LOGVIEWER_SUPPRESS_MS) || 5000;
  const MAX_ATTEMPTS_DEV = Number(viteEnv.VITE_LOGVIEWER_MAX_ATTEMPTS) || 3;
  const MAX_ATTEMPTS_PROD = Number(viteEnv.VITE_LOGVIEWER_MAX_ATTEMPTS) || 1;
  const TOTAL_ATTEMPTS_CAP = Number(viteEnv.VITE_LOGVIEWER_TOTAL_ATTEMPTS_CAP) || 5;
  const MAX_CONCURRENT_SOCKETS = Number(viteEnv.VITE_LOGVIEWER_MAX_CONCURRENT) || 2;
  const THROTTLE_WARN_CAP = Number(viteEnv.VITE_LOGVIEWER_THROTTLE_WARN_CAP) || 2;
  const DEBUG_LOGVIEWER = !!viteEnv.VITE_LOGVIEWER_DEBUG;
  const pageOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  setLogs([]);
  setError(null);
  // Suppress showing transient connection errors for a short window
  // while we try multiple candidates / retries. This improves UX when
  // backend or proxy is still warming up after deploy/restart.
  const supTs = Date.now() + SUPPRESS_MS;
  // update ref directly
  suppressErrorsUntilRef.current = supTs;
  lastErrorMessageRef.current = null;
      setIsConnected(false);
      setIsAutoScrollEnabled(true); // 每次打开时重置为自动滚动

      

      // Production: only try the configured socket URL or the page origin and
      // use websocket transport only. Development: keep multi-candidate and
      // polling fallback for convenience during dev.
      let candidates: (string | undefined)[];
  const backendPreferred = socketUrl || pageOrigin;
      let transports: ('websocket' | 'polling')[];
      if (isDev) {
        candidates = [undefined, socketUrl, backendPreferred];
        transports = ['polling', 'websocket'];
      } else {
        candidates = [backendPreferred];
        transports = ['websocket'];
      }

  let connected = false;
      let stopped = false;
      let activeSocket: Socket | null = null;
  // total attempts across candidates to avoid runaway loops
  let totalAttempts = 0;

      const tryConnect = async (candidate?: string): Promise<Socket> => {
  // local throttle counters to avoid spamming global console; stored in ref
  const throttleCounts = throttleCountsRef.current;
        if (stopped || connected) throw new Error('stopped_or_connected');
        // use transports determined by environment
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
          // mark that this socket increased the global active count
          try {
            if (typeof window !== 'undefined') {
              const win = window as Window & { __eks_logviewer_active_count?: number };
              win.__eks_logviewer_active_count = (win.__eks_logviewer_active_count || 0) + 1;
              // attach a typed flag to socket
              (socket as unknown as { __eks_incremented?: boolean }).__eks_incremented = true;
            }
          } catch {
            // ignore
          }
          // only update state if changed
          setIsConnected((prev) => prev ? prev : true);
          setError((prev) => (prev === null ? prev : null));
          socket.emit('get-logs', { deploymentName, environmentId });
        });

  socket.on('connect_error', (err: unknown) => {
          // Throttle noisy warnings per candidate; only log first few to avoid spam
          const candidateKey = (candidate ?? 'default').toString();
          const key = `ws_warn_count_${candidateKey}`;
          const prev = throttleCounts.get(key) || 0;
          throttleCounts.set(key, prev + 1);
          if (prev < THROTTLE_WARN_CAP) console.warn('WebSocket connect_error via', candidate ?? 'default/proxy', err);
          const candidateLabel = candidate ?? '页面代理';
          const localhostHint = candidate && /localhost|127\.0\.0\.1/.test(candidate)
            ? '（请注意：浏览器中的 localhost 指向客户端机器，部署到服务器时应使用服务的公网地址或页面域名）'
            : '';
          const msg = `无法连接日志服务（尝试 ${candidateLabel} 失败）。${candidate ? '请检查后端是否监听该地址。' : '请检查 Vite 代理配置或后端。'}${localhostHint}`;
          lastErrorMessageRef.current = msg;
          // only surface to UI after suppression window (use ref to avoid effect loop)
          const sup = suppressErrorsUntilRef.current;
          if (!connected && (!sup || Date.now() >= sup)) {
            setError((prev) => (prev === msg ? prev : msg));
          }
        });

        socket.on('connect_timeout', (timeout) => {
          // throttle
          const candidateKey = (candidate ?? 'default').toString();
          const key = `ws_timeout_count_${candidateKey}`;
          const prev = throttleCounts.get(key) || 0;
          throttleCounts.set(key, prev + 1);
          if (prev < THROTTLE_WARN_CAP) console.warn('connect_timeout', candidate, timeout);
          const msg = `连接超时（尝试 ${candidate ?? '页面代理'}）`;
          lastErrorMessageRef.current = msg;
          const sup2 = suppressErrorsUntilRef.current;
          if (!connected && (!sup2 || Date.now() >= sup2)) {
            setError((prev) => (prev === msg ? prev : msg));
          }
        });

        socket.on('error', (err: unknown) => {
          // throttle
          const candidateKey = (candidate ?? 'default').toString();
          const key = `ws_error_count_${candidateKey}`;
          const prev = throttleCounts.get(key) || 0;
          throttleCounts.set(key, prev + 1);
          if (prev < THROTTLE_WARN_CAP) console.warn('socket error', candidate, err);
          const msg = `Socket 错误（${candidate ?? '页面代理'}）：${String(err)}`;
          lastErrorMessageRef.current = msg;
          const sup3 = suppressErrorsUntilRef.current;
          if (!connected && (!sup3 || Date.now() >= sup3)) {
            setError((prev) => (prev === msg ? prev : msg));
          }
        });

        socket.io?.on('reconnect_attempt', (attempt) => {
          console.log('reconnect attempt', attempt);
        });

        socket.on('disconnect', () => {
          console.log('WebSocket disconnected');
          // decrement global active counter if this socket incremented it
          try {
            if (typeof window !== 'undefined') {
              const win = window as Window & { __eks_logviewer_active_count?: number };
              if ((socket as unknown as { __eks_incremented?: boolean }).__eks_incremented) {
                win.__eks_logviewer_active_count = Math.max(0, (win.__eks_logviewer_active_count || 1) - 1);
                (socket as unknown as { __eks_incremented?: boolean }).__eks_incremented = false;
              }
            }
          } catch {
            // ignore
          }
          setIsConnected((prev) => (prev ? false : prev));
        });

        socket.on('log-chunk', (chunk: string) => setLogs((prev) => [...prev, chunk]));
        socket.on('log-error', (msg: string) => setError(msg));
  socket.on('log-end', (m: string) => setLogs((prev) => [...prev, `\n--- ${m} ---\n`]));

        return socket;
      };

      (async () => {
        let socketInstance: Socket | null = null;
        // Helper: limited retries with exponential backoff + jitter
        async function attemptWithRetries(candidate?: string) {
          const maxAttempts = isDev ? MAX_ATTEMPTS_DEV : MAX_ATTEMPTS_PROD;
          const baseDelay = 300; // ms
          for (let attempt = 1; attempt <= maxAttempts && !connected && !stopped; attempt++) {
            // guard total attempts across candidates
            totalAttempts += 1;
            if (totalAttempts > TOTAL_ATTEMPTS_CAP) {
              if (DEBUG_LOGVIEWER) console.warn('totalAttempts cap reached, aborting attempts');
              break;
            }
            try {
              if (attempt > 1) {
                // exponential backoff with jitter
                const delay = Math.floor(baseDelay * Math.pow(2, attempt - 2) * (0.8 + Math.random() * 0.4));
                await new Promise((r) => setTimeout(r, delay));
              }
              socketInstance = await tryConnect(candidate);

              // wait up to ~4.2s for connection
              let waited = 0;
              while (!connected && waited < 4200 && !stopped) {
                await new Promise((r) => setTimeout(r, 200));
                waited += 200;
              }

              if (connected) return true;
            } catch (e) {
              // only log summary to avoid thrashing logs
                  // keep this as debug; avoid printing many stack traces by default
                  if ((throttleCountsRef.current.get(`connect_debug_${candidate ?? 'default'}`) || 0) < 2) {
                    console.debug('connect attempt failed', candidate, e);
                    throttleCountsRef.current.set(`connect_debug_${candidate ?? 'default'}`, (throttleCountsRef.current.get(`connect_debug_${candidate ?? 'default'}`) || 0) + 1);
                  }
            }

            // ensure disconnection of this attempt
            try {
              if (socketInstance && socketInstance.disconnect) socketInstance.disconnect();
            } catch (e) {
              // ignore disconnect errors
              if ((throttleCountsRef.current.get(`disconnect_debug_${candidate ?? 'default'}`) || 0) < 2) {
                console.debug('disconnect cleanup failed', e);
                throttleCountsRef.current.set(`disconnect_debug_${candidate ?? 'default'}`, (throttleCountsRef.current.get(`disconnect_debug_${candidate ?? 'default'}`) || 0) + 1);
              }
            }
          }
          return false;
        }

        for (const c of candidates) {
          if (stopped || connected) break;
          // Check global concurrent socket cap
          if (typeof window !== 'undefined') {
            const win = window as Window & { __eks_logviewer_active_count?: number };
            if ((win.__eks_logviewer_active_count || 0) >= MAX_CONCURRENT_SOCKETS) {
              if (DEBUG_LOGVIEWER) console.warn('全局并发 LogViewer socket 达到上限，跳过连接尝试');
              break;
            }
          }
          console.log('尝试连接日志服务，候选地址：', c ?? '页面代理（默认）');
          const ok = await attemptWithRetries(c);
          if (ok) break;
        }
        // after trying all candidates, if not connected, surface the last error
        if (!connected) {
          if (lastErrorMessageRef.current) setError(lastErrorMessageRef.current);
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
        // clean refs as well to avoid stale values
        suppressErrorsUntilRef.current = null;
        lastErrorMessageRef.current = null;
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