// จัดเรียงรูปใบ้ของเกมปริศนาใบ้คำ
//
// คนสร้างข้ออัปโหลดรูปมา 1-6 ชิ้นแล้วเรียงลำดับได้ **แต่ไม่ต้องเลือกเลย์เอาต์**
// เพราะสิ่งที่ตัดสินว่าสวยหรือไม่ ไม่ใช่ความชอบ แต่คือ
//   จำนวนรูป × สัดส่วนของรูป × ขนาดจอที่กำลังแสดง
// ซึ่งเป็นเลขที่ระบบรู้ดีกว่าคน — และคนสร้างข้อก็ไม่ได้เห็นจอบนรถตอนกรอกอยู่ดี
//
// ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ ไม่แตะ DOM โดยตั้งใจ:
//   1) เขียนเทสต์ได้ (ดู __tests__/puzzleLayout.test.js)
//   2) หน้าพรีวิวใน Builder เรียกตัวเดียวกับจอจริง — พรีวิวที่ไม่ตรงกับของจริง
//      แย่กว่าไม่มีพรีวิว เพราะคนสร้างข้อจะเชื่อมันแล้วไปเจอของจริงบนเวที

export const MAX_CLUES = 6
export const MIN_CLUES = 1

/** สัดส่วนที่ถือว่า "แนวตั้ง" / "แนวนอนจัด" */
const TALL_RATIO = 1.2   // สูง/กว้าง
const WIDE_RATIO = 2.0   // กว้าง/สูง

/** เพดานจำนวนคอลัมน์ของแต่ละพื้นผิว */
const MAX_COLUMNS = {
  stage: 3,          // จอเวที 16:9 — เกิน 3 คอลัมน์รูปจะเล็กจนดูไม่ออกว่าเป็นอะไร
  bus_tv: 3,
  phone: 2,          // มือถือแนวตั้ง
  phoneLandscape: 3,
}

/** กริดตั้งต้นตามจำนวนรูป — ตัวอย่างจริงในเอกสารใช้ 3 รูปเรียงแถวเดียว */
const BASE_COLUMNS = { 1: 1, 2: 2, 3: 3, 4: 2, 5: 3, 6: 3 }

function majority(values, predicate) {
  const known = values.filter((v) => typeof v === 'number' && v > 0)
  if (known.length === 0) return false
  return known.filter(predicate).length * 2 > known.length
}

/**
 * @param {number} count       จำนวนรูปใบ้ (1-6)
 * @param {object} opts
 * @param {'stage'|'bus_tv'|'phone'|'phoneLandscape'} opts.surface
 * @param {number[]} opts.aspects  อัตราส่วน กว้าง/สูง ของแต่ละรูป (ไม่รู้ก็ใส่ null ได้)
 * @returns {{columns:number, rows:number, lastRowCount:number, centerLastRow:boolean, tall:boolean}}
 */
export function clueGrid(count, { surface = 'stage', aspects = [] } = {}) {
  const n = Math.max(MIN_CLUES, Math.min(MAX_CLUES, Number(count) || 0))
  let columns = BASE_COLUMNS[n] ?? 3

  // รูปแนวตั้งหลายใบเรียงกันจะสูงจนล้นจอ — ลดคอลัมน์ลงหนึ่ง (แต่ไม่ต่ำกว่า 2)
  const tall = majority(aspects, (a) => 1 / a > TALL_RATIO)
  if (tall && columns > 2) columns -= 1

  // รูปแนวนอนจัด (พาโนรามา) เรียงแถวเดียวได้สวยกว่าเสมอถ้ามีไม่เกิน 3
  const wide = majority(aspects, (a) => a > WIDE_RATIO)
  if (wide && n <= 3) columns = n

  columns = Math.min(columns, MAX_COLUMNS[surface] ?? 3, n)

  const rows = Math.ceil(n / columns)
  const lastRowCount = n - columns * (rows - 1)

  return {
    columns,
    rows,
    lastRowCount,
    // 5 รูปเป็น 3 บน / 2 ล่าง — แถวล่างต้องอยู่กึ่งกลาง ไม่ใช่ชิดซ้าย
    // ถ้าปล่อยชิดซ้ายจะดูเหมือนจอเรนเดอร์ไม่เสร็จ ไม่ใช่ดีไซน์
    centerLastRow: lastRowCount > 0 && lastRowCount < columns,
    tall,
  }
}

/**
 * ขนาดตัวอักษรของใบ้แบบอีโมจิ/คำ — ต้องผูกกับขนาดช่อง ไม่ใช่ตั้ง px ตายตัว
 * ช่องของ 1 รูป กับ 6 รูป ต่างกันราวสามเท่า ถ้าตั้งค่าเดียวจะได้อีโมจิจิ๋วอยู่กลางช่องว่าง
 * คืนเป็นหน่วย cqw (ขนาดเทียบกับความกว้างของช่อง) เพื่อให้ CSS container query จัดการต่อ
 */
export function clueTextScale(clueKind, body) {
  if (clueKind === 'emoji') return 52
  const len = (body ?? '').trim().length
  if (len <= 3) return 40
  if (len <= 6) return 30
  if (len <= 10) return 22
  return 16
}

/** ตรวจก่อนบันทึก — ข้อความตรงกับที่ RPC ฝั่ง DB จะตอบกลับมา */
export function validateClues(clues) {
  const list = (clues ?? []).filter((c) => (c?.body ?? '').trim() !== '')
  if (list.length < MIN_CLUES) return 'ต้องมีรูปใบ้อย่างน้อย 1 ชิ้น'
  if (list.length > MAX_CLUES) return `รูปใบ้ได้สูงสุด ${MAX_CLUES} ชิ้น`
  return null
}

/**
 * แยกคำตอบเป็นพยางค์จากที่คนสร้างข้อพิมพ์ "ภู-กระ-ดึง"
 * ช่องเดียวทำสามหน้าที่: จำนวนพยางค์บนป้าย · ชิ้นส่วนของอนิเมชันตอนเฉลย ·
 * เครื่องเตือนว่าคำตอบกับจำนวนพยางค์ไม่ตรงกัน
 * ไม่บังคับให้แยกถูกหลักภาษา — แยกตามที่อยากให้จอโชว์ก็พอ
 */
export function splitSyllables(text) {
  return (text ?? '')
    .split(/[-–—\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
