// 產生 info.json：記錄 focus 底圖的內容雜湊。
//
// focus 區域（嘉南地區）的中心會隨觀測熱點調整，底圖跟著重產。打包進 bundle 的
// 底圖是建置當下那一份，長時間開著的頁面不會知道底圖換了，就會出現底圖與資料圖
// 對不上的情況。因此把雜湊放進 info.json，由 client 定時比對、有變才重抓。
//
// 由 prebuild 自動執行；更新 src/assets/taiwan_focus*.webp 後記得一併提交 info.json。
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const TARGETS = {
  light: 'src/assets/taiwan_focus.webp',
  dark: 'src/assets/taiwan_focus_dark.webp',
}

const focus = {}
for (const [key, path] of Object.entries(TARGETS)) {
  focus[key] = createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
}

const out = resolve(root, 'info.json')
writeFileSync(out, JSON.stringify({ focus }, null, 2) + '\n')

for (const [key, hash] of Object.entries(focus)) {
  console.log(`info.json: focus.${key} = ${hash.slice(0, 12)}…`)
}
