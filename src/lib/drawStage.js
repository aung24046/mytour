// ธีมและจังหวะของ "จอใหญ่" เกมสุ่มรายชื่อ
//
// แยกออกมาเป็นไฟล์เดียวเพราะจอโปรเจกเตอร์กับมือถือลูกทัวร์ต้องเล่นอนิเมชัน
// แบบเดียวกันในจังหวะเดียวกัน ถ้าฝังค่าไว้คนละหน้า เวลาจะเพี้ยนกันทันที
//
// ⚠️ สีในนี้จงใจไม่ผูกกับ token ธีมบริษัท (--c-brand ฯลฯ) ต่างจากส่วนอื่นของแอป
//    เพราะจอใหญ่คือ "เวที" ไม่ใช่หน้าเครื่องมือ — ทีมงานเลือกบรรยากาศได้เอง
//    ต่อทริป และต้องอ่านออกจากท้ายห้องมืด ซึ่งสีแบรนด์บางเจ้าทำไม่ได้

export const STAGE_THEMES = {
  led: {
    key: 'led',
    swatch: '#2be8c8',
    page: '#05080d', ink: '#eafcf8', muted: 'rgba(234,252,248,.55)',
    accent: '#2be8c8', gold: '#ffb020',
    disp: "'Chakra Petch', 'Noto Sans Thai', sans-serif",
    radius: 6, light: false,
    wheel: { seg: ['#0e2029', '#132b36'], win: '#0d2f33', stroke: '#223947', text: '#eafcf8' },
    confetti: ['#2be8c8', '#ffb020', '#ff4d8d', '#ffffff'],
  },
  board: {
    key: 'board',
    swatch: '#ff6b35',
    page: '#101317', ink: '#f2f4f7', muted: 'rgba(242,244,247,.5)',
    accent: '#ff6b35', gold: '#e8b44a',
    disp: "'Anuphan', 'Noto Sans Thai', sans-serif",
    radius: 3, light: false, flap: true,
    wheel: { seg: ['#1a1e24', '#20252c'], win: '#2a2119', stroke: '#39404a', text: '#edeff2' },
    confetti: ['#ff6b35', '#e8b44a', '#edeff2', '#9aa3ae'],
  },
  emerald: {
    key: 'emerald',
    swatch: '#d4af37',
    page: '#052018', ink: '#f6f0e2', muted: 'rgba(246,240,226,.55)',
    accent: '#d4af37', gold: '#e8c86a',
    disp: "'Kanit', 'Noto Sans Thai', sans-serif",
    radius: 4, light: false, frame: true,
    wheel: { seg: ['#0a2a20', '#0d3529'], win: '#164434', stroke: '#1d5540', text: '#f3ecdc' },
    confetti: ['#d4af37', '#e8c86a', '#f3ecdc', '#c1683a'],
  },
  sky: {
    key: 'sky',
    swatch: '#1d7fd8',
    page: 'linear-gradient(176deg,#a8d2f7 0%,#cfe6fb 34%,#eef6ff 68%,#fff 100%)',
    ink: '#0d2039', muted: 'rgba(13,32,57,.55)',
    accent: '#1d7fd8', gold: '#e08b12',
    disp: "'Anuphan', 'Noto Sans Thai', sans-serif",
    radius: 14, light: true,
    wheel: { seg: ['#eaf3fc', '#dbe9f8'], win: '#c9e0f7', stroke: '#b7cee6', text: '#10243f' },
    confetti: ['#1d7fd8', '#f2724b', '#e08b12', '#ffffff'],
  },
  grid: {
    key: 'grid',
    swatch: '#d6402c',
    page: '#fbfaf5', ink: '#1a1a18', muted: 'rgba(26,26,24,.55)',
    accent: '#d6402c', gold: '#b07d09',
    disp: "'Anuphan', 'Noto Sans Thai', sans-serif",
    radius: 2, light: true, paper: true,
    wheel: { seg: ['#fbfaf5', '#f0eee5'], win: '#f6e0da', stroke: '#cfcbbc', text: '#1a1a18' },
    confetti: ['#d6402c', '#1a1a18', '#b07d09', '#ffffff'],
  },
  candy: {
    key: 'candy',
    swatch: '#e0417a',
    page: 'linear-gradient(168deg,#ffe8ef 0%,#fff3e6 52%,#e6f7f2 100%)',
    ink: '#4a2340', muted: 'rgba(74,35,64,.55)',
    accent: '#e0417a', gold: '#f0a03c',
    disp: "'Mitr', 'Noto Sans Thai', sans-serif",
    radius: 26, light: true, soft: true,
    wheel: { seg: ['#fff2f6', '#ffe6ee'], win: '#ffd9e6', stroke: '#eec7d5', text: '#4a2340' },
    confetti: ['#e0417a', '#f0a03c', '#5dc7af', '#ffffff'],
  },
}

export const THEME_LIST = Object.values(STAGE_THEMES)
export const getTheme = (key) => STAGE_THEMES[key] ?? STAGE_THEMES.led

export const ANIM_KEYS = ['slot', 'wheel', 'elim']

// จังหวะรวมของแต่ละแบบ (มิลลิวินาที)
// ทุกแบบเล่นสองช่วง: พุ่งเร็ว → เกือบหยุดผิดคน → คืบต่อช้าๆ เข้าคนจริง
// ช่วงหลังต้องยาวพอให้คนทั้งห้องลุ้นทัน ต่ำกว่านี้แล้วรู้สึกว่า "จบห้วน"
export const ANIM_MS = { slot: 7000, wheel: 7600, elim: 8200 }

/** ความสูงของแต่ละชื่อในสล็อต — จอใหญ่กับมือถือคนละสเกล */
export const SLOT_ROW = { full: 140, mini: 46 }

/**
 * ตัดข้อความเป็นหน่วยอักษร (grapheme) สำหรับป้ายพลิกแบบสนามบิน
 * ตัดตรงๆ ทีละ char ไม่ได้ เพราะสระกับวรรณยุกต์ไทยจะหลุดจากพยัญชนะ
 */
export function graphemes(text) {
  const s = String(text ?? '')
  try {
    return [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment)
  } catch {
    return Array.from(s)
  }
}

/**
 * มุมที่ต้องหมุนวงล้อให้ช่องผู้ชนะ (ช่องที่ 0) มาหยุดใต้เข็มพอดี
 * แบ่งสองจังหวะ: หยุดคาขอบช่องก่อน แล้วค่อยคืบเข้ากลาง
 */
export function wheelAngles(segments) {
  const a = 360 / Math.max(1, segments)
  const base = 360 * 7 - a / 2
  return { first: base - a * 0.44, final: base, segAngle: a }
}

/** สร้างรายชื่อหลอกสำหรับรีลสล็อต ปิดท้ายด้วยชื่อจริงเสมอ */
export function slotStrip(pool, winner, len = 34) {
  const out = []
  for (let i = 0; i < len; i += 1) {
    out.push(pool[Math.floor(Math.random() * pool.length)] ?? winner)
  }
  out.push(winner)
  return out
}
