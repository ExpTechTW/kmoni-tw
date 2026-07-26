import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { download } from '@/copyImage'
import { GifEncoder } from '@/gif'
import { decodeGif, type DecodedGif, type Pixels } from '@/editor/decodeGif'

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64]

/**
 * GIF 的延遲以 1/100 秒為單位，而且瀏覽器普遍把小於 20ms 的延遲當成 100ms。
 * 所以高倍速不能一直縮短延遲 —— 觸底後改成跳格，總長度才會真的變短。
 */
const MIN_DELAY_MS = 20

interface Crop {
  x: number
  y: number
  w: number
  h: number
}

interface Step {
  index: number
  delayMs: number
}

/**
 * 依倍速算出實際要輸出的影格與各自的延遲。預覽與匯出共用同一份，
 * 所以看到的就是匯出的結果。
 */
function plan(frames: { delayMs: number }[], speed: number): Step[] {
  const steps: Step[] = []
  let carry = 0
  for (let i = 0; i < frames.length; i++) {
    carry += frames[i].delayMs / speed
    // 還不夠一個可表示的延遲就跳過這格，時間累積到下一格
    if (carry < MIN_DELAY_MS && i < frames.length - 1) continue
    steps.push({ index: i, delayMs: Math.max(MIN_DELAY_MS, carry) })
    carry = 0
  }
  return steps
}

