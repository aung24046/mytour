// ลูกทัวร์ไม่ต้อง login — จำ guest_id ปัจจุบันไว้ใน localStorage หลังลงทะเบียน
// เพื่อให้หน้า MyQR / Itinerary / Bingo / ShareLocation รู้ว่า "ฉันคือใคร"
const STORAGE_KEY = 'mytour_guest_id'

export function saveGuestId(guestId) {
  try {
    localStorage.setItem(STORAGE_KEY, guestId)
  } catch {
    // localStorage อาจถูกบล็อก (private mode) — เงียบไว้ ผู้ใช้แค่ต้องลงทะเบียนใหม่
  }
}

export function getGuestId() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearGuestId() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}
