// Resolve a guest's phone number regardless of whether "phone" is the built-in
// core field (guests.phone) or a custom field an admin added via FormBuilder
// tagged with field_purpose = 'phone'. Dashboard/CheckIn call this instead of
// hardcoding guests.phone so the UI keeps working after form customization.

// responsesByGuestId: { [guestId]: { [fieldId]: value } }
// phoneField: the form_fields row with field_purpose === 'phone' (or null)
export function resolveGuestPhone(guest, phoneField, responsesByGuestId) {
  if (!phoneField) return guest.phone ?? null
  if (phoneField.is_core) return guest[phoneField.field_key] ?? guest.phone ?? null

  const responses = responsesByGuestId?.[guest.id]
  return responses?.[phoneField.id] ?? null
}

export function findFieldByPurpose(fields, purpose) {
  return fields.find((f) => f.field_purpose === purpose && f.is_active) ?? null
}

/**
 * ตัดทุกอย่างที่ไม่ใช่ตัวเลขออกจากเบอร์โทร เพื่อใช้เทียบว่า "เบอร์เดียวกัน" หรือไม่
 *
 * ทำไมต้องมี: เดิมเช็คเบอร์ซ้ำด้วย .eq() ซึ่งเทียบสตริงตรงตัว
 * "081-234-5678" กับ "0812345678" กับ " 0812345678 " จึงเล็ดลอดเป็นคนละเบอร์
 * แล้วลงทะเบียนซ้ำได้ทั้งที่เป็นคนเดียวกัน
 *
 * ต้องตรงกับนิพจน์ที่ใช้ใน unique index ฝั่งฐานข้อมูล:
 *   regexp_replace(phone, '\D', '', 'g')
 */
export function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function buildResponsesByGuestId(responses) {
  const map = {}
  for (const r of responses) {
    if (!map[r.guest_id]) map[r.guest_id] = {}
    map[r.guest_id][r.field_id] = r.value
  }
  return map
}
