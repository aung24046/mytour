import {
  isNoneValue, stripEnglish, splitEntries, parseEntry, splitSelfWritten,
  canonicalLabel, classifyField, buildSummary,
} from '../dietarySummary.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — ได้ ${JSON.stringify(a)}`)

// ตัวเลือกจริงจากฟอร์มลงทะเบียนที่ใช้อยู่
const ALLERGY_OPTS = [
  { value: 'ไม่มีอาการแพ้อาหาร (No food allergies)' },
  { value: 'อาหารทะเล (Seafood)' },
  { value: 'กุ้ง / กั้ง / ปู (Shellfish)' },
  { value: 'นมวัว / ผลิตภัณฑ์จากนม (Dairy)' },
  { value: 'ผงชูรส (MSG)' },
  { value: 'อื่นๆ โปรดระบุ (Other, please specify)', hasText: true },
]
const CONDITION_OPTS = [
  { value: 'ไม่มี (None)' },
  { value: 'โรคเบาหวาน (Diabetes)' },
  { value: 'โรคความดันโลหิตสูง (High Blood Pressure)' },
  { value: 'อื่นๆ โปรดระบุ (Other)', hasText: true },
  { value: 'อื่นๆ โปรดระบุ (Other, please specify)', hasText: true },
]
const DRUG_OPTS = [{ value: 'ไม่มี (No)' }, { value: 'มี (Yes)', hasText: true }]

console.log('── ค่าที่แปลว่าไม่มี')
ok(isNoneValue('ไม่มีอาการแพ้อาหาร (No food allergies)'), 'ไม่มีอาการแพ้อาหาร')
ok(isNoneValue('ไม่มี (None)'), 'ไม่มี (None)')
ok(isNoneValue(''), 'ค่าว่าง')
ok(!isNoneValue('ไม่ทานเนื้อวัว (No Beef)'), 'ไม่ทานเนื้อวัว ไม่ใช่ "ไม่มี"')

console.log('── ตัดวงเล็บภาษาอังกฤษ')
eq(stripEnglish('ไม่ทานเนื้อวัว (No Beef)'), 'ไม่ทานเนื้อวัว', 'ตัดวงเล็บอังกฤษ')
eq(stripEnglish('โรคหอบหืด / ระบบทางเดินหายใจ (Asthma / Respiratory)'), 'โรคหอบหืด / ระบบทางเดินหายใจ', 'มีสแลชในวงเล็บ')
eq(stripEnglish('ภูมิแพ้ (ยุง, ไรฝุ่น)'), 'ภูมิแพ้ (ยุง, ไรฝุ่น)', 'วงเล็บภาษาไทยต้องไม่โดนตัด')
eq(stripEnglish('(Shellfish)'), '(Shellfish)', 'ตัดแล้วว่างเปล่า → คงของเดิม')

console.log('── ตัดสตริงเป็นรายตัวเลือก (บั๊กเดิม: split เจอลูกน้ำแล้วตัดหมด)')
eq(
  splitEntries('กุ้ง / กั้ง / ปู (Shellfish), อื่นๆ โปรดระบุ (Other, please specify): หัวหอม', ALLERGY_OPTS),
  ['กุ้ง / กั้ง / ปู (Shellfish)', 'อื่นๆ โปรดระบุ (Other, please specify): หัวหอม'],
  'ตัวเลือกที่มีสแลชและช่องว่างไม่โดนตัด'
)
eq(
  splitEntries('อื่นๆ โปรดระบุ (Other): ภูมิแพ้(ไรฝุ่น, ยุง), อื่นๆ โปรดระบุ (Other, please specify): ภูมิแพ้ (ยุง, ไรฝุ่น)', CONDITION_OPTS),
  ['อื่นๆ โปรดระบุ (Other): ภูมิแพ้(ไรฝุ่น, ยุง)', 'อื่นๆ โปรดระบุ (Other, please specify): ภูมิแพ้ (ยุง, ไรฝุ่น)'],
  'ลูกน้ำในข้อความที่ผู้ใช้พิมพ์เองต้องไม่ถูกตัด'
)
eq(splitEntries('มี (Yes): เพนิซิลลิน,แอสไพริน,กลุ่มซัลฟา', DRUG_OPTS),
  ['มี (Yes): เพนิซิลลิน,แอสไพริน,กลุ่มซัลฟา'], 'ลูกน้ำติดกันไม่มีเว้นวรรค')
eq(splitEntries('อะไรสักอย่างที่ไม่มีในตัวเลือก', ALLERGY_OPTS),
  ['อะไรสักอย่างที่ไม่มีในตัวเลือก'], 'ไม่ตรงตัวเลือกเลย → คืนทั้งก้อน')
