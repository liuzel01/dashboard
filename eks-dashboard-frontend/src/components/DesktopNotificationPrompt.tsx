import React, { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Space } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import {
  DESKTOP_NOTIFICATION_PERMISSION_CHANGED,
  desktopNotificationPermission,
  requestDesktopNotificationPermission,
} from '../services/desktopNotifications';

const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

export const DesktopNotificationPrompt: React.FC<{
  userKey: string;
  visible: boolean;
}> = ({ userKey, visible }) => {
  const { message } = App.useApp();
  const storageKey = useMemo(
    () => `dashboard.desktop-notifications.dismissed-until:${userKey}`,
    [userKey],
  );
  const [permission, setPermission] = useState(desktopNotificationPermission);
  const [dismissedUntil, setDismissedUntil] = useState(() =>
    Number(localStorage.getItem(storageKey) || 0),
  );

  useEffect(() => {
    setDismissedUntil(Number(localStorage.getItem(storageKey) || 0));
  }, [storageKey]);

  useEffect(() => {
    const sync = () => setPermission(desktopNotificationPermission());
    window.addEventListener(DESKTOP_NOTIFICATION_PERMISSION_CHANGED, sync);
    let permissionStatus: PermissionStatus | undefined;
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((status) => {
        permissionStatus = status;
        status.addEventListener('change', sync);
      })
      .catch(() => undefined);
    return () => {
      window.removeEventListener(DESKTOP_NOTIFICATION_PERMISSION_CHANGED, sync);
      permissionStatus?.removeEventListener('change', sync);
    };
  }, []);

  if (
    !visible ||
    permission !== 'default' ||
    dismissedUntil > Date.now() ||
    typeof Notification === 'undefined' ||
    !window.isSecureContext
  ) return null;

  const enable = async () => {
    const result = await requestDesktopNotificationPermission();
    setPermission(result.permission);
    if (result.permission === 'granted') {
      new Notification('Dashboard 通知已开启', {
        body: 'CI/CD 任务完成后将在此处提醒。',
        tag: 'cicd-notification-test',
      });
    } else if (result.permission === 'denied') {
      message.warning('浏览器已拒绝通知，可在地址栏的站点设置中重新允许');
    }
  };

  const dismiss = () => {
    const until = Date.now() + DISMISS_MS;
    localStorage.setItem(storageKey, String(until));
    setDismissedUntil(until);
  };

  return (
    <Alert
      type="info"
      showIcon
      icon={<BellOutlined />}
      message="开启桌面通知"
      description="Jenkins 构建或推包完成后，即使切换到其他标签页，也能收到系统提醒。"
      action={(
        <Space>
          <Button size="small" onClick={dismiss}>暂不提醒</Button>
          <Button size="small" type="primary" icon={<BellOutlined />} onClick={enable}>
            开启通知
          </Button>
        </Space>
      )}
      style={{ marginBottom: 16 }}
    />
  );
};
