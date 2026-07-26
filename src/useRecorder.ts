import { useCallback, useEffect, useRef, useState } from 'react'
import { download, renderStack } from '@/copyImage'
import { GifEncoder } from '@/gif'

const INTERVAL_MS = 1000 //          每秒一張，與畫面更新同頻
export const MAX_FRAMES = 600 //     單檔上限 10 分鐘

export interface Recorder {
  recording: boolean
  /** 目前這一段已錄的張數。 */
  frames: number
  /** 已自動存檔的段數。 */
  files: number
  start: () => void
  stop: () => void
}

/**
 * 把畫面每秒合成一張、累積成 GIF。滿 10 分鐘就自動切檔下載並接著錄，
 * 避免單一檔案大到瀏覽器抱不動 —— 長時間錄影必須有這個上限。
 */
export function useRecorder(stackRef: React.RefObject<HTMLElement | null>): Recorder {
  const [recording, setRecording] = useState(false)
  const [frames, setFrames] = useState(0)
  const [files, setFiles] = useState(0)

  const encoder = useRef<GifEncoder | null>(null)
  const part = useRef(0)

  const save = useCallback(() => {
    const enc = encoder.current
    encoder.current = null
    if (!enc || enc.frameCount === 0) return

    part.current += 1
    download(enc.finish(), `kmoni-tw-${stamp()}-${String(part.current).padStart(2, '0')}.gif`)
    setFiles(part.current)
    setFrames(0)
  }, [])

  useEffect(() => {
    if (!recording) return

    function capture() {
      const stack = stackRef.current
      if (!stack) return

      const canvas = renderStack(stack)
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return

      let rgba: Uint8ClampedArray
      try {
        rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      } catch {
        return // 畫布被跨來源影像污染
      }

      if (!encoder.current) encoder.current = new GifEncoder(canvas.width, canvas.height, rgba)
      encoder.current.addFrame(rgba, INTERVAL_MS)
      setFrames(encoder.current.frameCount)

      // 滿一段就存檔，下一次 capture 會自動開新的一段。
      if (encoder.current.frameCount >= MAX_FRAMES) save()
    }

    capture() // 按下就先抓一張，不必等一秒
    const id = setInterval(capture, INTERVAL_MS)
    return () => clearInterval(id)
  }, [recording, stackRef, save])

  return {
    recording,
    frames,
    files,
    start: useCallback(() => {
      part.current = 0
      setFiles(0)
      setFrames(0)
      setRecording(true)
    }, []),
    stop: useCallback(() => {
      setRecording(false)
      save() // 把最後不滿一段的部分存下來
    }, [save]),
  }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
