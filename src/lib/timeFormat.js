// รูปแบบเวลากลางของระบบ — เก็บลงฐานข้อมูลเป็นสตริง 'HH:MM' แบบ 24 ชั่วโมงเสมอ
//
// เหตุผลที่ต้องมีไฟล์นี้: <input type="time"> รับและคืนค่าเป็น 'HH:MM' เท่านั้น
// ถ้าโหลดค่าที่ไม่ตรงรูปแบบเข้าไป (เช่น '08:00 AM' ที่ทีมงานเคยพิมพ์มือไว้)
// ช่องจะแสดงว่างโดยไม่เตือน แล้วค่าเดิมจะหายทันทีที่กดบันทึกครั้งถัดไป
// จึงต้องกรองผ่าน toTimeInput() ทุกครั้งที่ดึงค่าจากฐานข้อมูลมาใส่ฟอร์ม

/** true ถ้าเป็น 'HH:MM' 24 ชั่วโมงที่ถูกต้อง */
export function isTimeValue(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

/**
 * แปลงข้อความเวลาแบบอิสระให้เป็น 'HH:MM' สำหรับใส่ใน <input type="time">
 * คืน '' ถ้าอ่านไม่ออก — ปล่อยให้ช่องว่างดีกว่าโยนค่าที่ input ไม่รับเข้าไป
 * รองรับ: '06:30', '6.30', '08:00 AM', '12:00 PM', 'ุ06:30 AM' (มีอักขระหลงหน้า), '0630'
 */
export function toTimeInput(raw) {
  if (raw == null) return ''
  const text = String(raw).trim()
  if (!text) return ''
  if (isTimeValue(text)) return text

  let match = text.match(/(\d{1,2})\s*[:.]\s*(\d{2})/)
  if (!match) match = text.match(/^\D*(\d{1,2})(\d{2})\D*$/)
  if (!match) return ''

  let hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return ''

  const isPm = /p\.?\s*m/i.test(text)
  const isAm = /a\.?\s*m/i.test(text)
  if (isPm && hour < 12) hour += 12
  if (isAm && hour === 12) hour = 0
  if (hour > 23) return ''

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** ค่าที่จะเขียนลงฐานข้อมูล — null เมื่อว่าง เพื่อไม่ให้มีสตริงว่างปนกับ null */
export function toTimeStorage(raw) {
  return toTimeInput(raw) || null
}

/** แสดงช่วงเวลาเปิด-ปิด เช่น '06:00–22:00' / '06:00 เป็นต้นไป' (มีแค่ค่าเดียวก็แสดงได้) */
export function formatTimeRange(from, to) {
  const start = toTimeInput(from)
  const end = toTimeInput(to)
  if (start && end) return `${start}–${end}`
  return start || end || ''
}
