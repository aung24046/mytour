import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId, getStaffSession } from '../../../lib/staffSession'
import { can } from '../../../lib/permissions'
import {
  AVAILABLE_COLUMNS,
  DOC_TITLES,
  DOC_TYPES,
  calcAge,
  formatGender,
  formatNationalId,
  formatThaiDate,
  hydrateColumns,
  useColumnFillCounts,
  useDocumentContext,
} from '../../../lib/documentData'
import { decideOrientation } from '../../../lib/printProfiles'
import DocumentHeader from '../../../components/document/DocumentHeader'
import DocumentTable from '../../../components/document/DocumentTable'
import DocumentFooter from '../../../components/document/DocumentFooter'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'
import ColumnPicker from '../../../components/document/ColumnPicker'

// บัญชีรายชื่อผู้เดินทาง (DataSpec §2) — ใช้กับ ตม. / สายการบิน / ประกันภัย
// ชุดข้อมูลเข้มที่สุดในระบบ จึงต้องเลือกคอลัมน์ได้ละเอียดที่สุดด้วย
export default function GuestManifest() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.GUEST_MANIFEST)
  const session = getStaffSession()

  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [columns, setColumns] = useState([])
  const [presets, setPresets] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error: loadError } = await supabase
        .from('guests')
        .select(
          'id, name, nickname, gender, phone, note, food_allergy, medical_condition, ' +
            'emergency_contact_name, emergency_contact_phone, ' +
            'title, name_en, birthdate, national_id, passport_no, passport_expiry, nationality, insurance_no'
        )
        .eq('tour_id', tourId)
        .order('name', { ascending: true })

      if (cancelled) return

      if (loadError) {
        console.error('[GuestManifest] load failed', loadError)
        setError('โหลดรายชื่อไม่สำเร็จ')
        setLoading(false)
        return
      }

      setGuests(data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  useEffect(() => {
    if (ctx.presets.length === 0 || columns.length > 0) return
    setPresets(ctx.presets)
    const def = ctx.presets.find((p) => p.is_default) ?? ctx.presets[0]
    setColumns(hydrateColumns(def.columns ?? []))
  }, [ctx.presets, columns.length])

  const rows = useMemo(
    () =>
      guests.map((g, i) => {
        const age = calcAge(g.birthdate)
        return {
          _id: g.id,
          index: String(i + 1),
          title: g.title,
          name: g.name,
          nickname: g.nickname,
          name_en: g.name_en,
          gender: formatGender(g.gender),
          birthdate: g.birthdate
            ? `${formatThaiDate(g.birthdate)}${age != null ? ` · ${age} ปี` : ''}`
            : '',
          national_id: formatNationalId(g.national_id),
          passport_no: g.passport_no,
          passport_expiry: formatThaiDate(g.passport_expiry),
          nationality: g.nationality,
          insurance_no: g.insurance_no,
          phone: g.phone,
          emergency_contact_name: g.emergency_contact_name,
          emergency_contact_phone: g.emergency_contact_phone
            ? `${g.emergency_contact_phone}${g.emergency_contact_name ? ` (${g.emergency_contact_name})` : ''}`
            : '',
          food_allergy: g.food_allergy,
          medical_condition: g.medical_condition,
          note: g.note,
        }
      }),
    [guests]
  )

  const availableKeys = useMemo(() => AVAILABLE_COLUMNS.guest_manifest.map((c) => c.key), [])
  const fillCounts = useColumnFillCounts(rows, availableKeys)
  const fillCountsWithTotal = useMemo(
    () => ({ ...fillCounts, __total: rows.length }),
    [fillCounts, rows.length]
  )

  const orientation = useMemo(() => decideOrientation(columns), [columns])
  const meta = DOC_TITLES.guest_manifest

  // สรุปหัวเอกสาร — ตม. กับประกันภัยถามยอดนี้เป็นอย่างแรกเสมอ
  const summary = useMemo(() => {
    const adults = guests.filter((g) => {
      const age = calcAge(g.birthdate)
      return age == null || age >= 18
    }).length
    const children = guests.length - adults
    return children > 0
      ? `ผู้ใหญ่ ${adults} · เด็ก ${children} · รวม ${guests.length} ท่าน`
      : `รวม ${guests.length} ท่าน`
  }, [guests])

  if (loading || ctx.loading) {
    return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  }
  if (error || ctx.error) {
    return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>
  }

  return (
    <DocumentShell
      title={meta.title}
      paper={orientation.paper}
      orientationNote={orientation.switched ? orientation.reason : null}
      onPrint={defaultPrint}
      printDisabled={rows.length === 0}
      toolbar={
        <ColumnPicker
          docType={DOC_TYPES.GUEST_MANIFEST}
          available={AVAILABLE_COLUMNS.guest_manifest}
          selected={columns}
          onChange={setColumns}
          presets={presets}
          onPresetsChange={setPresets}
          fillCounts={fillCountsWithTotal}
          canSavePreset={can(session, 'document.preset')}
        />
      }
    >
      <DocumentHeader
        org={ctx.org}
        tour={ctx.tour}
        leader={ctx.leader}
        title={meta.title}
        subtitle={meta.subtitle}
      />

      <div className="my-2 text-[8pt] text-gray-600">{summary}</div>

      <DocumentTable columns={columns} rows={rows} emptyText="ทริปนี้ยังไม่มีลูกทัวร์" />

      <DocumentFooter org={ctx.org} summary={summary} />
    </DocumentShell>
  )
}
