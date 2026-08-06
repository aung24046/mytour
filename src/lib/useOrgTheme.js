// โหลดธีมของบริษัทแล้วฉีดเข้า <html>
//
// ฝั่งลูกทัวร์: orgId มาจาก TourContext (resolve จาก join_code ใน URL)
// ฝั่งทีมงาน:  orgId มาจาก staffSession
//
// ลำดับการทำงาน (สำคัญ — กันสีกระพริบ):
//   1. มี orgId ปุ๊บ → ฉีดจาก cache ในเครื่องทันที ไม่รอเน็ต
//   2. ยิง DB ไปเงียบๆ ได้ผลแล้วค่อยฉีดทับ + อัปเดต cache
//
// ถ้าข้ามขั้นที่ 1 ผู้ใช้จะเห็นสีฟ้าเริ่มต้นแวบนึงแล้วเด้งเป็นสีบริษัท
// ซึ่งดูเหมือนแอปพัง โดยเฉพาะบนเน็ตช้าระหว่างเดินทาง

import { useEffect } from 'react'

import { supabase } from './supabase'
import { useMode } from './colorMode'
import { applyThemeTokens, resolveTheme, cacheTheme, loadCachedTheme } from './themes'

export function useOrgTheme(orgId) {
  // ⚠️ ต้องคำนวณเฉดใหม่ทุกครั้งที่สลับโหมด
  //    inline style ที่เราฉีดชนะกฎ :root[data-mode='dark'] ใน stylesheet เสมอ
  //    ถ้าไม่ฉีดใหม่ โหมดมืดจะได้เฉดแบรนด์ของโหมดสว่างค้างอยู่
  const mode = useMode()

  useEffect(() => {
    if (!orgId) return
    let alive = true

    // ── 1. cache ก่อน — ฉีดทันทีแบบ synchronous ──────────────────
    const cached = loadCachedTheme(orgId)
    if (cached) applyThemeTokens(resolveTheme(cached, mode).tokens)

    // ── 2. ค่าจริงจาก DB ─────────────────────────────────────────
    supabase
      .from('organizations')
      .select('theme_preset, theme_brand_color')
      .eq('id', orgId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          // ออฟไลน์หรือ query พัง — ถ้ามี cache อยู่แล้วก็ใช้ต่อไป ไม่ต้องทำอะไร
          // ไม่ปล่อยให้แอปกลับไปสีเริ่มต้น เพราะนั่นดูเหมือนแอปพังยิ่งกว่า
          if (!cached) console.warn('[useOrgTheme] โหลดธีมไม่สำเร็จ ใช้สีเริ่มต้น', error)
          return
        }
        if (!data) return
        applyThemeTokens(resolveTheme(data, mode).tokens)
        cacheTheme(orgId, data)
      })

    return () => {
      alive = false
    }
  }, [orgId, mode])
}
