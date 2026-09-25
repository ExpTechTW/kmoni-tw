import { useEffect, useState } from 'react'
import { REPLAY_WINDOW_SEC, type Mode } from '@/config'

const TIMEOUT = 8000
/**
 * 上限在兩次詢問之間會自己往前推（見下方），這裡只是為了拿到新寫完的小時
 * （landed_until）。後端在新的一小時寫完後至少留 2 分鐘才讓上限進入它，30 秒綽綽有餘。
 */
const REFRESH_MS = 30_000

export interface TimeWindow {
  oldest: number
  newest: number
  /** 尚未取得可用區間（只會發生在有 status 的模式），此時時間軸應停用。 */
  pending: boolean
}

interface Remote {
  oldest: number
  /** available_until，開區間。 */
  until: number
  /** landed_until：上限往前推的極限。舊版後端沒有這個欄位時為 null，不外推。 */
  landed: number | null
  /** 收到回應時的本機秒數。 */
  fetched: number
}

/**
 * 時間軸的可用區間。
 *
 * 一般模式是以「現在」往回推算；CWA 沒有即時端點，區間由它自己的 status
 * 端點提供（available_from / available_until），所以要另外去問。
 */
export function useModeWindow(mode: Mode, nowSec: number): TimeWindow {
  const [remote, setRemote] = useState<Remote | null>(null)
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

        // available_from 是閉區間，但保留期邊緣每秒往前移，等到真的去要時它本身已經過期
        // （實測回 416），所以 +1。
        setRemote({
          oldest: from + 1,
          until,
          landed: pickNumber(j, 'landed_until'),
          fetched: Math.floor(Date.now() / 1000),
        })
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

  // 後端的上限每秒前進一秒（now − 延遲），但不會超過已寫完的那一小時（landed_until）。
  // 兩次詢問之間自己往前推，播放追著上限時才不會撞上 30 秒前問到的值、停下來等下一次。
  // 以本機經過的秒數外推，不拿本機時鐘去減延遲，兩端時鐘不同步也不會推過頭。
  const elapsed = Math.max(0, nowSec - remote.fetched)
  const until =
    remote.landed === null ? remote.until : Math.min(remote.until + elapsed, remote.landed)

  // 上限另外受該模式的緩衝限制，取較舊者；available_until 是開區間，本身不能要。
  const newest = Math.min(until - 1, nowSec - mode.lagSec)
  return { oldest: remote.oldest, newest: Math.max(remote.oldest, newest), pending: false }
}

function pickNumber(o: unknown, key: string): number | null {
  if (typeof o !== 'object' || o === null) return null
  const v = (o as Record<string, unknown>)[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
