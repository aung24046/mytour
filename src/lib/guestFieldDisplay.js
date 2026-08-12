// จัดรูป "ค่าคำตอบของลูกทัวร์" ให้อ่านออก ก่อนเอาไปแสดงในหน้าจัดการลูกทัวร์/เอกสาร
//
// ปัญหาเดิม: หน้าจัดการลูกทัวร์เอาค่าดิบจากฐานข้อมูลมาแปะตรง ๆ จึงได้หน้าตาแบบนี้
//   "ไม่มีอาการแพ้อาหาร (No food allergies)"        ← วงเล็บอังกฤษกินที่ครึ่งบรรทัด
//   "อื่นๆ โปรดระบุ (Other, please specify): หัวหอม" ← คำตอบจริงอยู่ท้ายคำนำหน้า 35 ตัวอักษร
//   ":05"                                            ← ระยะเวลา 5 นาที
//   "1990-05-21"                                     ← วันเกิดแบบ ISO
//   "0812345678"                                     ← เบอร์ไม่มีขีดคั่น
//   "1234567890123"                                  ← เลขบัตรประชาชนติดกันพรืด
//
// ตัวแกะคำตอบ (ตัดตามตัวเลือกจริง / แยกข้อความที่พิมพ์เอง / ตัดวงเล็บอังกฤษ)
// ใช้ตัวเดียวกับหน้าสรุปข้อจำกัดอาหาร เพื่อให้สองหน้าตีความข้อมูลชุดเดียวกันตรงกัน
import { splitEntries, parseEntry, stripEnglish } from './dietarySummary.js'
import { isNationalIdField, formatThaiNationalId } from './fieldFormat.js'

/** ป้ายชื่อคำถาม — ตัดวงเล็บภาษาอังกฤษท้ายป้ายออก ("ไข่ (Eggs)" → "ไข่") */
export function formatFieldLabel(field) {
  return stripEnglish(field?.label ?? '')
}

/** เบอร์โทรไทย: 10 หลัก → 081-234-5678, 9 หลัก (เบอร์บ้าน) → 02-123-4567 */
export function formatPhone(raw) {
  const s = (raw ?? '').trim()
  const digits = s.replace(/\D/g, '')
  if (s.startsWith('+')) return s // เบอร์ต่างประเทศ — อย่าไปยุ่ง รูปแบบต่างกันทุกประเทศ
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`
  return s
}

/** "HH:MM" ที่ DurationField เก็บไว้ → { hours, minutes } (":05" = 0 ชม. 5 นาที) */
export function parseDuration(raw) {
  const [h = '', m = ''] = (raw ?? '').split(':')
  const hours = Number(h) || 0
  const minutes = Number(m) || 0
  if (!hours && !minutes) return null
  return { hours, minutes }
}

/** "1990-05-21" → "21 พ.ค. 1990" ตามภาษาที่เปิดอยู่ */
export function formatDate(raw, locale = 'th') {
  const s = (raw ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s
  const date = new Date(`${s.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return s
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

const PHONE_RE = /โทร|เบอร์|phone|mobile|tel/i
const DATE_RE = /วันเกิด|วันที่|birth|date|expiry|หมดอายุ/i
const PASSPORT_RE = /พาสปอร์ต|หนังสือเดินทาง|passport/i

/**
 * แปลงค่าดิบเป็นรูปแบบที่พร้อมแสดง
 *
 * @returns {{ kind: 'empty'|'text'|'chips'|'duration', text?: string, chips?: string[],
 *            hours?: number, minutes?: number, mono?: boolean, multiline?: boolean }}
 */
export function formatFieldValue(field, raw, { locale = 'th' } = {}) {
  const s = (raw ?? '').toString().trim()
  if (!s) return { kind: 'empty' }

  const type = field?.field_type
  const key = field?.field_key ?? ''
  const label = field?.label ?? ''

  // เลือกได้หลายข้อ → แยกเป็นชิป จะได้ไม่กลายเป็นบรรทัดยาวเหยียดเส้นเดียว
  if (type === 'checkbox') {
    const chips = splitEntries(s, field?.options)
      .map((entry) => parseEntry(entry, field?.options).label)
      .filter(Boolean)
    return chips.length > 0 ? { kind: 'chips', chips } : { kind: 'empty' }
  }

  // เลือกข้อเดียว — ยังต้องแกะ "มี (Yes): ยาที่แพ้" ออกมาเหมือนกัน
  if (type === 'radio' || type === 'select') {
    return { kind: 'text', text: parseEntry(s, field?.options).label }
  }

  if (type === 'duration') {
    const d = parseDuration(s)
    return d ? { kind: 'duration', ...d } : { kind: 'empty' }
  }

  if (type === 'date' || DATE_RE.test(key) || DATE_RE.test(label)) {
    return { kind: 'text', text: formatDate(s, locale), mono: true }
  }

  if (isNationalIdField(field) || key === 'national_id') {
    return { kind: 'text', text: formatThaiNationalId(s) || s, mono: true }
  }

  if (PASSPORT_RE.test(key) || PASSPORT_RE.test(label)) {
    return { kind: 'text', text: s.toUpperCase(), mono: true }
  }

  if (type === 'tel' || PHONE_RE.test(key) || PHONE_RE.test(label)) {
    return { kind: 'text', text: formatPhone(s), mono: true }
  }

  // ข้อความยาว (หมายเหตุ) — ต้องคงการขึ้นบรรทัดที่ผู้ใช้พิมพ์มา
  if (type === 'textarea' || s.includes('\n')) {
    return { kind: 'text', text: s, multiline: true }
  }

  return { kind: 'text', text: stripEnglish(s) }
}

/** ใช้ตัดสินว่าจะซ่อนช่องที่ยังไม่กรอกหรือไม่ */
export function hasValue(field, raw) {
  return formatFieldValue(field, raw).kind !== 'empty'
}
