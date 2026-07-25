import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import '@/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 只在正式站台註冊：開發時掛 Service Worker 容易拿到舊資源，除錯會很痛苦。
// 用相對路徑，才能跟 base: './' 一樣在任何子路徑下運作。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 註冊失敗只是少了快取，不影響監視功能
    })
  })
}
