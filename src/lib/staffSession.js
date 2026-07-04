// Staff ล็อกอินด้วย PIN 4 หลัก (ไม่ใช่ Supabase Auth จริง) — เก็บ session ไว้ใน localStorage
// นี่คือ "screen gate" ระดับ UI เท่านั้น ไม่ใช่การป้องกันระดับฐานข้อมูล
const STORAGE_KEY = 'mytour_staff_session'

export function saveStaffSession(staff) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(staff))
  } catch {
    // localStorage อาจถูกบล็อก (private mode) — เงียบไว้ ผู้ใช้แค่ต้อง login ใหม่
  }
}

export function getStaffSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearStaffSession() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}
