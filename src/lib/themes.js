// ธีมสีต่อบริษัท (white-label) — บริษัททัวร์แต่ละรายเห็นแอปเป็นสีของตัวเอง
//
// หลักการสามข้อ (ดู MyTour_Theming_Design_v1.md §2):
//   1. ธีมคุมได้แค่ "สีแบรนด์" — เขียว/เหลือง/แดง เป็นสีความหมาย ห้ามเปลี่ยน
//      ถ้าปล่อยให้ลูกค้าเปลี่ยนสีปุ่ม SOS ได้ นั่นคือความเสี่ยง ไม่ใช่ฟีเจอร์
//   2. ระบบรับประกันคอนทราสต์เอง ไม่ฝากไว้กับรสนิยมลูกค้า
//      ลูกค้าเลือกสีมา → เราคำนวณเฉดที่เหลือ + ขยับจนผ่าน WCAG AA
//   3. พรีเซ็ตอยู่ในโค้ด ไม่อยู่ใน DB — เหตุผลเดียวกับที่ permissions.js
//      เลือก hardcode ตารางสิทธิ์: สิ่งที่ config เองได้คือสิ่งที่ทดสอบไม่ได้
//
// DB เก็บแค่ { theme_preset, theme_brand_color } ไม่เก็บ token ทั้งชุด
// เพื่อให้วันที่เราปรับพรีเซ็ตให้ดีขึ้น บริษัทเก่าได้อานิสงส์ด้วย

// ─────────────────────────────────────────────────────────────────
// แปลงสี
// ─────────────────────────────────────────────────────────────────

/** '#0891b2' → [8, 145, 178] · คืน null ถ้ารูปแบบผิด */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

/** [8, 145, 178] → '#0891b2' */
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')
}

/** [8, 145, 178] → '8 145 178' — รูปแบบที่ CSS variable ต้องการ (ดู index.css) */
export function rgbToTriple([r, g, b]) {
  return `${clamp255(r)} ${clamp255(g)} ${clamp255(b)}`
}

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

// ─────────────────────────────────────────────────────────────────
// คอนทราสต์ (WCAG 2.1)
// ─────────────────────────────────────────────────────────────────

