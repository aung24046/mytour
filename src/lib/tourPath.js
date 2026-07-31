// สร้าง path ฝั่งลูกทัวร์ที่มี prefix ทริปเสมอ: /t/:code/...
//
// ก่อนมี multi-tour ลิงก์เขียนตรงๆ ว่า "/itinerary"
// ตอนนี้ต้องเป็น "/t/JPN102/itinerary" ไม่งั้นข้ามไปทริปอื่นไม่ได้

/** หน้า guest ทั้งหมดที่ต้องมี prefix ทริป */
export const GUEST_ROUTES = [
  '', // Register / หน้าแรกของทริป
  'itinerary',
  'my-qr',
  'my-room',
  'my-seat',
  'bingo',
  'share-location',
  'sos',
  'trip-guide',
  'feedback',
  'edit-profile',
]

/**
 * tourPath('JPN102', 'itinerary') → '/t/JPN102/itinerary'
 * tourPath('JPN102')              → '/t/JPN102'
 * ถ้าไม่มี code (ยังโหลดไม่เสร็จ) → คืน path เดิมแบบ legacy ไม่ให้ลิงก์พัง
 */
export function tourPath(code, sub = '') {
  const clean = String(sub || '').replace(/^\/+/, '')
  if (!code) return `/${clean}`
  return clean ? `/t/${code}/${clean}` : `/t/${code}`
}

/** hook-friendly: สร้างตัวช่วยที่ผูก code ไว้แล้ว */
export function makeTourPath(code) {
  return (sub = '') => tourPath(code, sub)
}

/** ดึง join_code ออกจาก pathname — ใช้ตอนต้องรู้ code นอก Router context */
export function extractTourCode(pathname) {
  const m = /^\/t\/([^/]+)/.exec(pathname || '')
  return m ? m[1] : null
}
