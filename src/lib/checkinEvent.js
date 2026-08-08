// จุดเช็คอิน (checkin_events) ที่ทีมงานเลือกอยู่ — จำไว้ข้ามหน้า/ข้ามการรีเฟรช
//
// เดิม CheckIn.jsx เก็บ selectedEventId ไว้ใน state อย่างเดียว พอออกจากหน้าแล้วกลับมา
// หรือรีเฟรช ก็เด้งกลับไปจุดแรก (core) เสมอ และ Dashboard ก็เดาจุดที่ "กำลังทำ" เอง
// ทำให้สองหน้าไม่ตรงกัน — ที่นี่เก็บลง localStorage แยกตามทริป แล้วกระจายให้หน้าอื่นรู้ด้วย
// custom event (ในแท็บเดียวกัน) + storage event (ข้ามแท็บ)

const PREFIX = 'mytour_checkin_event'
const CHANGE_EVENT = 'mytour:checkin-event-change'

function storageKey(tourId) {
  return `${PREFIX}_${tourId}`
}

export function getSelectedCheckinEventId(tourId) {
  if (!tourId) return null
  try {
    return localStorage.getItem(storageKey(tourId)) || null
  } catch {
    return null
  }
}

export function setSelectedCheckinEventId(tourId, eventId) {
  if (!tourId) return
  try {
    if (eventId) localStorage.setItem(storageKey(tourId), eventId)
    else localStorage.removeItem(storageKey(tourId))
  } catch {
    // localStorage อาจถูกบล็อก — ยังใช้งานต่อได้ แค่ไม่จำข้ามรีเฟรช
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { tourId, eventId } }))
  } catch {
    // no-op
  }
}

/** ฟังการเปลี่ยนจุดเช็คอินของทริปนี้ — คืนฟังก์ชัน unsubscribe */
export function subscribeSelectedCheckinEvent(tourId, callback) {
  function handleCustom(e) {
    if (!e.detail || e.detail.tourId !== tourId) return
    callback(e.detail.eventId ?? null)
  }
  function handleStorage(e) {
    if (e.key !== storageKey(tourId)) return
    callback(e.newValue || null)
  }

  window.addEventListener(CHANGE_EVENT, handleCustom)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(CHANGE_EVENT, handleCustom)
    window.removeEventListener('storage', handleStorage)
  }
}

/**
 * เลือกจุดที่ควรใช้จริง: ถ้า id ที่จำไว้ยังมีอยู่ในรายการก็ใช้ตัวนั้น
 * ไม่งั้น fallback ไปจุดหลัก (is_core) หรือจุดแรกสุด
 */
export function resolveCheckinEventId(events, savedId) {
  if (!events || events.length === 0) return null
  if (savedId && events.some((ev) => ev.id === savedId)) return savedId
  return events.find((ev) => ev.is_core)?.id ?? events[0].id
}
