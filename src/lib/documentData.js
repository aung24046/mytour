// ข้อมูลร่วมของเอกสาร export ทุกใบ — org (หัวกระดาษ) + tour + หัวหน้าทัวร์ + preset คอลัมน์
//
// แยกออกมาเพราะทั้ง 8 เอกสารต้องใช้ชุดเดียวกันหมด ไม่ควรก๊อป query ซ้ำ 8 รอบ

import { useEffect, useMemo, useState } from 'react'

import { supabase } from './supabase'
import { fetchAllRows } from './fetchAll'
import { useActiveTourId, useActiveOrgId } from './staffSession'
import { OVERFLOW } from './printProfiles'
import { splitEntries, parseEntry } from './dietarySummary'

/** ชนิดเอกสารที่ระบบรองรับ — ตรงกับ CHECK constraint ของ document_presets */
export const DOC_TYPES = {
  ROOMING_LIST: 'rooming_list',
  GUEST_MANIFEST: 'guest_manifest',
  SEAT_MANIFEST: 'seat_manifest',
  DIETARY_SHEET: 'dietary_sheet',
  ITINERARY_BOOKLET: 'itinerary_booklet',
  EMERGENCY_CARD: 'emergency_card',
  EXPENSE_REPORT: 'expense_report',
  FEEDBACK_REPORT: 'feedback_report',
  FEEDBACK_FORM: 'feedback_form',
  // เอกสารหน้างาน (ส.ค. 2569) — ใช้ตอนรวมพลและระหว่างเดินทาง
  JOIN_POSTER: 'join_poster',
  SIGNATURE_SHEET: 'signature_sheet',
  NAME_TAG: 'name_tag',
}

export const DOC_TITLES = {
  rooming_list: { title: 'ใบจัดห้องพัก', subtitle: 'Rooming list' },
  guest_manifest: { title: 'บัญชีรายชื่อผู้เดินทาง', subtitle: 'Guest manifest' },
  seat_manifest: { title: 'ผังที่นั่งรถ', subtitle: 'Seat manifest' },
  dietary_sheet: { title: 'สรุปข้อจำกัดด้านอาหาร', subtitle: 'Dietary & allergy' },
  itinerary_booklet: { title: 'โปรแกรมการเดินทาง', subtitle: 'Itinerary' },
  emergency_card: { title: 'บัตรฉุกเฉิน', subtitle: 'Emergency card' },
  expense_report: { title: 'รายงานค่าใช้จ่าย', subtitle: 'Expense report' },
  feedback_report: { title: 'รายงานความพึงพอใจ', subtitle: 'Feedback report' },
  // ⚠️ คนละใบกับ feedback_report — ใบนี้คือฟอร์มเปล่าไว้แจก ชื่อจึงต้องต่างกันให้ชัด
  feedback_form: { title: 'แบบประเมิน (ฉบับกระดาษ)', subtitle: 'Feedback form — blank' },
  join_poster: { title: 'เข้าร่วมทริป', subtitle: 'Join QR poster' },
  signature_sheet: { title: 'ใบเซ็นชื่อ', subtitle: 'Signature sheet' },
  name_tag: { title: 'ป้ายชื่อ', subtitle: 'Name tag' },
}

