// จุดนัดพบที่แนบไปกับประกาศ
//
// ที่มา: ตอนปล่อยลูกทัวร์เดินเองในที่ใหญ่ๆ จุดนัดพบถูกพูดปากเปล่าครั้งเดียว
// คนที่จำไม่ได้ไม่กล้าถาม แล้วมาสาย — หมุดที่กดเปิดแผนที่ได้แก้ตรงนี้
//
// จุดสำคัญของการออกแบบ: เราไม่ได้เก็บพิกัดของลูกทัวร์เลยสักคน
// เก็บแค่พิกัดของ "จุดนัดพบ" จุดเดียว แล้วให้โทรศัพท์ของลูกทัวร์เป็นคนคำนวณ
// ระยะทางและเวลาเดินเอง (Google Maps ทำให้ฟรีและแม่นกว่าที่เราจะทำได้)
// ได้ประโยชน์เดียวกับการตามพิกัด โดยไม่ต้องแตะข้อมูลส่วนบุคคลของใคร
//
// ทุกฟังก์ชันในไฟล์นี้เป็น pure — ไม่แตะ supabase ไม่แตะ DOM เทสต์ได้ตรงๆ

// ใส่นามสกุล .js ไว้ด้วย เพราะไฟล์นี้ถูก import ตรงๆ โดย node ตอนรันเทสต์
// (node ESM ไม่เติมนามสกุลให้เหมือน Vite) — ดู src/lib/__tests__/meet-point.test.mjs
import { parseLatLngFromMapsUrl } from './geo.js'

/** true ถ้าประกาศแถวนี้มีหมุดที่ใช้งานได้จริง */
export function hasMeetPoint(row) {
  return Number.isFinite(row?.meet_lat) && Number.isFinite(row?.meet_lng)
}

/**
 * แกะพิกัดจากสิ่งที่ทีมงานวางลงช่อง — รับได้ทั้งลิงก์ Google Maps และพิกัดดิบ
 * คืน { lat, lng } หรือ null
 *
 * รับพิกัดดิบด้วยเพราะบางทีทีมงานก็อปมาจากที่อื่น (แชท/โน้ต) ไม่ได้มาเป็นลิงก์เสมอ
 * ลิงก์ย่อ (maps.app.goo.gl) แกะไม่ได้ — ตัวมันไม่มีพิกัดอยู่ข้างใน ต้องกดเปิดก่อน
 */
export function parseMeetPointInput(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null

  const fromUrl = parseLatLngFromMapsUrl(text)
  if (fromUrl) return fromUrl

  const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/)
  if (m) {
    const lat = Number(m[1])
    const lng = Number(m[2])
    if (isValidLatLng(lat, lng)) return { lat, lng }
  }
  return null
}

export function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  )
}

/**
 * ลิงก์เปิดแผนที่ — ตั้งใจใช้ URL กลางของ Google Maps ไม่ใช่ deep link ของแอป
 * เพราะเครื่องที่ไม่มีแอปติดตั้ง (หรือ iPhone ที่ใช้ Apple Maps) จะเปิดในเบราว์เซอร์ได้เอง
 * และพอกดแล้ว Google Maps จะคำนวณ "เดินกี่นาที" จากตำแหน่งเขาให้เอง ซึ่งคือหัวใจของฟีเจอร์นี้
 */
export function meetPointMapsUrl(lat, lng) {
  if (!isValidLatLng(lat, lng)) return null
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

/** ลิงก์แบบขอเส้นทางเดิน — ใช้กับปุ่ม "นำทางไปจุดนัดพบ" */
export function meetPointDirectionsUrl(lat, lng) {
  if (!isValidLatLng(lat, lng)) return null
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`
}

/**
 * เหลืออีกกี่นาทีถึงเวลารวมพล (ติดลบ = เลยเวลามาแล้ว)
 * คืน null ถ้าไม่ได้ตั้งเวลาไว้หรือรูปแบบไม่ถูกต้อง
 *
 * คิดจากเวลาท้องถิ่นของเครื่อง ไม่ใช่ UTC — เครื่องทีมงานกับลูกทัวร์อยู่โซนเดียวกันเสมอ
 * (โทรศัพท์ตั้งโซนตามเครือข่ายท้องถิ่นให้อัตโนมัติ) ค่าจึงตรงกันทั้งสองฝั่ง
 */
export function minutesUntilMeet(meetTime, now = new Date()) {
  const m = String(meetTime ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null

  const target = new Date(now)
  target.setHours(Number(m[1]), Number(m[2]), 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 60000)
}

/**
 * ระดับความเร่งด่วนของนับถอยหลัง ไว้ให้หน้าจอเลือกสี
 * 'past' เลยเวลาแล้ว · 'soon' เหลือไม่เกิน 15 นาที · 'ok' ยังสบาย
 */
export function meetUrgency(minutesLeft) {
  if (minutesLeft == null) return null
  if (minutesLeft < 0) return 'past'
  if (minutesLeft <= 15) return 'soon'
  return 'ok'
}

/** คอลัมน์ที่ต้อง select มาด้วยทุกครั้งที่ดึงประกาศ ไม่งั้นหมุดจะหายเงียบ */
export const MEET_COLUMNS = 'meet_lat, meet_lng, meet_label, meet_time'
