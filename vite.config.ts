import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // 相對路徑，讓同一份 dist 在 user page、project page 子路徑
  // 或自訂網域下都能直接運作，不必為 GitHub Pages 另外設定 base。
  base: './',

  // GIF 編輯器是獨立的一頁：兩個入口各自打包，編輯器（含 GIF 解碼器）
  // 的程式碼不會進到首頁的 chunk，首頁載入量完全不受影響。
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        editor: path.resolve(import.meta.dirname, 'editor.html'),
      },
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
