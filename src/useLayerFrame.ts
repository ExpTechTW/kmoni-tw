import { useEffect, useRef, useState, type RefObject } from 'react'
import { frameUrl, type LayerKey, type Region } from '@/config'
import { useNow } from '@/useNow'

const PERIOD = 1000 //  即時模式每秒發一次請求（固定節奏，不受 RTT 影響）
const TIMEOUT = 8000 //  單次請求逾時，避免慢速網路把更新迴圈卡死
const STALE = 4000 //   超過此毫秒數未更新視為延遲
const DEAD = 12000 //   超過此毫秒數未更新視為中斷
const MAX_FAILS = 3 //  連續失敗幾次後視為中斷
const MAX_INFLIGHT = 4 // 同時在途的請求上限，網路太慢時就跳過該輪

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
 * 取得指定圖層／區域的影像並畫到 canvas 上。at 為 null 表示持續追最新影像，
 * 否則只抓該 unix 秒的重播影像一次。paused 在即時模式下會停止輪詢。
 *
 * 影像刻意走 createImageBitmap + drawImage + close()，而不是 blob URL 配 <img>：
 * 後者每秒都會產生一個新網址，Chrome 的影像快取以網址為鍵保留「解碼後」的點陣圖
 * （756×648×4 ≈ 2 MB／張），撤銷網址並不會馬上釋放它，實測記憶體會以每秒約 1.7 MB
 * 一路長到記憶體壓力才回收。close() 則是立即歸還，長時間開著也不會累積。
 *
 * 即時模式以固定節奏發送，而不是等前一次結束才排下一次 —— 後者的實際週期會是
 * 1000 + RTT，實測 RTT 約 110 ms 就會 30 秒少拿 2 張，網路越慢掉得越兇。改成固定
 * 節奏後每秒都會發，慢回的結果用序號比對直接丟棄（畫面上已經有更新的了）。
 *
 * 序號與在途集合放在 ref：重播播放時 at 每秒變動、effect 會跟著重建，若在 cleanup
 * 中止在途請求，RTT 一旦超過一秒就永遠沒有一張抓得完（實測延遲 1.5 秒時 21 個請求
 * 全數被中止）。因此只有換圖層／區域才中止，其餘讓它跑完再用序號決定要不要畫。
 *
 * 災時網路狀況仍要防堆積：在途請求超過 MAX_INFLIGHT 就跳過該輪，卡住的請求會逾時，
 * 分頁在背景時完全不抓圖。
 */
export function useLayerFrame(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  layer: LayerKey,
  region: Region,
  at: number | null,
  paused: boolean,
) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [lastOk, setLastOk] = useState(0)
  const [fails, setFails] = useState(0)
  const now = useNow(PERIOD)

  // 這三個要跨 effect 重建存活，重播每秒換 at 時才不會被重設。
  const sent = useRef(0) //     已送出的序號，單調遞增
  const painted = useRef(0) //  已畫到畫面上的最大序號
  const gen = useRef(0) //      圖層／區域的世代，換了就作廢所有在途結果
  const inflight = useRef(new Set<AbortController>())

  const url = frameUrl(layer, region, at)
  const live = at === null

  // 換圖層或區域時清掉畫面，避免 PGA 的資料配上 PGV 的圖例，
  // 並中止在途請求、跳世代讓已經回來的結果作廢。
  // 只前進重播時刻時不做這些，畫面才不會每幀閃一下。
  useEffect(() => {
    const pending = inflight.current
    gen.current++
    for (const aborter of pending) aborter.abort()
    pending.clear()

    clear(canvasRef.current)
    setOutcome(null)
    setLastOk(0)
    setFails(0)
  }, [canvasRef, layer, region.key])

  // 卸載時收乾淨。
  useEffect(() => {
    const pending = inflight.current
    return () => {
      for (const aborter of pending) aborter.abort()
      pending.clear()
    }
  }, [])

  useEffect(() => {
    // 即時模式暫停：停止輪詢，畫面停在最後一張。
    // 重播模式仍要抓，否則拖到的那一刻會沒有畫面。
    if (live && paused) return

    let scheduling = true

    async function request() {
      // 分頁在背景時不抓圖，省下災時寶貴的頻寬與電力。
      if (!scheduling || (live && document.hidden)) return
      // 網路慢到請求塞住時就跳過這一輪，寧可掉張數也不要無限堆積。
      if (inflight.current.size >= MAX_INFLIGHT) return

      const mine = ++sent.current
      const myGen = gen.current
      const aborter = new AbortController()
      inflight.current.add(aborter)

      try {
        const res = await fetch(url, {
          // 即時影像必須繞過快取；重播影像是固定的歷史畫面，可以放心快取。
          cache: live ? 'no-store' : 'default',
          signal: AbortSignal.any([aborter.signal, AbortSignal.timeout(TIMEOUT)]),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const bitmap = await createImageBitmap(await res.blob())
        try {
          // 世代不符（已換圖層）或比已顯示的更舊就丟棄 —— 慢回的結果畫上去只會倒退。
          if (myGen === gen.current && mine > painted.current) {
            painted.current = mine
            paint(canvasRef.current, bitmap)
          }
        } finally {
          // 無論有沒有畫上去都要歸還，這是不累積記憶體的關鍵。
          bitmap.close()
        }

        if (myGen !== gen.current) return
        // 即使該張被丟棄，連線本身仍是成功的，狀態要照實反映。
        setLastOk(Date.now())
        setFails(0)
        setOutcome({ url, ok: true })
      } catch {
        if (myGen !== gen.current) return
        setFails((n) => n + 1)
        setOutcome({ url, ok: false })
      } finally {
        inflight.current.delete(aborter)
      }
    }

    void request()
    // 重播只抓一張；即時模式才用固定節奏持續發送。
    const timer = live ? setInterval(request, PERIOD) : undefined

    // 這裡只停排程，不中止在途請求：重播每秒換 at 都會走到這裡，
    // 中止的話 RTT 一超過一秒就永遠抓不完一張。
    return () => {
      scheduling = false
      if (timer) clearInterval(timer)
    }
  }, [canvasRef, url, live, paused])

  return { status: describe({ live, paused, at, url, outcome, lastOk, fails, now }) }
}

function paint(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap) {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 只在尺寸真的不同時才改，設定 width/height 會重新配置整塊 buffer。
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width
    canvas.height = bitmap.height
  }

  // 資料圖有透明區域，不清掉的話舊的測站點會殘留。
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
}

function clear(canvas: HTMLCanvasElement | null) {
  const ctx = canvas?.getContext('2d')
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
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
    if (!s.outcome) return { tone: 'replay', text: '載入中…', stamp }

    // 暫停時是在檢視某一刻，要精確反映「這一刻」抓到了沒有。
    if (s.paused) {
      if (s.outcome.url !== s.url) return { tone: 'replay', text: '載入中…', stamp }
      if (!s.outcome.ok) return { tone: 'down', text: '此時間無資料', stamp }
      return { tone: 'replay', text: '重播（暫停）', stamp }
    }

    // 播放中畫面一直在更新，不該因為最新那張還在路上就顯示「載入中」；
    // 連續失敗才代表真的沒有資料。
    if (s.fails >= MAX_FAILS) return { tone: 'down', text: '此時間無資料', stamp }
    return { tone: 'replay', text: '重播', stamp }
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
