import { useEffect, useRef, useState } from 'react'
import { frameUrl, type LayerKey, type Region } from '@/config'
import { useNow } from '@/useNow'

const PERIOD = 1000 //  即時模式每秒更新一次
const TIMEOUT = 8000 //  單次請求逾時，避免慢速網路把更新迴圈卡死
const STALE = 4000 //   超過此毫秒數未更新視為延遲
const DEAD = 12000 //   超過此毫秒數未更新視為中斷
const MAX_FAILS = 3 //  連續失敗幾次後視為中斷

export type Tone = 'init' | 'live' | 'lag' | 'down' | 'replay' | 'paused'

export interface Status {
  tone: Tone
  text: string
  /** 狀態列右側的時間字串。 */
  stamp: string
}

/** 這次抓圖的結果，記著是哪一個網址，才能分辨「載入中」與「已載入」。 */
interface Outcome {
  url: string
  ok: boolean
}

/**
 * 取得指定圖層／區域的影像。at 為 null 表示持續追最新影像，
 * 否則只抓該 unix 秒的重播影像一次。paused 在即時模式下會停止輪詢，
 * 畫面停在最後一張。
 *
 * 災時網路狀況通常很差，所以即時模式刻意做到：請求不堆疊（前一次結束才排下一次，
 * 網路越慢自動降頻）、卡住的請求會逾時重試、新影像解碼完成才換上畫面（不閃爍）、
 * 分頁在背景時完全不抓圖。
 */
export function useLayerFrame(
  layer: LayerKey,
  region: Region,
  at: number | null,
  paused: boolean,
) {
  const [frame, setFrame] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [lastOk, setLastOk] = useState(0)
  const [fails, setFails] = useState(0)
  const shown = useRef<string | null>(null)
  const now = useNow(PERIOD)

  const url = frameUrl(layer, region, at)
  const live = at === null

  // 換圖層或區域時清掉舊影像，避免 PGA 的資料配上 PGV 的圖例。
  // 只前進重播時刻時不清，畫面才不會每幀閃一下。
  useEffect(() => {
    revoke(shown)
    setFrame(null)
    setOutcome(null)
    setLastOk(0)
    setFails(0)
  }, [layer, region.key])

  // 卸載時回收最後一張；其餘的在換新影像時就地回收。
  useEffect(() => () => revoke(shown), [])

  useEffect(() => {
    // 即時模式暫停：停止輪詢，畫面停在最後一張。
    // 重播模式仍要抓，否則拖到的那一刻會沒有畫面。
    if (live && paused) return

    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    // 拖動時間軸時舊的請求要立刻中止，否則會一路堆積到逾時為止。
    const aborter = new AbortController()

    async function poll() {
      // 分頁在背景時不抓圖，省下災時寶貴的頻寬與電力。
      if (live && document.hidden) {
        timer = setTimeout(poll, PERIOD)
        return
      }

      try {
        const res = await fetch(url, {
          // 即時影像必須繞過快取；重播影像是固定的歷史畫面，可以放心快取。
          cache: live ? 'no-store' : 'default',
          signal: AbortSignal.any([aborter.signal, AbortSignal.timeout(TIMEOUT)]),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const objectUrl = URL.createObjectURL(await res.blob())

        // 先解碼再換上畫面，換圖時就不會閃爍或出現半張圖。
        const decoded = new Image()
        decoded.src = objectUrl
        await decoded.decode()

        if (stopped) {
          URL.revokeObjectURL(objectUrl)
          return
        }

        // 一秒一張，不回收會持續累積記憶體。
        revoke(shown)
        shown.current = objectUrl

        setFrame(objectUrl)
        setLastOk(Date.now())
        setFails(0)
        setOutcome({ url, ok: true })
      } catch {
        if (stopped) return
        setFails((n) => n + 1)
        setOutcome({ url, ok: false })
      }

      // 重播只抓一張；即時模式才排下一次。
      if (live && !stopped) timer = setTimeout(poll, PERIOD)
    }

    void poll()

    return () => {
      stopped = true
      clearTimeout(timer)
      aborter.abort()
    }
  }, [url, live, paused])

  return { frame, status: describe({ live, paused, at, url, outcome, lastOk, fails, now }) }
}

function revoke(ref: { current: string | null }) {
  if (ref.current) {
    URL.revokeObjectURL(ref.current)
    ref.current = null
  }
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-TW', { hour12: false })
}

function describe(s: {
  live: boolean
  paused: boolean
  at: number | null
  url: string
  outcome: Outcome | null
  lastOk: number
  fails: number
  now: number
}): Status {
  if (!s.live) {
    const stamp = s.at === null ? '' : clock(s.at * 1000)
    if (s.outcome?.url !== s.url) return { tone: 'replay', text: '載入中…', stamp }
    if (!s.outcome.ok) return { tone: 'down', text: '此時間無資料', stamp }
    return { tone: 'replay', text: s.paused ? '重播（暫停）' : '重播', stamp }
  }

  const stamp = s.lastOk ? `更新 ${clock(s.lastOk)}` : '--:--:--'

  // 即時模式暫停時畫面就停在最後一張，狀態要講清楚，避免誤以為是現況。
  if (s.paused) return { tone: 'paused', text: '已暫停', stamp }

  if (!s.lastOk) {
    return s.fails
      ? { tone: 'down', text: '無法連線', stamp }
      : { tone: 'init', text: '連線中…', stamp }
  }

  const age = s.now - s.lastOk

  if (s.fails >= MAX_FAILS || age > DEAD) return { tone: 'down', text: '連線中斷', stamp }
  if (age > STALE) return { tone: 'lag', text: `延遲 ${Math.round(age / 1000)} 秒`, stamp }
  return { tone: 'live', text: '即時', stamp }
}
