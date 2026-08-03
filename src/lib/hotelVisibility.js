// แหล่งความจริงเดียวว่า "ลูกทัวร์เห็นคอลัมน์ไหนของ hotels ได้บ้าง"
//
// ใช้ร่วมกัน 2 ที่:
//   - MyRoom.jsx        ใช้เป็นรายการคอลัมน์ใน .select()
//   - GuestPreviewSheet ใช้กรองข้อมูลก่อนแสดงพรีวิวให้ทีมงานดู
//
// การมีรายการเดียวทำให้พรีวิวไม่มีวันแสดงสิ่งที่ลูกทัวร์ไม่เห็นจริง และกลับกัน
// ถ้าเพิ่มคอลัมน์ใหม่ให้ลูกทัวร์เห็น ต้องมาเพิ่มที่นี่ที่เดียว

/** คอลัมน์ที่ปลอดภัยสำหรับฝั่งลูกทัวร์ */
export const GUEST_HOTEL_FIELDS = [
  'id',
  'name',
  'check_in_date',
  'check_out_date',
  'general_info',
  'wifi_name',
  'wifi_password',
  'breakfast_time',
  'breakfast_location',
  'dinner_time',
  'dinner_location',
  'check_in_time',
  'checkout_time',
  'morning_call',
  'luggage_time',
  'meeting_point',
  'address',
  'address_local',
  'phone',
  'map_url',
  'sort_order',
  'facilities',
  'room_amenities',
  'power_plug',
]

/** ข้อมูลภายใน — ห้ามหลุดไปฝั่งลูกทัวร์เด็ดขาด */
export const INTERNAL_HOTEL_FIELDS = ['staff_notes', 'booking_ref', 'supplier_id']

/** สตริงสำหรับ supabase .select() */
export const GUEST_HOTEL_COLUMNS = GUEST_HOTEL_FIELDS.join(', ')

/** คัดเฉพาะฟิลด์ที่ลูกทัวร์เห็นออกมาจาก object โรงแรม */
export function pickGuestVisible(hotel) {
  if (!hotel) return null
  const out = {}
  for (const field of GUEST_HOTEL_FIELDS) out[field] = hotel[field]
  return out
}
