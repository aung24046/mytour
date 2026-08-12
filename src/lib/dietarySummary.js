// แปรผลคำตอบเรื่องอาหาร/สุขภาพจากฟอร์มลงทะเบียน ให้พร้อมแสดงผล
//
// ทำไมต้องมีไฟล์นี้: คำตอบถูกเก็บเป็น "สตริงเดียว" ที่อัดหลายอย่างรวมกัน
//   "กุ้ง / กั้ง / ปู (Shellfish), อื่นๆ โปรดระบุ (Other, please specify): หัวหอม"
// ซึ่งอ่านตรง ๆ ไม่ได้เลย ต้องแกะ 4 ชั้น: ตัดตัวเลือก → แยกข้อความที่ผู้ใช้พิมพ์เอง
// → ตัดวงเล็บภาษาอังกฤษ → รวมคำตอบที่ความหมายเดียวกัน
//
// ⚠️ ห้าม import อะไรที่ผูกกับ React/DOM ในไฟล์นี้ — มี unit test เรียกตรงจาก node
//    (src/lib/__tests__/dietary.test.mjs)

// ── 1. ค่าที่แปลว่า "ไม่มี" ────────────────────────────────────────
// ต้องตัดออกจากสรุป เพราะไม่ใช่ข้อจำกัด ครอบทั้งไทยและอังกฤษ
export function isNoneValue(raw) {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return true
  if (s.startsWith('ไม่มี')) return true // "ไม่มี", "ไม่มี (No)", "ไม่มีอาการแพ้อาหาร...", "ไม่มีข้อจำกัด..."
  if (['no', 'none', 'n/a', 'na', '-', 'ไม่แพ้', 'ไม่แพ้อาหาร'].includes(s)) return true
  if (s.includes('no food allerg') || s.includes('no restriction')) return true
  return false
}

