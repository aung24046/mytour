// PIN ของทีมงาน เก็บไว้ใช้ระหว่างหน้าในแท็บเดียวกัน
//
// ทำไมต้องถาม PIN ทั้งที่ล็อกอินแล้ว:
//   session ที่เก็บใน localStorage ไม่มี PIN อยู่ (ตั้งใจ) และแอปทั้งใบใช้ anon key
//   ตัวเดียวกับลูกทัวร์ ถ้า RPC ที่แตะเฉลย/คำตอบไม่ตรวจอะไรเลย
//   ลูกทัวร์ก็เรียกดูได้เหมือนกัน
//
// sessionStorage ไม่ใช่ localStorage: ปิดแท็บแล้วหายคือสิ่งที่ต้องการ
// ไม่ควรมี PIN ค้างอยู่บนเครื่องข้ามวัน
const KEY = 'mytour.quiz.pin'

export function getQuizPin() {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveQuizPin(pin) {
  try {
    sessionStorage.setItem(KEY, pin)
  } catch {
    // โหมดส่วนตัวของ Safari — แค่ต้องพิมพ์ใหม่รอบหน้า
  }
}

export function clearQuizPin() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // no-op
  }
}