eq(splitEntries('ข้อความอิสระ, มีลูกน้ำ', []), ['ข้อความอิสระ, มีลูกน้ำ'], 'ฟิลด์ไม่มีตัวเลือก → ไม่ตัด')

console.log('── แกะข้อความที่ผู้ใช้พิมพ์เอง')
eq(parseEntry('อื่นๆ โปรดระบุ (Other, please specify): หัวหอม', ALLERGY_OPTS).label, 'หัวหอม', 'อื่นๆ → เหลือแค่คำตอบ')
ok(parseEntry('อื่นๆ โปรดระบุ (Other, please specify): หัวหอม', ALLERGY_OPTS).isSelfWritten, 'ติดธงว่าพิมพ์เอง')
eq(parseEntry('มี (Yes): Ibuprofen', DRUG_OPTS).label, 'Ibuprofen', 'มี (Yes) → เหลือชื่อยา')
eq(parseEntry('กุ้ง / กั้ง / ปู (Shellfish)', ALLERGY_OPTS).label, 'กุ้ง / กั้ง / ปู', 'ตัวเลือกปกติ')
eq(parseEntry('มีภาวะแพ้ง่าย/แพ้รุนแรง (Anaphylaxis): ถั่ว', [{ value: 'มีภาวะแพ้ง่าย/แพ้รุนแรง (Anaphylaxis)', hasText: true }]).label,
  'มีภาวะแพ้ง่าย/แพ้รุนแรง: ถั่ว', 'ตัวเลือกที่มีความหมายในตัวเอง → ต่อท้ายไม่ทิ้ง')

console.log('── แตกข้อความที่พิมพ์เองเป็นรายการย่อย')
eq(splitSelfWritten('เพนิซิลลิน,แอสไพริน,กลุ่มซัลฟา'), ['เพนิซิลลิน', 'แอสไพริน', 'กลุ่มซัลฟา'], 'ยา 3 ตัวในช่องเดียว')
eq(splitSelfWritten('Ibuprofen, Omeprazole'), ['Ibuprofen', 'Omeprazole'], 'ยา 2 ตัว')
eq(splitSelfWritten('ภูมิแพ้ (ยุง, ไรฝุ่น)'), ['ภูมิแพ้ (ยุง, ไรฝุ่น)'], 'มีวงเล็บ → ห้ามแตก')
eq(splitSelfWritten('หัวหอม'), ['หัวหอม'], 'คำเดียว')

console.log('── รวมคำตอบความหมายเดียวกัน')
eq(canonicalLabel('ไม่กินไก่'), 'ไม่ทานไก่ / สัตว์ปีก', 'ไม่กินไก่')
eq(canonicalLabel('งดสัตว์ปีก'), 'ไม่ทานไก่ / สัตว์ปีก', 'งดสัตว์ปีก')
eq(canonicalLabel('ไม่ทานอาหารรสเผ็ด'), 'ไม่ทานเผ็ด', 'รสเผ็ด')
eq(canonicalLabel('แพ้กุ้ง'), 'แพ้กุ้ง', 'คำที่ไม่อยู่ในรายการต้องไม่โดนแตะ')

console.log('── จัดคำถามเข้ากลุ่ม')
ok(classifyField({ label: 'อาหารที่แพ้ (Food Allergies)', field_purpose: 'dietary' }) === 'allergy', 'แพ้อาหาร → allergy')
ok(classifyField({ label: 'ข้อจำกัดด้านอาหาร (Dietary Restrictions)', field_purpose: 'dietary' }) === 'preference', 'ข้อจำกัด → preference')
ok(classifyField({ label: 'การแพ้ยา (Medication Allergies)', field_purpose: 'medical' }) === 'allergy', 'แพ้ยา → allergy')
ok(classifyField({ label: 'โรคประจำตัวหรือปัญหาสุขภาพ', field_purpose: 'medical' }) === 'condition', 'โรคประจำตัว → condition')
ok(classifyField({ label: 'กรุ๊ปเลือดอะไร?', field_purpose: 'medical' }) === 'info', 'กรุ๊ปเลือด → info (ไม่ใช่ข้อจำกัด)')

