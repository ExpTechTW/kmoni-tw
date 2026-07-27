// 底圖、資料圖、圖例都是 756×648，逐像素對齊，直接疊放。
import taiwan from '@/assets/taiwan.webp'
import taiwanDark from '@/assets/taiwan_dark.webp'
import taiwanFocus from '@/assets/taiwan_focus.webp'
import taiwanFocusDark from '@/assets/taiwan_focus_dark.webp'
// 三種模式的色階各不相同，圖例各有一套；sv 六個頻率共用同一張。
import tremInt from '@/assets/trem/legend_int.webp'
import tremPga from '@/assets/trem/legend_pga.webp'
import tremPgv from '@/assets/trem/legend_pgv.webp'
import tremPgd from '@/assets/trem/legend_pgd.webp'
import tremSv from '@/assets/trem/legend_sv.webp'
import nearInt from '@/assets/near/legend_int.webp'
import nearPga from '@/assets/near/legend_pga.webp'
import nearPgv from '@/assets/near/legend_pgv.webp'
import cwaInt from '@/assets/cwa/legend_int.webp'
import cwaPga from '@/assets/cwa/legend_pga.webp'
import cwaPgv from '@/assets/cwa/legend_pgv.webp'
import cwaPgd from '@/assets/cwa/legend_pgd.webp'
import cwaSv from '@/assets/cwa/legend_sv.webp'

/** 即時影像。 */
const LIVE_API = 'https://api.lb.exptech.dev/api/v1/kmoni-tw/'

/** 重播影像在另一個網域（封存站）。 */
const REPLAY_API = 'https://static.core-tnn1.exptech.dev/api/v1/kmoni-tw/'

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

/**
 * 觀測深度。只有 CWA 有井下資料，端點以 -b 結尾（int / int-b）。
 * 拆成獨立選項而不是灌進圖層清單，否則 10 個量測會變成 20 項難以瀏覽。
 */
export const DEPTHS = [
  { key: 'surface', label: '地表', suffix: '' },
  { key: 'borehole', label: '井下', suffix: '-b' },
] as const

/**
 * 觀測模式與其圖層。兩種模式共用同一組 REGIONS，但走不同的路徑前綴：
 * 即時走 trem-img、近即時走 img。兩邊的圖層 key 會重複（都有 int/pga/pgv），
 * 這是刻意的 —— 切換模式時可以停在同一個物理量上。
 *
 * ready=false 代表後端還沒有這個端點。實測 trem-img/* 全部 404、img/{int,pga,pgv}
 * 回 200，所以目前只有近即時可用。UI 會停用未就緒者 —— 災害工具不該讓人點下去
 * 只得到「無法連線」。後端上線後把 ready 改成 true 即可。
 */
