// สีและรูปทรงของตัวเลือกในควิซ — ต้องตรงกันเป๊ะระหว่างจอใหญ่กับมือถือ
//
// นี่คือกลไกทั้งหมดของเกมแบบ Kahoot: จอใหญ่บอกว่าตัวเลือกไหนคืออะไร
// มือถือมีแค่ปุ่มสี่ปุ่ม คนเล่นจับคู่เอาเองด้วย "สี + รูปทรง"
//
// ทำไมต้องมีรูปทรงด้วย ไม่ใช่แค่สี:
//   ผู้ชายราว 1 ใน 12 คนตาบอดสีแดง-เขียว ซึ่งเป็นคู่สีที่ใช้อยู่นี่พอดี
//   ถ้าใช้สีอย่างเดียว ในกรุ๊ป 40 คนจะมีคนเล่นไม่ได้ประมาณ 1-2 คนทุกกรุ๊ป
//
// ฟิลด์ symbol เก็บไว้อ่านในโค้ดเฉยๆ ไม่ได้ถูกเรนเดอร์แล้ว — ของจริงวาดด้วย
// clip-path ผ่าน components/quiz/OptionShape.jsx (ดูเหตุผลที่ SHAPE_GEOMETRY)
//
// ทำไม hardcode hex ไม่ใช้ token ของธีม:
//   token ธีม (bg-brand ฯลฯ) เปลี่ยนตามสีบริษัท ถ้าใช้ที่นี่ บางบริษัทจะได้
//   ตัวเลือกสี่ปุ่มที่สีใกล้กันจนแยกไม่ออก — ปุ่มพวกนี้ต้องต่างกันชัดเสมอ
export const OPTION_STYLES = [
  { key: 'a', color: '#dc2626', shape: 'triangle', symbol: '▲' },
  { key: 'b', color: '#2563eb', shape: 'diamond', symbol: '◆' },
  { key: 'c', color: '#ca8a04', shape: 'circle', symbol: '●' },
  { key: 'd', color: '#16a34a', shape: 'square', symbol: '■' },
]

/** ถูก/ผิด ใช้แค่ 2 ปุ่ม — เขียว/แดง ตรงกับความคาดหวังของคนเล่น */
export const TF_STYLES = [
  { key: 'true', color: '#16a34a', shape: 'circle', symbol: '●' },
  { key: 'false', color: '#dc2626', shape: 'cross', symbol: '✕' },
]

