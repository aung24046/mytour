// กระดานแผ่นป้ายของเกม "เปิดแผ่นป้าย"
//
// ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ ไม่แตะ DOM โดยตั้งใจ ด้วยเหตุผลเดียวกับ puzzleLayout.js:
//   1) เขียนเทสต์ได้ (ดู __tests__/tile-grid.test.mjs)
//   2) หน้าพรีวิวใน Builder เรียกตัวเดียวกับจอจริง — พรีวิวที่ไม่ตรงกับของจริง
//      แย่กว่าไม่มีพรีวิว เพราะคนสร้างข้อจะเชื่อมันแล้วไปเจอของจริงบนเวทีต่อหน้าคน 40 คน
//
// ★ ไม่ตัดภาพเป็น N ไฟล์ ตัดด้วย CSS
//   อัปโหลดไฟล์เดียว แล้วเรนเดอร์ rows×cols กล่องที่ใช้ภาพเดียวกันเป็น background
//   แล้วเลื่อนตำแหน่งให้แต่ละกล่องเห็นคนละส่วน
//   ได้สามอย่าง: เปลี่ยนกริดทีหลังไม่ต้องอัปใหม่ · ไม่กิน storage 12 object ต่อข้อ ·
//   Builder ไม่ต้องจัดการไฟล์กำพร้าตอนคนแก้กริด

export const MIN_DIM = 2
export const MAX_DIM = 6
export const MAX_STEP = 4

/** ตัวเลือกกริดใน Builder — ครอบคลุมสัดส่วนภาพที่เจอจริง ไม่ต้องให้กรอกเลขเอง */
export const GRID_PRESETS = [
  { rows: 2, cols: 3, label: '2 × 3' },
  { rows: 3, cols: 3, label: '3 × 3' },
  { rows: 3, cols: 4, label: '3 × 4' },
  { rows: 4, cols: 3, label: '4 × 3' },
  { rows: 4, cols: 4, label: '4 × 4' },
  { rows: 4, cols: 5, label: '4 × 5' },
  { rows: 5, cols: 4, label: '5 × 4' },
  { rows: 5, cols: 6, label: '5 × 6' },
]

/** อัตราส่วนสำเร็จรูปของกรอบครอป — เหมือนแอปแต่งรูปในมือถือ (null = อิสระ) */
export const CROP_RATIOS = [
  { key: 'free',  value: null,   label: 'อิสระ' },
  { key: '1:1',   value: 1,      label: '1:1' },
  { key: '4:3',   value: 4 / 3,  label: '4:3' },
  { key: '3:4',   value: 3 / 4,  label: '3:4' },
  { key: '16:9',  value: 16 / 9, label: '16:9' },
]

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi)

// แยก "ไม่ได้ส่งมา" ออกจาก "ส่งมาแต่ค่าเพี้ยน" โดยตั้งใจ
// ไม่ได้ส่ง → ค่าเริ่มต้น · ส่งมาแต่เพี้ยน (0, -3, 99) → บีบเข้าช่วง
// ถ้าใช้ `Number(x) || ค่าเริ่มต้น` เลข 0 จะกลายเป็นค่าเริ่มต้นเพราะ 0 เป็น falsy
// ซึ่งทำให้ข้อมูลเสียกลายเป็นข้อมูลที่ดูปกติ แทนที่จะถูกบีบให้เห็นว่าผิด
const num = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback   // Number(null) = 0 ไม่ใช่ NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function clampGrid(rows, cols) {
  return {
    rows: clamp(Math.round(num(rows, 3)), MIN_DIM, MAX_DIM),
    cols: clamp(Math.round(num(cols, 4)), MIN_DIM, MAX_DIM),
  }
}

export function clampStep(step) {
  return clamp(Math.round(num(step, 1)), 1, MAX_STEP)
}

export function tileCount(rows, cols) {
  const g = clampGrid(rows, cols)
  return g.rows * g.cols
}

