/**
 * GIF89a 解碼器（零相依）。
 *
 * 逐格解出「合成後」的完整畫面（RGBA），呼叫端不必自己處理透明與 disposal。
 * 有處理：全域／區域調色盤、透明索引、四種 disposal、交錯掃描。
 */

/** 明確綁定 ArrayBuffer，才能直接餵給 ImageData。 */
export type Pixels = Uint8ClampedArray<ArrayBuffer>

export interface GifFrame {
  /** 已與前幾格合成完的完整畫面。 */
  rgba: Pixels
  /** 這一格要停留的毫秒數。 */
  delayMs: number
}

export interface DecodedGif {
  width: number
  height: number
  frames: GifFrame[]
}

export function decodeGif(buffer: ArrayBuffer): DecodedGif {
  const b = new Uint8Array(buffer)
  let p = 0

  const sig = String.fromCharCode(...b.subarray(0, 3))
  if (sig !== 'GIF') throw new Error('不是 GIF 檔')
  p = 6

  const width = b[p] | (b[p + 1] << 8)
  const height = b[p + 2] | (b[p + 3] << 8)
  const packed = b[p + 4]
  p += 7

  let globalTable: Uint8Array | null = null
  if (packed & 0x80) {
    const size = 3 * (1 << ((packed & 0x07) + 1))
    globalTable = b.subarray(p, p + size)
    p += size
  }

  const frames: GifFrame[] = []
  const canvas: Pixels = new Uint8ClampedArray(width * height * 4) // 持續累積的畫布
  let delayMs = 100
  let transparent = -1
  let disposal = 0

  while (p < b.length) {
    const block = b[p++]

    if (block === 0x3b) break // 結束

    if (block === 0x21) {
      const label = b[p++]
      if (label === 0xf9) {
        p++ // 區塊長度固定為 4
        const flags = b[p]
        disposal = (flags >> 2) & 0x07
        transparent = flags & 0x01 ? b[p + 3] : -1
        delayMs = (b[p + 1] | (b[p + 2] << 8)) * 10
        p += 4
        p++ // 結束子區塊
      } else {
        p = skipBlocks(b, p)
      }
      continue
    }

    if (block !== 0x2c) continue // 未知區塊，跳過

    const left = b[p] | (b[p + 1] << 8)
    const top = b[p + 2] | (b[p + 3] << 8)
    const fw = b[p + 4] | (b[p + 5] << 8)
    const fh = b[p + 6] | (b[p + 7] << 8)
    const fpacked = b[p + 8]
    p += 9

    let table = globalTable
    if (fpacked & 0x80) {
      const size = 3 * (1 << ((fpacked & 0x07) + 1))
      table = b.subarray(p, p + size)
      p += size
    }
    if (!table) throw new Error('GIF 缺少調色盤')

    const interlaced = (fpacked & 0x40) !== 0
    const minCodeSize = b[p++]
    const { data, next } = readBlocks(b, p)
    p = next

    const indices = lzwDecode(minCodeSize, data, fw * fh)

    // disposal=3 要在畫這一格之前先存檔，之後才能還原
    const saved = disposal === 3 ? canvas.slice() : null

    for (let y = 0; y < fh; y++) {
      const srcRow = interlaced ? deinterlace(y, fh) : y
      for (let x = 0; x < fw; x++) {
        const idx = indices[srcRow * fw + x]
        if (idx === transparent) continue // 透明：保留畫布上原本的內容

        const cx = left + x
        const cy = top + y
        if (cx >= width || cy >= height) continue

        const o = (cy * width + cx) * 4
        canvas[o] = table[idx * 3]
        canvas[o + 1] = table[idx * 3 + 1]
        canvas[o + 2] = table[idx * 3 + 2]
        canvas[o + 3] = 255
      }
    }

    frames.push({ rgba: canvas.slice(), delayMs: delayMs || 100 })

    // 處理這一格畫完後的清除方式，供下一格使用
    if (disposal === 2) {
      for (let y = top; y < Math.min(top + fh, height); y++) {
        for (let x = left; x < Math.min(left + fw, width); x++) {
          const o = (y * width + x) * 4
          canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0
        }
      }
    } else if (disposal === 3 && saved) {
      canvas.set(saved)
    }
  }

  if (frames.length === 0) throw new Error('這個 GIF 沒有任何影格')
  return { width, height, frames }
}

/** GIF 交錯掃描的列順序。 */
function deinterlace(y: number, height: number): number {
  const p1 = Math.ceil(height / 8)
  const p2 = Math.ceil((height - 4) / 8)
  const p3 = Math.ceil((height - 2) / 4)
  if (y < p1) return y * 8
  if (y < p1 + p2) return (y - p1) * 8 + 4
  if (y < p1 + p2 + p3) return (y - p1 - p2) * 4 + 2
  return (y - p1 - p2 - p3) * 2 + 1
}

function skipBlocks(b: Uint8Array, p: number): number {
  while (b[p] !== 0) p += b[p] + 1
  return p + 1
}

function readBlocks(b: Uint8Array, p: number): { data: Uint8Array; next: number } {
  const parts: Uint8Array[] = []
  let total = 0
  while (b[p] !== 0) {
    const n = b[p]
    parts.push(b.subarray(p + 1, p + 1 + n))
    total += n
    p += n + 1
  }
  const data = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    data.set(part, at)
    at += part.length
  }
  return { data, next: p + 1 }
}

function lzwDecode(minCodeSize: number, data: Uint8Array, pixels: number): Uint8Array {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const out = new Uint8Array(pixels)

  // 字典以「前綴碼 + 尾字元」表示，避免每次複製陣列
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const stack = new Uint8Array(4096)

  let codeSize = minCodeSize + 1
  let next = eoi + 1
  let acc = 0
  let accBits = 0
  let at = 0
  let outAt = 0
  let prev = -1

  const reset = () => {
    codeSize = minCodeSize + 1
    next = eoi + 1
    prev = -1
  }

  for (let i = 0; i < clear; i++) suffix[i] = i

  while (outAt < pixels) {
    while (accBits < codeSize) {
      if (at >= data.length) return out // 資料提前結束就用已解出的部分
      acc |= data[at++] << accBits
      accBits += 8
    }
    const code = acc & ((1 << codeSize) - 1)
    acc >>= codeSize
    accBits -= codeSize

    if (code === clear) {
      reset()
      continue
    }
    if (code === eoi) break

    let top = 0
    let cur = code

    if (code >= next) {
      // 尚未定義的碼：等於「上一串 + 上一串的第一個字元」
      if (prev < 0) break
      cur = prev
      stack[top++] = firstChar(prefix, suffix, prev)
    }

    while (cur >= clear) {
      stack[top++] = suffix[cur]
      cur = prefix[cur]
    }
    stack[top++] = suffix[cur]

    while (top > 0 && outAt < pixels) out[outAt++] = stack[--top]

    if (prev >= 0 && next < 4096) {
      prefix[next] = prev
      suffix[next] = suffix[cur] // cur 此時是這一串的第一個字元
      next++
      if (next === 1 << codeSize && codeSize < 12) codeSize++
    }
    prev = code
  }

  return out
}

function firstChar(prefix: Int32Array, suffix: Uint8Array, code: number): number {
  let c = code
  while (c >= 256) c = prefix[c]
  return suffix[c]
}
