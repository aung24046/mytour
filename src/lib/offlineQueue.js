// คิว action ที่ต้องเขียนกลับ Supabase แต่ทำตอนนี้ไม่ได้ (เน็ตหลุด)
// กด tick เช็คอินได้ทันทีเสมอ (optimistic UI) แล้ว sync คิวนี้เมื่อเน็ตกลับมา
//
// รูปแบบ action: { id, type: 'checkin', guestId, status, checkInTime, createdAt }
// ออกแบบให้ replay ซ้ำได้อย่างปลอดภัย (idempotent) — เขียนทับค่าล่าสุดเสมอ ไม่ใช่ increment
//
// dedupe key: เดิมใช้ guestId ตรงๆ (1 guest = 1 action ค้างต่อ type เพราะเป็นการ "แก้ค่าล่าสุด"
// เช่นเช็คอิน/SOS) ถ้า action ไหนไม่ใช่แบบนั้น (เช่นบันทึกรายจ่ายหลายรายการ ห้ามถูกแทนที่กัน)
// ให้ส่ง dedupeKey เป็นค่าที่ unique ต่อรายการ (เช่น uuid ที่สุ่มตอนสร้าง) มาแทน guestId

const QUEUE_KEY = 'mytour_offline_queue'

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // no-op — ถ้าเขียนไม่ได้ก็ยังมี state ใน memory ของหน้าปัจจุบันอยู่
  }
}

export function enqueue(action) {
  const queue = readQueue()
  const dedupeKey = action.dedupeKey ?? action.guestId
  // ถ้ามี action เดิมสำหรับ key เดียวกันค้างอยู่ ให้แทนที่ด้วยอันล่าสุด (ไม่ sync ซ้ำซ้อน)
  // ถ้าไม่มี dedupeKey/guestId เลย (เช่นทุกรายการต้องถูกเก็บแยกกัน) จะไม่ทับของเดิม
  const filtered =
    dedupeKey === undefined
      ? queue
      : queue.filter((a) => !(a.type === action.type && (a.dedupeKey ?? a.guestId) === dedupeKey))
  filtered.push({
    ...action,
    id: `${action.type}-${dedupeKey ?? 'item'}-${Date.now()}`,
    createdAt: Date.now(),
  })
  writeQueue(filtered)
  return filtered
}

export function getQueue() {
  return readQueue()
}

export function removeFromQueue(actionId) {
  const queue = readQueue().filter((a) => a.id !== actionId)
  writeQueue(queue)
  return queue
}

export function clearQueue() {
  writeQueue([])
}