/** หมายเลขแผ่น 1..N เรียงซ้าย→ขวา บน→ล่าง — คงที่เสมอ เพราะคนคุมเกมต้องพูดได้ว่า "เปิดเบอร์ 7" */
export function tileNumbers(rows, cols) {
  const n = tileCount(rows, cols)
  return Array.from({ length: n }, (_, i) => i + 1)
}

/** แผ่นหมายเลข n อยู่แถวไหนคอลัมน์ไหน (นับจาก 0) */
export function tilePosition(n, rows, cols) {
  const g = clampGrid(rows, cols)
  const i = clamp(Math.round(Number(n) || 1), 1, g.rows * g.cols) - 1
  return { row: Math.floor(i / g.cols), col: i % g.cols }
}

/**
 * กรอบครอปเป็นสัดส่วน 0-1 ของภาพต้นฉบับ
 * ค่าเพี้ยน/ไม่มี = ใช้ทั้งภาพ ไม่ใช่พังทั้งกระดาน
 */
export function normalizeCrop(crop) {
  const x = Number(crop?.x ?? crop?.crop_x ?? 0)
  const y = Number(crop?.y ?? crop?.crop_y ?? 0)
  const w = Number(crop?.w ?? crop?.crop_w ?? 1)
  const h = Number(crop?.h ?? crop?.crop_h ?? 1)
  const safe = (v, d) => (Number.isFinite(v) ? v : d)

  let cw = clamp(safe(w, 1), 0.01, 1)
  let ch = clamp(safe(h, 1), 0.01, 1)
  let cx = clamp(safe(x, 0), 0, 1 - cw)
  let cy = clamp(safe(y, 0), 0, 1 - ch)
  return { x: cx, y: cy, w: cw, h: ch }
}

/**
 * สไตล์ background ของแผ่นหมายเลข n
 *
 * คณิตศาสตร์ (พิสูจน์ไว้ในเทสต์):
 *   ภาพถูกขยายให้ "กรอบครอป" พอดีกับกระดาน → ความกว้างภาพ = cols/crop_w เท่าของกล่องหนึ่งใบ
 *   background-position ของ CSS เป็นเปอร์เซ็นต์ของ (กล่อง − ภาพ) ไม่ใช่ของกล่องเฉยๆ
 *   จึงต้องหารด้วย (scale − 1) ไม่ใช่ (cols − 1) ตรงๆ
 *
 * ไม่มีภาพ → คืน null ให้ผู้เรียกวาดช่องเปล่า ไม่ใช่ throw
 */
export function tileStyle(n, { rows, cols, crop, imageUrl }) {
  if (!imageUrl) return null
  const g = clampGrid(rows, cols)
  const c = normalizeCrop(crop)
  const { row, col } = tilePosition(n, g.rows, g.cols)

  const sx = g.cols / c.w
  const sy = g.rows / c.h
  const px = ((c.x * g.cols) / c.w + col) / (sx - 1)
  const py = ((c.y * g.rows) / c.h + row) / (sy - 1)

  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: `${round(sx * 100)}% ${round(sy * 100)}%`,
    backgroundPosition: `${round(px * 100)}% ${round(py * 100)}%`,
    backgroundRepeat: 'no-repeat',
  }
}

/**
 * ภาพตอนปิด — ใช้กริดเดียวกันเพื่อให้แผ่นที่ปิดอยู่ประกอบกันเป็นภาพเดียว
 * ไม่ครอป เพราะเป็นคนละภาพกับภาพเฉลย (โลโก้บริษัท ลายทัวร์) และคนสร้างข้อ
 * ไม่ได้ตั้งกรอบให้มัน
 */
export function coverStyle(n, { rows, cols, imageUrl }) {
  if (!imageUrl) return null
  const g = clampGrid(rows, cols)
  const { row, col } = tilePosition(n, g.rows, g.cols)
  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: `${g.cols * 100}% ${g.rows * 100}%`,
    backgroundPosition: `${round((col / (g.cols - 1)) * 100)}% ${round((row / (g.rows - 1)) * 100)}%`,
    backgroundRepeat: 'no-repeat',
  }
}