export const MODES = [
  {
    key: 'realtime',
    label: '即時',
    path: 'trem-img',
    // 指示燈顏色，讓人一眼看出畫面上是哪一種資料
    tone: 'live',
    depths: false,
    live: true,
    hasLevel: true,
    status: null,
    // 即時目前沒有封存，時間軸整組停用（lagSec 用不到）。
    replay: false,
    lagSec: 0,
    layers: [
      { key: 'int', label: '即時震度', legend: tremInt, ready: true },
      { key: 'pga', label: '最大加速度', legend: tremPga, ready: true },
      { key: 'pgv', label: '最大速度', legend: tremPgv, ready: true },
      { key: 'pgd', label: '最大位移', legend: tremPgd, ready: true },
      // sv 系列都是「速度應答」，只是頻率不同，沒有獨立的速度應答圖層；
      // 標籤一定要帶上「速度應答」，只寫頻率看不出是什麼。六個共用同一張圖例。
      { key: 'sv0125', label: '0.125Hz 速度應答', legend: tremSv, ready: true },
      { key: 'sv025', label: '0.25Hz 速度應答', legend: tremSv, ready: true },
      { key: 'sv05', label: '0.5Hz 速度應答', legend: tremSv, ready: true },
      { key: 'sv1', label: '1.0Hz 速度應答', legend: tremSv, ready: true },
      { key: 'sv2', label: '2.0Hz 速度應答', legend: tremSv, ready: true },
      { key: 'sv4', label: '4.0Hz 速度應答', legend: tremSv, ready: true },
    ],
  },
  {
    key: 'cwa',
    label: 'CWA',
    path: 'cwa-img',
    tone: 'cwa',
    // 只有 CWA 有井下
    depths: true,
    // 沒有即時端點，一律以時刻播放；可用區間由 status 提供而非以「現在」推算。
    live: false,
    hasLevel: false,
    status: 'https://api.core-tnn1.exptech.dev/api/v1/kmoni-tw/cwa-img/status',
    replay: true,
    // CWA：最新不得超過 now−95 分（實際再與 available_until 取較舊者）
    lagSec: 95 * 60,
    layers: [
      { key: 'int', label: '震度', legend: cwaInt, ready: true },
      { key: 'pga', label: '最大加速度', legend: cwaPga, ready: true },
      { key: 'pgv', label: '最大速度', legend: cwaPgv, ready: true },
      { key: 'pgd', label: '最大位移', legend: cwaPgd, ready: true },
      { key: 'sv0125', label: '0.125Hz 速度應答', legend: cwaSv, ready: true },
      { key: 'sv025', label: '0.25Hz 速度應答', legend: cwaSv, ready: true },
      { key: 'sv05', label: '0.5Hz 速度應答', legend: cwaSv, ready: true },
      { key: 'sv1', label: '1.0Hz 速度應答', legend: cwaSv, ready: true },
      { key: 'sv2', label: '2.0Hz 速度應答', legend: cwaSv, ready: true },
      { key: 'sv4', label: '4.0Hz 速度應答', legend: cwaSv, ready: true },
    ],
  },
  {
    key: 'near',
    label: '近即時',
    path: 'img',
    tone: 'near',
    depths: false,
    live: true,
    hasLevel: true,
    status: null,
    replay: true,
    // 近即時：入庫緩衝，實測會浮動（量過 113～528 秒）
    lagSec: 120,
    layers: [
      { key: 'int', label: '近即時震度', legend: nearInt, ready: true },
      { key: 'pga', label: '最大加速度', legend: nearPga, ready: true },
      { key: 'pgv', label: '最大速度', legend: nearPgv, ready: true },
    ],
  },
] as const

export type Region = (typeof REGIONS)[number]
export type RegionKey = Region['key']
export type Mode = (typeof MODES)[number]
export type ModeKey = Mode['key']
export type Layer = Mode['layers'][number]
export type LayerKey = Layer['key']
export type Depth = (typeof DEPTHS)[number]
export type DepthKey = Depth['key']
export type Theme = 'light' | 'dark'

/**
 * 入庫緩衝寫在各模式的 lagSec：比「現在 − lagSec」更新的時刻封存還沒寫進去，
 * 時間軸右端因此停在那裡，否則右邊那一段永遠只會顯示「此時間無資料」。
 *
 * CWA 與近即時的落後幅度差很多（95 分 vs 約 2 分），所以分開設定而不共用常數。
 * CWA 另外還會與 status 的 available_until 取較舊者。
 */

/** 從緩衝點再往回算的可回溯長度。實測封存正好保留 48 小時（72 小時已 404）。 */
export const REPLAY_WINDOW_SEC = 48 * 60 * 60

/**
 * 時間軸微調的級距。48 小時攤在滑桿上是每像素約 350 秒，
 * 光靠拖曳選不到特定時刻，一定要有這排按鈕才實用。
 */
export const REPLAY_NUDGES = [
  { sec: -3600, label: '−1時' },
  { sec: -600, label: '−10分' },
  { sec: -60, label: '−1分' },
  { sec: -10, label: '−10秒' },
  { sec: -1, label: '−1秒' },
  { sec: 1, label: '+1秒' },
  { sec: 10, label: '+10秒' },
  { sec: 60, label: '+1分' },
  { sec: 600, label: '+10分' },
  { sec: 3600, label: '+1時' },
] as const

/** 播放時每幀前進 1 秒，間隔 1 秒 —— 與實際時間同速。 */
export const REPLAY_STEP_SEC = 1
export const REPLAY_FRAME_MS = 1000

export const REGION_KEYS = REGIONS.map((r) => r.key)
export const MODE_KEYS = MODES.map((m) => m.key)
export const DEPTH_KEYS = DEPTHS.map((d) => d.key)
export const LAYER_KEYS = MODES.flatMap((m) => m.layers.map((l) => l.key))

