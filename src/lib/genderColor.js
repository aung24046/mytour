// ใช้ระบายสีชื่อลูกทัวร์ตามเพศ ให้ staff กวาดตาเจอเร็วขึ้นเวลาดูรายชื่อยาวๆ
// ชาย = ฟ้า, หญิง = ชมพู, ไม่ระบุ/ไม่มีข้อมูล = สีปกติ (ไม่ใส่สี)
export function genderTextClass(gender) {
  if (gender === 'ชาย') return 'text-blue-600'
  if (gender === 'หญิง') return 'text-pink-600'
  return ''
}

// เวอร์ชัน background สีทึบ ใช้กับจุดที่โชว์ชื่อเป็นกล่อง/ป้ายสีพื้น เช่น ผังที่นั่งบนรถบัส
export function genderBgClass(gender, fallback = 'bg-sky-500 text-white') {
  if (gender === 'ชาย') return 'bg-blue-500 text-white'
  if (gender === 'หญิง') return 'bg-pink-500 text-white'
  return fallback
}