/** ป้ายชื่อคอลัมน์กลาง — ใช้ทั้งในเอกสารและหน้าเลือกคอลัมน์ */
export const COLUMN_LABELS = {
  index: 'ลำดับ',
  room_number: 'ห้อง',
  floor: 'ชั้น',
  room_type: 'ประเภท',
  max_guests: 'พักได้',
  room_note: 'หมายเหตุห้อง',
  title: 'คำนำหน้า',
  name: 'ชื่อ-นามสกุล',
  nickname: 'ชื่อเล่น',
  name_en: 'Name (EN)',
  gender: 'เพศ',
  birthdate: 'วันเกิด',
  national_id: 'เลขบัตรประชาชน',
  passport_no: 'หนังสือเดินทาง',
  passport_expiry: 'วันหมดอายุ',
  nationality: 'สัญชาติ',
  insurance_no: 'เลขที่กรมธรรม์',
  phone: 'โทรศัพท์',
  emergency_contact_name: 'ผู้ติดต่อฉุกเฉิน',
  emergency_contact_phone: 'เบอร์ฉุกเฉิน',
  food_allergy: 'แพ้อาหาร',
  medical_condition: 'โรคประจำตัว',
  dietary: 'ข้อจำกัดอาหาร',
  note: 'หมายเหตุ',
  seat_number: 'ที่นั่ง',
  expense_date: 'วันที่',
  category: 'หมวด',
  description: 'รายละเอียด',
  supplier: 'ซัพพลายเออร์',
  currency: 'สกุลเงิน',
  amount: 'จำนวน (บาท)',
  paid_by: 'ผู้จ่าย',
  receipt: 'ใบเสร็จ',
}

/** คอลัมน์ที่เป็นข้อมูลอ่อนไหวตาม PDPA — ติดป้ายเตือนก่อนพิมพ์ส่งออกนอกองค์กร */
export const SENSITIVE_KEYS = new Set([
  'national_id',
  'passport_no',
  'passport_expiry',
  'medical_condition',
  'birthdate',
])

/* ------------------------------------------------------------------ *
 * คอลัมน์ที่มาจากคำถามในฟอร์มลงทะเบียน (DataSpec §9.2)
 *
 * key เป็น `field:<field_id>` ไม่ใช่ field_key เพราะ:
 *   - field_key แต่ละทริปตั้งเองซ้ำกันได้ (custom_1784284645523 ฯลฯ)
 *   - field_id เป็น uuid ของคลังกลาง คงที่ข้ามทริป preset จึงใช้ซ้ำได้จริง
 * ------------------------------------------------------------------ */

export const FIELD_COLUMN_PREFIX = 'field:'

export function fieldColumnKey(fieldId) {
  return `${FIELD_COLUMN_PREFIX}${fieldId}`
}

export function isFieldColumn(key) {
  return typeof key === 'string' && key.startsWith(FIELD_COLUMN_PREFIX)
}

export function fieldIdFromColumn(key) {
  return isFieldColumn(key) ? key.slice(FIELD_COLUMN_PREFIX.length) : null
}

/** ป้ายหัวตาราง — คอลัมน์จากฟอร์มพก label มาเอง ตัวมาตรฐานใช้ COLUMN_LABELS */
export function columnLabel(col) {
  return col?.label ?? COLUMN_LABELS[col?.key] ?? col?.key ?? ''
}

/** คอลัมน์จากฟอร์มไม่มี field_purpose บอกความอ่อนไหว จึงเดาจาก label ตอนสร้าง
 *  แล้วติดมากับ col.sensitive — ที่นี่แค่เคารพค่าที่ติดมา */
export function isSensitiveColumn(col) {
  return col?.sensitive ?? SENSITIVE_KEYS.has(col?.key)
}

/** เดาความอ่อนไหวของคำถามจากข้อความ — พลาดทางเข้มดีกว่าพลาดทางหลวม */
const SENSITIVE_LABEL_RE =
  /บัตรประชาชน|ประจำตัวประชาชน|พาสปอร์ต|หนังสือเดินทาง|passport|national\s*id|วันเกิด|วันเดือนปีเกิด|birth|โรคประจำตัว|แพ้ยา|ยาที่ใช้|ประวัติการรักษา|medical|ศาสนา|religion/i

/** คำถามปลายเปิดยาวเกินกว่าจะยัดในช่องตาราง — ลงแถวย่อยแทน */
const LONG_FIELD_TYPES = new Set(['textarea', 'long_text', 'paragraph'])
const SHORT_FIELD_TYPES = new Set(['date', 'number', 'tel', 'phone'])

