export const DESKTOP_NOTIFICATION_PERMISSION_CHANGED =
  'dashboard:desktop-notification-permission-changed';

export const desktopNotificationPermission = (): NotificationPermission =>
  typeof Notification === 'undefined' ? 'denied' : Notification.permission;

export const requestDesktopNotificationPermission = async () => {
  if (typeof Notification === 'undefined') {
    return { permission: 'denied' as NotificationPermission, reason: 'unsupported' as const };
  }
  if (!window.isSecureContext) {
    return { permission: Notification.permission, reason: 'insecure' as const };
  }
  if (Notification.permission === 'denied') {
    return { permission: 'denied' as NotificationPermission, reason: 'denied' as const };
  }
  const permission = await Notification.requestPermission();
  window.dispatchEvent(
    new CustomEvent(DESKTOP_NOTIFICATION_PERMISSION_CHANGED, {
      detail: permission,
    }),
  );
  return { permission, reason: 'requested' as const };
};
