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
 * ความสูงของช่องรูปใบ้ตามพื้นผิวและจำนวนแถว
 *
 * ตัวเลขชุดนี้เคยใหญ่กว่านี้ราวหนึ่งในห้า แล้วได้ฟีดแบ็กว่า "กรอบรูปแต่ละรูปใบ้
 * ใหญ่เกินไป" — บนมือถือ กรอบสองใบกินจอจนช่องพิมพ์คำตอบตกไปอยู่ใต้เส้นพับ
 * ซึ่งเป็นปุ่มเดียวที่หน้านั้นมี
 */
// ★ 12 ก.ย. 2026 เจ้าของโปรเจกต์: "รูปเล็ก · กรอบพื้นหลังกับกล่องขาวดูไม่สมส่วน"
//   จอเวทีจึงขยายขึ้นราวหนึ่งในสาม — กล่องขาวกินพื้นที่เกือบเต็มจอแล้ว (PuzzleStage)
//   ที่ว่างที่เหลือรอบรูปไม่ได้ทำให้ดูโปร่ง มันแค่ทำให้รูปใบ้ซึ่งเป็นโจทย์ทั้งหมดของเกมเล็กลง
const CELL_HEIGHT = {
  stage:          { single: 'min(60vh, 820px)', multi: 'min(31vh, 380px)' },
  bus_tv:         { single: 'min(60vh, 820px)', multi: 'min(31vh, 380px)' },
  phone:          { single: 'min(22vh, 180px)', multi: 'min(15vh, 124px)' },
  phoneLandscape: { single: 'min(30vh, 240px)', multi: 'min(18vh, 150px)' },
}

/**
 * @param {'stage'|'bus_tv'|'phone'|'phoneLandscape'} surface
 * @param {number} rows  จำนวนแถวที่ clueGrid คำนวณได้
 * @returns {string} CSS length
 */
export function clueCellHeight(surface, rows) {
  const set = CELL_HEIGHT[surface] ?? CELL_HEIGHT.stage
  return Number(rows) > 1 ? set.multi : set.single
}

/**
 * สไตล์ของ "กรอบ" รูปใบ้หนึ่งใบ
 *
 * ของเดิมกรอบกินเต็มความกว้างของช่องเสมอ ส่วนรูปข้างในเป็น object-contain
 * รูปแนวตั้งในช่องกว้างจึงได้กรอบขาวโล่งสองข้างที่กว้างกว่าตัวรูปเอง
 * และรูปพาโนรามาได้กรอบขาวโล่งบน-ล่าง — สายตาอ่านว่า "กรอบใหญ่"
 * ทั้งที่รูปเท่าเดิม
 *
 * แก้ด้วยการให้กรอบมีสัดส่วนเท่ารูปจริง แล้วจำกัดความกว้างสองชั้น:
 *   • ไม่เกินความกว้างของช่อง (100%)  — รูปนอนจัดจะได้ไม่ล้นออกข้าง
 *   • ไม่เกิน "ความสูงช่อง × สัดส่วน" — รูปตั้งจะได้ไม่สูงเกินแถว
 * min() ของสองค่านี้คือกรอบที่ใหญ่ที่สุดที่ยังหุ้มรูปพอดี ไม่มีขอบขาวเหลือ
 *
 * ช่องยังสูงเท่ากันทุกใบเหมือนเดิม (กรอบลอยกลางช่อง) เพราะสิ่งที่ทำให้แถว
 * ดูเป็นระเบียบคือความสูงของช่อง ไม่ใช่ความกว้างของกรอบ
 *
 * รูปที่ยังโหลดไม่เสร็จ (aspect = null) ใช้เต็มช่องไปก่อน แล้วหดเองตอนรู้สัดส่วน
 *
 * @param {number|null} aspect  กว้าง/สูง ของรูปจริง
 * @param {string} cellHeight   ความสูงของช่อง (CSS length)
 * @returns {object} style object
 */
export function clueFrameStyle(aspect, cellHeight) {
  if (typeof aspect !== 'number' || !(aspect > 0) || !cellHeight) {
    return { width: '100%', height: cellHeight }
  }
  return {
    width: `min(100%, calc(${cellHeight} * ${aspect}))`,
    aspectRatio: String(aspect),
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
