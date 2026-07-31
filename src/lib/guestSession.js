// ลูกทัวร์ไม่ต้อง login — จำ guest_id ไว้ใน localStorage หลังลงทะเบียน
// เพื่อให้หน้า MyQR / Itinerary / Bingo / ShareLocation รู้ว่า "ฉันคือใคร"
//
// multi-tour: เก็บเป็น map ต่อทริป ไม่ใช่ id เดียว
//   { "<tourId>": { guestId, savedAt }, ... }
// → เครื่องเดียวไปหลายทริปพร้อมกันได้ ไม่ทับกัน
//
// คีย์เก่า (mytour_guest_id) ถูกย้ายเข้า map อัตโนมัติครั้งแรกที่เรียก
// → ลูกทัวร์ที่ลงทะเบียนไว้แล้วไม่ต้องทำอะไรเลย

import { LEGACY_TOUR_ID } from './constants'

const STORAGE_KEY = 'mytour_guest_sessions'
const LEGACY_KEY = 'mytour_guest_id'

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const map = raw ? JSON.parse(raw) : {}
    return map && typeof map === 'object' ? map : {}
  } catch {
    // localStorage อาจถูกบล็อก (private mode) — ผู้ใช้แค่ต้องลงทะเบียนใหม่
    return {}
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // no-op
  }
}

/**
 * ย้ายคีย์เก่า mytour_guest_id → map ใต้ทริปแรกของระบบ
 * idempotent — เรียกซ้ำไม่มีผล
 */
export function migrateLegacyGuestSession() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (!legacy) return

    const map = readAll()
    if (!map[LEGACY_TOUR_ID]) {
      map[LEGACY_TOUR_ID] = { guestId: legacy, savedAt: Date.now() }
      writeAll(map)
    }
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // no-op
  }
}

export function saveGuestId(tourId, guestId) {
  if (!tourId || !guestId) return
  const map = readAll()
  map[tourId] = { guestId, savedAt: Date.now() }
  writeAll(map)
}

export function getGuestId(tourId) {
  if (!tourId) return null
  migrateLegacyGuestSession()
  return readAll()[tourId]?.guestId ?? null
}

export function clearGuestId(tourId) {
  if (!tourId) return
  const map = readAll()
  delete map[tourId]
  writeAll(map)
}

/** ล้างทุกทริป — ใช้ตอน "ออกจากระบบทั้งหมด" */
export function clearAllGuestSessions() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // no-op
  }
}

/**
 * รายการทริปที่เครื่องนี้เคยลงทะเบียน — ใช้ทำหน้า "/" เลือกทริปของฉัน
 * → [{ tourId, guestId, savedAt }] เรียงล่าสุดก่อน
 */
export function listGuestSessions() {
  migrateLegacyGuestSession()
  const map = readAll()
  return Object.entries(map)
    .map(([tourId, v]) => ({
      tourId,
      guestId: v?.guestId ?? null,
      savedAt: v?.savedAt ?? 0,
    }))
    .filter((s) => s.guestId)
    .sort((a, b) => b.savedAt - a.savedAt)
}
