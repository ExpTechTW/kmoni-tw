// 底圖、資料圖、圖例都是 756×648，逐像素對齊，直接疊放。
import taiwan from '@/assets/taiwan.webp'
import taiwanDark from '@/assets/taiwan_dark.webp'
import taiwanFocus from '@/assets/taiwan_focus.webp'
import taiwanFocusDark from '@/assets/taiwan_focus_dark.webp'
import legendInt from '@/assets/legend_int.webp'
import legendPga from '@/assets/legend_pga.webp'
import legendPgv from '@/assets/legend_pgv.webp'

/** 即時影像。 */
const LIVE_API = 'https://api.lb.exptech.dev/api/v1/kmoni-tw/img/'

/** 重播影像在另一個網域（封存站）。 */
const REPLAY_API = 'https://static.core-tnn1.exptech.dev/api/v1/kmoni-tw/img/'

/**
 * 觀測區域。之後要增減區域只要改這個陣列，UI 與型別都會跟著長出來。
 *
 * focus=true 的區域會在網址加上 ?focus=1，由後端渲染放大後的視野；
 * darkBasemap 留空時，深色模式會沿用同一張底圖。
 */
export const REGIONS = [
  { key: 'all', label: '全國', focus: false, basemap: taiwan, darkBasemap: taiwanDark },
  {
    key: 'chianan',
    label: '嘉南地區',
    focus: true,
    basemap: taiwanFocus,
    darkBasemap: taiwanFocusDark,
  },
] as const

export const LAYERS = [
  { key: 'int', label: '計測震度', legend: legendInt },
  { key: 'pga', label: 'PGA', legend: legendPga },
  { key: 'pgv', label: 'PGV', legend: legendPgv },
] as const

export type Region = (typeof REGIONS)[number]
export type RegionKey = Region['key']
export type LayerKey = (typeof LAYERS)[number]['key']
export type Theme = 'light' | 'dark'

/** 重播可回溯的長度：距今 2 小時。 */
export const REPLAY_WINDOW_SEC = 2 * 60 * 60

/**
 * 封存落後現在約 6～7 分鐘（實測 now-400 秒才開始有資料），
 * 比這更新的時刻取不到影像，所以時間軸右端就停在這裡。
 */
export const REPLAY_LAG_SEC = 420

/** 播放時每幀前進 1 秒，間隔 1 秒 —— 與實際時間同速。 */
export const REPLAY_STEP_SEC = 1
export const REPLAY_FRAME_MS = 1000

export const REGION_KEYS = REGIONS.map((r) => r.key)
export const LAYER_KEYS = LAYERS.map((l) => l.key)

export function regionOf(key: RegionKey): Region {
  return REGIONS.find((r) => r.key === key) ?? REGIONS[0]
}

export function basemapOf(region: Region, theme: Theme): string {
  return theme === 'dark' && region.darkBasemap ? region.darkBasemap : region.basemap
}

/**
 * 影像網址。at 為 null 代表即時影像，否則是該 unix 秒的重播影像。
 * 資料圖不分深淺色，所以與 theme 無關。
 *
 * 封存站不吃 ?focus=1（帶不帶回傳的位元組完全相同），所以重播一律是全國視野；
 * 呼叫端請用 shownRegion() 取得對應的底圖，底圖才不會和資料圖對不起來。
 */
export function frameUrl(layer: LayerKey, region: Region, at: number | null): string {
  if (at !== null) return `${REPLAY_API}${layer}/${at}`
  return region.focus ? `${LIVE_API}${layer}?focus=1` : LIVE_API + layer
}

/** 重播時實際呈現的區域：封存只有全國視野。 */
export function shownRegion(region: Region, at: number | null): Region {
  return at === null ? region : REGIONS[0]
}