// ── 2. ตัดวงเล็บภาษาอังกฤษท้ายป้าย ─────────────────────────────────
// "ไม่ทานเนื้อวัว (No Beef)" → "ไม่ทานเนื้อวัว"  (แถวสั้นลงครึ่งหนึ่ง)
// จงใจจับเฉพาะวงเล็บที่ข้างในเป็นอักษรละตินล้วน — วงเล็บภาษาไทยที่ผู้ใช้พิมพ์เอง
// เช่น "ภูมิแพ้ (ยุง, ไรฝุ่น)" ต้องไม่โดนตัด เพราะนั่นคือเนื้อหาจริง
const TRAILING_EN_PAREN = /\s*\([A-Za-z0-9\s,./'’&+\-–]+\)\s*$/
export function stripEnglish(label) {
  const s = (label ?? '').trim()
  const stripped = s.replace(TRAILING_EN_PAREN, '').trim()
  return stripped || s
}

// ── 3. ตัดสตริงคำตอบเป็นรายตัวเลือก ────────────────────────────────
// เดิมใช้ raw.split(', ') ซึ่งตัดทุกลูกน้ำ ทำให้ข้อความที่ผู้ใช้พิมพ์เองพัง:
//   "อื่นๆ: ภูมิแพ้ (ยุง, ไรฝุ่น)" → "อื่นๆ: ภูมิแพ้ (ยุง" + "ไรฝุ่น)"
// วิธีใหม่: ตัดเฉพาะจุดที่ถัดจาก ", " แล้วเป็นจุดเริ่มของ "ค่าตัวเลือกจริง"
// เทียบตัวยาวก่อนเสมอ เผื่อมีตัวเลือกที่ขึ้นต้นเหมือนกัน
export function splitEntries(raw, options = []) {
  const s = (raw ?? '').trim()
  if (!s) return []

  const values = (options ?? [])
    .map((o) => o?.value)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  // ฟิลด์ข้อความล้วน (ไม่มีตัวเลือก) — ทั้งก้อนคือคำตอบเดียว
  if (values.length === 0) return [s]

  const bounds = []
  for (let i = 0; i <= s.length; i++) {
    const atStart = i === 0
    const afterSep = i >= 2 && s.startsWith(', ', i - 2)
    if (!atStart && !afterSep) continue
    if (values.some((v) => s.startsWith(v, i))) bounds.push(i)
  }

  // ไม่ตรงกับตัวเลือกไหนเลย (ข้อมูลเก่า/ตัวเลือกถูกแก้ทีหลัง) — คืนทั้งก้อน
  if (bounds.length === 0) return [s]

  const out = []
  if (bounds[0] > 0) out.push(s.slice(0, Math.max(0, bounds[0] - 2)).trim())
  for (let k = 0; k < bounds.length; k++) {
    const end = k + 1 < bounds.length ? bounds[k + 1] - 2 : s.length
    out.push(s.slice(bounds[k], end).trim())
  }
  return out.filter(Boolean)
}

// ── 4. แกะ "ค่าตัวเลือก: ข้อความที่พิมพ์เอง" ───────────────────────
// รูปแบบการเก็บมาจาก src/lib/optionOtherText.js (คั่นด้วย ": ")
// ⚠️ อย่าใช้ \b กับคำไทย — JS ถือว่าอักษรไทยไม่ใช่ word character ขอบคำจึงเพี้ยน
function isSelfWrittenOption(base) {
  const s = (base ?? '').trim()
  return s === 'มี' || /^อื่น\s*ๆ/.test(s) || /^other/i.test(s)
}

export function parseEntry(entry, options = []) {
  const s = (entry ?? '').trim()
  const values = (options ?? [])
    .map((o) => o?.value)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)

  const matched = values.find((v) => s === v || s.startsWith(`${v}: `))
  if (!matched) return { label: stripEnglish(s), text: '', isSelfWritten: false }

  const text = s === matched ? '' : s.slice(matched.length + 2).trim()
  const base = stripEnglish(matched)

  if (!text) return { label: base, text: '', isSelfWritten: false }

  // "อื่นๆ โปรดระบุ: หัวหอม" / "มี (Yes): Ibuprofen" → ป้ายคือสิ่งที่ผู้ใช้พิมพ์
  // ส่วนตัวเลือกที่มีความหมายในตัวเอง เช่น "แพ้รุนแรง (Anaphylaxis): ถั่ว" → ต่อท้าย
  if (isSelfWrittenOption(base)) return { label: text, text, isSelfWritten: true }
  return { label: `${base}: ${text}`, text, isSelfWritten: true }
}

// ── 4.5 แตกข้อความที่พิมพ์เองเป็นรายการย่อย ────────────────────────
// "มี (Yes): เพนิซิลลิน,แอสไพริน,กลุ่มซัลฟา" คือยา 3 ตัว ควรนับแยกกัน
// ไม่งั้นคนที่แพ้ Ibuprofen จะกระจายอยู่หลายแถวจนไม่รู้ว่ารวมกี่คน
//
// แต่ถ้ามีวงเล็บอยู่ในข้อความ แปลว่าลูกน้ำนั้นน่าจะเป็นส่วนหนึ่งของคำอธิบาย
// เช่น "ภูมิแพ้ (ยุง, ไรฝุ่น)" — กรณีนี้ห้ามแตก
export function splitSelfWritten(text) {
  const s = (text ?? '').trim()
  if (!s) return []
  if (s.includes('(') || s.includes(')')) return [s]
  return s.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)
}

// ── 5. รวมคำตอบที่ความหมายเดียวกัน ─────────────────────────────────
// คนพิมพ์เองย่อมเขียนไม่เหมือนกัน ("ไม่ทานไก่" / "ไม่กินไก่" / "งดสัตว์ปีก")
// ถ้าไม่รวม จะได้ 3 แถว แถวละ 1 คน ซึ่งอ่านแล้วประเมินไม่ได้ว่าต้องเตรียมกี่ที่
//
// รายการนี้ "คัดมาด้วยมือ" โดยตั้งใจ — ไม่ใช้การเดาความคล้ายอัตโนมัติ เพราะเรื่องแพ้
// อาหารรวมผิดแล้วอันตราย ถ้าเจอคำใหม่ที่ควรรวม ให้มาเติมที่นี่
export const SYNONYM_GROUPS = [
  { canonical: 'ไม่ทานไก่ / สัตว์ปีก', match: [/ไม่ทานไก่/, /ไม่กินไก่/, /งดไก่/, /สัตว์ปีก/] },
  { canonical: 'ผงชูรส', match: [/ผงชูรส/, /(^|[^a-z])msg([^a-z]|$)/i] },
  { canonical: 'ไม่ทานเผ็ด', match: [/เผ็ด/] },
  { canonical: 'ไม่ทานเนื้อวัว', match: [/ไม่ทานเนื้อวัว/, /ไม่กินเนื้อวัว/, /งดเนื้อวัว/, /no beef/i] },
  { canonical: 'ไม่ทานเนื้อหมู', match: [/ไม่ทานเนื้อหมู/, /ไม่กินหมู/, /งดหมู/, /no pork/i] },
]

