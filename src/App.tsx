import { useEffect, useState } from 'react'
import {
  LAYERS,
  LAYER_KEYS,
  REGIONS,
  REGION_KEYS,
  REPLAY_FRAME_MS,
  REPLAY_LAG_SEC,
  REPLAY_STEP_SEC,
  REPLAY_WINDOW_SEC,
  basemapOf,
  levelTone,
  regionOf,
  shownRegion,
  type LayerKey,
  type RegionKey,
  type Theme,
} from '@/config'
import { loadPref, savePref } from '@/storage'
import { useLayerFrame } from '@/useLayerFrame'
import { useLevel } from '@/useLevel'
import { useNow } from '@/useNow'

const THEMES = ['light', 'dark'] as const

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => loadPref('theme', THEMES, 'light'))
  const [regionKey, setRegionKey] = useState<RegionKey>(() =>
    loadPref('region', REGION_KEYS, 'all'),
  )
  const [layer, setLayer] = useState<LayerKey>(() => loadPref('layer', LAYER_KEYS, 'int'))

  // at 為 null 代表即時模式。重播位置不記憶，重開一律回到即時。
  const [at, setAt] = useState<number | null>(null)
  // 暫停對兩種模式都有效：即時模式停止輪詢，重播模式停止前進。
  const [paused, setPaused] = useState(false)

  const replaying = at !== null
  // 重播只有全國視野，底圖要跟著換，否則會配上對不起來的資料圖。
  const region = shownRegion(regionOf(regionKey), at)
  const active = LAYERS.find((l) => l.key === layer) ?? LAYERS[0]
  const { frame, status } = useLayerFrame(layer, region, at, paused)
  const level = useLevel(at, paused)
  const nowSec = Math.floor(useNow(1000) / 1000)

  useEffect(() => {
    savePref('theme', theme)
    document.documentElement.dataset.theme = theme
    // 讓行動瀏覽器的網址列底色跟著主題走
    document
      .querySelector('meta[name=theme-color]')
      ?.setAttribute('content', theme === 'dark' ? '#000000' : '#ececec')
  }, [theme])

  useEffect(() => savePref('region', regionKey), [regionKey])
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const i = '123'.indexOf(e.key)
      if (i >= 0) setLayer(LAYERS[i].key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

      <nav className="tabs" role="tablist" aria-label="圖層">
        {LAYERS.map((l) => (
          <button
            key={l.key}
            role="tab"
            aria-selected={l.key === layer}
            onClick={() => setLayer(l.key)}
          >
            {l.label}
          </button>
        ))}
      </nav>

      {/* 由下往上：底圖、資料圖、圖例。資料圖不分深淺色。 */}
      <div className="stack">
        <img src={basemapOf(region, theme)} alt={`${region.label}底圖`} decoding="async" />
        {frame && <img src={frame} alt="" decoding="async" />}
        <img src={active.legend} alt={`${active.label}圖例`} decoding="async" />
      </div>

      <footer>
        <span className={`dot ${status.tone}`} />
        <span className="state">{status.text}</span>
        <span className={`level ${level === null ? '' : levelTone(level)}`}>
          震動 Level: {level ?? '—'}
        </span>
        <span className="time">{status.stamp}</span>
      </footer>

      <div className="replay">
        <input
          type="range"
          min={-REPLAY_WINDOW_SEC}
          max={-REPLAY_LAG_SEC}
          step={REPLAY_STEP_SEC}
          value={offset}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="重播時間"
        />
        <button className="btn" onClick={() => setPaused((p) => !p)}>
          {paused ? '播放' : '暫停'}
        </button>
        <button className="btn" onClick={toLive} disabled={!replaying}>
          即時模式
        </button>
      </div>
    </div>
  )
}
