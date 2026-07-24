import { useEffect, useState } from 'react'

/** 每 interval 毫秒重新取得現在時刻，讓依賴時間的顯示持續走動。 */
export function useNow(interval: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval])

  return now
}