function overflowForField(field) {
  if (LONG_FIELD_TYPES.has(field.field_type)) return OVERFLOW.SUBROW
  if (SHORT_FIELD_TYPES.has(field.field_type)) return OVERFLOW.NOWRAP
  return OVERFLOW.WRAP
}

/** field หนึ่งข้อ → column def ที่ ColumnPicker กับ DocumentTable ใช้ได้ทันที */
function toFieldColumn(field) {
  return {
    key: fieldColumnKey(field.id),
    label: field.label ?? field.field_key,
    overflow: overflowForField(field),
    sensitive: SENSITIVE_LABEL_RE.test(field.label ?? ''),
    group: 'form',
  }
}

/** คอลัมน์ที่เลือกได้ของแต่ละเอกสาร พร้อมนโยบายข้อความยาวที่แนะนำ
 *  ทุกคอลัมน์แสดงเต็มเสมอ — ที่ยาวมากใช้ subrow หรือ footnote แทนการตัดข้อความ */
export const AVAILABLE_COLUMNS = {
  rooming_list: [
    { key: 'room_number', overflow: OVERFLOW.NOWRAP, locked: true },
    { key: 'floor', overflow: OVERFLOW.NOWRAP },
    { key: 'room_type', overflow: OVERFLOW.WRAP },
    // หมายเหตุห้อง (connecting / non-smoking / ขอชั้นสูง) — โรงแรมต้องเห็นตอนรับใบนี้
    { key: 'room_note', overflow: OVERFLOW.WRAP },
    { key: 'name', overflow: OVERFLOW.WRAP, locked: true },
    { key: 'nickname', overflow: OVERFLOW.WRAP },
    { key: 'name_en', overflow: OVERFLOW.WRAP },
    { key: 'gender', overflow: OVERFLOW.NOWRAP },
    { key: 'birthdate', overflow: OVERFLOW.NOWRAP },
    { key: 'national_id', overflow: OVERFLOW.NOWRAP },
    { key: 'passport_no', overflow: OVERFLOW.NOWRAP },
    { key: 'passport_expiry', overflow: OVERFLOW.NOWRAP },
    { key: 'nationality', overflow: OVERFLOW.WRAP },
    { key: 'phone', overflow: OVERFLOW.NOWRAP },
    { key: 'note', overflow: OVERFLOW.FOOTNOTE },
  ],
  guest_manifest: [
    { key: 'index', overflow: OVERFLOW.NOWRAP, locked: true },
    { key: 'title', overflow: OVERFLOW.WRAP },
    { key: 'name', overflow: OVERFLOW.WRAP, locked: true },
    { key: 'nickname', overflow: OVERFLOW.WRAP },
    { key: 'name_en', overflow: OVERFLOW.WRAP },
    { key: 'gender', overflow: OVERFLOW.NOWRAP },
    { key: 'birthdate', overflow: OVERFLOW.NOWRAP },
    { key: 'national_id', overflow: OVERFLOW.NOWRAP },
    { key: 'passport_no', overflow: OVERFLOW.NOWRAP },
    { key: 'passport_expiry', overflow: OVERFLOW.NOWRAP },
    { key: 'nationality', overflow: OVERFLOW.WRAP },
    { key: 'insurance_no', overflow: OVERFLOW.NOWRAP },
    { key: 'phone', overflow: OVERFLOW.NOWRAP },
    { key: 'emergency_contact_name', overflow: OVERFLOW.WRAP },
    { key: 'emergency_contact_phone', overflow: OVERFLOW.NOWRAP },
    { key: 'food_allergy', overflow: OVERFLOW.WRAP },
    { key: 'dietary', overflow: OVERFLOW.WRAP },
    { key: 'medical_condition', overflow: OVERFLOW.SUBROW },
    { key: 'note', overflow: OVERFLOW.FOOTNOTE },
  ],
}

