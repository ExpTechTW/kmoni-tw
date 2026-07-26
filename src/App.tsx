import { useEffect, useRef, useState } from 'react'
import {
  LAYER_KEYS,
  MODES,
  MODE_KEYS,
  REGIONS,
  REGION_KEYS,
  REPLAY_FRAME_MS,
  REPLAY_LAG_SEC,
  REPLAY_STEP_SEC,
  REPLAY_WINDOW_SEC,
  basemapOf,
  levelTone,
  modeReady,
  regionOf,
  resolveLayer,
  resolveMode,
  shownRegion,
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

  // at 為 null 代表即時模式。重播位置不記憶，重開一律回到即時。
  const [at, setAt] = useState<number | null>(null)
  // 暫停對兩種模式都有效：即時模式停止輪詢，重播模式停止前進。
  const [paused, setPaused] = useState(false)

  const replaying = at !== null
  // 重播只有全國視野，底圖要跟著換，否則會配上對不起來的資料圖。
  const region = shownRegion(regionOf(regionKey), at)
  // 記住的模式／圖層可能還沒就緒，一律換算成真的能用的那一個。
  const mode = resolveMode(modeKey)
  const active = resolveLayer(mode, layerKey)
  const layer = active.key
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState<CopyResult | null>(null)
  const rec = useRecorder(stackRef)
  const { status } = useLayerFrame(canvasRef, mode, layer, region, at, paused)
  const level = useLevel(mode, at, paused)
  const nowSec = Math.floor(useNow(1000) / 1000)

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

  // 重播播放：每 REPLAY_FRAME_MS 前進 REPLAY_STEP_SEC 秒，最多到最新的封存時刻。
  useEffect(() => {
    if (paused || !replaying) return
    const id = setInterval(() => {
      setAt((t) => {
        if (t === null) return null
        const newest = Math.floor(Date.now() / 1000) - REPLAY_LAG_SEC
        return Math.min(t + REPLAY_STEP_SEC, newest)
      })
    }, REPLAY_FRAME_MS)
    return () => clearInterval(id)
  }, [paused, replaying])

  // 播到封存尾端就停下來，不然會一直重抓同一張。
  useEffect(() => {
    if (replaying && at !== null && at >= nowSec - REPLAY_LAG_SEC) setPaused(true)
  }, [replaying, at, nowSec])

  // 切到沒有封存的模式時要離開重播，否則會一直抓不到影像。
  useEffect(() => {
    if (!mode.replay) setAt(null)
  }, [mode.replay])

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

  // 滑桿是「距現在幾秒」。右端停在最新的封存時刻（而非現在），
  // 因為比那更新的時刻還沒有存檔，拉過去只會取不到影像。
  const offset =
    at === null
      ? -REPLAY_LAG_SEC
      : Math.min(-REPLAY_LAG_SEC, Math.max(-REPLAY_WINDOW_SEC, at - nowSec))

  // 拖動時間軸是在檢視某一刻，先停下來比較合理。
  function seek(v: number) {
    setPaused(true)
    setAt(nowSec + v)
  }

  function toLive() {
    setPaused(false)
    setAt(null)
  }

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

      {/* 重播中封存只有全國視野，focus 區域先停用，選取狀態也顯示實際呈現的區域。 */}
      <nav className="tabs" role="tablist" aria-label="區域">
        {REGIONS.map((r) => (
          <button
            key={r.key}
            role="tab"
            aria-selected={r.key === region.key}
            disabled={replaying && r.focus}
            title={replaying && r.focus ? '重播沒有此區域的封存影像' : undefined}
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
        <span className="state">{status.text}</span>
        <span className={`level ${level === null ? '' : levelTone(level)}`}>
          震動 Level: {level ?? '—'}
        </span>
        <span className="time">{status.stamp}</span>
      </footer>

      {/* 即時模式沒有封存，時間軸與回到最新一併停用（暫停仍可用，那是停止輪詢）。 */}
      <div className="replay">
        <input
          type="range"
          min={-REPLAY_WINDOW_SEC}
          max={-REPLAY_LAG_SEC}
          step={REPLAY_STEP_SEC}
          value={offset}
          disabled={!mode.replay}
          title={mode.replay ? undefined : `${mode.label}沒有封存資料，無法重播`}
          onChange={(e) => seek(Number(e.target.value))}
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
        <button className="btn" onClick={toLive} disabled={!replaying || rec.recording}>
          即時模式
        </button>
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
      </div>

      <p className="disclaimer">僅供參考，應以中央氣象署發布之內容為準</p>
    </div>
  )
}
