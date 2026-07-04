import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

import './lib/i18n'
import './index.css'
import App from './App.jsx'

// ลงทะเบียน service worker — auto-update เงียบๆ เบื้องหลัง ไม่ต้อง prompt ผู้ใช้
// (เหมาะกับงานหน้างานที่ staff/ลูกทัวร์ไม่ควรถูกขัดจังหวะด้วย popup อัปเดต)
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