console.log('── ประกอบร่างทั้งชุด')
const guests = [
  { id: 'g1', name: 'สมหญิง ใจดี', nickname: 'เจน', gender: 'หญิง' },
  { id: 'g2', name: 'นันทิดา ศรีสุข', nickname: 'แนน', gender: 'หญิง' },
  { id: 'g3', name: 'สมชาย พูนทรัพย์', nickname: 'ชาย', gender: 'ชาย' },
  { id: 'g4', name: 'ไม่มีข้อจำกัด', nickname: 'ปกติ', gender: 'ชาย' },
]
const fields = [
  { id: 'f1', label: 'อาหารที่แพ้ (Food Allergies)', field_purpose: 'dietary', options: ALLERGY_OPTS },
  { id: 'f2', label: 'ข้อจำกัดด้านอาหาร (Dietary Restrictions)', field_purpose: 'dietary',
    options: [{ value: 'ไม่มีข้อจำกัด (No restrictions)' }, { value: 'ไม่ทานเนื้อวัว (No Beef)' },
              { value: 'อื่นๆ โปรดระบุ (Other, please specify)', hasText: true }] },
  { id: 'f3', label: 'กรุ๊ปเลือดอะไร?', field_purpose: 'medical', options: [{ value: 'O' }, { value: 'B' }] },
]
fields.push({ id: 'f4', label: 'การแพ้ยา (Medication Allergies)', field_purpose: 'medical', options: DRUG_OPTS })
const responses = [
  { field_id: 'f4', guest_id: 'g1', value: 'มี (Yes): Ibuprofen, Omeprazole' },
  { field_id: 'f4', guest_id: 'g3', value: 'มี (Yes): Ibuprofen' },
  { field_id: 'f1', guest_id: 'g1', value: 'นมวัว / ผลิตภัณฑ์จากนม (Dairy)' },
  { field_id: 'f1', guest_id: 'g2', value: 'กุ้ง / กั้ง / ปู (Shellfish), อื่นๆ โปรดระบุ (Other, please specify): หัวหอม' },
  { field_id: 'f2', guest_id: 'g3', value: 'ไม่มีข้อจำกัด (No restrictions), ไม่ทานเนื้อวัว (No Beef)' },
  { field_id: 'f2', guest_id: 'g2', value: 'อื่นๆ โปรดระบุ (Other, please specify): ไม่กินไก่' },
  { field_id: 'f3', guest_id: 'g1', value: 'B' },
  { field_id: 'f1', guest_id: 'g4', value: 'ไม่มีอาการแพ้อาหาร (No food allergies)' },
]
const s = buildSummary({ guests, fields, responses })
const tier = (name) => s.tiers.find((x) => x.tier === name)

eq(tier('allergy').items.map((i) => `${i.label}=${i.count}`).sort(),
  ['กุ้ง / กั้ง / ปู=1', 'นมวัว / ผลิตภัณฑ์จากนม=1', 'ยา: Ibuprofen=2', 'ยา: Omeprazole=1', 'หัวหอม=1'],
  'กองแพ้ — ยาแยกเป็นรายตัวและมีคำนำหน้า "ยา:"')
eq(tier('preference').items.map((i) => `${i.label}=${i.count}`).sort(),
  ['ไม่ทานเนื้อวัว=1', 'ไม่ทานไก่ / สัตว์ปีก=1'], 'กองความชอบ (รวม "ไม่กินไก่" แล้ว)')
eq(tier('info').items.map((i) => i.label), ['B'], 'กรุ๊ปเลือดอยู่กองข้อมูล ไม่ปนโรคประจำตัว')
eq(tier('condition').items.length, 0, 'ไม่มีโรคประจำตัว')
ok(tier('allergy').peopleCount === 3, 'นับคนไม่ซ้ำในกองแพ้ (เจน แนน ชาย — แนนมี 2 รายการ นับ 1)')
eq(s.conflicts.map((c) => c.guest.nickname), ['ชาย'], 'จับคนที่ตอบ "ไม่มีข้อจำกัด" คู่กับข้อจำกัดอื่น')
eq(s.totals, { guests: 4, withAny: 3, none: 1 }, 'ยอดรวม')
// เสี่ยงเท่ากัน (ทั้งสามมีอาการแพ้) จึงเรียงตามจำนวนรายการ: เจน 3 (ยา 2 + อาหาร 1) > แนน 3 แต่เจนมาก่อนเพราะเข้าคิวก่อน
eq(s.byPerson.map((p) => p.guest.nickname), ['เจน', 'แนน', 'ชาย'], 'เรียงรายคนตามความเสี่ยง (แพ้ก่อน)')
const nan = s.byPerson.find((p) => p.guest.nickname === 'แนน')
eq(nan.allergy, ['กุ้ง / กั้ง / ปู', 'หัวหอม'], 'รายการแพ้ของแนน')
eq(nan.preference, ['ไม่ทานไก่ / สัตว์ปีก'], 'คนเดียวอยู่ได้หลายกอง')

console.log(fail === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail === 0 ? 0 : 1)