export function canonicalLabel(label) {
  const s = (label ?? '').trim()
  for (const group of SYNONYM_GROUPS) {
    if (group.match.some((re) => re.test(s))) return group.canonical
  }
  return s
}

// คีย์สำหรับจับกลุ่ม — ตัดช่องว่าง/เครื่องหมายที่ไม่มีผลต่อความหมายออก
export function groupKey(label) {
  return canonicalLabel(label).toLowerCase().replace(/[\s./,\-–]/g, '')
}

// ── 6. จัดคำถามเข้ากลุ่มตามความเร่งด่วน ────────────────────────────
// ปัญหาเดิม: field_purpose มีแค่ dietary/medical ทำให้ "แพ้กุ้ง" (เสี่ยงถึงชีวิต)
// ถูกกองรวมกับ "ไม่ทานเนื้อวัว" (ความชอบ) และกรุ๊ปเลือดไปโผล่ในสรุปโรคประจำตัว
//
// ทางแก้ที่ถูกจริงคือแยก field_purpose ให้ละเอียดขึ้นในฐานข้อมูล แต่กระทบหลายหน้า
// ระหว่างนี้เดาจากชื่อคำถามไปก่อน — ถ้าวันหนึ่งเพิ่ม purpose ใหม่แล้ว ให้ลบตัวเดานี้ทิ้ง
export const TIERS = ['allergy', 'condition', 'preference', 'info']

const ALLERGY_RE = /แพ้|allerg/i
const BLOOD_RE = /กรุ๊ปเลือด|กรุปเลือด|หมู่เลือด|blood\s*(type|group)/i

export function classifyField(field) {
  const label = field?.label ?? ''
  if (field?.field_key === 'food_allergy') return 'allergy'
  if (field?.field_key === 'medical_condition') return 'condition'
  if (BLOOD_RE.test(label)) return 'info'
  if (ALLERGY_RE.test(label)) return 'allergy'
  return field?.field_purpose === 'dietary' ? 'preference' : 'condition'
}

// ── 7. ประกอบร่าง ──────────────────────────────────────────────────
/**
 * @param {object[]} guests   — { id, name, nickname, gender, phone, food_allergy, medical_condition }
 * @param {object[]} fields   — จาก v_tour_form_fields (ต้องมี label, options, field_purpose)
 * @param {object[]} responses— { field_id, guest_id, value }
 */
