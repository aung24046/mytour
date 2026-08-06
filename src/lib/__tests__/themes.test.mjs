import {
  hexToRgb, rgbToHex, rgbToTriple, contrastRatio, deriveBrandTokens,
  resolveTheme, THEME_PRESETS, PRESET_KEYS,
} from '../themes.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }
const trip = (t) => t.split(' ').map(Number)
const WHITE = [255,255,255]

console.log('── แปลงสี')
ok(rgbToHex(hexToRgb('#0891b2')) === '#0891b2', 'hex ไป-กลับ')
ok(rgbToHex(hexToRgb('#08f')) === '#0088ff', 'hex 3 หลัก')
ok(hexToRgb('ไม่ใช่สี') === null, 'สีผิดรูปแบบคืน null')
ok(hexToRgb('#12345') === null, 'ความยาวผิดคืน null')
ok(rgbToTriple([8,145,178]) === '8 145 178', 'รูปแบบเลขสามช่อง')
ok(rgbToTriple([-5, 300, 12.6]) === '0 255 13', 'ค่าเกินขอบถูกหนีบ')

console.log('── คอนทราสต์')
ok(Math.abs(contrastRatio([0,0,0], WHITE) - 21) < 0.01, 'ดำ/ขาว = 21')
ok(Math.abs(contrastRatio(WHITE, WHITE) - 1) < 0.01, 'ขาว/ขาว = 1')

console.log('── guard คอนทราสต์ (หัวใจของงานนี้)')
const CASES = [
  ['#077c99', 'ฟ้าทะเล (แก้แล้ว)'],
  ['#0891b2', 'ฟ้าทะเลเดิม — ต้องโดนขยับ'],
  ['#2f5d8c', 'น้ำเงิน slate'],
  ['#27272a', 'เทาเกือบดำ'],
  ['#2c4269', 'กรมท่า'],
  ['#facc15', 'เหลืองสด — ต้องโดนขยับ'],
  ['#22c55e', 'เขียวสด'],
  ['#f472b6', 'ชมพูอ่อน — ต้องโดนขยับ'],
  ['#ffffff', 'ขาวล้วน — เคสสุดโต่ง'],
  ['#000000', 'ดำล้วน — เคสสุดโต่ง'],
  ['#e11d48', 'แดงเข้ม'],
  ['#06b6d4', 'ฟ้าสด'],
]
for (const [hex, label] of CASES) {
  const d = deriveBrandTokens(hex)
  ok(d !== null, `${label}: คำนวณได้`)
  const brand = trip(d.tokens['c-brand'])
  const hover = trip(d.tokens['c-brand-hover'])
  const lighter = trip(d.tokens['c-brand-lighter'])
  const light = trip(d.tokens['c-brand-light'])
  const rWhite = contrastRatio(brand, WHITE)
  const rHover = contrastRatio(hover, lighter)
  ok(rWhite >= 4.49, `${label}: ขาวบนแบรนด์ ${rWhite.toFixed(2)} ต้อง ≥ 4.5`)
  ok(rHover >= 4.49, `${label}: ปุ่มรอง ${rHover.toFixed(2)} ต้อง ≥ 4.5`)
  ok(contrastRatio(light, WHITE) < contrastRatio(brand, WHITE), `${label}: brand-light ต้องอ่อนกว่า brand`)
  for (const [k, v] of Object.entries(d.tokens)) {
    ok(/^\d{1,3} \d{1,3} \d{1,3}$/.test(v), `${label}: ${k} รูปแบบถูกต้อง (ได้ "${v}")`)
  }
  const mark = d.notes.length ? '⚠ ขยับ' : '  ผ่านเลย'
  console.log(`  ${mark}  ${label.padEnd(28)} ขาว/แบรนด์ ${rWhite.toFixed(2).padStart(5)}  ปุ่มรอง ${rHover.toFixed(2).padStart(5)}`)
}

