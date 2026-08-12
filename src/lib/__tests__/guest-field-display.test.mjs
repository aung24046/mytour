import {
  formatFieldLabel, formatPhone, parseDuration, formatDate, formatFieldValue, hasValue,
} from '../guestFieldDisplay.js'

let fail = 0
const ok = (cond, msg) => { if (!cond) { fail++; console.log('  ✗', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — ได้ ${JSON.stringify(a)}`)

// ฟิลด์จริงจากฟอร์มลงทะเบียนที่ใช้อยู่
const ALLERGY = {
  field_key: 'custom_food_allergies', field_type: 'checkbox',
  label: 'อาหารที่แพ้ (Food Allergies)',
  options: [
    { value: 'ไม่มีอาการแพ้อาหาร (No food allergies)' },
    { value: 'กุ้ง / กั้ง / ปู (Shellfish)' },
    { value: 'นมวัว / ผลิตภัณฑ์จากนม (Dairy)' },
    { value: 'อื่นๆ โปรดระบุ (Other, please specify)', hasText: true },
  ],
}
const DRUG = {
  field_key: 'custom_medication_allergy', field_type: 'radio',
  label: 'การแพ้ยา (Medication Allergies)',
  options: [{ value: 'ไม่มี (No)' }, { value: 'มี (Yes)', hasText: true }],
}
const DURATION = { field_key: 'custom_travel_duration', field_type: 'duration', label: 'ระยะเวลาเดินทาง' }
const PHONE = { field_key: 'phone', field_type: 'tel', label: 'เบอร์โทรศัพท์ (Phone)' }
const BIRTH = { field_key: 'birthdate', field_type: 'date', label: 'วันเกิด (Date of Birth)' }
const NID = { field_key: 'national_id', field_type: 'text', label: 'เลขบัตรประชาชน' }
const PASSPORT = { field_key: 'passport_no', field_type: 'text', label: 'เลขหนังสือเดินทาง (Passport No.)' }
const NOTE = { field_key: 'note', field_type: 'textarea', label: 'หมายเหตุ' }

console.log('── ป้ายชื่อคำถาม')
eq(formatFieldLabel(ALLERGY), 'อาหารที่แพ้', 'ตัดวงเล็บอังกฤษออกจากป้าย')
eq(formatFieldLabel({ label: 'นั่งBusไหน' }), 'นั่งBusไหน', 'ป้ายที่ไม่มีวงเล็บคงเดิม')

console.log('── เบอร์โทร')
eq(formatPhone('0812345678'), '081-234-5678', 'มือถือ 10 หลัก')
eq(formatPhone('021234567'), '02-123-4567', 'เบอร์บ้าน 9 หลัก')
eq(formatPhone('+82-10-2345-6789'), '+82-10-2345-6789', 'เบอร์ต่างประเทศไม่แตะ')
eq(formatPhone('ไม่มี'), 'ไม่มี', 'ค่าที่ไม่ใช่ตัวเลขคงเดิม')

console.log('── ระยะเวลา')
eq(parseDuration(':05'), { hours: 0, minutes: 5 }, '":05" = 5 นาที (เคสจริงจากฐานข้อมูล)')
eq(parseDuration('01:30'), { hours: 1, minutes: 30 }, '1 ชม. 30 นาที')
eq(parseDuration('00:00'), null, 'ศูนย์ทั้งคู่ = ไม่ได้กรอก')

console.log('── วันที่')
// locale 'th' ใช้ปฏิทินพุทธเป็นค่าเริ่มต้นของ Intl (2533) — ตรงกับที่หน้าอื่นในแอปแสดงอยู่แล้ว
ok(/2533/.test(formatDate('1990-05-21', 'th')), 'แปลงวันที่ ISO เป็น พ.ศ. ตาม locale ไทย')
ok(formatDate('1990-05-21', 'en').includes('1990'), 'locale อังกฤษเป็น ค.ศ.')
eq(formatDate('ไม่ทราบ'), 'ไม่ทราบ', 'ค่าที่ไม่ใช่วันที่คงเดิม')

console.log('── ค่าคำตอบ')
eq(formatFieldValue(ALLERGY, 'ไม่มีอาการแพ้อาหาร (No food allergies)'),
  { kind: 'chips', chips: ['ไม่มีอาการแพ้อาหาร'] }, 'checkbox ข้อเดียว')
eq(formatFieldValue(ALLERGY, 'กุ้ง / กั้ง / ปู (Shellfish), อื่นๆ โปรดระบุ (Other, please specify): หัวหอม'),
  { kind: 'chips', chips: ['กุ้ง / กั้ง / ปู', 'หัวหอม'] }, 'checkbox หลายข้อ + ข้อความที่พิมพ์เอง')
eq(formatFieldValue(DRUG, 'มี (Yes): Ibuprofen'), { kind: 'text', text: 'Ibuprofen' }, 'radio ที่มีช่องระบุ')
eq(formatFieldValue(DRUG, 'ไม่มี (No)'), { kind: 'text', text: 'ไม่มี' }, 'radio ปกติ')
eq(formatFieldValue(DURATION, ':05'), { kind: 'duration', hours: 0, minutes: 5 }, 'ระยะเวลา')
eq(formatFieldValue(PHONE, '0812345678'), { kind: 'text', text: '081-234-5678', mono: true }, 'เบอร์โทร')
eq(formatFieldValue(NID, '1234567890123'), { kind: 'text', text: '1-2345-67890-12-3', mono: true }, 'เลขบัตรประชาชน')
eq(formatFieldValue(PASSPORT, 'ab1234567'), { kind: 'text', text: 'AB1234567', mono: true }, 'พาสปอร์ตเป็นตัวใหญ่')
eq(formatFieldValue(NOTE, 'บรรทัดหนึ่ง\nบรรทัดสอง').multiline, true, 'ข้อความหลายบรรทัด')
eq(formatFieldValue(ALLERGY, '').kind, 'empty', 'ค่าว่าง')
eq(formatFieldValue(ALLERGY, '   ').kind, 'empty', 'เว้นวรรคล้วน = ว่าง')
ok(formatFieldValue(BIRTH, '1990-05-21').mono, 'วันเกิดใช้ตัวเลขความกว้างเท่ากัน')

console.log('── ตัวช่วยซ่อนช่องว่าง')
ok(hasValue(ALLERGY, 'ไข่ (Eggs)'), 'มีค่า')
ok(!hasValue(ALLERGY, ''), 'ไม่มีค่า')

console.log(fail === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${fail} ข้อ`)
process.exit(fail === 0 ? 0 : 1)
