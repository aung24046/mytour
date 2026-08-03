// เช็คลิสต์เตรียมข้อมูลโรงแรม — จัดกลุ่มตาม "ตอนไหนต้องใช้" ไม่ใช่ "เป็นข้อมูลประเภทไหน"
//
// เหตุผล: ทีมงานกรอกข้อมูลเป็นรอบตามจังหวะงาน (ยืนยันจองล่วงหน้า → ถึงหน้างานค่อยได้เวลาจริง)
// การเรียงตามไทม์ไลน์จึงตรงกับลำดับที่ข้อมูลเข้ามาจริง และทำให้รู้ว่า "ตอนนี้ยังขาดอะไร"
//
// requiredFields = ไม่มีแล้วทริปมีปัญหาจริง (นับในแถบความพร้อม)
// fields         = ทุกช่องที่ editor ของรายการนั้นเปิดให้แก้ (รวมช่องเสริม)
//
// ปรับได้ที่เดียว: ถ้าบริษัทมองว่าอะไรจำเป็น/ไม่จำเป็นต่างจากนี้ แก้ requiredFields พอ

import { normalizeList } from './hotelFacilities'
import { toTimeInput } from './timeFormat'

function hasText(value) {
  return value != null && String(value).trim() !== ''
}

export const PHASES = [
  {
    key: 'prep',
    icon: 'luggage',
    items: [
      { key: 'dates', icon: 'calendar', fields: ['check_in_date', 'check_out_date'], requiredFields: ['check_in_date', 'check_out_date'] },
      { key: 'booking', icon: 'fileText', fields: ['booking_ref', 'supplier_id'], requiredFields: ['booking_ref'] },
      { key: 'address', icon: 'location', fields: ['address', 'address_local', 'map_url'], requiredFields: ['address'] },
      { key: 'phone', icon: 'phone', fields: ['phone'], requiredFields: ['phone'] },
    ],
  },
  {
    key: 'checkin',
    icon: 'key',
    items: [
      { key: 'checkInTime', icon: 'clock', fields: ['check_in_time'], requiredFields: ['check_in_time'] },
      { key: 'meetingPoint', icon: 'bus', fields: ['meeting_point'], requiredFields: [] },
    ],
  },
  {
    key: 'stay',
    icon: 'bed',
    items: [
      { key: 'wifi', icon: 'wifi', fields: ['wifi_name', 'wifi_password'], requiredFields: ['wifi_password'] },
      { key: 'breakfast', icon: 'coffee', fields: ['breakfast_time', 'breakfast_location'], requiredFields: ['breakfast_time'] },
      { key: 'dinner', icon: 'cutlery', fields: ['dinner_time', 'dinner_location'], requiredFields: [] },
      { key: 'facilities', icon: 'star', fields: ['facilities', 'room_amenities', 'power_plug'], requiredFields: [] },
      { key: 'guestNote', icon: 'message', fields: ['general_info'], requiredFields: [] },
    ],
  },
  {
    key: 'checkout',
    icon: 'door',
    items: [
      { key: 'checkoutTime', icon: 'clock', fields: ['checkout_time'], requiredFields: ['checkout_time'] },
      { key: 'wakeUp', icon: 'alarm', fields: ['morning_call', 'luggage_time'], requiredFields: [] },
    ],
  },
  {
    key: 'internal',
    icon: 'lock',
    staffOnly: true,
    items: [{ key: 'staffNotes', icon: 'notes', fields: ['staff_notes'], requiredFields: [] }],
  },
]

export const ALL_ITEMS = PHASES.flatMap((p) => p.items.map((i) => ({ ...i, phase: p.key })))

export function itemByKey(key) {
  return ALL_ITEMS.find((i) => i.key === key) ?? null
}

/** ฟิลด์ของรายการนี้มีค่าอยู่กี่ช่อง — jsonb นับว่า "มี" เมื่อมีอย่างน้อย 1 รายการ */
function filledCount(hotel, fields) {
  return fields.filter((f) => {
    const value = hotel?.[f]
    if (f === 'facilities' || f === 'room_amenities') return normalizeList(value).length > 0
    return hasText(value)
  }).length
}

/**
 * สถานะของรายการหนึ่ง
 *   'done'     — ช่องจำเป็นครบแล้ว (หรือเป็นรายการไม่บังคับที่กรอกแล้ว)
 *   'missing'  — จำเป็นแต่ยังขาด
 *   'optional' — ไม่บังคับและยังว่าง
 */
export function itemStatus(hotel, item) {
  const required = item.requiredFields.length > 0
  if (required) {
    const missing = item.requiredFields.filter((f) => !hasText(hotel?.[f]))
    return missing.length === 0 ? 'done' : 'missing'
  }
  return filledCount(hotel, item.fields) > 0 ? 'done' : 'optional'
}

/** ความพร้อมนับเฉพาะรายการที่จำเป็น — ช่องเสริมที่ว่างไม่ควรทำให้ดูเหมือนงานยังไม่เสร็จ */
export function readiness(hotel) {
  const requiredItems = ALL_ITEMS.filter((i) => i.requiredFields.length > 0)
  const done = requiredItems.filter((i) => itemStatus(hotel, i) === 'done').length
  return {
    done,
    total: requiredItems.length,
    ready: done === requiredItems.length,
    missingItems: requiredItems.filter((i) => itemStatus(hotel, i) !== 'done').map((i) => i.key),
  }
}

/** ข้อความสรุปค่าปัจจุบันของรายการ ใช้โชว์ท้ายแถว — คืน '' ถ้ายังไม่มีอะไรเลย */
export function itemPreview(hotel, item, t) {
  const parts = []
  for (const field of item.fields) {
    const value = hotel?.[field]
    if (field === 'facilities' || field === 'room_amenities') {
      const n = normalizeList(value).length
      if (n > 0) parts.push(t('staff.roomMap.itemsCount', { count: n }))
      continue
    }
    if (field === 'supplier_id') continue
    if (!hasText(value)) continue
    if (
      field.endsWith('_time') ||
      field === 'morning_call' ||
      field === 'luggage_time' ||
      field === 'checkout_time'
    ) {
      parts.push(toTimeInput(value) || String(value))
      continue
    }
    parts.push(String(value).replace(/\s+/g, ' ').trim())
  }
  const text = parts.join(' · ')
  return text.length > 42 ? `${text.slice(0, 42)}…` : text
}