console.log('── เคสที่ต้องมีคำเตือน')
ok(deriveBrandTokens('#facc15').notes.length > 0, 'เหลืองสดต้องมีคำเตือน')
ok(deriveBrandTokens('#facc15').notes.length === 1, 'คำเตือนต้องมีแค่เรื่องสีที่ผู้ใช้เลือก ไม่รวมเฉดที่ระบบคำนวณเอง')
ok(deriveBrandTokens('#ffffff').notes.length > 0, 'ขาวล้วนต้องมีคำเตือน')
ok(deriveBrandTokens('#0891b2').notes.length > 0, 'ฟ้าทะเลเดิมต้องมีคำเตือน (คอนทราสต์ 3.68)')
ok(deriveBrandTokens('#077c99').notes.length === 0, 'ฟ้าทะเลที่แก้แล้วต้องไม่มีคำเตือน')

console.log('── พรีเซ็ต')
for (const k of PRESET_KEYS) {
  const p = THEME_PRESETS[k]
  ok(hexToRgb(p.brandColor) !== null, `${k}: brandColor ใช้ได้`)
  for (const mode of ['light', 'dark']) {
    const d = deriveBrandTokens(p.brandColor, mode)
    ok(d.notes.length === 0, `${k}/${mode}: พรีเซ็ตของเราเองต้องไม่โดนขยับ`)
    const set = mode === 'dark' ? p.dark : p.light
    ok(set !== undefined, `${k}: ต้องมีชุด ${mode}`)
    for (const t of Object.values(set)) {
      ok(/^\d{1,3} \d{1,3} \d{1,3}$/.test(t), `${k}/${mode}: token รูปแบบถูกต้อง`)
    }
    ok(!Object.keys(set).some((n) => /success|warning|danger/.test(n)),
       `${k}/${mode}: ห้ามมีสีความหมายในพรีเซ็ต`)
  }
}

console.log('── โหมดมืด: เฉดแบรนด์ต้องสลับบทบาท')
for (const [hex, label] of CASES) {
  const L = deriveBrandTokens(hex, 'light')
  const D = deriveBrandTokens(hex, 'dark')
  const lum = (t) => {
    const [r, g, b] = trip(t).map((v) => v / 255)
    const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  // พื้นชิปในโหมดมืดต้องเข้ม ไม่ใช่สว่างจ้าแบบโหมดสว่าง
  ok(lum(D.tokens['c-brand-lighter']) < 0.2, `${label}: โหมดมืด brand-lighter ต้องเป็นสีเข้ม`)
  ok(lum(L.tokens['c-brand-lighter']) > 0.7, `${label}: โหมดสว่าง brand-lighter ต้องเป็นสีอ่อน`)
  // ตัวหนังสือบนชิปต้องอ่านออกทั้งสองโหมด
  ok(contrastRatio(trip(D.tokens['c-brand-hover']), trip(D.tokens['c-brand-lighter'])) >= 4.49,
     `${label}: โหมดมืด ปุ่มรองต้องผ่าน AA`)
  ok(contrastRatio(trip(D.tokens['c-brand']), WHITE) >= 4.49,
     `${label}: โหมดมืด ขาวบนปุ่มหลักต้องผ่าน AA`)
}

console.log('── resolveTheme')
ok(Object.keys(resolveTheme(null).tokens).length > 0, 'row ว่างยังได้ธีมเริ่มต้น')
ok(resolveTheme({ theme_preset: 'ไม่มีจริง' }).tokens['c-brand'] === rgbToTriple(hexToRgb('#077c99')), 'พรีเซ็ตมั่วตกไปที่ ocean')
ok(resolveTheme({ theme_preset: 'slate' }, 'dark').tokens['c-brand-lighter']
   !== resolveTheme({ theme_preset: 'slate' }, 'light').tokens['c-brand-lighter'],
   'โหมดมืดกับสว่างต้องได้เฉดต่างกัน')
const bad = resolveTheme({ theme_preset: 'slate', theme_brand_color: 'พัง' })
ok(bad.tokens['c-brand'] === rgbToTriple(hexToRgb('#2f5d8c')), 'สีเสียใน DB ตกไปใช้สีพรีเซ็ต')
const custom = resolveTheme({ theme_preset: 'slate', theme_brand_color: '#7c3aed' })
ok(custom.tokens['c-brand'] !== rgbToTriple(hexToRgb('#2f5d8c')), 'สีที่ owner เลือกชนะพรีเซ็ต')
ok(custom.tokens['c-line'] === THEME_PRESETS.slate.light['c-line'], 'token อื่นยังมาจากพรีเซ็ต')

console.log(fail === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail ? 1 : 0)