/**
 * ใส่ label + ป้ายอ่อนไหวให้ column def ที่มาจาก preset (jsonb เก็บแค่ key กับนโยบาย)
 *
 * `knownKeys` = คอลัมน์ที่ทริปปัจจุบันมีจริง ใช้ตัดคอลัมน์คำถามที่ทริปนี้ไม่ได้ถามทิ้ง
 * เพราะ preset เก็บที่ระดับ org แต่คำถามผูกกับทริป — ถ้าไม่ตัด ผู้ใช้จะได้คอลัมน์ผี
 * ที่มีหัวตารางแต่ทุกแถวเป็น "—" และหาถอดออกในรายการไม่เจอ
 * ส่วนคอลัมน์มาตรฐานไม่ตัด เพราะมีครบทุกทริปอยู่แล้ว
 */
export function hydrateColumns(cols, { knownKeys } = {}) {
  return cols
    .filter((c) => !knownKeys || !isFieldColumn(c.key) || knownKeys.has(c.key))
    .map((c) => ({
      ...c,
      label: c.label ?? COLUMN_LABELS[c.key] ?? c.key,
      sensitive: c.sensitive ?? SENSITIVE_KEYS.has(c.key),
    }))
}

/**
 * โหลดข้อมูลหัวกระดาษ + preset ของเอกสารหนึ่งใบ
 * คืน org = null ได้ถ้ายังไม่ได้ตั้งค่าบริษัท — หน้าเอกสารยังเรนเดอร์ได้ แค่ไม่มีหัว
 */
export function useDocumentContext(docType) {
  const tourId = useActiveTourId()
  const orgId = useActiveOrgId()

  const [state, setState] = useState({
    loading: true,
    error: null,
    org: null,
    tour: null,
    leader: null,
    staff: [],
    presets: [],
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [orgRes, tourRes, staffRes, presetRes] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', orgId).maybeSingle(),
        supabase
          .from('tours')
          .select('id, org_id, name, join_code, status, start_date, end_date, doc_leader_staff_id')
          .eq('id', tourId)
          .maybeSingle(),
        supabase
          .from('v_tour_staff')
          .select('id, name, phone, role, job_title, is_active')
          .eq('tour_id', tourId),
        supabase
          .from('document_presets')
          .select('id, name, columns, is_default')
          .eq('org_id', orgId)
          .eq('doc_type', docType)
          .order('is_default', { ascending: false })
          .order('name'),
      ])

      if (cancelled) return

      // tour โหลดไม่ได้ = เอกสารทำต่อไม่ได้จริงๆ ส่วน org/preset ขาดได้
      if (tourRes.error) {
        console.error('[documentData] load failed', tourRes.error)
        setState((s) => ({ ...s, loading: false, error: 'โหลดข้อมูลทริปไม่สำเร็จ' }))
        return
      }
      if (orgRes.error) console.warn('[documentData] org load failed', orgRes.error)
      if (presetRes.error) console.warn('[documentData] preset load failed', presetRes.error)

      const staff = (staffRes.data ?? []).filter((s) => s.is_active !== false)

      // ⚠️ หนึ่งทริปมีคน role='lead' ได้หลายคน — เดิมใช้ .find() หยิบคนแรกที่ฐานข้อมูล
      // คืนมา (ไม่ได้เรียงอะไร) เอกสารเลยขึ้นชื่อ "Admin" แบบสุ่ม
      //
      // ลำดับใหม่: คนที่ผู้ใช้เลือกไว้ → ถ้ามี lead อยู่คนเดียวก็ใช้คนนั้น → ไม่งั้นปล่อยว่าง
      // ไม่เดาเมื่อกำกวม เพราะพิมพ์ชื่อผิดคนลงเอกสารที่ส่งคู่ค้าแก้ทีหลังไม่ได้
      const chosenId = tourRes.data?.doc_leader_staff_id
      const leads = staff.filter((s) => s.role === 'lead')
      const leader =
        (chosenId && staff.find((s) => s.id === chosenId)) ||
        (leads.length === 1 ? leads[0] : null)

      setState({
        loading: false,
        error: null,
        org: orgRes.data ?? null,
        tour: tourRes.data ?? null,
        leader,
        staff,
        presets: presetRes.data ?? [],
      })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId, orgId, docType])

  return state
}

