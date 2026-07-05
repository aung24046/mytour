// ตัวช่วยกลางสำหรับตัวเลือกแบบ "มี text กำกับ" เช่น "อื่นๆ โปรดระบุ", "มี (ระบุชื่อยา)"
// ใช้ร่วมกันทั้ง CheckboxGroup (value เป็น array ของ string) และ RadioGroup (value เป็น string เดียว)
// รูปแบบการเก็บ: ถ้าเลือกแล้วไม่มี text ต่อท้าย → เก็บแค่ opt.value เฉยๆ
//                ถ้ามี text → เก็บเป็น "opt.value: text" (คั่นด้วย ": ")
// เลือกวิธีนี้เพราะยังคง contract เดิม (string | string[]) ของ DynamicField ไว้ทั้งหมด
// ไม่ต้องแก้ logic การ submit ใน Register.jsx / GuestManager.jsx เลย

const SEPARATOR = ': '

export function matchEntry(entry, optValue) {
  if (entry === optValue) return true
  return entry.startsWith(`${optValue}${SEPARATOR}`)
}

export function extractText(entry, optValue) {
  if (entry === optValue) return ''
  if (entry.startsWith(`${optValue}${SEPARATOR}`)) {
    return entry.slice((optValue + SEPARATOR).length)
  }
  return ''
}

export function buildEntry(optValue, text) {
  const trimmed = (text ?? '').trim()
  return trimmed ? `${optValue}${SEPARATOR}${trimmed}` : optValue
}
