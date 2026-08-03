// สิ่งอำนวยความสะดวกของโรงแรม — taxonomy กลาง ใช้ร่วมกันทั้งฝั่ง staff และ guest
//
// เก็บลง hotels.facilities / hotels.room_amenities เป็น jsonb array
// การที่ taxonomy อยู่ในโค้ด (ไม่ใช่ตารางในฐานข้อมูล) ทำให้เพิ่ม/ตัดรายการได้โดยไม่ต้อง migrate
// แต่แลกมาด้วยข้อบังคับว่า "key ห้ามเปลี่ยนหลังใช้งานจริง" เพราะข้อมูลเก่าอ้าง key ไว้แล้ว
//
// รูปแบบข้อมูล:
//   facilities:     [{ key, fee, from, to, note }]   — from/to เป็น 'HH:MM' 24 ชม.
//   room_amenities: [{ key, fee, note }]
//
// หมายเหตุ: เดิมเวลาเปิด-ปิดเก็บเป็นสตริงเดียว (hours: '06:00-22:00') ที่พิมพ์มือ
// เปลี่ยนมาเป็นสองช่องเพื่อให้ใช้ <input type="time"> ได้ และเทียบเวลาได้ในอนาคต
// readItem() ยังอ่านข้อมูลรูปแบบเดิมได้อยู่ เผื่อมีแถวที่บันทึกไว้ก่อนเปลี่ยน

import { toTimeInput } from './timeFormat'

/** ค่าที่เป็นไปได้ของ fee — '' คือไม่ระบุ */
export const FEE_VALUES = ['', 'free', 'paid']

// กลุ่ม "จำเป็น" กางไว้เป็นค่าเริ่มต้นในฟอร์ม — กลุ่มอื่นพับไว้
// เพื่อไม่ให้ทีมงานเจอกำแพง checkbox 28 ช่องตั้งแต่เปิดหน้าจอ
export const FACILITY_GROUPS = [
  {
    key: 'essential',
    defaultOpen: true,
    items: [
      // ลิฟต์สำคัญที่สุดในลิสต์ — ทัวร์ผู้สูงอายุ + โรงแรมยุโรป/ญี่ปุ่นเก่าหลายแห่งไม่มี
      { key: 'elevator', icon: 'elevator', hasHours: false },
      { key: 'laundry', icon: 'washMachine', hasHours: true },
      { key: 'pool', icon: 'swimming', hasHours: true },
      { key: 'gym', icon: 'barbell', hasHours: true },
      { key: 'luggage_storage', icon: 'luggage', hasHours: false },
      { key: 'drinking_water', icon: 'glassWater', hasHours: false },
    ],
  },
  {
    key: 'byTrip',
    defaultOpen: false,
    items: [
      { key: 'onsen', icon: 'onsen', hasHours: true },
      { key: 'spa', icon: 'spa', hasHours: true },
      { key: 'restaurant', icon: 'cutlery', hasHours: true },
      { key: 'minimart', icon: 'store', hasHours: true },
      { key: 'parking', icon: 'parking', hasHours: false },
      { key: 'bus_parking', icon: 'bus', hasHours: false },
      { key: 'smoking_area', icon: 'cigarette', hasHours: false },
      { key: 'meeting_room', icon: 'people', hasHours: false },
    ],
  },
  {
    key: 'accessibility',
    defaultOpen: false,
    items: [
      { key: 'wheelchair_ramp', icon: 'wheelchair', hasHours: false },
      { key: 'accessible_bathroom', icon: 'toilet', hasHours: false },
      { key: 'ground_floor_room', icon: 'stairsDown', hasHours: false },
    ],
  },
]

