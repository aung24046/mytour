// ตัวช่วยของหน้าบันทึกรายจ่าย — แยกออกมาเพราะเป็นตรรกะล้วน ทดสอบได้โดยไม่ต้องมี DOM
//
// เป้าหมายของหน้านี้คือ "ลงรายการให้เร็วกว่าเปิด Google Sheet"
// ตัวช่วยพวกนี้จึงเน้นรับค่าที่คนพิมพ์จริงบนมือถือ ไม่ใช่ค่าที่ฟอร์มอยากได้

// 'อื่นๆ' อยู่ท้ายสุดเสมอ — เป็นตัวรับที่เหลือ ไม่ใช่ตัวเลือกที่ควรสะดุดตาก่อนหมวดจริง
// ⚠️ ค่าพวกนี้ถูกล็อกด้วย CHECK constraint ของ expenses.category ในฐานข้อมูลด้วย
//    เพิ่มหมวดใหม่ที่นี่อย่างเดียวจะ insert ไม่ผ่าน — ต้องมี migration คู่กันเสมอ
export const CATEGORIES = [
  'food',
  'transport',
  'accommodation',
  'entrance',
  'tip',
  'equipment',
  'misc',
]

/**
 * อ่านจำนวนเงินจากสิ่งที่คนพิมพ์จริง
 *
 * รองรับ:
 *   "1,250"      → 1250      (คนไทยพิมพ์คอมมาคั่นหลักติดมือจาก Excel)
 *   "1250 บาท"   → 1250      (พิมพ์หน่วยติดมาเพราะก๊อปจากใบเสร็จ)
 *   "120+80+45"  → 245       (ค่าอาหารหลายโต๊ะ ไม่ต้องเปิดเครื่องคิดเลข)
 *   " 90 "       → 90
 *
 * คืน null เมื่ออ่านไม่ออกหรือไม่เป็นบวก — ให้ผู้เรียกตัดสินใจว่าจะเตือนยังไง
 * ไม่ใช้ eval/Function เพราะรับ input จากผู้ใช้ตรงๆ — บวกทีละพจน์พอ
 */
export function parseAmount(input) {
  if (input == null) return null
  const cleaned = String(input).replace(/[,\s฿]|บาท/g, '')
  if (cleaned === '') return null

  const parts = cleaned.split('+')
  let total = 0
  for (const part of parts) {
    if (part === '') return null
    if (!/^\d*\.?\d+$/.test(part)) return null
    total += Number(part)
  }

  if (!Number.isFinite(total) || total <= 0) return null
  // ปัดสองตำแหน่งกันเศษทศนิยมลอยจากการบวก (0.1+0.2)
  return Math.round(total * 100) / 100
}

/** จำนวนหลักสูงสุดต่อหนึ่งก้อน — 9 หลักคือ 999 ล้าน พอสำหรับทัวร์ทุกขนาด
 *  และกันเคสนิ้วค้างบนปุ่มจนได้เลขยาวเป็นพรืด */
const MAX_DIGITS = 9

/**
 * ต่อปุ่มที่กดเข้ากับตัวเลขที่พิมพ์อยู่ — ตรรกะของแป้นตัวเลขที่เราวาดเอง
 *
 * ทำไมต้องเขียนแป้นเอง: คีย์บอร์ดของเครื่องกินจอ 302pt จาก 844pt (36%) และดันเนื้อหา
 * ขึ้นลงทุกครั้งที่เปิด-ปิด แป้นที่วาดเองสูง ~250pt อยู่กับที่ ไม่มีอะไรกระโดด
 * และวางไว้ครึ่งล่างของจอซึ่งนิ้วโป้งเอื้อมถึงสบายที่สุด
 *
 * กติกา:
 *   - '.' ใส่ได้ก้อนละจุดเดียว และถ้ายังไม่มีตัวเลขนำหน้าจะเติม '0.' ให้
 *   - '+' ต่อก้อนใหม่ ใส่ซ้ำหรือใส่ตอนยังว่างไม่ได้
 *   - ตัวเลขนำหน้าเป็น 0 โดดๆ จะถูกแทนที่ ไม่ใช่ต่อท้ายเป็น 0123
 */
export function appendAmountKey(current, key) {
  const value = String(current ?? '')
  const segment = value.split('+').pop()

  if (key === 'backspace') return value.slice(0, -1)
  if (key === 'clear') return ''

  if (key === '+') {
    if (value === '' || value.endsWith('+') || value.endsWith('.')) return value
    return `${value}+`
  }

  if (key === '.') {
    if (segment.includes('.')) return value
    return segment === '' ? `${value}0.` : `${value}.`
  }

  if (!/^\d$/.test(key)) return value

  const digits = segment.replace('.', '').length
  if (digits >= MAX_DIGITS) return value
  // '0' โดดๆ แล้วกดเลขต่อ = แทนที่ ไม่ใช่ 05
  if (segment === '0') return `${value.slice(0, -1)}${key}`
  return `${value}${key}`
}

/**
 * กรองสิ่งที่พิมพ์เข้ามาจากคีย์บอร์ด (ของเครื่องหรือคีย์บอร์ดจริงบนคอม) ให้เหลือรูปแบบเดียว
 * กับที่แป้นในแอปสร้าง — ทั้งสองทางจึงเขียนลง state ตัวเดียวกันได้โดยไม่ต้องแยกโหมด
 *
 * รับคอมมาคั่นหลักที่คนพิมพ์ติดมือ ('1,250' → '1250') และตัดทุกอย่างที่ parseAmount อ่านไม่ออก
 * ทิ้งเงียบๆ แทนที่จะขึ้น error — ระหว่างพิมพ์ยังไม่ใช่จังหวะที่ควรดุผู้ใช้
 */
