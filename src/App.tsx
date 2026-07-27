import { useEffect, useRef, useState } from 'react'
import {
  DEPTHS,
  DEPTH_KEYS,
  LAYER_KEYS,
  MODES,
  MODE_KEYS,
  REGIONS,
  REGION_KEYS,
  REPLAY_FRAME_MS,
  REPLAY_NUDGES,
  REPLAY_STEP_SEC,
  basemapOf,
  levelTone,
  modeReady,
  regionOf,
  resolveLayer,
  resolveMode,
  type DepthKey,
  type LayerKey,
  type ModeKey,
  type RegionKey,
  type Theme,
} from '@/config'
import { copyStack, type CopyResult } from '@/copyImage'
import { loadPref, savePref } from '@/storage'
import { MAX_FRAMES, useRecorder } from '@/useRecorder'
import { useFocusBasemap } from '@/useFocusBasemap'
import { useLayerFrame } from '@/useLayerFrame'
import { useLevel } from '@/useLevel'
import { useModeWindow } from '@/useModeWindow'
import { useNow } from '@/useNow'

const THEMES = ['light', 'dark'] as const

const COPY_LABEL: Record<CopyResult | 'idle', string> = {
  idle: '複製圖片',
  copied: '已複製',
  downloaded: '已下載',
  failed: '複製失敗',
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => loadPref('theme', THEMES, 'light'))
  const [regionKey, setRegionKey] = useState<RegionKey>(() =>
    loadPref('region', REGION_KEYS, 'all'),
  )
  const [modeKey, setModeKey] = useState<ModeKey>(() => loadPref('mode', MODE_KEYS, 'realtime'))
  const [layerKey, setLayerKey] = useState<LayerKey>(() => loadPref('layer', LAYER_KEYS, 'int'))
  const [depth, setDepth] = useState<DepthKey>(() => loadPref('depth', DEPTH_KEYS, 'surface'))

  // at 為 null 代表即時模式。重播位置不記憶，重開一律回到即時。
  const [at, setAt] = useState<number | null>(null)
  // 暫停對兩種模式都有效：即時模式停止輪詢，重播模式停止前進。
  const [paused, setPaused] = useState(false)

  const replaying = at !== null
  // 記住的模式／圖層可能還沒就緒，一律換算成真的能用的那一個。
  const mode = resolveMode(modeKey)
  const region = regionOf(regionKey)
  const active = resolveLayer(mode, layerKey)
  const layer = active.key
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<CopyResult | null>(null)
  const rec = useRecorder(stackRef)
  const { status } = useLayerFrame(canvasRef, mode, layer, region, at, paused, depth)
  const level = useLevel(mode, at, paused)
  const nowSec = Math.floor(useNow(1000) / 1000)

  // 時間軸的可用區間：一般模式以「現在」推算，CWA 由它的 status 提供。
  const win = useModeWindow(mode, nowSec)
  const { oldest, newest } = win
  const current = at ?? newest

  // focus 區域的中心會變，底圖定時從 raw 更新；抓不到就沿用 bundle 內的。
  const liveFocus = useFocusBasemap(theme)
  const basemap = region.focus && liveFocus ? liveFocus : basemapOf(region, theme)

  useEffect(() => {
    savePref('theme', theme)
    document.documentElement.dataset.theme = theme
    // 讓行動瀏覽器的網址列底色跟著主題走
    document
      .querySelector('meta[name=theme-color]')
      ?.setAttribute('content', theme === 'dark' ? '#000000' : '#ececec')
  }, [theme])

  // 複製結果提示 2 秒後恢復
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(id)
  }, [copied])

  useEffect(() => savePref('region', regionKey), [regionKey])
  useEffect(() => savePref('mode', modeKey), [modeKey])
  useEffect(() => savePref('layer', layer), [layer])
  useEffect(() => savePref('depth', depth), [depth])

  // 上界放進 ref：它每秒都在變，直接寫進 deps 會讓 1 秒的 interval 不斷重建而永遠不觸發。
  const newestRef = useRef(newest)
  newestRef.current = newest

  // 重播播放：每 REPLAY_FRAME_MS 前進 REPLAY_STEP_SEC 秒，最多到可用區間的尾端。
  useEffect(() => {
    if (paused || !replaying) return
    const id = setInterval(() => {
      setAt((t) => (t === null ? null : Math.min(t + REPLAY_STEP_SEC, newestRef.current)))
    }, REPLAY_FRAME_MS)
    return () => clearInterval(id)
  }, [paused, replaying])

  // 換模式先回到即時；沒有即時端點的模式（CWA）改從可用區間尾端往前一小時開始播。
  useEffect(() => {
    setAt(null)
  }, [mode.key])

  // 起播點就是上限（現在 −1 小時，或封存實際尾端，取較舊者）。
  useEffect(() => {
    if (mode.live || win.pending) return
    setAt((t) => (t === null ? newest : t))
  }, [mode.key, mode.live, win.pending, newest])

  // 數字鍵切換目前模式底下「可用」的圖層。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 焦點在下拉選單或時間軸上時交給元件自己處理，別搶數字鍵。
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return

      const i = Number(e.key) - 1
      const usable = mode.layers.filter((l) => l.ready)
      if (i >= 0 && i < usable.length) setLayerKey(usable[i].key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode.layers])

  // 跳到某個絕對時刻。錄影中一律不受理：光靠 input 的 disabled 只擋得住滑鼠，
  // 任何其他呼叫進來都會讓錄到的 GIF 時間前後錯亂。
  function seekTo(sec: number) {
    if (rec.recording) return
    setPaused(true)
    setAt(Math.min(newest, Math.max(oldest, Math.round(sec))))
  }

  const locked = !mode.replay || rec.recording || win.pending
  const lockReason = rec.recording
    ? '錄製中無法調整時間'
    : win.pending
      ? '正在取得可用時間範圍…'
      : mode.replay
        ? undefined
        : `${mode.label}沒有封存資料，無法重播`

  function toLive() {
    setPaused(false)
    setAt(null)
  }

  // 「等待新資料」只在上限真的不動時才顯示。正常追著邊界播放時 at 與 newest
  // 每秒一起前進，光看 at >= newest 會永遠成立而誤報。
  const lastAdvance = useRef({ value: newest, sec: nowSec })
  if (newest !== lastAdvance.current.value) lastAdvance.current = { value: newest, sec: nowSec }
  const stalled = nowSec - lastAdvance.current.sec >= 3
  const atEnd = replaying && at !== null && at >= newest && stalled

  async function onCopy() {
    const stack = stackRef.current
    if (stack) setCopied(await copyStack(stack))
  }

  // 錄影期間畫面必須持續前進，所以按下就自動播放，暫停鍵讓位給「錄製結束」。
  function startRecording() {
    setPaused(false)
    rec.start()
  }

  return (
    <div className="wrap">
      <header>
        <h1>強震監視器</h1>
        <button
          className="btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="切換深淺色"
        >
          {theme === 'dark' ? '淺色' : '深色'}
        </button>
      </header>

      {/* 沒有任何可用圖層的模式先停用，免得選進去是一片死路。 */}
      <nav className="tabs" role="tablist" aria-label="模式">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={m.key === mode.key}
            disabled={!modeReady(m)}
            title={modeReady(m) ? undefined : '此模式的圖層後端尚未提供'}
            onClick={() => setModeKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </nav>

      {/* 只有 CWA 有井下資料，其他模式不顯示這一列。 */}
      {mode.depths && (
        <nav className="tabs" role="tablist" aria-label="深度">
          {DEPTHS.map((d) => (
            <button
              key={d.key}
              role="tab"
              aria-selected={d.key === depth}
              onClick={() => setDepth(d.key)}
            >
              {d.label}
            </button>
          ))}
        </nav>
      )}

      <nav className="tabs" role="tablist" aria-label="區域">
        {REGIONS.map((r) => (
          <button
            key={r.key}
            role="tab"
            aria-selected={r.key === region.key}
            onClick={() => setRegionKey(r.key)}
          >
            {r.label}
          </button>
        ))}
      </nav>

      {/* 圖層最多 10 個且名稱長，用下拉選單（NIED 強震モニタ 也是這樣）。 */}
      <div className="picker">
        <select
          aria-label="圖層"
          value={layer}
          onChange={(e) => setLayerKey(e.target.value as LayerKey)}
        >
          {mode.layers.map((l) => (
            <option key={l.key} value={l.key} disabled={!l.ready}>
              {l.ready ? l.label : `${l.label}（尚未提供）`}
            </option>
          ))}
        </select>
      </div>

      {/* 由下往上：底圖、資料圖、圖例。資料圖不分深淺色。 */}
      <div className="stack" ref={stackRef}>
        <img
          src={basemap}
          alt={`${region.label}底圖`}
          decoding="async"
          crossOrigin="anonymous"
        />
        <canvas ref={canvasRef} width={756} height={648} aria-hidden />
        {active.legend && (
          <img src={active.legend} alt={`${active.label}圖例`} decoding="async" />
        )}
      </div>

      <footer>
        <span className={`dot ${status.tone}`} />
        <span className="state">
          {status.text}
          {atEnd && !paused && '（等待新資料）'}
        </span>
        {mode.hasLevel && (
          <span className={`level ${level === null ? '' : levelTone(level)}`}>
            震動 Level: {level ?? '—'}
          </span>
        )}
        <span className="time">{status.stamp}</span>
      </footer>

      {/* 即時模式沒有封存，整組時間軸停用（暫停仍可用，那是停止輪詢）。 */}
      <div className="replay">
        <input
          type="range"
          min={oldest}
          max={newest}
          step={REPLAY_STEP_SEC}
          value={current}
          // 錄影中鎖住：拖動會讓時間軸跳來跳去，錄出來的 GIF 會前後錯亂。
          disabled={locked}
          title={lockReason}
          onChange={(e) => seekTo(Number(e.target.value))}
          aria-label="重播時間"
        />
        {/* 錄影中不能暫停（畫面要持續前進），這個位置改成結束錄製。 */}
        {rec.recording ? (
          <button className="btn stop" onClick={rec.stop}>
            錄製結束
          </button>
        ) : (
          <button className="btn" onClick={() => setPaused((p) => !p)}>
            {paused ? '播放' : '暫停'}
          </button>
        )}
        <button
          className="btn"
          onClick={toLive}
          disabled={!mode.live || !replaying || rec.recording}
          title={mode.live ? undefined : `${mode.label}沒有即時資料，只能依時刻播放`}
        >
          即時模式
        </button>
      </div>

      {/* 48 小時攤在滑桿上每像素約 350 秒，選不到特定時刻，
          所以再給「直接輸入時刻」與「固定級距微調」兩種精確操作。 */}
      <div className="replay nudges">
        <input
          type="datetime-local"
          step={1}
          value={toLocalInput(current)}
          min={toLocalInput(oldest)}
          max={toLocalInput(newest)}
          disabled={locked}
          title={lockReason}
          onChange={(e) => {
            const sec = fromLocalInput(e.target.value)
            if (sec !== null) seekTo(sec)
          }}
          aria-label="跳到指定時刻"
        />
        {REPLAY_NUDGES.map((n) => (
          <button
            key={n.sec}
            className="btn tiny"
            disabled={locked || current + n.sec < oldest || current + n.sec > newest}
            onClick={() => seekTo(current + n.sec)}
          >
            {n.label}
          </button>
        ))}
      </div>

      <div className="tools">
        <button className="btn copy" onClick={onCopy} title="把底圖、資料與圖例合成一張複製">
          {COPY_LABEL[copied ?? 'idle']}
        </button>
        {rec.recording ? (
          <span className="recording">
            <span className="dot down" />
            錄製中 {rec.frames}/{MAX_FRAMES} 張
            {rec.files > 0 && `・已存 ${rec.files} 檔`}
          </span>
        ) : (
          <button className="btn" onClick={startRecording} title="每秒一張合成 GIF，滿 10 分鐘自動分檔下載">
            錄製開始
          </button>
        )}
        {/* 獨立的一頁，另開視窗；它的程式碼不會進到首頁的 bundle。 */}
        <a className="btn" href="./editor.html" target="_blank" rel="noopener">
          GIF 編輯器
        </a>
      </div>

      <p className="disclaimer">僅供參考，應以中央氣象署發布之內容為準</p>
    </div>
  )
}

/** unix 秒 → datetime-local 需要的本地時間字串。 */
function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 不帶時區的字串會被當成本地時間解讀，正是我們要的。 */
function fromLocalInput(v: string): number | null {
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}