/**
 * โหลด custom field + คำตอบของทริป แล้วคืนตัวช่วยอ่านค่าแบบ "core ก่อน ไม่มีค่อยไป custom"
 *
 * ทำไมต้องมี: ระบบนี้ให้แอดมินสร้างคำถามเองได้ ข้อมูลสำคัญหลายอย่างจึงไม่ได้อยู่ใน
 * คอลัมน์ core แต่กระจายอยู่ใน guest_form_responses เช่นทริปจริงของ KBU12 เก็บ
 * เลขบัตรประชาชนไว้ที่ custom_1784284645523 และอาหารที่แพ้ไว้ที่ custom_food_allergies
 * ถ้าอ่านแค่ guests.national_id / guests.food_allergy เอกสารจะว่างทั้งที่มีข้อมูลอยู่
 *
 * จับคู่ด้วย field_purpose เป็นหลัก (ไม่ hardcode field_key เพราะแต่ละทริปตั้งชื่อเอง)
 * ส่วนเลขบัตรประชาชนไม่มี purpose รองรับ จึงเดาจากข้อความใน label
 */
/**
 * ตัดคำตอบที่แปลว่า "ไม่มี" ออกจากค่าที่จะขึ้นเอกสาร
 *
 * ฟอร์มลงทะเบียนเป็น checkbox ที่มีตัวเลือก "ไม่มีอาการแพ้อาหาร (No food allergies)"
 * ถ้าไม่ตัดออก ใบสรุปส่งร้านอาหารจะมี 95 บรรทัดที่เขียนว่าไม่แพ้อะไร ซึ่งไร้ประโยชน์
 * และแย่กว่านั้นคือคนที่แพ้จริงจะจมหายไปในกอง
 *
 * ระวัง: ค่าจาก checkbox คั่นด้วย ", " แต่ตัวเลือกเองก็มีวงเล็บที่มีคอมมาข้างใน
 * (เช่น "อื่นๆ โปรดระบุ (Other, please specify): ...") จึงตัดด้วย regex ทีละวลี
 * แทนการ split ด้วยคอมมา
 */
export function stripNoneAnswers(value) {
  if (!value) return ''
  const cleaned = String(value)
    .replace(
      /(ไม่มีอาการแพ้อาหาร\s*\([^)]*\)|ไม่มีข้อจำกัด\s*\([^)]*\)|ไม่มี\s*\(None\)|ไม่มี(?=\s*(,|$))|None|N\/A|-)/gi,
      ''
    )
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/^\s*,\s*|\s*,\s*$/g, '')
    .trim()
  return cleaned
}

