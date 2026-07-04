// คิว action ที่ต้องเขียนกลับ Supabase แต่ทำตอนนี้ไม่ได้ (เน็ตหลุด)
// กด tick เช็คอินได้ทันทีเสมอ (optimistic UI) แล้ว sync คิวนี้เมื่อเน็ตกลับมา
//
// รูปแบบ action: { id, type: 'checkin', guestId, status, checkInTime, createdAt }
// ออกแบบให้ replay ซ้ำได้อย่างปลอดภัย (idempotent) — เขียนทับค่าล่าสุดเสมอ ไม่ใช่ increment

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
  // ถ้ามี action เดิมสำหรับ guest เดียวกันค้างอยู่ ให้แทนที่ด้วยอันล่าสุด (ไม่ sync ซ้ำซ้อน)
  const filtered = queue.filter(
    (a) => !(a.type === action.type && a.guestId === action.guestId)
  )
  filtered.push({ ...action, id: `${action.type}-${action.guestId}-${Date.now()}`, createdAt: Date.now() })
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
