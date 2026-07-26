/**
 * 極簡 GIF89a 編碼器（零相依）。
 *
 * 針對這個畫面的特性最佳化：實測整張只有約 308 種顏色（量化到 256 幾乎無損，
 * 多出來的是灰階地形的漸層），而且每秒只有約 0.12% 的像素會變動。因此除了第一張
 * 之外都只編碼「有變動的像素」，其餘填透明索引並設定 disposal=1（不清除前一張），
 * 大片連續的透明索引經 LZW 壓縮後幾乎不佔空間。
 */

const TRANSPARENT = 255 // 保留給「與前一張相同」的像素

type Bytes = Uint8Array<ArrayBuffer>

export class GifEncoder {
  private readonly chunks: Bytes[] = []
  private readonly lookup = new Map<number, number>()
  private readonly width: number
  private readonly height: number
  private top: number[] = []
  private previous: Uint8Array | null = null
  private frames = 0

  constructor(width: number, height: number, first: Uint8ClampedArray) {
    this.width = width
    this.height = height
    const palette = this.buildPalette(first)
    this.chunks.push(header(width, height), palette, netscapeLoop())
  }

  get frameCount(): number {
    return this.frames
  }

  /** delayMs 是這一張要停留的時間。 */
  addFrame(rgba: Uint8ClampedArray, delayMs: number): void {
    const n = this.width * this.height
    const indices: Bytes = new Uint8Array(n)
    const prev = this.previous
    let changed = 0

    for (let i = 0; i < n; i++) {
      const rgb = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]
      const idx = this.indexOf(rgb)
      if (prev && prev[i] === idx) {
        indices[i] = TRANSPARENT
      } else {
        indices[i] = idx
        changed++
      }
    }

    // 完全沒變就不寫新影格，只把上一張的停留時間拉長。
    if (prev && changed === 0 && this.frames > 0) {
      extendDelay(this.chunks, delayMs)
      return
    }

    this.chunks.push(graphicControl(delayMs, prev !== null))
    this.chunks.push(imageDescriptor(this.width, this.height))
    this.chunks.push(lzw(8, indices))

    // 保存的是「畫面上實際的樣子」，所以透明的位置要沿用前一張的索引。
    const resolved = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      resolved[i] = indices[i] === TRANSPARENT && prev ? prev[i] : indices[i]
    }
    this.previous = resolved
    this.frames++
  }

  finish(): Blob {
    return new Blob([...this.chunks, new Uint8Array([0x3b])], { type: 'image/gif' })
  }

  /**
   * 以第一張影格的顏色建表：取最常出現的 255 種，其餘對應到最接近的一種。
   * 索引 255 保留給透明。
   */
  private buildPalette(rgba: Uint8ClampedArray): Bytes {
    const counts = new Map<number, number>()
    for (let i = 0; i < rgba.length; i += 4) {
      const rgb = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]
      counts.set(rgb, (counts.get(rgb) ?? 0) + 1)
    }

    const top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TRANSPARENT)
      .map(([rgb]) => rgb)

    const table = new Uint8Array(768)
    top.forEach((rgb, i) => {
      table[i * 3] = (rgb >> 16) & 0xff
      table[i * 3 + 1] = (rgb >> 8) & 0xff
      table[i * 3 + 2] = rgb & 0xff
      this.lookup.set(rgb, i)
    })
    this.top = top
    return table
  }

  /** 查表；沒收錄過的顏色找最接近的一個並記住，避免每次重算。 */
  private indexOf(rgb: number): number {
    const hit = this.lookup.get(rgb)
    if (hit !== undefined) return hit

    const r = (rgb >> 16) & 0xff
    const g = (rgb >> 8) & 0xff
    const b = rgb & 0xff
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < this.top.length; i++) {
      const c = this.top[i]
      const dr = r - ((c >> 16) & 0xff)
      const dg = g - ((c >> 8) & 0xff)
      const db = b - (c & 0xff)
      const d = dr * dr + dg * dg + db * db
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    this.lookup.set(rgb, best)
    return best
  }
}

