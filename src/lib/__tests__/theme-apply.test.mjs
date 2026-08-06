// จำลอง DOM แบบง่ายๆ พอให้ applyThemeTokens ทำงานได้ แล้วตรวจผลลัพธ์
const store = new Map()
const el = {
  style: {
    setProperty: (k, v) => store.set(k, v),
    removeProperty: (k) => store.delete(k),
  },
}
globalThis.document = { documentElement: el }
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null },
  setItem(k, v) { this._d.set(k, String(v)) },
}

const m = await import('../themes.js')
let fail = 0
const ok = (c, msg) => { if (!c) { fail++; console.log('  ✗', msg) } }

console.log('── บริษัท A: พรีเซ็ต navy ไม่ override สี')
m.applyThemeTokens(m.resolveTheme({ theme_preset: 'navy', theme_brand_color: null }).tokens)
ok(store.get('--c-brand') === '44 66 105', 'ได้สีกรมท่า')
ok(store.get('--c-accent') === '143 109 49', 'ได้ทองเหลืองจากพรีเซ็ต')
ok(!store.has('--c-success'), 'ไม่ฉีดสีความหมาย — ปล่อยให้ index.css คุม')
const navyCount = store.size

console.log('── บริษัท B: พรีเซ็ต slate + สีแบรนด์ของตัวเอง')
m.applyThemeTokens(m.resolveTheme({ theme_preset: 'slate', theme_brand_color: '#7c3aed' }).tokens)
ok(store.get('--c-brand') !== '44 66 105', 'สีแบรนด์เปลี่ยนจากบริษัทก่อนหน้า')
ok(store.get('--c-accent') === '15 118 110', 'accent มาจากพรีเซ็ต slate')
ok(!store.has('--c-success'), 'ยังไม่ฉีดสีความหมาย')

console.log('── สลับกลับ: ต้องไม่มีตัวแปรของธีมก่อนหน้าค้าง')
m.applyThemeTokens(m.resolveTheme({ theme_preset: 'ocean', theme_brand_color: null }).tokens)
ok(store.size < navyCount, `ocean ฉีดน้อยกว่า navy (${store.size} < ${navyCount})`)
ok(!store.has('--c-accent'), 'accent ของ navy/slate ถูกถอนออกแล้ว')
ok(store.get('--c-brand') === '7 124 153', 'กลับไปฟ้าทะเล')

console.log('── ล้างธีม')
m.clearThemeTokens()
ok(store.size === 0, 'ถอนตัวแปรออกหมด')

console.log('── cache')
m.cacheTheme('org-1', { theme_preset: 'navy', theme_brand_color: '#123456' })
const c = m.loadCachedTheme('org-1')
ok(c.theme_preset === 'navy' && c.theme_brand_color === '#123456', 'อ่าน cache กลับมาได้')
ok(m.loadCachedTheme('org-ไม่มี') === null, 'org ที่ไม่มี cache คืน null')
ok(m.loadCachedTheme(null) === null, 'orgId ว่างคืน null')

console.log('── ตัวแปรทุกตัวที่ฉีดต้องมีอยู่จริงใน index.css')
const cssText = await (await import('node:fs/promises')).readFile(
  new URL('../../index.css', import.meta.url), 'utf8')
const declared = new Set([...cssText.matchAll(/--(c-[a-z-]+)\s*:/g)].map((x) => x[1]))
for (const key of m.PRESET_KEYS) {
  m.applyThemeTokens(m.resolveTheme({ theme_preset: key }).tokens)
  for (const name of store.keys()) {
    ok(declared.has(name.slice(2)), `${key}: ${name} ต้องประกาศไว้ใน index.css ด้วย`)
  }
}
console.log(fail === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail ? 1 : 0)
