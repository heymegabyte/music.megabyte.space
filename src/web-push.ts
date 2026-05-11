// Web Push subscription manager. Owns SW registration handoff, VAPID key fetch,
// permission flow, subscribe/unsubscribe lifecycle, and persistence to Worker KV.

const VAPID_KEY_URL = '/api/push/vapid-key';
const SUBSCRIBE_URL = '/api/push/subscribe';
const UNSUBSCRIBE_URL = '/api/push/unsubscribe';

export type PushState = 'unsupported' | 'denied' | 'default' | 'subscribed' | 'unsubscribed';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return Notification.permission === 'default' ? 'default' : 'unsubscribed';
  const sub = await reg.pushManager.getSubscription();
  if (sub) return 'subscribed';
  return Notification.permission === 'default' ? 'default' : 'unsubscribed';
}

export async function subscribePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  if (Notification.permission === 'default') {
    const granted = await Notification.requestPermission();
    if (granted !== 'granted') return { ok: false, reason: granted };
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await postSubscription(existing);
    return { ok: true };
  }
  const vapid = await fetchVapidKey();
  if (!vapid) return { ok: false, reason: 'vapid_unavailable' };
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapid)
  });
  await postSubscription(sub);
  return { ok: true };
}

export async function unsubscribePush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return true;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return true;
  try {
    await fetch(UNSUBSCRIBE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
  } catch { /* network failure is fine — server prunes 410s on send */ }
  return sub.unsubscribe();
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  const payload = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  await fetch(SUBSCRIBE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

let cachedVapid: string | null = null;
async function fetchVapidKey(): Promise<string | null> {
  if (cachedVapid) return cachedVapid;
  try {
    const res = await fetch(VAPID_KEY_URL, { cache: 'force-cache' });
    if (!res.ok) return null;
    const data = await res.json() as { key?: string };
    if (!data.key) return null;
    cachedVapid = data.key;
    return data.key;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}
