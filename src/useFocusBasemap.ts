import { useEffect, useState } from 'react'
import { BASEMAP_REFRESH_MS, INFO_URL, focusBasemapUrl, type Theme } from '@/config'

const TIMEOUT = 8000

interface Info {
  focus?: { light?: string; dark?: string }
}

/**
 * 取得 focus 底圖的最新網址。定時比對 info.json 的雜湊，有變才換。
 *
 * 回傳 null 代表還沒拿到、或抓不到 —— 呼叫端應沿用 bundle 內的底圖。
 * 網址是先預載成功才回傳的，避免換上去卻是一張破圖：這在災時尤其重要，
 * 寧可顯示稍舊但正確的底圖，也不要空白。
 */
export function useFocusBasemap(theme: Theme): string | null {
  const [hash, setHash] = useState<string | null>(null)
  const [ready, setReady] = useState<string | null>(null)

  // 定時取雜湊。
  useEffect(() => {
    let stopped = false

    async function check() {
      try {
        const res = await fetch(INFO_URL, {
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const info: Info = await res.json()
        const next = theme === 'dark' ? info.focus?.dark : info.focus?.light
        if (!stopped && typeof next === 'string' && next) setHash(next)
      } catch {
        // 抓不到就維持現狀，呼叫端會沿用 bundle 內的底圖
      }
    }

    void check()
    const timer = setInterval(check, BASEMAP_REFRESH_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [theme])

  // 預載成功才換上。
  useEffect(() => {
    if (!hash) return
    const url = focusBasemapUrl(theme, hash)

    let stopped = false
    const img = new Image()
    // 一定要帶 CORS：否則瀏覽器會快取一份「非 CORS」的副本，之後把它畫進 canvas
    // 會污染畫布，複製合成圖就會失敗。raw.githubusercontent.com 有回 ACAO: *。
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!stopped) setReady(url)
    }
    img.src = url

    return () => {
      stopped = true
    }
  }, [theme, hash])

  return ready
}