export function buildSummary({ guests = [], fields = [], responses = [] }) {
  const guestById = new Map(guests.map((g) => [g.id, g]))
  const fieldById = new Map(fields.map((f) => [f.id, f]))

  // tier -> key -> { label, isSelfWritten, variants:Set, people:Map, fieldLabels:Set }
  const tierMap = new Map(TIERS.map((tier) => [tier, new Map()]))
  const tierFieldLabels = new Map(TIERS.map((tier) => [tier, new Set()]))
  const perPerson = new Map()
  const conflicts = new Map()

  function ensurePerson(guest) {
    if (!perPerson.has(guest.id)) {
      perPerson.set(guest.id, { guest, allergy: [], condition: [], preference: [], info: [] })
    }
    return perPerson.get(guest.id)
  }

  function addAnswer(field, guest, raw) {
    if (!guest || !raw) return
    const tier = classifyField(field)
    const entries = splitEntries(raw, field?.options)
    const kept = []
    let sawNone = false

    for (const entry of entries) {
      if (isNoneValue(entry)) {
        sawNone = true
        continue
      }
      kept.push(entry)
    }

    // ติ๊ก "ไม่มี" พร้อมกับข้อจำกัดอื่นในคำถามเดียวกัน — นับตามข้อจำกัดที่ระบุ แล้วตั้งธงให้ทีมงานไปยืนยัน
    if (sawNone && kept.length > 0 && !conflicts.has(guest.id)) {
      conflicts.set(guest.id, { guest, fieldLabel: stripEnglish(field?.label ?? '') })
    }
    if (kept.length === 0) return

    tierFieldLabels.get(tier).add(stripEnglish(field?.label ?? ''))
    const bucket = tierMap.get(tier)
    const person = ensurePerson(guest)

    // แพ้ยาอยู่กองเดียวกับแพ้อาหาร (เร่งด่วนพอกัน) จึงต้องมีคำนำหน้าบอกว่าอันไหนคือยา
    const isDrug = tier === 'allergy' && field?.field_purpose === 'medical'

    for (const entry of kept) {
      const parsed = parseEntry(entry, field?.options)
      const labels = parsed.isSelfWritten ? splitSelfWritten(parsed.label) : [parsed.label]
      for (const one of labels) addItem(bucket, person, tier, guest, one, parsed.isSelfWritten, isDrug)
    }
  }

  function addItem(bucket, person, tier, guest, rawLabel, isSelfWritten, isDrug) {
    if (!rawLabel) return
    const label = isDrug ? `ยา: ${rawLabel}` : rawLabel
    const key = groupKey(label)
    if (!bucket.has(key)) {
      bucket.set(key, {
        key,
        label: canonicalLabel(label),
        isSelfWritten,
        variants: new Set(),
        people: new Map(),
      })
    }
    const item = bucket.get(key)
    item.variants.add(label)
    item.people.set(guest.id, guest) // Map = คนเดิมตอบซ้ำหลายคำถามก็นับครั้งเดียว
    if (!person[tier].includes(item.label)) person[tier].push(item.label)
  }

  // คำตอบจากฟิลด์แกน (เก็บในตาราง guests ตรง ๆ)
  const coreDietary = fields.find((f) => f.is_core && classifyField(f) === 'allergy')
  const coreMedical = fields.find((f) => f.is_core && classifyField(f) === 'condition')
  for (const g of guests) {
    if (g.food_allergy) addAnswer(coreDietary ?? { field_key: 'food_allergy', label: '' }, g, g.food_allergy)
    if (g.medical_condition)
      addAnswer(coreMedical ?? { field_key: 'medical_condition', label: '' }, g, g.medical_condition)
  }

  // คำตอบจากฟิลด์ที่ตั้งเอง
  for (const r of responses) {
    const field = fieldById.get(r.field_id)
    const guest = guestById.get(r.guest_id)
    if (field && guest) addAnswer(field, guest, r.value)
  }

  const tiers = TIERS.map((tier) => {
    const items = Array.from(tierMap.get(tier).values())
      .map((item) => ({
        key: item.key,
        label: item.label,
        isSelfWritten: item.isSelfWritten,
        variants: Array.from(item.variants),
        people: Array.from(item.people.values()),
        count: item.people.size,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'th'))

    const peopleIds = new Set()
    for (const item of items) for (const p of item.people) peopleIds.add(p.id)

    return {
      tier,
      items,
      peopleCount: peopleIds.size,
      fieldLabels: Array.from(tierFieldLabels.get(tier)).filter(Boolean),
    }
  })

  // เรียงรายคนตามความเร่งด่วน: แพ้ → โรคประจำตัว → ความชอบ
  const severityOf = (p) => (p.allergy.length ? 3 : p.condition.length ? 2 : p.preference.length ? 1 : 0)
  const byPerson = Array.from(perPerson.values())
    .filter((p) => severityOf(p) > 0)
    .sort((a, b) => {
      const d = severityOf(b) - severityOf(a)
      if (d) return d
      const na = a.allergy.length + a.condition.length + a.preference.length
      const nb = b.allergy.length + b.condition.length + b.preference.length
      return nb - na
    })
    .map((p) => ({ ...p, severity: severityOf(p) }))

  return {
    tiers,
    byPerson,
    conflicts: Array.from(conflicts.values()),
    totals: {
      guests: guests.length,
      withAny: byPerson.length,
      none: Math.max(0, guests.length - byPerson.length),
    },
  }
}
