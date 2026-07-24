// 記住使用者的選擇。無痕模式下 localStorage 可能直接丟例外，
// 所以每次存取都包起來 —— 記不住偏好無所謂，但不能讓畫面掛掉。

export function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 忽略：存不了偏好不影響監視功能
  }
}
