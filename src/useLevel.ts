import { useEffect, useRef, useState } from 'react'
import { levelUrl, type Mode } from '@/config'

const PERIOD = 1000 //  即時模式每秒發一次請求（固定節奏，不受 RTT 影響）
const TIMEOUT = 8000 //  單次請求逾時，避免慢速網路把更新迴圈卡死
// 等級回應只有 1 byte，不需要跟影像一樣的容忍度，壓低一點省慢速網路的連線。
const MAX_INFLIGHT = 2

/**
 * 取得震動等級。at 為 null 表示持續追最新值，否則抓該 unix 秒的封存值。
 * 取不到時回傳 null，畫面顯示 “—” 而不是假的 0。
 *
 * 與影像同樣的節奏策略：固定每秒發送、慢回的結果依序號丟棄、在途過多就跳過該輪、
 * 分頁在背景時不抓。
 */
export function useLevel(mode: Mode, at: number | null, paused: boolean): number | null {
  const [level, setLevel] = useState<number | null>(null)
  // 與影像同理：重播每秒換 at 時 effect 會重建，這些必須存活下來。
  const sent = useRef(0)
  const applied = useRef(0)
  const inflight = useRef(new Set<AbortController>())

  const url = levelUrl(mode, at)
  const live = at === null

  useEffect(() => {
    const pending = inflight.current
    return () => {
      for (const aborter of pending) aborter.abort()
      pending.clear()
    }
  }, [])

  useEffect(() => {
    // 這個模式沒有等級端點就完全不抓（例如 CWA）
    if (!mode.hasLevel) {
      setLevel(null)
      return
    }
    if (!url) return
    if (live && paused) return

    let scheduling = true

    async function request() {
      if (!scheduling || (live && document.hidden)) return
      if (inflight.current.size >= MAX_INFLIGHT) return

      const mine = ++sent.current
      const aborter = new AbortController()
      inflight.current.add(aborter)

      try {
        const res = await fetch(url, {
          // 這個端點沒有 cache-control 但邊緣會快取（x-cache: HIT），
          // 即時值一定要繞過，否則會拿到舊的等級。
          cache: live ? 'no-store' : 'default',
          signal: AbortSignal.any([aborter.signal, AbortSignal.timeout(TIMEOUT)]),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const n = Number((await res.text()).trim())
        // 比已顯示的更舊就丟棄，避免等級在畫面上倒退。
        if (mine > applied.current) {
          applied.current = mine
          setLevel(Number.isFinite(n) ? n : null)
        }
      } catch {
        if (mine > applied.current) {
          applied.current = mine
          setLevel(null)
        }
      } finally {
        inflight.current.delete(aborter)
      }
    }

    void request()
    // 重播只抓一次；即時模式才用固定節奏持續發送。
    const timer = live ? setInterval(request, PERIOD) : undefined

    // 只停排程，不中止在途請求（理由同 useLayerFrame）。
    return () => {
      scheduling = false
      if (timer) clearInterval(timer)
    }
  }, [url, live, paused, mode.hasLevel])

  return level
}
