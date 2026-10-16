import React, { useContext, useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContextValue';
import { CicdRealtimeContext } from './CicdRealtimeContextValue';
import type { CicdRun } from '../services/api';

const terminalStatuses = new Set([
  'SUCCESS',
  'FAILURE',
  'ABORTED',
  'CANCELLED',
  'UNKNOWN',
]);

const notificationWording: Record<string, { title: string; statusLabel: string }> = {
  SUCCESS: { title: 'CI/CD 执行成功', statusLabel: '执行成功' },
  FAILURE: { title: 'CI/CD 执行失败', statusLabel: '执行失败' },
  ABORTED: { title: 'CI/CD 执行已中止', statusLabel: '已中止' },
  CANCELLED: { title: 'CI/CD 执行已取消', statusLabel: '已取消' },
  UNKNOWN: { title: 'CI/CD 执行状态待确认', statusLabel: '状态待确认，请在 Jenkins 中核实' },
};

export const CicdRealtimeProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const navigate = useNavigate();
  const { me, permissions } = useContext(AuthContext);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const allowed = permissions.includes('menu:cicd-runs');

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (!token || !allowed || !me?.username) {
      setSocket(null);
      setConnected(false);
      return;
    }
    const nextSocket = io('/cicd', {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
    });
    setSocket(nextSocket);

    nextSocket.on('cicd-ready', () => setConnected(true));
    nextSocket.on('disconnect', () => setConnected(false));
    nextSocket.on('cicd-run-updated', (run: CicdRun) => {
      if (
        !terminalStatuses.has(run.status) ||
        run.requested_by_username !== me.username ||
        typeof Notification === 'undefined' ||
        Notification.permission !== 'granted'
      ) return;
      const notifiedKey = `cicd-notified:${me.username}:${run.run_id}:${run.status}`;
      if (localStorage.getItem(notifiedKey)) return;
      localStorage.setItem(notifiedKey, new Date().toISOString());
      const wording = notificationWording[run.status] || notificationWording.UNKNOWN;
      const notification = new Notification(
        wording.title,
        {
          body: `${run.environment_id} / ${run.job_name}：${wording.statusLabel}`,
          tag: `cicd-run-${run.run_id}`,
        },
      );
      notification.onclick = () => {
        window.focus();
        navigate('/cicd-runs');
        notification.close();
      };
    });

    return () => {
      nextSocket.disconnect();
      setConnected(false);
      setSocket((current) => current === nextSocket ? null : current);
    };
  }, [allowed, me?.username, navigate]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);
  return (
    <CicdRealtimeContext.Provider value={value}>
      {children}
    </CicdRealtimeContext.Provider>
  );
};
