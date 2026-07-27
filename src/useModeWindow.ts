import { useEffect, useState } from 'react'
import { REPLAY_WINDOW_SEC, type Mode } from '@/config'

const TIMEOUT = 8000
/** 可用區間會隨時間往前滑動，定期重新問一次。 */
const REFRESH_MS = 60_000

export interface TimeWindow {
  oldest: number
  newest: number
  /** 尚未取得可用區間（只會發生在有 status 的模式），此時時間軸應停用。 */
  pending: boolean
}

/**
 * 時間軸的可用區間。
 *
 * 一般模式是以「現在」往回推算；CWA 沒有即時端點，區間由它自己的 status
 * 端點提供（available_from / available_until），所以要另外去問。
 */
export function useModeWindow(mode: Mode, nowSec: number): TimeWindow {
  const [remote, setRemote] = useState<{ oldest: number; newest: number } | null>(null)
  const status = mode.status

  useEffect(() => {
    setRemote(null)
    if (!status) return

    let stopped = false

    async function check() {
      try {
        const res = await fetch(status!, {
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const j: unknown = await res.json()
        const from = pickNumber(j, 'available_from')
        const until = pickNumber(j, 'available_until')
        if (stopped || from === null || until === null || until <= from) return

        // 兩端都是開區間：實測 available_until 本身回 404、available_from 本身回 416。
        setRemote({ oldest: from + 1, newest: until - 1 })
      } catch {
        // 問不到就維持現狀，時間軸留在停用狀態
      }
    }

    void check()
    const id = setInterval(check, REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [status])

  // 沒有 status 的模式：整段以「現在」往回推算。
  if (!status) {
    const newest = nowSec - mode.lagSec
    return { oldest: newest - REPLAY_WINDOW_SEC, newest, pending: false }
  }

  if (!remote) return { oldest: nowSec, newest: nowSec, pending: true }

  // 有 status 的模式：上限同時受封存實際範圍與該模式的緩衝限制，取較舊者。
  const newest = Math.min(remote.newest, nowSec - mode.lagSec)
  return { oldest: remote.oldest, newest: Math.max(remote.oldest, newest), pending: false }
}

function pickNumber(o: unknown, key: string): number | null {
  if (typeof o !== 'object' || o === null) return null
  const v = (o as Record<string, unknown>)[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