export function sanitizeAmountInput(raw) {
  const cleaned = String(raw ?? '').replace(/[^\d.+]/g, '')
  if (cleaned === '') return ''

  const segments = cleaned.split('+')
  const out = segments.map((segment) => {
    const [head, ...rest] = segment.split('.')
    // จุดเกินก้อนละหนึ่งให้ยุบรวมกัน ('1.2.3' → '1.23')
    const decimals = rest.join('')
    const intPart = head.replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS)
    if (rest.length === 0) return intPart
    return `${intPart === '' ? '0' : intPart}.${decimals.slice(0, MAX_DIGITS)}`
  })

  // '+' นำหน้าหรือซ้อนกันถูกทิ้ง แต่ '+' ตัวท้ายเก็บไว้ได้ เพราะแปลว่ากำลังจะพิมพ์ก้อนต่อไป
  const kept = out.filter((s, i) => s !== '' || i === out.length - 1)
  return kept.join('+')
}

/** ใส่คอมมาคั่นหลักให้เลขที่กำลังพิมพ์ โดยไม่แตะส่วนทศนิยมและตัว + ที่ยังพิมพ์ค้างอยู่ */
export function formatAmountDisplay(value) {
  const str = String(value ?? '')
  if (str === '') return ''
  return str
    .split('+')
    .map((segment) => {
      const [intPart, decPart] = segment.split('.')
      const grouped = intPart === '' ? '' : Number(intPart).toLocaleString('en-US')
      if (decPart === undefined) return grouped
      return `${grouped === '' ? '0' : grouped}.${decPart}`
    })
    .join('+')
}

/**
 * รายชื่อคนจ่ายที่ให้เลือก — รวมคนที่ล็อกอินอยู่เข้าไปด้วยเสมอ
 *
 * ทำไม: ตัวเลือกมาจาก v_tour_staff ของทริปที่เปิดอยู่ ถ้าคนล็อกอินเป็นแอดมินระดับบริษัท
 * ที่ไม่ได้ถูกมอบหมายเข้าทริปนี้ ชื่อตัวเองจะไม่อยู่ในลิสต์ ช่องคนจ่ายเลยขึ้น "—"
 * ทั้งที่ค่าถูกตั้งไว้แล้ว — ดูเหมือนระบบไม่ได้ตั้งค่าให้ ทั้งที่ตั้งแล้ว
 */
export function payerOptions(staffList, me) {
  const list = (staffList ?? []).map((s) => ({ id: s.id, name: s.name }))
  if (me?.id && !list.some((s) => s.id === me.id)) {
    list.unshift({ id: me.id, name: me.name ?? '' })
  }
  return list
}

/** yyyy-mm-dd ของวันนี้ตามเวลาเครื่อง — ห้ามใช้ toISOString() เพราะมันแปลงเป็น UTC
 *  ไทยเป็น UTC+7 ทุกครั้งที่ลงรายการก่อน 07:00 จะได้วันที่ของเมื่อวาน */
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  d.setDate(d.getDate() + days)
  return localDateString(d)
}

/**
 * แกะข้อความที่วางมาจาก Google Sheet / Excel / โน้ตในมือถือ ให้เป็นรายการรายจ่าย
 *
 * ทีมที่ใช้ชีตอยู่แล้วจะมีของค้างอยู่ในชีตเสมอ ถ้าย้ายเข้าแอปแล้วต้องพิมพ์ใหม่ทีละแถว
 * ก็ไม่มีเหตุผลให้ย้าย — วางทับได้เลยคือทางออก
 *
 * รับได้ทั้ง tab (จากชีต) และคอมมา (จากโน้ต) เป็นตัวคั่น
 *   "350\tค่าอาหารเที่ยง"  → { amount: 350, description: 'ค่าอาหารเที่ยง' }
 *   "350, ค่าอาหารเที่ยง"  → เหมือนกัน
 *   "350"                  → { amount: 350, description: '' }
 * บรรทัดที่อ่านจำนวนเงินไม่ออกจะถูกข้าม (เช่นหัวตารางที่ติดมาด้วย)
 */
export function parsePastedRows(text) {
  if (!text) return []
  return String(text)
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return null

      const cells = trimmed.split(/\t|,(?=\s*\D)/)
      const amount = parseAmount(cells[0])
      if (amount == null) return null

      return { amount, description: (cells.slice(1).join(' ') || '').trim() }
    })
    .filter(Boolean)
}

/** ค่าตั้งต้นที่จำไว้ต่อทริป — หมวดที่ใช้ล่าสุดกับคนจ่ายล่าสุด
 *  เก็บใน localStorage เพราะเป็นความชอบของ "เครื่องนี้" ไม่ใช่ข้อมูลทริป */
const PREFS_KEY = 'mytour_expense_prefs'

export function readExpensePrefs(tourId) {
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return all[tourId] ?? {}
  } catch {
    return {}
  }
}

export function writeExpensePrefs(tourId, prefs) {
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    all[tourId] = { ...(all[tourId] ?? {}), ...prefs }
    localStorage.setItem(PREFS_KEY, JSON.stringify(all))
  } catch {
    // no-op — จำไม่ได้ก็แค่กลับไปใช้ค่าตั้งต้นเดิม ไม่ใช่เรื่องที่ต้องเตือนผู้ใช้
  }
}
