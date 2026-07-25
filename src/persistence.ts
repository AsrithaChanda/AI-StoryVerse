const STORAGE_KEY = "storyverse:last-ember:v1";

export function loadPersisted<T>(): T | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function savePersisted<T>(value: T): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // The demo remains usable when storage is unavailable.
  }
}

export function clearPersisted(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op for restricted browser storage.
  }
}