export function useGuestCustomFields(tourId) {
  // loaded แยกจาก fields.length เพราะ "ยังไม่โหลด" กับ "โหลดแล้วแต่ทริปนี้ไม่มีคำถาม"
  // ต้องแยกให้ออก — หน้าเอกสารรอ loaded ก่อนค่อย hydrate preset ไม่งั้นคอลัมน์คำถาม
  // ในชุดที่บันทึกไว้จะถูกตัดทิ้งทั้งหมดตั้งแต่เฟรมแรก
  const [state, setState] = useState({ loaded: false, fields: [], responses: [] })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: fields, error } = await supabase
        .from('v_tour_form_fields')
        // options จำเป็นสำหรับ resolveList — ใช้ตัดสตริงคำตอบตามตัวเลือกจริง
        .select('id, field_key, label, field_purpose, field_type, options, is_active, sort_order')
        .eq('tour_id', tourId)
        // เอกสารทุกใบเติมข้อมูลจากฟอร์มลงทะเบียนเท่านั้น
        // ถ้าไม่กรอง คำตอบแบบประเมิน (เช่นคอมเมนต์ปลายเปิด) มีสิทธิ์หลุดไปโผล่ในช่อง
        // "หมายเหตุ" หรือ "ข้อจำกัดอาหาร" ของใบที่ส่งให้โรงแรมและร้านอาหาร
        .eq('form_type', 'registration')

      if (cancelled) return
      if (error || !fields?.length) {
        if (error) console.warn('[documentData] custom fields load failed', error)
        setState({ loaded: true, fields: [], responses: [] })
        return
      }

      const active = fields
        .filter((f) => f.is_active !== false)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      // ⚠️ ต้องแบ่งหน้า — คำตอบของทริปเดียวเกิน 1000 แถวได้ง่าย (ทริปจริงมี 1481)
      //    ถ้าดึงรวดเดียวจะได้มาแค่ 1000 แถวแบบสุ่มชุด เอกสารจึงข้อมูลหายเป็นครั้งคราว
      const activeIds = active.map((f) => f.id)
      const { data: responses } = await fetchAllRows(
        () =>
          supabase
            .from('guest_form_responses')
            .select('guest_id, field_id, value')
            .in('field_id', activeIds),
        { orderBy: 'id' }
      )

      if (!cancelled) setState({ loaded: true, fields: active, responses: responses ?? [] })
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  return useMemo(() => {
    const byGuest = {}
    for (const r of state.responses) {
      if (!byGuest[r.guest_id]) byGuest[r.guest_id] = {}
      byGuest[r.guest_id][r.field_id] = r.value
    }

    const byPurpose = (purpose) => state.fields.filter((f) => f.field_purpose === purpose)
    const byLabel = (re) => state.fields.filter((f) => re.test(f.label ?? ''))

    // คอลัมน์เอกสาร → รายการ field ที่ใช้เติมเมื่อ core ว่าง
    const sources = {
      food_allergy: byLabel(/แพ้.*อาหาร|อาหาร.*แพ้|food.*allerg/i),
      dietary: byPurpose('dietary').filter((f) => !/แพ้/.test(f.label ?? '')),
      medical_condition: byPurpose('medical'),
      national_id: byLabel(/บัตรประชาชน|ประจำตัวประชาชน|national\s*id/i),
      phone: byPurpose('phone'),
      emergency_contact_phone: byPurpose('emergency_contact'),
    }

    // คำถามที่ถูกดูดไปเป็นคอลัมน์มาตรฐานอยู่แล้ว (แพ้อาหาร / เบอร์ / เลขบัตร ฯลฯ)
    // ห้ามโผล่เป็นคอลัมน์คำถามซ้ำอีกรอบ ไม่งั้นเอกสารจะมีสองช่องที่ค่าเหมือนกัน
    const mappedIds = new Set(Object.values(sources).flat().map((f) => f.id))

    /** คำถามทั้งหมดในฟอร์มลงทะเบียน → column def ที่เลือกได้ในหน้าเอกสาร */
    const fieldColumns = state.fields
      .filter((f) => !mappedIds.has(f.id))
      .map(toFieldColumn)

    /** อ่านค่าของคอลัมน์หนึ่งจาก guest — core ก่อน ถ้าว่างค่อยรวมค่าจาก custom field */
    function resolve(guest, key) {
      // คอลัมน์คำถาม: อ่านคำตอบข้อนั้นตรงๆ ไม่มี core ให้ fallback
      const fieldId = fieldIdFromColumn(key)
      if (fieldId) {
        return stripNoneAnswers((byGuest[guest?.id] ?? {})[fieldId] ?? '')
      }

      const core = guest?.[key]
      if (core != null && String(core).trim() !== '') return stripNoneAnswers(String(core))

      const answers = byGuest[guest?.id] ?? {}
      const parts = (sources[key] ?? [])
        .map((f) => stripNoneAnswers(answers[f.id] ?? ''))
        .filter((v) => v !== '')

      return [...new Set(parts)].join(' · ')
    }

    /**
     * เหมือน resolve แต่คืนเป็น "รายการ" ที่แกะแล้ว แทนสตริงยาวต่อกันด้วย ' · '
     *
     * ทำไมต้องมี: ช่อง "ข้อจำกัด/ข้อควรทราบ" ในใบส่งร้านอาหารเคยเอาคำตอบหลายคำถาม
     * มาต่อกันเป็นสตริงเดียว ทั้งที่แต่ละคำตอบเองก็มีวงเล็บอังกฤษและคำนำหน้า
     * "อื่นๆ โปรดระบุ:" ติดมาด้วย ผลคือกำแพงข้อความที่ร้านอ่านไม่ออก
     *
     * ตัวแกะใช้ชุดเดียวกับหน้าสรุปข้อจำกัดอาหาร (dietarySummary) — สองที่ตีความตรงกัน
     */
    function resolveList(guest, key) {
      const answers = byGuest[guest?.id] ?? {}
      const out = []

      const pushFrom = (raw, field) => {
        const cleaned = stripNoneAnswers(String(raw ?? ''))
        if (!cleaned) return
        for (const entry of splitEntries(cleaned, field?.options)) {
          const { label } = parseEntry(entry, field?.options)
          if (label && !out.includes(label)) out.push(label)
        }
      }

      const fieldId = fieldIdFromColumn(key)
      if (fieldId) {
        pushFrom(answers[fieldId], state.fields.find((f) => f.id === fieldId))
        return out
      }

      // คอลัมน์ core ที่เก็บในตาราง guests ตรง ๆ ไม่มี options ให้เทียบ — คืนทั้งก้อน
      const core = guest?.[key]
      if (core != null && String(core).trim() !== '') {
        pushFrom(core, null)
        return out
      }

      for (const f of sources[key] ?? []) pushFrom(answers[f.id], f)
      return out
    }

    return {
      resolve,
      resolveList,
      fieldColumns,
      loaded: state.loaded,
      ready: state.fields.length > 0,
    }
  }, [state])
}

