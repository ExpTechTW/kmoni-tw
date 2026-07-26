/**
 * 把地圖的三層（底圖、資料圖 canvas、圖例）壓平成一張圖。
 *
 * 畫面上是三個獨立堆疊的元素，所以瀏覽器原生的「複製圖片」只會拿到最上層那張
 * 幾乎全透明的圖例 —— 這裡自己合成一張才有意義。錄影也共用同一個合成結果。
 */
export type CopyResult = 'copied' | 'downloaded' | 'failed'

/** 依畫面上的堆疊順序合成一張 canvas；尺寸取自資料圖（756×648）。 */
export function renderStack(stack: HTMLElement): HTMLCanvasElement | null {
  const data = stack.querySelector('canvas')
  const first = stack.querySelector('img')
  const width = data?.width || first?.naturalWidth || 0
  const height = data?.height || first?.naturalHeight || 0
  if (!width || !height) return null

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) return null

  // 底圖的海是透明的，先鋪上與畫面一致的底色，貼到別處才不會變成黑底。
  ctx.fillStyle = getComputedStyle(stack).backgroundColor
  ctx.fillRect(0, 0, width, height)

  for (const el of stack.children) {
    if (el instanceof HTMLImageElement) {
      if (el.complete && el.naturalWidth > 0) ctx.drawImage(el, 0, 0, width, height)
    } else if (el instanceof HTMLCanvasElement) {
      ctx.drawImage(el, 0, 0, width, height)
    }
  }
  return out
}

/** 合成後複製到剪貼簿；剪貼簿不可用時退而下載，總之要讓人拿得到圖。 */
export async function copyStack(stack: HTMLElement): Promise<CopyResult> {
  const canvas = renderStack(stack)
  if (!canvas) return 'failed'

  let blob: Blob | null = null
  try {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return 'failed' // 畫布被跨來源影像污染時會丟 SecurityError
  }
  if (!blob) return 'failed'

  try {
    // Safari 要求在使用者手勢的同一個 tick 內建立 ClipboardItem，
    // 所以傳入 Promise<Blob> 而不是 await 過的 Blob。
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blob) })])
    return 'copied'
  } catch {
    return download(blob, 'kmoni-tw.png') ? 'downloaded' : 'failed'
  }
}

export function download(blob: Blob, name: string): boolean {
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    // 立刻 revoke 有些瀏覽器會來不及下載，延後一點再回收。
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    return true
  } catch {
    return false
  }
}