function header(width: number, height: number): Bytes {
  const b = new Uint8Array(13)
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // "GIF89a"
  writeU16(b, 6, width)
  writeU16(b, 8, height)
  b[10] = 0xf7 // 有全域調色盤、256 色
  b[11] = 0 // 背景色索引
  b[12] = 0 // 像素長寬比
  return b
}

/** NETSCAPE2.0 擴充：無限循環。 */
function netscapeLoop(): Bytes {
  return new Uint8Array([
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01,
    0x00, 0x00, 0x00,
  ])
}

function graphicControl(delayMs: number, transparent: boolean): Bytes {
  const b = new Uint8Array(8)
  b[0] = 0x21
  b[1] = 0xf9
  b[2] = 0x04
  // 保留(3) | disposal=1 不清除(3) | 使用者輸入(1) | 透明旗標(1)
  b[3] = transparent ? 0x05 : 0x04
  writeU16(b, 4, Math.max(1, Math.round(delayMs / 10))) // 單位是 1/100 秒
  b[6] = TRANSPARENT
  b[7] = 0
  return b
}

function imageDescriptor(width: number, height: number): Bytes {
  const b = new Uint8Array(10)
  b[0] = 0x2c
  writeU16(b, 1, 0)
  writeU16(b, 3, 0)
  writeU16(b, 5, width)
  writeU16(b, 7, height)
  b[9] = 0 // 無區域調色盤、非交錯
  return b
}

/** 畫面沒變時不新增影格，直接把上一張的 delay 加上去。 */
function extendDelay(chunks: Bytes[], delayMs: number): void {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i]
    if (c.length === 8 && c[0] === 0x21 && c[1] === 0xf9) {
      const add = Math.max(1, Math.round(delayMs / 10))
      writeU16(c, 4, Math.min(0xffff, (c[4] | (c[5] << 8)) + add))
      return
    }
  }
}

function writeU16(b: Bytes, at: number, v: number): void {
  b[at] = v & 0xff
  b[at + 1] = (v >> 8) & 0xff
}

/** GIF 版本的 LZW，輸出已切成 255 位元組的子區塊。 */
function lzw(minCodeSize: number, data: Bytes): Bytes {
  const clear = 1 << minCodeSize
  const eoi = clear + 1
  const bytes: number[] = []
  let dict = new Map<number, number>()
  let codeSize = minCodeSize + 1
  let next = eoi + 1
  let acc = 0
  let accBits = 0

  const emit = (code: number) => {
    acc |= code << accBits
    accBits += codeSize
    while (accBits >= 8) {
      bytes.push(acc & 0xff)
      acc >>= 8
      accBits -= 8
    }
  }

  emit(clear)
  let prefix = data[0]

  for (let i = 1; i < data.length; i++) {
    const k = data[i]
    const key = (prefix << 8) | k
    const found = dict.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    dict.set(key, next++)
    if (next === 4096) {
      emit(clear)
      dict = new Map()
      next = eoi + 1
      codeSize = minCodeSize + 1
    } else if (next === (1 << codeSize) + 1 && codeSize < 12) {
      // +1 是必要的：編碼器每送出一個碼就新增一筆字典，解碼器卻是從第二個碼
      // 才開始新增，字典永遠差一筆。少了這個 +1 會提早升位、與解碼器失同步。
      codeSize++
    }
    prefix = k
  }

  emit(prefix)
  emit(eoi)
  if (accBits > 0) bytes.push(acc & 0xff)

  // 切成子區塊：每塊前面放長度，最後以 0 收尾
  const out: number[] = [minCodeSize]
  for (let i = 0; i < bytes.length; i += 255) {
    const block = bytes.slice(i, i + 255)
    out.push(block.length, ...block)
  }
  out.push(0)
  return new Uint8Array(out)
}