function channelLuminance(v) {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** ความสว่างสัมพัทธ์ 0–1 */
export function luminance(rgb) {
  const [r, g, b] = rgb.map(channelLuminance)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** อัตราส่วนคอนทราสต์ 1–21 · AA ต้อง ≥ 4.5 สำหรับตัวหนังสือปกติ */
export function contrastRatio(rgbA, rgbB) {
  const a = luminance(rgbA)
  const b = luminance(rgbB)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = [255, 255, 255]

// ─────────────────────────────────────────────────────────────────
// คำนวณเฉดจากสีแบรนด์
// ─────────────────────────────────────────────────────────────────

/** ผสมสีสองสีตามสัดส่วน t (0 = สีแรก, 1 = สีที่สอง) */
function mix(rgbA, rgbB, t) {
  return rgbA.map((v, i) => v + (rgbB[i] - v) * t)
}

/** ทำให้เข้มขึ้นตามสัดส่วน (0.12 = เข้มขึ้น 12%) */
function darken(rgb, amount) {
  return mix(rgb, [0, 0, 0], amount)
}

/** ผสมขาวจนได้ความสว่างประมาณเป้าหมาย — ใช้ทำเฉดอ่อนสำหรับพื้นหลัง */
function tintToLuminance(rgb, targetLum) {
  // ความสว่างไม่เป็นเชิงเส้นกับสัดส่วนการผสม จึงหาด้วย binary search
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (luminance(mix(rgb, WHITE, mid)) < targetLum) lo = mid
    else hi = mid
  }
  return mix(rgb, WHITE, (lo + hi) / 2)
}

// ── HSL — ใช้เฉพาะตอนต้อง "สว่างขึ้นแต่ยังสดอยู่" ────────────────────
// ผสมขาวจะได้สีจืด ใช้ได้กับพื้นหลังอ่อน แต่ใช้กับหัว gradient ไม่ได้
// (ฟ้าทะเลจะกลายเป็นฟ้าหม่นแทนที่จะเป็นฟ้าสด)

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

/** สว่างขึ้นโดยคงเฉดสีและความสดไว้ */
function lighten(rgb, amount) {
  const [h, s, l] = rgbToHsl(rgb)
  return hslToRgb([h, s, Math.min(l + amount, 0.92)])
}

/**
 * เข้มสีลงทีละขั้นจนขาวอ่านออกบนพื้นนี้
 * คืน { rgb, adjusted } — adjusted บอกว่าขยับไปหรือเปล่า เพื่อเอาไปแจ้งผู้ใช้
 *
 * ทำไมต้องมี: ถ้าลูกค้าเลือกเหลืองสด ตัวหนังสือขาวบนปุ่มจะอ่านไม่ออกเลย
 * เราไม่ปฏิเสธสีของลูกค้า แต่เข้มลงให้พออ่านได้ แล้วบอกให้เขารู้
 */
function ensureWhiteReadable(rgb, minRatio = 4.5) {
  if (contrastRatio(rgb, WHITE) >= minRatio) return { rgb, adjusted: false }
  let cur = rgb
  for (let i = 0; i < 40; i++) {
    cur = darken(cur, 0.05)
    if (contrastRatio(cur, WHITE) >= minRatio) return { rgb: cur, adjusted: true }
  }
  return { rgb: cur, adjusted: true } // ดำสนิทแล้วก็ยอมแพ้ (ไม่มีทางเกิดขึ้นจริง)
}

/** ทำให้สว่างขึ้นทีละขั้นจนอ่านออกบนพื้นที่กำหนด — คู่ตรงข้ามของ ensureWhiteReadable */
function ensureReadableOn(rgb, bg, minRatio = 4.5) {
  let cur = rgb
  for (let i = 0; i < 40 && contrastRatio(cur, bg) < minRatio; i++) {
    cur = lighten(cur, 0.04)
  }
  return cur
}

// พื้นการ์ดของโหมดมืด — ต้องตรงกับ --c-surface ใน :root[data-mode='dark']
const DARK_SURFACE = [24, 33, 39]

/**
 * สร้าง token ชุดสีแบรนด์ทั้งหมดจากสีเดียว
 *
 * @param {string} hex สีแบรนด์ที่ owner เลือก
 * @param {'light'|'dark'} mode โหมดสีที่กำลังใช้อยู่
 *
 * ทำไมต้องรับ mode: ธีมของบริษัทถูกฉีดเป็น inline style บน <html>
 * ซึ่ง "ชนะ" กฎ :root[data-mode='dark'] ใน stylesheet เสมอ
 * ถ้าคำนวณชุดเดียวแล้วฉีดไปตรงๆ โหมดมืดจะได้เฉดแบรนด์ของโหมดสว่างมาแทน
 * (ชิปพื้นอ่อนจะสว่างจ้าบนพื้นดำ) จึงต้องคำนวณให้ตรงโหมดปัจจุบัน
 * แล้วฉีดใหม่ทุกครั้งที่สลับโหมด — ดู useOrgTheme.js
 *
 * คู่สีที่บังคับผ่าน AA (ดู MyTour_Theming_Design_v1.md §3.3):
 *   ขาว บน brand                 ≥ 4.5 — ปุ่มหลัก, หัวแถบ, ปุ่ม QR กลางแถบ
 *   brand-hover บน brand-lighter  ≥ 4.5 — ปุ่มรอง, ชิปเมนูล่างที่ active
 */
export function deriveBrandTokens(hex, mode = 'light') {
  const base = hexToRgb(hex)
  if (!base) return null

  const notes = []
  const isDark = mode === 'dark'

  // ปุ่มทึบยังใช้ตัวหนังสือขาวทั้งสองโหมด เกณฑ์จึงเหมือนกัน
  const { rgb: brand, adjusted } = ensureWhiteReadable(base)
  if (adjusted) {
    notes.push('ปรับสีแบรนด์ให้เข้มขึ้น เพื่อให้ตัวหนังสือขาวบนปุ่มอ่านออก')
  }

  // เฉดอ่อน/เข้มสลับบทบาทกันตามโหมด:
  //   โหมดสว่าง — light/lighter = พื้นชิปสีจาง, hover = ตัวหนังสือเข้ม
  //   โหมดมืด   — light/lighter = พื้นชิปสีเข้ม, hover = ตัวหนังสือสว่าง
  const brandLight = isDark ? mix(DARK_SURFACE, brand, 0.28) : tintToLuminance(brand, 0.78)
  const brandLighter = isDark ? mix(DARK_SURFACE, brand, 0.14) : tintToLuminance(brand, 0.93)
  const brandDeep = isDark ? lighten(brand, 0.28) : darken(brand, 0.3)
  // หัว gradient ต้องสว่างขึ้นแต่ยังสด — ผสมขาวจะได้สีจืด (ฟ้าทะเล → ฟ้าหม่น)
  const brandStart = isDark ? darken(brand, 0.18) : lighten(brand, 0.17)

  let brandHover = isDark ? lighten(brand, 0.16) : darken(brand, 0.14)

  // ปุ่มรอง: ตัวหนังสือ brand-hover บนพื้น brand-lighter ต้องอ่านออก
  //
  // ⚠️ ตรงนี้ไม่ push เข้า notes โดยตั้งใจ — brand-hover เป็นเฉดที่ระบบคำนวณเอง
  //    ผู้ใช้ไม่ได้เลือกมัน การบอกว่า "เราปรับสีตัวหนังสือปุ่มรองให้" จึงเป็นเสียงรบกวน
  //    notes สงวนไว้สำหรับกรณีที่เราแก้ "สีที่ผู้ใช้เลือกเอง" ซึ่งเขาต้องรู้
  //    ส่วนตัวเลขคอนทราสต์ที่ได้จริงโชว์อยู่ใน ratios ให้ดูได้อยู่แล้ว
  if (contrastRatio(brandHover, brandLighter) < 4.5) {
    if (isDark) {
      brandHover = ensureReadableOn(brandHover, brandLighter)
    } else {
      for (let i = 0; i < 40 && contrastRatio(brandHover, brandLighter) < 4.5; i++) {
        brandHover = darken(brandHover, 0.05)
      }
    }
  }

  return {
    tokens: {
      'c-brand': rgbToTriple(brand),
      'c-brand-hover': rgbToTriple(brandHover),
      'c-brand-light': rgbToTriple(brandLight),
      'c-brand-lighter': rgbToTriple(brandLighter),
      'c-brand-deep': rgbToTriple(brandDeep),
      'c-brand-start': rgbToTriple(brandStart),
    },
    notes,
    // เอาไว้โชว์ในหน้าตั้งค่าให้ owner เห็นว่าผ่านเกณฑ์เท่าไร
    ratios: {
      whiteOnBrand: contrastRatio(brand, WHITE),
      hoverOnLighter: contrastRatio(brandHover, brandLighter),
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// พรีเซ็ต
// ─────────────────────────────────────────────────────────────────

// ค่าที่ไม่ระบุในพรีเซ็ต = ใช้ค่าเริ่มต้นจาก :root ใน index.css
// สีความหมาย (success/warning/danger) ไม่มีในพรีเซ็ตโดยตั้งใจ — ห้ามเปลี่ยน
//
// แต่ละพรีเซ็ตมีสองชุด: `light` กับ `dark`
//
// ⚠️ ชุด dark ตั้งใจให้มีแค่สี accent — พื้นผิว/ตัวหนังสือ/เส้นขอบของโหมดมืด
//    ใช้ชุดกลางจาก index.css ร่วมกันทุกพรีเซ็ต
//    เหตุผล: บนพื้นเข้ม ความต่างของเทาแต่ละโทน (slate/zinc/navy) แทบมองไม่ออก
//    การแยกสี่ชุดจะได้พาเลตต์ที่เกือบเหมือนกัน แลกกับงานดูแลและงานทดสอบสี่เท่า
//    ถ้าวันหนึ่งลูกค้าทักว่าโหมดมืดของแต่ละธีมเหมือนกันหมด ค่อยแยกทีหลังได้
export const THEME_PRESETS = {
  ocean: {
    key: 'ocean',
    // เดิมคือ #0891b2 — เข้มขึ้นเป็น #077c99 เมื่อ ส.ค. 2569
    // เพราะตัวหนังสือขาวบนสีเดิมได้คอนทราสต์แค่ 3.68:1 ไม่ผ่าน AA (4.5:1)
    // ซึ่งกระทบปุ่มหลักกับปุ่ม QR กลางแถบ — จุดที่ลูกทัวร์ต้องกดกลางแดด
    name: 'ฟ้าทะเล',
    hint: 'โทนเดิมของ MyTour',
    brandColor: '#077c99',
    swatch: ['#077c99', '#066b84', '#f97362', '#eef4f7'],
    light: {}, // token ที่เหลือใช้ค่าเริ่มต้นใน index.css
    dark: {},
  },
  slate: {
    key: 'slate',
    name: 'Slate professional',
    hint: 'น้ำเงินเข้ม เรียบ น่าเชื่อถือ',
    brandColor: '#2f5d8c',
    swatch: ['#2f5d8c', '#1e3a5f', '#0f766e', '#f1f5f9'],
    dark: { 'c-accent': '45 212 191', 'c-accent-hover': '94 234 212', 'c-accent-bg': '17 59 55', 'c-accent-text': '153 246 228', 'c-on-accent': '43 13 8' },
    light: {
      'c-accent': '15 118 110',
      'c-accent-hover': '17 94 89',
      // เดิม 204 251 241 (#ccfbf1) มิ้นท์สดเกินไปสำหรับกรอบ "ตอนนี้" ที่กินพื้นที่ใหญ่
      'c-accent-bg': '227 246 241',
      'c-accent-text': '17 94 89',
      // accent ของธีมนี้เป็นเขียวเข้ม ตัวหนังสือบนพื้นนี้ต้องเป็นสีขาว
      // ไม่ใช่สีเข้มแบบค่าเริ่มต้นที่ทำไว้ให้ส้มพีชอ่อนของธีมฟ้าทะเล
      'c-on-accent': '255 255 255',
      'c-surface-muted': '248 250 252',
      'c-surface-sunken': '241 245 249',
      'c-ink': '15 23 42',
      'c-ink-muted': '100 116 139',
      'c-ink-faint': '100 116 139',
      'c-neutral-bg': '241 245 249',
      'c-neutral-text': '51 65 85',
      'c-line-subtle': '241 245 249',
      'c-line': '226 232 240',
      'c-line-strong': '203 213 225',
      'c-app-glow': '226 232 240',
      'c-scrollbar': '203 213 225',
    },
  },
  mono: {
    key: 'mono',
    name: 'Monochrome signal',
    hint: 'เทาทั้งระบบ ใช้สีเดียวบอกสถานะ',
    brandColor: '#27272a',
    swatch: ['#27272a', '#18181b', '#4f46e5', '#f4f4f5'],
    dark: { 'c-accent': '129 140 248', 'c-accent-hover': '165 180 252', 'c-accent-bg': '32 30 66', 'c-accent-text': '186 196 253', 'c-on-accent': '43 13 8' },
    light: {
      'c-accent': '79 70 229',
      'c-accent-hover': '67 56 202',
      'c-accent-bg': '238 242 255',
      'c-accent-text': '55 48 163',
      'c-on-accent': '255 255 255', // อินดิโกเข้ม → ตัวหนังสือขาว
      'c-surface-muted': '250 250 250',
      'c-surface-sunken': '244 244 245',
      'c-ink': '24 24 27',
      'c-ink-muted': '82 82 91',
      'c-ink-faint': '82 82 91',
      'c-neutral-bg': '244 244 245',
      'c-neutral-text': '63 63 70',
      'c-line-subtle': '244 244 245',
      'c-line': '228 228 231',
      'c-line-strong': '212 212 216',
      'c-app-glow': '244 244 245',
      'c-scrollbar': '212 212 216',
    },
  },
  navy: {
    key: 'navy',
    name: 'Navy brass',
    hint: 'กรมท่า + ทองเหลืองด้าน โทนพรีเมียม',
    brandColor: '#2c4269',
    swatch: ['#2c4269', '#152238', '#8f6d31', '#eef1f5'],
    dark: { 'c-accent': '212 175 106', 'c-accent-hover': '230 202 152', 'c-accent-bg': '56 44 22', 'c-accent-text': '235 208 158', 'c-on-accent': '43 13 8' },
    light: {
      'c-accent': '143 109 49',
      'c-accent-hover': '122 92 38',
      'c-accent-bg': '246 237 217',
      'c-accent-text': '107 79 31',
      'c-on-accent': '255 255 255', // ทองเหลืองด้าน → ตัวหนังสือขาว
      'c-surface-muted': '249 250 251',
      'c-surface-sunken': '238 241 245',
      'c-ink': '16 26 43',
      'c-ink-muted': '104 117 140',
      'c-ink-faint': '104 117 140',
      'c-neutral-bg': '238 241 245',
      'c-neutral-text': '58 74 100',
      'c-line-subtle': '238 241 245',
      'c-line': '227 230 236',
      'c-line-strong': '211 216 224',
      'c-app-glow': '227 230 236',
      'c-scrollbar': '211 216 224',
    },
  },
}

export const PRESET_KEYS = Object.keys(THEME_PRESETS)
export const DEFAULT_PRESET = 'ocean'

// ─────────────────────────────────────────────────────────────────
// รวมร่าง + ฉีดเข้า DOM
// ─────────────────────────────────────────────────────────────────

/**
 * แปลงค่าที่เก็บใน DB → ชุดตัวแปร CSS ที่พร้อมฉีด
 * @param {{ theme_preset?: string, theme_brand_color?: string }} row แถวจาก organizations
 * @param {'light'|'dark'} mode โหมดสีปัจจุบัน — ต้องส่งให้ตรง ไม่งั้นโหมดมืดจะได้เฉดของโหมดสว่าง
 * @returns {{ tokens: Record<string,string>, notes: string[], ratios: object|null }}
 */
export function resolveTheme(row, mode = 'light') {
  const presetKey = PRESET_KEYS.includes(row?.theme_preset) ? row.theme_preset : DEFAULT_PRESET
  const preset = THEME_PRESETS[presetKey]
  const presetTokens = (mode === 'dark' ? preset.dark : preset.light) || {}

  // สีแบรนด์: ถ้า owner ไม่ได้เลือกเอง ใช้ของพรีเซ็ต
  const brandHex = row?.theme_brand_color || preset.brandColor
  const derived = deriveBrandTokens(brandHex, mode)

  if (!derived) {
    // สีใน DB เสีย — ใช้พรีเซ็ตล้วน ดีกว่าโชว์แอปสีเพี้ยน
    console.warn('[themes] theme_brand_color ไม่ถูกต้อง ใช้สีของพรีเซ็ตแทน', row?.theme_brand_color)
    const fallback = deriveBrandTokens(preset.brandColor, mode)
    return { tokens: { ...presetTokens, ...fallback.tokens }, notes: [], ratios: fallback.ratios }
  }

  return {
    tokens: { ...presetTokens, ...derived.tokens },
    notes: derived.notes,
    ratios: derived.ratios,
  }
}

// จำไว้ว่าฉีดตัวแปรอะไรไปบ้าง เพื่อถอนคืนให้หมดตอนสลับธีม
// ถ้าไม่ถอน ธีมเก่าจะค้างเฉพาะตัวแปรที่ธีมใหม่ไม่ได้ระบุ
let appliedVars = []

/** ฉีดตัวแปรลง <html> — เรียกได้บ่อยเท่าที่ต้องการ (หน้าตั้งค่าเรียกทุกครั้งที่เลื่อนสี) */
export function applyThemeTokens(tokens, target = document.documentElement) {
  for (const name of appliedVars) target.style.removeProperty(`--${name}`)
  appliedVars = []
  for (const [name, value] of Object.entries(tokens || {})) {
    target.style.setProperty(`--${name}`, value)
    appliedVars.push(name)
  }
}

/** คืนค่าเริ่มต้นจาก index.css */
export function clearThemeTokens(target = document.documentElement) {
  applyThemeTokens({}, target)
}

// ─────────────────────────────────────────────────────────────────
// cache กันสีกระพริบตอนเปิดแอป
// ─────────────────────────────────────────────────────────────────
//
// ถ้ารอ DB ตอบก่อนค่อยฉีด ผู้ใช้จะเห็นสีเริ่มต้นแวบนึงแล้วเด้งเป็นสีบริษัท
// จึงเก็บธีมล่าสุดต่อ org ไว้ในเครื่อง แล้วฉีดทันทีตอนบูต
// (จำเป็นอยู่แล้วเพราะแอปต้องทำงานตอนออฟไลน์)

const CACHE_PREFIX = 'mytour_theme_'

export function cacheTheme(orgId, row) {
  if (!orgId) return
  try {
    localStorage.setItem(
      CACHE_PREFIX + orgId,
      JSON.stringify({
        theme_preset: row?.theme_preset ?? DEFAULT_PRESET,
        theme_brand_color: row?.theme_brand_color ?? null,
      })
    )
  } catch {
    // localStorage เต็ม/ถูกบล็อก — ไม่ใช่ critical path
  }
}

export function loadCachedTheme(orgId) {
  if (!orgId) return null
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + orgId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