// ของใช้ในห้อง — แยกจาก facilities เพราะเป็นคุณสมบัติ "ในห้อง" ไม่ใช่ "ในโรงแรม"
// ถ้าอนาคตมีห้องหลายเกรดในโรงแรมเดียวกัน ชุดนี้ย้ายไปผูกกับ hotel_rooms ได้โดยไม่กระทบ facilities
export const ROOM_AMENITIES = [
  { key: 'fridge', icon: 'fridge' },
  { key: 'kettle', icon: 'kettle' },
  { key: 'hairdryer', icon: 'wind' },
  { key: 'safe', icon: 'safe' },
  { key: 'iron', icon: 'iron' },
  { key: 'bathtub', icon: 'bath' },
  { key: 'extra_bed', icon: 'bed' },
]

/** รายการ facility ทั้งหมดแบบแบน — ใช้ค้นหา metadata จาก key */
export const ALL_FACILITIES = FACILITY_GROUPS.flatMap((g) => g.items)

const FACILITY_BY_KEY = Object.fromEntries(ALL_FACILITIES.map((f) => [f.key, f]))
const AMENITY_BY_KEY = Object.fromEntries(ROOM_AMENITIES.map((a) => [a.key, a]))

export function facilityMeta(key) {
  return FACILITY_BY_KEY[key] ?? null
}

export function amenityMeta(key) {
  return AMENITY_BY_KEY[key] ?? null
}

/** อ่าน item หนึ่งตัวให้อยู่ในรูปแบบปัจจุบัน
 *  รองรับข้อมูลรูปแบบเดิมที่เก็บเวลาเป็นสตริงเดียว เช่น hours: '06:00-22:00' */
function readItem(item) {
  const { hours, from, to, ...rest } = item
  if (from != null || to != null) {
    return { ...rest, from: toTimeInput(from), to: toTimeInput(to) }
  }
  if (typeof hours === 'string' && hours.trim()) {
    const parts = hours.split(/[-–~]/)
    return { ...rest, from: toTimeInput(parts[0]), to: toTimeInput(parts[1]) }
  }
  return { ...rest, from: '', to: '' }
}

/** อ่านค่าจากฐานข้อมูลให้เป็น array เสมอ — กันข้อมูลเก่า/เสียรูปทำหน้าพัง */
export function normalizeList(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && typeof item.key === 'string')
    .map(readItem)
}

/** เรียงรายการที่บันทึกไว้ตามลำดับใน taxonomy — ให้ลูกทัวร์เห็นลำดับเดิมทุกครั้ง
 *  ไม่ใช่ลำดับตามที่ทีมงานบังเอิญกดเลือก */
export function sortByTaxonomy(list, order) {
  const rank = Object.fromEntries(order.map((item, i) => [item.key, i]))
  return [...normalizeList(list)].sort(
    (a, b) => (rank[a.key] ?? 999) - (rank[b.key] ?? 999)
  )
}

/** สลับสถานะเลือก/ไม่เลือกของ facility หนึ่งตัว */
export function toggleItem(list, key) {
  const current = normalizeList(list)
  return current.some((item) => item.key === key)
    ? current.filter((item) => item.key !== key)
    : [...current, { key, fee: '', from: '', to: '', note: '' }]
}

/** แก้ไขฟิลด์ย่อย (fee / from / to / note) ของ facility ที่เลือกไว้แล้ว */
export function patchItem(list, key, patch) {
  return normalizeList(list).map((item) =>
    item.key === key ? { ...item, ...patch } : item
  )
}

/** ตัดฟิลด์ว่างทิ้งก่อนบันทึก — ไม่ให้ jsonb บวมด้วย "" ที่ไม่มีความหมาย */
export function cleanForSave(list) {
  return normalizeList(list).map((item) => {
    const out = { key: item.key }
    if (item.fee) out.fee = item.fee
    // เก็บเฉพาะเวลาที่ผ่านการตรวจรูปแบบแล้ว — ค่าที่อ่านไม่ออกไม่ควรค้างในฐานข้อมูล
    const from = toTimeInput(item.from)
    const to = toTimeInput(item.to)
    if (from) out.from = from
    if (to) out.to = to
    if (item.note?.trim()) out.note = item.note.trim()
    return out
  })
}
