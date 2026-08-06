// ตรวจคอนทราสต์ของคู่สีที่ใช้จริงในแอป ทั้งโหมดสว่างและโหมดมืด
//
// ทำไมต้องมีไฟล์นี้: การตรวจสีทีละตัวไม่บอกอะไร คนอ่านไม่ได้อ่าน "สีตัวหนังสือ"
// เขาอ่าน "ตัวหนังสือสีนี้ บนพื้นสีนี้" — คู่สีต่างหากที่ต้องผ่านเกณฑ์
//
// ค่าสีอ่านจาก index.css โดยตรง ไม่ได้ copy มาไว้ที่นี่
// ถ้าใครแก้สีใน index.css แล้วคอนทราสต์ตก เทสต์นี้จะจับได้ทันที

import { readFileSync } from 'node:fs'
import { contrastRatio, THEME_PRESETS, PRESET_KEYS } from '../themes.js'

const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')

/** ดึงตัวแปรจากบล็อกที่กำหนด */
function readVars(mode) {
  const start =
    mode === 'doc'
      ? css.indexOf(":root[data-mode='dark'] .doc-root")
      : mode === 'dark'
        ? css.indexOf(":root[data-mode='dark'] {")
        : css.indexOf(':root {')
  if (start < 0) throw new Error(`หาบล็อก ${mode} ใน index.css ไม่เจอ`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  const block = css.slice(open, close)
  const out = {}
  for (const m of block.matchAll(/--(c-[a-z-]+):\s*([0-9]+ [0-9]+ [0-9]+)\s*;/g)) {
    out[m[1]] = m[2].split(' ').map(Number)
  }
  return out
}

const WHITE = [255, 255, 255]

// คู่สีที่ใช้จริง — [ตัวหนังสือ, พื้นหลัง, ที่ใช้, เกณฑ์]
// เกณฑ์ 4.5 = ตัวหนังสือปกติ · 3.0 = ตัวใหญ่หรือองค์ประกอบ UI (เส้นขอบ ไอคอน)
const PAIRS = [
  ['c-ink', 'c-surface', 'ข้อความหลักบนการ์ด', 4.5],
  ['c-ink', 'c-surface-muted', 'ข้อความหลักบนพื้นหน้า', 4.5],
  ['c-ink', 'c-surface-sunken', 'ข้อความหลักบนพื้นจม', 4.5],
  ['c-ink-muted', 'c-surface', 'ข้อความรอง', 4.5],
  ['c-ink-muted', 'c-surface-sunken', 'ข้อความรองบนพื้นจม', 4.5],
  ['c-ink-faint', 'c-surface', 'ข้อความจาง', 4.5],
  ['c-ink-faint', 'c-surface-sunken', 'ข้อความจางบนพื้นจม', 4.5],
  ['c-neutral-text', 'c-surface', 'ข้อความน้ำหนักกลาง', 4.5],

  ['c-brand-hover', 'c-brand-lighter', 'ปุ่มรอง / ชิปเมนูล่างที่เลือกอยู่', 4.5],
  ['c-brand-hover', 'c-brand-light', 'ชิปแบรนด์เข้ม', 4.5],
  ['c-brand', 'c-surface', 'ไอคอนสีแบรนด์บนการ์ด', 3.0],
  ['c-brand-deep', 'c-surface', 'หัวข้อสีแบรนด์เข้ม', 4.5],

  // สถานะ "ตอนนี้" ใช้สีที่สาม (accent) ไม่ใช่สีแบรนด์และไม่ใช่เขียว
  // เพื่อให้แยกออกจาก "เสร็จแล้ว" และยังมีมิติต่างจากปุ่มหลัก
  ['c-accent-text', 'c-accent-bg', 'ป้าย/การ์ด "ตอนนี้"', 4.5],
  ['c-accent-text', 'c-surface', 'เวลาของรายการที่กำลังทำอยู่', 4.5],
  ['c-accent-text', 'c-surface-muted', 'เวลาบนไทม์ไลน์หน้าแรก', 4.5],
  ['c-success-text', 'c-success-bg', 'ป้ายสำเร็จ', 4.5],
  ['c-warning-text', 'c-warning-bg', 'ป้ายเตือน', 4.5],
  ['c-warning-ink', 'c-warning-bg', 'ข้อความประกาศด่วน', 4.5],
  ['c-danger-text', 'c-danger-bg', 'ป้ายอันตราย', 4.5],

  ['c-line-strong', 'c-surface', 'ขอบช่องกรอก', 1.5],
  ['c-line', 'c-surface', 'ขอบการ์ด', 1.1],
]

// ตัวหนังสือขาวบนพื้นทึบ — ปุ่มหลักและป้ายสถานะ
const ON_SOLID = [
  ['c-brand', 'ปุ่มหลัก / หัวแถบ / ปุ่ม QR'],
  ['c-success', 'ป้าย "ตอนนี้" บนกำหนดการ'],
  ['c-danger', 'ปุ่มขอความช่วยเหลือ'],
]

// พื้นที่สว่างเกินกว่าจะใช้ตัวหนังสือขาว — ใช้ตัวหนังสือเข้มแทน
const ON_TINTED = [
  ['c-on-accent', 'c-accent', 'ปุ่มเน้น (ส้มพีช)'],
  ['c-on-warning', 'c-warning', 'ปุ่ม/ป้ายเตือน (เหลืองอำพัน)'],
]

let fail = 0
for (const mode of ['light', 'dark']) {
  const v = readVars(mode)
  console.log(`\n── โหมด${mode === 'dark' ? 'มืด' : 'สว่าง'}`)

  for (const [fg, bg, label, min] of PAIRS) {
    if (!v[fg] || !v[bg]) {
      fail++
      console.log(`  ✗ ${label}: ไม่มีตัวแปร ${!v[fg] ? fg : bg} ในบล็อก ${mode}`)
      continue
    }
    const r = contrastRatio(v[fg], v[bg])
    if (r < min) {
      fail++
      console.log(`  ✗ ${label.padEnd(34)} ${r.toFixed(2)} < ${min}  (${fg} บน ${bg})`)
    }
  }

  for (const [fg, bg, label] of ON_TINTED) {
    const r = contrastRatio(v[fg], v[bg])
    if (r < 4.5) {
      fail++
      console.log(`  ✗ ${label.padEnd(34)} ${r.toFixed(2)} < 4.5`)
    }
  }

  for (const [bg, label] of ON_SOLID) {
    const r = contrastRatio(WHITE, v[bg])
    if (r < 4.5) {
      fail++
      console.log(`  ✗ ขาวบน ${label.padEnd(28)} ${r.toFixed(2)} < 4.5`)
    }
  }

  // สีเชิงหมวดหมู่ (เพศ/ประเภทที่นั่ง) ยังเป็นสี Tailwind ดิบ ไม่ได้อยู่ใน token
  // แต่ต้องอ่านออกบนพื้นของโหมดนั้นด้วย จึงตรวจแยก
  const CATEGORICAL = {
    'ชาย (blue-600)': [37, 99, 235],
    'หญิง (pink-600)': [219, 39, 119],
    'ทีมงาน (emerald-700)': [4, 120, 87],
    'VIP (amber-700)': [180, 83, 9],
  }
  for (const [label, rgb] of Object.entries(CATEGORICAL)) {
    // ใช้เป็นพื้นทึบคู่กับตัวหนังสือขาวเสมอ
    const r = contrastRatio(WHITE, rgb)
    if (r < 4.5) {
      fail++
      console.log(`  ✗ ขาวบน ${label.padEnd(28)} ${r.toFixed(2)} < 4.5`)
    }
  }
}

// ── หน้าเอกสาร A4 ตอนผู้ใช้เปิดโหมดมืด ────────────────────────────
// เอกสารเป็นกระดาษขาวเสมอ ตัวหนังสือจึงต้องเป็นสีเข้ม ไม่ใช่สีอ่อนของโหมดมืด
console.log('\n── หน้าเอกสาร A4 (ขณะเปิดโหมดมืด)')
{
  const v = readVars('doc')
  const DOC_PAIRS = [
    ['c-ink', 'ข้อความหลักในเอกสาร'],
    ['c-ink-muted', 'ข้อความรองในเอกสาร'],
    ['c-ink-faint', 'ข้อความจางในเอกสาร'],
    ['c-danger', 'ข้อความเตือนในเอกสาร'],
  ]
  for (const [tok, label] of DOC_PAIRS) {
    if (!v[tok]) {
      fail++
      console.log(`  ✗ ${label}: .doc-root ไม่ได้ประกาศ ${tok} — จะตกไปใช้ค่าโหมดมืด`)
      continue
    }
    const r = contrastRatio(v[tok], WHITE)
    if (r < 4.5) {
      fail++
      console.log(`  ✗ ${label.padEnd(34)} ${r.toFixed(2)} < 4.5 บนกระดาษขาว`)
    }
  }
}

// ── พรีเซ็ตแต่ละชุด ────────────────────────────────────────────────
// ⚠️ ช่องโหว่ที่เคยพลาด: เทสต์เดิมตรวจแค่ค่าใน index.css ซึ่งเป็นชุดของธีม
//    ฟ้าทะเลเท่านั้น พรีเซ็ตอื่นไม่เคยถูกตรวจเลย
//    ผลคือ slate/mono/navy ที่มี accent เป็น "สีเข้ม" ยังใช้ตัวหนังสือสีเข้ม
//    ทับไปด้วย (ค่าเริ่มต้นที่ทำไว้ให้ส้มพีชอ่อน) → ป้าย "ตอนนี้" อ่านไม่ออก
//    ตอนนี้ตรวจทุกพรีเซ็ต ทั้งสองโหมด
console.log('\n── พรีเซ็ตแต่ละชุด')
for (const key of PRESET_KEYS) {
  for (const mode of ['light', 'dark']) {
    const base = readVars(mode)
    const over = (mode === 'dark' ? THEME_PRESETS[key].dark : THEME_PRESETS[key].light) || {}
    // token ที่พรีเซ็ตไม่ระบุ = ใช้ค่าเริ่มต้นจาก index.css
    const v = { ...base }
    for (const [k, val] of Object.entries(over)) v[k] = val.split(' ').map(Number)

    const CHECKS = [
      ['c-on-accent', 'c-accent', 'ตัวหนังสือบนป้าย "ตอนนี้"'],
      ['c-accent-text', 'c-accent-bg', 'ตัวหนังสือบนกรอบ "ตอนนี้"'],
      ['c-ink', 'c-surface', 'ข้อความหลัก'],
      ['c-ink-muted', 'c-surface', 'ข้อความรอง'],
      ['c-ink-faint', 'c-surface', 'ข้อความจาง'],
      ['c-on-warning', 'c-warning', 'ตัวหนังสือบนป้ายเตือน'],
    ]
    for (const [fg, bg, label] of CHECKS) {
      const r = contrastRatio(v[fg], v[bg])
      if (r < 4.5) {
        fail++
        console.log(`  ✗ [${key}/${mode}] ${label.padEnd(26)} ${r.toFixed(2)} < 4.5`)
      }
    }
  }
}

console.log(fail === 0 ? '\n✅ คู่สีผ่านเกณฑ์ทั้งหมด ทุกโหมด ทุกพรีเซ็ต' : `\n❌ ไม่ผ่าน ${fail} คู่`)
process.exit(fail ? 1 : 0)
