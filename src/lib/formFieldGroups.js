// จัดกลุ่มคำถามในฟอร์มลงทะเบียนเป็นหมวดหมู่ ให้ตรงกับที่ผู้ใช้ต้องการ:
// ข้อมูลส่วนตัวพื้นฐาน → สุขภาพ/ความปลอดภัย/อาหาร → ผู้ติดต่อฉุกเฉิน → อื่นๆ
// ใช้ร่วมกันทั้งฝั่งลงทะเบียน (Register.jsx) และฝั่งแก้ไขข้อมูลของ staff (GuestManager.jsx)
export const CATEGORY_ORDER = ['personal', 'health', 'emergency', 'other']

// สไตล์หัวการ์ดต่อหมวด (ไอคอน + สี) — ใช้ร่วมกันทั้งหน้าลงทะเบียนและหน้าแก้ไขข้อมูล
export const CATEGORY_STYLE = {
  personal: { icon: 'people', tint: '#E6F1FB', text: '#0C447C', iconColor: '#185FA5' },
  health: { icon: 'heart', tint: '#E1F5EE', text: '#0F6E56', iconColor: '#0F6E56' },
  emergency: { icon: 'phone', tint: '#FAECE7', text: '#993C1D', iconColor: '#993C1D' },
  other: { icon: 'star', tint: '#EEEDFE', text: '#3C3489', iconColor: '#3C3489' },
}

export function groupFieldsByCategory(fields) {
  const buckets = { personal: [], health: [], emergency: [], other: [] }
  for (const f of fields) {
    const cat = CATEGORY_ORDER.includes(f.category) ? f.category : 'other'
    buckets[cat].push(f)
  }
  return CATEGORY_ORDER
    .map((category) => ({ category, fields: buckets[category] }))
    .filter((group) => group.fields.length > 0)
}