/**
 * สัดส่วนของกระดานหลังครอป (กว้าง/สูง) — ใช้ตั้ง aspect-ratio ของกล่องนอก
 * imageAspect = กว้าง/สูง ของภาพต้นฉบับ
 */
export function boardAspect(imageAspect, crop) {
  const a = Number(imageAspect)
  if (!Number.isFinite(a) || a <= 0) return null
  const c = normalizeCrop(crop)
  return (a * c.w) / c.h
}

/**
 * สัดส่วนของแผ่นป้ายหนึ่งใบ = สัดส่วนกระดาน × (แถว ÷ คอลัมน์)
 *
 * สูตรบรรทัดนี้คือเหตุผลที่ "ไม่ล็อกอัตราส่วนตอนครอป" — ภาพ 16:9 กับกริด 4 คอลัมน์
 * 3 แถว ได้แผ่นป้าย 4:3 ซึ่งสวยปกติ แผ่นป้ายไม่จำเป็นต้องเป็นจัตุรัส
 * มันแค่ต้องไม่ยาวเป็นเส้น — และพรีวิวสดใน Builder บอกเรื่องนี้ได้ดีกว่ากฎ
 */
export function tileAspect(imageAspect, rows, cols, crop) {
  const b = boardAspect(imageAspect, crop)
  if (b == null) return null
  const g = clampGrid(rows, cols)
  return (b * g.rows) / g.cols
}

/** แผ่นที่ผอมหรือยาวเกินกว่านี้ดูไม่ออกว่าเป็นภาพอะไร — Builder เอาไปเตือน ไม่ใช่ห้าม */
export const TILE_ASPECT_WARN = 2.5

export function tileShapeWarning(imageAspect, rows, cols, crop) {
  const a = tileAspect(imageAspect, rows, cols, crop)
  if (a == null) return null
  if (a > TILE_ASPECT_WARN) return 'wide'
  if (a < 1 / TILE_ASPECT_WARN) return 'tall'
  return null
}

export function isOpen(n, revealed) {
  return Array.isArray(revealed) && revealed.some((x) => Number(x) === Number(n))
}

/**
 * แผ่นที่ควร "เปิด" บนจอ ณ ตอนนี้
 *
 * ★ ตอนเฉลยต้องเปิดครบทุกแผ่นเสมอ ไม่ว่า revealed_tiles ในฐานข้อมูลจะมีกี่แผ่น
 *   (เจ้าของโปรเจกต์เจอ 12 ก.ย. 2026: กดเฉลยทั้งที่ไม่มีใครตอบถูก แล้วแผ่นเปิดไม่หมด
 *   เพราะ quiz_reveal_internal สาขา tiles ไม่ได้เติม revealed_tiles — ฝั่ง DB แก้แล้ว
 *   แต่จอต้องไม่พึ่งฐานข้อมูลอย่างเดียว ห้องที่เปิดค้างอยู่ก่อนดีพลอยต้องถูกด้วย)
 */
export function boardRevealed(revealed, rows, cols, revealAll = false) {
  if (revealAll) return tileNumbers(rows, cols)
  return Array.isArray(revealed) ? revealed : []
}

export function openCount(revealed, rows, cols) {
  const total = tileCount(rows, cols)
  const list = Array.isArray(revealed) ? revealed : []
  const seen = new Set(list.map(Number).filter((x) => x >= 1 && x <= total))
  return seen.size
}

/**
 * แผ่นที่เพิ่งเปิดในรอบนี้ — จอเวทีใช้ตัดสินว่าจะเล่นอนิเมชันพลิกแผ่นไหน
 * เทียบจาก revealed_tiles ค่าก่อนหน้ากับค่าใหม่ ไม่ต้องเก็บ event แยก
 */
export function justOpened(prev, next) {
  const before = new Set((Array.isArray(prev) ? prev : []).map(Number))
  return (Array.isArray(next) ? next : [])
    .map(Number)
    .filter((n) => !before.has(n))
}

function round(v) {
  return Math.round(v * 1000) / 1000
}
