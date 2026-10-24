/** Detecção de capacidades reais do aparelho — nada é prometido sem checagem. */

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function iosVersion(): number | null {
  const m = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  return m ? Number(m[1]) + Number(m[2]) / 10 : null;
}

export interface Capabilities {
  serviceWorker: boolean;
  notifications: boolean;
  notificationPermission: NotificationPermission | 'indisponivel';
  /** No iOS, notificações web só existem com o app instalado na Tela de Início (iOS 16.4+). */
  notificationsNeedInstall: boolean;
  badge: boolean;
  persistentStorage: boolean;
  standalone: boolean;
  ios: boolean;
  backgroundScheduling: false;
}

export function capabilities(): Capabilities {
  const ios = isIOS();
  const standalone = isStandalone();
  const hasNotif = typeof window !== 'undefined' && 'Notification' in window;
  return {
    serviceWorker: 'serviceWorker' in navigator,
    notifications: hasNotif,
    notificationPermission: hasNotif ? Notification.permission : 'indisponivel',
    notificationsNeedInstall: ios && !standalone,
    badge: 'setAppBadge' in navigator,
    persistentStorage: !!navigator.storage?.persist,
    standalone,
    ios,
    // Não há API web confiável para agendar notificações locais com o app fechado (sem servidor de push).
    backgroundScheduling: false,
  };
}

/** Pede permissão SOMENTE a partir de um toque do usuário. */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'indisponivel'> {
  if (!('Notification' in window)) return 'indisponivel';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

export async function showNotification(title: string, body: string, tag: string): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png' });
      return true;
    }
    new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

export async function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* sem suporte: ignorado */
  }
}

/** Pede ao navegador para não apagar o IndexedDB sob pressão de espaço. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