// ---------------------------------------------------------------------
// รูปทรงของตัวเลือก — วาดเอง ไม่ใช้กลิฟข้อความ
// ---------------------------------------------------------------------
// เดิมใช้ตัวอักษร ▲ ◆ ● ■ ตรงๆ ซึ่งมีปัญหา: ฟอนต์วาดสี่ตัวนี้มาคนละสัดส่วน
// ตั้ง font-size เท่ากันแต่ ● กับ ■ ออกมาเล็กกว่า ▲ ราว 40% บนจอเวที
// เห็นชัดมากจนดูเหมือนตัวเลือกสองอันสำคัญกว่าอีกสองอัน
//
// จึงวาดด้วย clip-path แล้วไล่ขนาดกล่องให้ทุกรูปมี "พื้นที่หมึก" เท่ากัน
// (ไม่ใช่กล่องเท่ากัน — กล่องเท่ากันคือต้นเหตุของปัญหาเดิม)
//   สามเหลี่ยม / ข้าวหลามตัด = ครึ่งกล่อง → กล่องใหญ่สุด  1.000
//   วงกลม                    = π/4 ของกล่อง →             0.798
//   สี่เหลี่ยม                = เต็มกล่อง →                0.707
// ผลพลอยได้: ไม่ต้องพึ่งฟอนต์ที่มีกลิฟพวกนี้ ซึ่งบนทีวี Android บนรถบางรุ่นไม่มี
// ความหนาแขนกากบาท: แก้สมการ 2√2·t − t² = 0.5 (พื้นที่เท่าสามเหลี่ยม/ข้าวหลามตัด)
// ได้ t ≈ 0.1894 แล้วแปลงเป็นระยะตามแกน X = t/√2 ≈ 0.134
const X = 0.134
export const SHAPE_GEOMETRY = {
  triangle: { scale: 1, clip: 'polygon(50% 2%, 100% 98%, 0 98%)' },
  diamond: { scale: 1, clip: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' },
  circle: { scale: 0.798, clip: 'circle(50%)' },
  square: { scale: 0.707, clip: 'inset(0)' },
  cross: {
    scale: 1,
    clip:
      `polygon(${X * 100}% 0, 50% ${(0.5 - X) * 100}%, ${(1 - X) * 100}% 0, 100% ${X * 100}%, ` +
      `${(0.5 + X) * 100}% 50%, 100% ${(1 - X) * 100}%, ${(1 - X) * 100}% 100%, 50% ${(0.5 + X) * 100}%, ` +
      `${X * 100}% 100%, 0 ${(1 - X) * 100}%, ${(0.5 - X) * 100}% 50%, 0 ${X * 100}%)`,
  },
}

export function shapeGeometry(shape) {
  return SHAPE_GEOMETRY[shape] ?? SHAPE_GEOMETRY.square
}

export function optionStyles(kind) {
  return kind === 'tf' ? TF_STYLES : OPTION_STYLES
}

/** ตัวเลือกที่จะแสดงจริง — tf ไม่ต้องให้สตาฟพิมพ์เอง */
export function optionLabels(question, t) {
  if (!question) return []
  if (question.kind === 'tf') return [t('quiz.true'), t('quiz.false')]
  return Array.isArray(question.options) ? question.options : []
}

// ---------------------------------------------------------------------
// จอใหญ่ 2 แบบ — ไม่ใช่แค่ย่อขยาย
// ---------------------------------------------------------------------
// projector = งานเลี้ยง จอ 16:9 คนดูห่าง 10 เมตร
// bus_tv    = ทีวี 15-19" บนรถ คนแถวหลังห่างกว่า และเครื่องเล่นซีพียูอ่อน
//             อนิเมชันหนักๆ จะกระตุกจนดูแย่กว่าไม่มีเลย
export const STAGE_PRESETS = {
  projector: {
    questionClass: 'text-4xl md:text-6xl',
    optionClass: 'text-2xl md:text-3xl',
    timerClass: 'text-6xl md:text-8xl',
    leaderboardRows: 10,
    showOptionText: true,
    animate: true,
  },
  bus_tv: {
    questionClass: 'text-4xl md:text-5xl',
    optionClass: 'text-3xl md:text-4xl',
    timerClass: 'text-7xl',
    leaderboardRows: 3,
    showOptionText: true,
    animate: false,
  },
}

export function stagePreset(mode) {
  return STAGE_PRESETS[mode] ?? STAGE_PRESETS.projector
}

// ---------------------------------------------------------------------
// สีทีม
// ---------------------------------------------------------------------
// ลูกทัวร์ตั้งชื่อทีมเองได้ แต่ "เลือกสีเองไม่ได้" — ระบบแจกเรียงตามลำดับที่สร้าง
// ถ้าให้เลือกเอง เดี๋ยวได้สองทีมสีฟ้าใกล้กันจนแยกไม่ออกจากท้ายรถ
// 8 สีนี้เลือกมาให้ต่างกันทั้งเฉดและความสว่าง อ่านออกบนพื้นดำของจอเวที
// และมีอิโมจิกำกับด้วย เผื่อคนตาบอดสี (เหตุผลเดียวกับรูปทรงของปุ่มตัวเลือก)
export const TEAM_STYLES = [
  { color: '#ef4444', badge: '🔴' },
  { color: '#3b82f6', badge: '🔵' },
  { color: '#22c55e', badge: '🟢' },
  { color: '#eab308', badge: '🟡' },
  { color: '#a855f7', badge: '🟣' },
  { color: '#f97316', badge: '🟠' },
  { color: '#14b8a6', badge: '🩵' },
  { color: '#ec4899', badge: '🩷' },
]

export function teamStyle(index) {
  return TEAM_STYLES[(index ?? 0) % TEAM_STYLES.length]
}

// ---------------------------------------------------------------------
// สกินจอเวที — คนละแกนกับ screen_mode
// ---------------------------------------------------------------------
// screen_mode ตอบคำถามว่า "จอใหญ่แค่ไหน คนดูห่างเท่าไร" (projector / bus_tv)
// stage_theme ตอบคำถามว่า "บรรยากาศแบบไหน" — สองอย่างนี้ผสมกันได้อิสระ
// เก็บในคอลัมน์ quiz_sessions.stage_theme ซึ่งมีอยู่แล้วตั้งแต่ migration แรก
// (ลอกรูปแบบมาจาก draw_rooms.stage_theme ของหน้าสุ่มรางวัลทั้งดุ้น)
//
// มีสองสกิน ไม่ใช่สาม — เคยร่าง "ตั๋วกระดาษ" ไว้ด้วยแล้วตัดทิ้ง เพราะจอเวที
// พื้นสว่างในห้องจัดเลี้ยงที่ปิดไฟจะแยงตาคนแถวหน้า และเราไม่มีเคสจริงที่ต้อง
// ฉายควิซกลางแดด (ทีวีบนรถใช้ bus_tv ซึ่งเป็นแกน screen_mode ไม่ใช่สกิน)
export const STAGE_SKINS = {
  // ค่าเริ่มต้น — ต่อยอดจากหน้าตาแอป ใช้ฟอนต์เดียวกับที่ self-host อยู่แล้ว
  // พื้นเข้มไล่เฉดไม่ดำสนิท เพราะกล้องถ่ายรูปงานจะได้ไม่ได้พื้นดำตาย
  day: {
    key: 'day',
    page: 'linear-gradient(150deg, #14243a 0%, #0d1a2b 55%, #122b34 100%)',
    ink: '#f4f9ff',
    muted: 'rgba(244,249,255,0.62)',
    panel: 'rgba(255,255,255,0.07)',
    panelLine: 'rgba(255,255,255,0.11)',
    accent: '#22c9c9',
    gold: '#f0b429',
    font: "'Noto Sans Thai Looped', 'Plus Jakarta Sans', system-ui, sans-serif",
    radius: '22px',
    outlineOptions: false,
  },
  // ตัวเลือก — งานเลี้ยงกลางคืนที่ปิดไฟ จอโปรเจกเตอร์เป็นแหล่งแสงเดียวในห้อง
  // ตัวเลือกเป็นกรอบเรืองแสงพื้นโปร่ง ไม่ใช่บล็อกสีทึบ เพราะบล็อกสีเต็มจอ
  // ในห้องมืดจะแยงตาจนอ่านข้อความในบล็อกไม่ออก
  neon: {
    key: 'neon',
    page: '#04060b',
    ink: '#eafcff',
    muted: 'rgba(234,252,255,0.55)',
    panel: 'rgba(255,255,255,0.05)',
    panelLine: 'rgba(255,255,255,0.09)',
    accent: '#25e0c0',
    gold: '#ffc233',
    font: "'Chakra Petch', 'Noto Sans Thai', system-ui, sans-serif",
    radius: '10px',
    outlineOptions: true,
  },
}

export const STAGE_SKIN_LIST = Object.values(STAGE_SKINS)

export function stageSkin(key) {
  return STAGE_SKINS[key] ?? STAGE_SKINS.day
}

// ═══════════════════════════════════════════════════════════════════════
// พื้นหลังตาหมากรุกของจอใหญ่สกิน arcade (ปริศนาใบ้คำ · เปิดแผ่นป้าย · What Words · Word Shuffle)
// ═══════════════════════════════════════════════════════════════════════
// ★ 12 ก.ย. 2026 เจ้าของโปรเจกต์: "ช่องเล็กเกินไป ลายตา · ขอสุ่มสีบ้าง จะได้ไม่เดิมๆ"
//   ช่องจึงใหญ่ขึ้นเท่าตัว (ยืดตามความกว้างจอ) และสีสุ่มจาก 4 ชุด
//   สุ่มด้วย "รหัสห้อง" ไม่ใช่ Math.random — จอใหญ่ · จอทีวีบนรถ · การรีเฟรชกลางเกม
//   ต้องได้สีเดียวกันเสมอ ไม่งั้นสีเปลี่ยนเองระหว่างเล่นจะดูเหมือนจอเสีย
export const CHECKER_COLORS = [
  { key: 'green', color: '#0f8a4a' },   // เขียวเดิมของเอกสารต้นฉบับ
  { key: 'blue', color: '#1560bd' },
  { key: 'orange', color: '#e2701a' },
  { key: 'violet', color: '#6d3fc4' },
]

/** ช่องหนึ่งตาราง — ยืดตามจอ: จอเล็กช่องเล็กลงหน่อยจะได้ไม่กินพื้นที่ จอใหญ่ช่องโต ไม่ลายตา */
const CHECKER_TILE = 'clamp(150px, 15vw, 280px)'

function hashString(text) {
  let h = 0
  for (const ch of String(text ?? '')) h = (h * 31 + ch.codePointAt(0)) % 100000
  return h
}

/** สีของห้องนี้ — คงที่ตลอดเกมเพราะคิดจากรหัสห้อง */
export function checkerColor(seed) {
  return CHECKER_COLORS[hashString(seed) % CHECKER_COLORS.length]
}

/**
 * ค่า CSS background ของพื้นหลังตาหมากรุก
 * @param {string} seed รหัสห้อง (session id) — ห้องเดียวกันได้สีเดียวกันทุกจอ
 */
export function stageChecker(seed) {
  const { color } = checkerColor(seed)
  return `repeating-conic-gradient(${color} 0% 25%, #ffffff 0% 50%) 50% / ${CHECKER_TILE} ${CHECKER_TILE}`
}
