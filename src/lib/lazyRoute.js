import { lazy } from 'react'

// โหลดหน้าแบบ lazy ให้ทนกับ "แอปถูก deploy ใหม่ระหว่างที่แท็บนี้เปิดค้างอยู่"
//
// ★ 12 ก.ย. 2026 เจ้าของโปรเจกต์เจอหน้างาน: กด "เข้าไปคุม" ของเกมเปิดแผ่นป้ายแล้วจอขาว
//     Failed to load module script ... MIME type of "text/html"
//     TypeError: Failed to fetch dynamically imported module: /assets/TilesHost-BNnrkORX.js
//
//   เกิดอะไรขึ้น: ทุกครั้งที่ deploy ใหม่ ชื่อไฟล์ chunk เปลี่ยนตามเนื้อหา (…-BNnrkORX.js)
//   ไฟล์ชุดเก่าถูกลบออกจากโฮสต์ทันที แต่แท็บที่เปิดค้างไว้ (หรือ index.html ที่ service worker
//   เก็บไว้) ยังอ้างชื่อไฟล์ชุดเก่าอยู่ พอกดเข้าหน้าที่เป็น lazy ครั้งแรกหลัง deploy
//   เบราว์เซอร์จึงขอไฟล์ที่ไม่มีแล้ว — Vercel ตอบ index.html กลับมา (SPA fallback)
//   เบราว์เซอร์เห็นว่าเป็น text/html ไม่ใช่ JavaScript ก็ปฏิเสธ แล้วหน้าก็ค้างขาว
//
//   ทำไมเจอที่เกมเปิดแผ่นป้าย: หน้าเกมฝั่งทีมงานทั้งหมดเป็น lazy (ดู App.jsx)
//   เกมไหนที่เปิดหลัง deploy เป็นเกมแรกก็เจอเกมนั้น ไม่ได้เกี่ยวกับตัวเกม
//
//   ทางแก้: จับ error ตรงนี้แล้ว "ล้างแคชของ service worker + โหลดหน้าใหม่หนึ่งครั้ง"
//   ผู้ใช้จะเห็นแค่หน้ากระพริบแล้วเข้าได้ตามปกติ ไม่ต้องรู้จักคำว่าล้างแคช
//   กันวนลูปด้วยเวลา: ถ้าเพิ่งรีโหลดไปไม่ถึง 20 วิ จะโยน error ต่อให้ RouteBoundary ขึ้นปุ่มให้กดเอง

const RELOAD_KEY = 'mytour.chunk.reloadedAt'
const RELOAD_GUARD_MS = 20000

function lastReloadAt() {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
  } catch {
    return 0
  }
}

/** ล้าง precache ของ service worker แล้วโหลดหน้าใหม่ — ต้องล้างก่อน ไม่งั้นได้ index.html เก่ากลับมาอีก */
export async function reloadForNewVersion() {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    /* โหมดส่วนตัวเขียนไม่ได้ — ยอมเสี่ยงรีโหลดซ้ำดีกว่าค้างจอขาว */
  }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map((r) => r.update().catch(() => {})))
  } catch {
    /* ล้างไม่ได้ก็ยังรีโหลดต่อ — ส่วนใหญ่ได้ไฟล์ใหม่จากเน็ตอยู่ดี */
  }
  window.location.reload()
}

/** ใช้แทน React.lazy สำหรับหน้าที่โหลดตอนเปิดใช้ */
export function lazyRoute(factory) {
  return lazy(() =>
    factory().catch((err) => {
      if (Date.now() - lastReloadAt() > RELOAD_GUARD_MS) {
        reloadForNewVersion()
        // ค้าง promise ไว้เฉยๆ ระหว่างรอหน้ารีโหลด — อย่าโยน error ให้จอแดงแวบ
        return new Promise(() => {})
      }
      throw err
    })
  )
}