export function depthOf(key: DepthKey): Depth {
  return DEPTHS.find((d) => d.key === key) ?? DEPTHS[0]
}

export function regionOf(key: RegionKey): Region {
  return REGIONS.find((r) => r.key === key) ?? REGIONS[0]
}

/** 有任何一個圖層可用，這個模式才選得下去。 */
export function modeReady(mode: Mode): boolean {
  return mode.layers.some((l) => l.ready)
}

/**
 * 把「記住的模式」對應到真的能用的模式。目前 trem-img 尚未上線，
 * 所以即使偏好或預設是「即時」，也會自動退到「近即時」。
 * 後端一上線就會自動改用偏好的模式，不必改程式。
 */
export function resolveMode(key: string): Mode {
  return MODES.find((m) => m.key === key && modeReady(m)) ?? MODES.find(modeReady) ?? MODES[0]
}

/**
 * 把「記住的圖層」對應到目前模式底下真的能用的圖層。
 * 換模式、或記住的偏好已失效時，退回該模式第一個可用的圖層。
 */
export function resolveLayer(mode: Mode, key: string): Layer {
  const layers: readonly Layer[] = mode.layers
  return (
    layers.find((l) => l.key === key && l.ready) ?? layers.find((l) => l.ready) ?? layers[0]
  )
}

export function basemapOf(region: Region, theme: Theme): string {
  return theme === 'dark' && region.darkBasemap ? region.darkBasemap : region.basemap
}

/**
 * 影像網址。at 為 null 代表即時影像，否則是該 unix 秒的重播影像。
 * focus 區域一律帶 ?focus=1，即時與重播一致；資料圖不分深淺色，與 theme 無關。
 */
export function frameUrl(
  mode: Mode,
  layer: LayerKey,
  region: Region,
  at: number | null,
  depth: DepthKey,
): string {
  // 有井下資料的模式才加後綴，其餘忽略深度選擇。
  const name = mode.depths ? layer + depthOf(depth).suffix : layer
  const focus = region.focus ? '?focus=1' : ''

  if (at !== null) return `${REPLAY_API}${mode.path}/${name}/${at}${focus}`
  // 沒有即時端點的模式在時刻定案前不該送出任何請求（否則會打到不存在的即時網址）
  if (!mode.live) return ''
  return `${LIVE_API}${mode.path}/${name}${focus}`
}



/**
 * focus 底圖的執行時來源。
 *
 * focus 區域的中心會隨觀測熱點調整，底圖跟著重產；打包進 bundle 的是建置當下那一份，
 * 長時間開著的頁面會出現底圖與資料圖對不上的情況。因此改成定時比對 info.json 裡的
 * 雜湊，有變才從 raw 重抓。抓不到時（離線、GitHub 不通）沿用 bundle 內的底圖。
 */
const RAW = 'https://raw.githubusercontent.com/ExpTechTW/kmoni-tw/main'

export const INFO_URL = `${RAW}/info.json`

/** 每 10 分鐘比對一次雜湊。 */
export const BASEMAP_REFRESH_MS = 10 * 60 * 1000

export function focusBasemapUrl(theme: Theme, hash: string): string {
  const name = theme === 'dark' ? 'taiwan_focus_dark' : 'taiwan_focus'
  // 雜湊帶在 query，內容一換網址就換，瀏覽器不會拿到舊的快取。
  return `${RAW}/src/assets/${name}.webp?h=${hash}`
}

/** 震動等級（純文字數字）。跟著模式走，路徑前綴與影像相同。 */
export function levelUrl(mode: Mode, at: number | null): string {
  return at === null
    ? `${LIVE_API}${mode.path}/level`
    : `${REPLAY_API}${mode.path}/level/${at}`
}

export type LevelTone = 'blue' | 'green' | 'yellow' | 'orange' | 'red'

/** 震動等級分級：由高到低比對，第一個符合的就是該級。 */
const LEVEL_STEPS: { min: number; tone: LevelTone }[] = [
  { min: 1500, tone: 'red' },
  { min: 500, tone: 'orange' },
  { min: 250, tone: 'yellow' },
  { min: 30, tone: 'green' },
  { min: 0, tone: 'blue' },
]

export function levelTone(level: number): LevelTone {
  return LEVEL_STEPS.find((s) => level >= s.min)?.tone ?? 'blue'
}
