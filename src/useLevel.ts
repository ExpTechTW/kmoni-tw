import { useEffect, useState } from 'react'
import { levelUrl } from '@/config'

const PERIOD = 1000 //  即時模式每秒更新一次
const TIMEOUT = 8000 //  單次請求逾時，避免慢速網路把更新迴圈卡死

/**
 * 取得震動等級。at 為 null 表示持續追最新值，否則抓該 unix 秒的封存值。
 * 取不到時回傳 null，畫面顯示 “—” 而不是假的 0。
 *
 * 與影像同樣的節流策略：請求不堆疊、逾時中止、分頁在背景時不抓。
 */
export function useLevel(at: number | null, paused: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null)
  const url = levelUrl(at)
  const live = at === null

  useEffect(() => {
    if (live && paused) return

    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const aborter = new AbortController()

    async function poll() {
      if (live && document.hidden) {
        timer = setTimeout(poll, PERIOD)
        return
      }

      try {
        const res = await fetch(url, {
          // 這個端點沒有 cache-control 但邊緣會快取（x-cache: HIT），
          // 即時值一定要繞過，否則會拿到舊的等級。
          cache: live ? 'no-store' : 'default',
          signal: AbortSignal.any([aborter.signal, AbortSignal.timeout(TIMEOUT)]),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const n = Number((await res.text()).trim())
        if (!stopped) setLevel(Number.isFinite(n) ? n : null)
      } catch {
        if (!stopped) setLevel(null)
      }

      // 重播只抓一次；即時模式才排下一次。
      if (live && !stopped) timer = setTimeout(poll, PERIOD)
    }

    void poll()

    return () => {
      stopped = true
      clearTimeout(timer)
      aborter.abort()
    }
  }, [url, live, paused])

  return level
}
