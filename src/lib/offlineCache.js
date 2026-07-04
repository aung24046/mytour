// เก็บสำเนาข้อมูลล่าสุดไว้ในเครื่อง เพื่อให้ staff เปิดดูรายชื่อ/กำหนดการได้แม้เน็ตหลุด
// ใช้คู่กับ offlineQueue.js สำหรับ action ที่ต้องเขียนกลับ Supabase (เช่นเช็คอิน)

function keyFor(name) {
  return `mytour_cache_${name}`
}

export function saveCache(name, data) {
  try {
    localStorage.setItem(keyFor(name), JSON.stringify({ data, savedAt: Date.now() }))
  } catch {
    // localStorage เต็ม/ถูกบล็อก — เงียบไว้ ไม่ใช่ critical path
  }
}

export function loadCache(name) {
  try {
    const raw = localStorage.getItem(keyFor(name))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.data ?? null
  } catch {
    return null
  }
}
