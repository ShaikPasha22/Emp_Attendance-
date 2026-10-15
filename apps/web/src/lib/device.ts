const KEY = 'attendance.deviceId';
let memoryId: string | null = null;

/** Stable per-browser ID used for HR's optional device-binding restriction. */
export function getDeviceId(): string {
  if (memoryId) return memoryId;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return (memoryId = existing);
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return (memoryId = id);
  } catch {
    // Storage blocked (private mode): fall back to a per-session id.
    return (memoryId ??= crypto.randomUUID());
  }
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}
