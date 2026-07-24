import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // 相對路徑，讓同一份 dist 在 user page、project page 子路徑
  // 或自訂網域下都能直接運作，不必為 GitHub Pages 另外設定 base。
  base: './',

  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