/**
 * นับว่าคอลัมน์ไหนมีคนกรอกจริงกี่คน (DataSpec §9.1)
 * คอลัมน์ที่ได้ 0 จะถูกซ่อนอัตโนมัติ แต่ยังแสดงในรายการพร้อมตัวนับ
 * เพื่อให้ผู้ใช้เห็นว่าทำไมมันหาย ไม่ใช่หายเงียบ
 */
export function useColumnFillCounts(rows, keys) {
  return useMemo(() => {
    const counts = {}
    for (const key of keys) {
      counts[key] = rows.reduce((n, row) => {
        const v = row[key]
        return n + (v != null && String(v).trim() !== '' && String(v).trim() !== '—' ? 1 : 0)
      }, 0)
    }
    return counts
  }, [rows, keys])
}

/** dd/mm/พ.ศ. */
export function formatThaiDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear() + 543}`
}

/** อายุเต็มปี ณ วันที่อ้างอิง (ค่าตั้งต้น = วันนี้) */
export function calcAge(birthdate, at = new Date()) {
  if (!birthdate) return null
  const b = new Date(birthdate)
  if (Number.isNaN(b.getTime())) return null
  let age = at.getFullYear() - b.getFullYear()
  const m = at.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && at.getDate() < b.getDate())) age -= 1
  return age >= 0 ? age : null
}

/** 1-2345-67890-12-3 */
export function formatNationalId(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits.length !== 13) return value ?? ''
  return `${digits[0]}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits[12]}`
}

export function formatGender(value) {
  if (!value) return ''
  const v = String(value).toLowerCase()
  if (['male', 'm', 'ชาย'].includes(v)) return 'ชาย'
  if (['female', 'f', 'หญิง'].includes(v)) return 'หญิง'
  return String(value)
}
