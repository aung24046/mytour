// จัดกลุ่มคำถามในฟอร์มลงทะเบียนเป็นหมวดหมู่ ให้ตรงกับที่ผู้ใช้ต้องการ:
// ข้อมูลส่วนตัวพื้นฐาน → สุขภาพ/ความปลอดภัย/อาหาร → ผู้ติดต่อฉุกเฉิน → อื่นๆ
// ใช้ร่วมกันทั้งฝั่งลงทะเบียน (Register.jsx) และฝั่งแก้ไขข้อมูลของ staff (GuestManager.jsx)
export const CATEGORY_ORDER = ['personal', 'health', 'emergency', 'other']

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
