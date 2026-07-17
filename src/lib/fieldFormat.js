// รูปแบบ/มาส์กสำหรับฟิลด์บางชนิดในฟอร์มลงทะเบียน

// ตรวจว่าเป็นฟิลด์ "เลขบัตรประชาชน" หรือไม่
// รองรับทั้ง field_purpose = 'national_id' (ถ้ามีตั้งไว้) และเดาจากป้ายชื่อ
export function isNationalIdField(field) {
  if (!field) return false
  if (field.field_purpose === 'national_id') return true
  const label = (field.label || '').toLowerCase()
  return /ประชาชน|บัตร\s*ปชช|national\s*id|citizen\s*id|id\s*card/.test(label)
}

// จัดรูปเลขบัตรประชาชนไทยเป็น X-XXXX-XXXXX-XX-X (13 หลัก) — ตัดอักขระที่ไม่ใช่ตัวเลข
// และจำกัดไม่เกิน 13 หลัก (ห้ามใส่เกิน)
export function formatThaiNationalId(raw) {
  const digits = (raw || '').replace(/\D/g, '').slice(0, 13)
  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i === 1 || i === 5 || i === 10 || i === 12) out += '-'
    out += digits[i]
  }
  return out
}

// ความยาวสูงสุดของสตริงหลังจัดรูป (13 หลัก + 4 ขีด)
export const THAI_NATIONAL_ID_MAX_LENGTH = 17
export const THAI_NATIONAL_ID_PLACEHOLDER = 'X-XXXX-XXXXX-XX-X'