export default function Editor() {
  const [gif, setGif] = useState<DecodedGif | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)

  const [crop, setCrop] = useState<Crop | null>(null)
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [index, setIndex] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const load = useCallback(async (file: File) => {
    setError('')
    setBusy(true)
    try {
      const decoded = decodeGif(await file.arrayBuffer())
      setGif(decoded)
      setName(file.name.replace(/\.gif$/i, ''))
      setCrop(null)
      setIndex(0)
      setPlaying(true)
    } catch (e) {
      setGif(null)
      setError(e instanceof Error ? e.message : '無法讀取這個檔案')
    } finally {
      setBusy(false)
    }
  }, [])

  const steps = useMemo(() => (gif ? plan(gif.frames, speed) : []), [gif, speed])

  // 倍速改變後步數會變少，游標要拉回範圍內
  useEffect(() => {
    setIndex((i) => (i < steps.length ? i : 0))
  }, [steps.length])

  // 播放：依這一步自己的停留時間排下一步。
  useEffect(() => {
    if (!playing || steps.length < 2) return
    const step = steps[index] ?? steps[0]
    const id = setTimeout(() => setIndex((i) => (i + 1) % steps.length), step.delayMs)
    return () => clearTimeout(id)
  }, [playing, index, steps])

  // 把目前這一步的影格畫到畫面上
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!gif || !canvas || !ctx || steps.length === 0) return
    const frame = gif.frames[(steps[index] ?? steps[0]).index]
    canvas.width = gif.width
    canvas.height = gif.height
    ctx.putImageData(new ImageData(frame.rgba, gif.width, gif.height), 0, 0)
  }, [gif, index, steps])

  // 在畫面上拖曳出裁切範圍；座標要換算回原圖尺寸（畫面可能被縮小顯示）。
  const toImage = (e: React.PointerEvent): { x: number; y: number } | null => {
    const stage = stageRef.current
    if (!gif || !stage) return null
    const r = stage.getBoundingClientRect()
    const scale = gif.width / r.width
    return {
      x: clamp(Math.round((e.clientX - r.left) * scale), 0, gif.width),
      y: clamp(Math.round((e.clientY - r.top) * scale), 0, gif.height),
    }
  }

  function onDown(e: React.PointerEvent) {
    const p = toImage(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = p
    setCrop(null)
  }

  function onMove(e: React.PointerEvent) {
    if (!drag.current) return
    const p = toImage(e)
    if (!p) return
    const a = drag.current
    setCrop({
      x: Math.min(a.x, p.x),
      y: Math.min(a.y, p.y),
      w: Math.abs(p.x - a.x),
      h: Math.abs(p.y - a.y),
    })
  }

  function onUp() {
    drag.current = null
    // 太小的框視為誤觸
    setCrop((c) => (c && c.w >= 8 && c.h >= 8 ? c : null))
  }

  async function onExport() {
    if (!gif) return
    setBusy(true)
    setError('')
    try {
      // 讓瀏覽器有機會先把「處理中」畫出來
      await new Promise((r) => setTimeout(r, 0))
      const area = crop ?? { x: 0, y: 0, w: gif.width, h: gif.height }
      const blob = encode(gif, area, steps)
      download(blob, `${name || 'edited'}-${area.w}x${area.h}.gif`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '匯出失敗')
    } finally {
      setBusy(false)
    }
  }

  const total = steps.reduce((s, st) => s + st.delayMs, 0) / 1000
  const area = crop ?? (gif ? { x: 0, y: 0, w: gif.width, h: gif.height } : null)

  return (
    <div className="editor">
      <header>
        <h1>GIF 編輯器</h1>
        <button
          className="btn"
          onClick={() => {
            const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
            document.documentElement.dataset.theme = next
            try {
              localStorage.theme = next
            } catch {
              // 無痕模式存不了，忽略
            }
          }}
        >
          深淺色
        </button>
      </header>

      {!gif && (
        <label
          className={`drop ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const f = e.dataTransfer.files[0]
            if (f) void load(f)
          }}
        >
          <strong>把 GIF 拖進來</strong>
          <span>或點擊選擇檔案</span>
          <span className="hint">檔案不會上傳，全部在你的瀏覽器內處理</span>
          <input
            type="file"
            accept="image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void load(f)
            }}
          />
        </label>
      )}

      {error && <p className="error">{error}</p>}

      {gif && area && (
        <>
          <div className="meta">
            <span>
              <b>{name}.gif</b>
            </span>
            <span>
              原始 <b>{gif.width}×{gif.height}</b>
            </span>
            <span>
              <b>{gif.frames.length}</b> 格
            </span>
            <span>
              輸出 <b>{area.w}×{area.h}</b>
            </span>
            <span>
              <b>{steps.length}</b> 格
              {steps.length < gif.frames.length && <span className="hint">（跳格）</span>}
            </span>
            <span>
              長度 <b>{total.toFixed(1)}</b> 秒
            </span>
          </div>

          <div
            className="stage"
            ref={stageRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            <canvas ref={canvasRef} />
            {crop && (
              <div
                className="crop"
                style={{
                  left: `${(crop.x / gif.width) * 100}%`,
                  top: `${(crop.y / gif.height) * 100}%`,
                  width: `${(crop.w / gif.width) * 100}%`,
                  height: `${(crop.h / gif.height) * 100}%`,
                }}
              />
            )}
          </div>

          <div className="row">
            <span className="label">裁切</span>
            <span className="hint">在畫面上拖曳選取範圍</span>
            <Num label="X" value={area.x} max={gif.width} onChange={(v) => setCrop({ ...area, x: v })} />
            <Num label="Y" value={area.y} max={gif.height} onChange={(v) => setCrop({ ...area, y: v })} />
            <Num label="寬" value={area.w} max={gif.width - area.x} onChange={(v) => setCrop({ ...area, w: v })} />
            <Num label="高" value={area.h} max={gif.height - area.y} onChange={(v) => setCrop({ ...area, h: v })} />
            <button className="btn" onClick={() => setCrop(null)} disabled={!crop}>
              全圖
            </button>
          </div>

          <div className="row">
            <span className="label">速度</span>
            {SPEEDS.map((s) => (
              <button
                key={s}
                className="btn"
                aria-pressed={s === speed}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
            <span className="hint">每格 {Math.round((steps[index] ?? steps[0])?.delayMs ?? 0)} ms</span>
          </div>

          <div className="row">
            <button className="btn" onClick={() => setPlaying((p) => !p)}>
              {playing ? '暫停' : '播放'}
            </button>
            <span className="hint">
              第 {index + 1} / {steps.length} 格
            </span>
            <button className="btn" onClick={onExport} disabled={busy}>
              {busy ? '處理中…' : '匯出 GIF'}
            </button>
            <button
              className="btn"
              onClick={() => {
                setGif(null)
                setError('')
              }}
            >
              換一個檔案
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Num(props: {
  label: string
  value: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="hint">
      {props.label}
      <input
        type="number"
        min={0}
        max={props.max}
        value={props.value}
        onChange={(e) => props.onChange(clamp(Number(e.target.value) || 0, 0, props.max))}
      />
    </label>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 依 plan 挑出影格、裁切並重新編碼。 */
function encode(gif: DecodedGif, area: Crop, steps: Step[]): Blob {
  const cut = (rgba: Pixels): Pixels => {
    if (area.x === 0 && area.y === 0 && area.w === gif.width && area.h === gif.height) return rgba
    const out: Pixels = new Uint8ClampedArray(area.w * area.h * 4)
    for (let y = 0; y < area.h; y++) {
      const from = ((area.y + y) * gif.width + area.x) * 4
      out.set(rgba.subarray(from, from + area.w * 4), y * area.w * 4)
    }
    return out
  }

  const first = cut(gif.frames[steps[0].index].rgba)
  const enc = new GifEncoder(area.w, area.h, first)
  enc.addFrame(first, steps[0].delayMs)
  for (let i = 1; i < steps.length; i++) {
    enc.addFrame(cut(gif.frames[steps[i].index].rgba), steps[i].delayMs)
  }
  return enc.finish()
}
