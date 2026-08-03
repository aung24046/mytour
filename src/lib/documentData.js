// ข้อมูลร่วมของเอกสาร export ทุกใบ — org (หัวกระดาษ) + tour + หัวหน้าทัวร์ + preset คอลัมน์
//
// แยกออกมาเพราะทั้ง 8 เอกสารต้องใช้ชุดเดียวกันหมด ไม่ควรก๊อป query ซ้ำ 8 รอบ

import { useEffect, useMemo, useState } from 'react'

import { supabase } from './supabase'
import { useActiveTourId, useActiveOrgId } from './staffSession'
import { OVERFLOW } from './printProfiles'

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
}

/** ป้ายชื่อคอลัมน์กลาง — ใช้ทั้งในเอกสารและหน้าเลือกคอลัมน์ */
export const COLUMN_LABELS = {
  index: 'ลำดับ',
  room_number: 'ห้อง',
  floor: 'ชั้น',
  room_type: 'ประเภท',
  max_guests: 'พักได้',
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

/** คอลัมน์ที่เลือกได้ของแต่ละเอกสาร พร้อมนโยบายข้อความยาวที่แนะนำ */
export const AVAILABLE_COLUMNS = {
  rooming_list: [
    { key: 'room_number', overflow: OVERFLOW.NOWRAP, locked: true },
    { key: 'floor', overflow: OVERFLOW.NOWRAP },
    { key: 'room_type', overflow: OVERFLOW.NOWRAP },
    { key: 'name', overflow: OVERFLOW.STACK, stackWith: 'nickname', locked: true },
    { key: 'nickname', overflow: OVERFLOW.NOWRAP },
    { key: 'name_en', overflow: OVERFLOW.NOWRAP },
    { key: 'gender', overflow: OVERFLOW.STACK, stackWith: 'birthdate' },
    { key: 'birthdate', overflow: OVERFLOW.NOWRAP },
    { key: 'national_id', overflow: OVERFLOW.NOWRAP },
    { key: 'passport_no', overflow: OVERFLOW.STACK, stackWith: 'passport_expiry' },
    { key: 'passport_expiry', overflow: OVERFLOW.NOWRAP },
    { key: 'nationality', overflow: OVERFLOW.NOWRAP },
    { key: 'phone', overflow: OVERFLOW.NOWRAP },
    { key: 'note', overflow: OVERFLOW.FOOTNOTE },
  ],
  guest_manifest: [
    { key: 'index', overflow: OVERFLOW.NOWRAP, locked: true },
    { key: 'name', overflow: OVERFLOW.STACK, stackWith: 'name_en', locked: true },
    { key: 'nickname', overflow: OVERFLOW.NOWRAP },
    { key: 'name_en', overflow: OVERFLOW.NOWRAP },
    { key: 'title', overflow: OVERFLOW.NOWRAP },
    { key: 'gender', overflow: OVERFLOW.STACK, stackWith: 'birthdate' },
    { key: 'birthdate', overflow: OVERFLOW.NOWRAP },
    { key: 'national_id', overflow: OVERFLOW.NOWRAP },
    { key: 'passport_no', overflow: OVERFLOW.STACK, stackWith: 'passport_expiry' },
    { key: 'passport_expiry', overflow: OVERFLOW.NOWRAP },
    { key: 'nationality', overflow: OVERFLOW.NOWRAP },
    { key: 'insurance_no', overflow: OVERFLOW.NOWRAP },
    { key: 'phone', overflow: OVERFLOW.STACK, stackWith: 'emergency_contact_phone' },
    { key: 'emergency_contact_name', overflow: OVERFLOW.NOWRAP },
    { key: 'emergency_contact_phone', overflow: OVERFLOW.NOWRAP },
    { key: 'food_allergy', overflow: OVERFLOW.CLAMP, lines: 2 },
    { key: 'medical_condition', overflow: OVERFLOW.SUBROW },
    { key: 'note', overflow: OVERFLOW.FOOTNOTE },
  ],
}

/** ใส่ label + ป้ายอ่อนไหวให้ column def ที่มาจาก preset (jsonb เก็บแค่ key กับนโยบาย) */
export function hydrateColumns(cols) {
  return cols.map((c) => ({
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
    presets: [],
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [orgRes, tourRes, staffRes, presetRes] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', orgId).maybeSingle(),
        supabase
          .from('tours')
          .select('id, org_id, name, join_code, status, start_date, end_date')
          .eq('id', tourId)
          .maybeSingle(),
        supabase.from('v_tour_staff').select('name, phone, role').eq('tour_id', tourId),
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

      const staff = staffRes.data ?? []
      const leader =
        staff.find((s) => s.role === 'leader') ??
        staff.find((s) => s.role === 'lead') ??
        staff[0] ??
        null

      setState({
        loading: false,
        error: null,
        org: orgRes.data ?? null,
        tour: tourRes.data ?? null,
        leader,
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
