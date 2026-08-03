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
  useGuestCustomFields,
} from '../../../lib/documentData'
import { decideOrientation } from '../../../lib/printProfiles'
import { downloadXlsx, tableToSheetRows } from '../../../lib/exportXlsx'
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
  // ข้อมูลสำคัญหลายอย่างของทริปจริงอยู่ใน custom field ไม่ใช่คอลัมน์ core
  const custom = useGuestCustomFields(tourId)

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
        const r = (key) => custom.resolve(g, key)
        return {
          _id: g.id,
          index: String(i + 1),
          title: g.title,
          name: g.name,
          nickname: g.nickname,
          name_en: g.name_en,
          gender: formatGender(g.gender),
          birthdate: formatThaiDate(g.birthdate),
          national_id: formatNationalId(r('national_id')),
          passport_no: g.passport_no,
          passport_expiry: formatThaiDate(g.passport_expiry),
          nationality: g.nationality,
          insurance_no: g.insurance_no,
          phone: r('phone'),
          emergency_contact_name: g.emergency_contact_name,
          emergency_contact_phone: r('emergency_contact_phone'),
          food_allergy: r('food_allergy'),
          dietary: r('dietary'),
          medical_condition: r('medical_condition'),
          note: g.note,
        }
      }),
    [guests, custom]
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

  // Excel ได้ทุกคอลัมน์ที่เลือก รวมคอลัมน์ที่บนกระดาษถูกย้ายไปแถวย่อย/เชิงอรรถ
  function handleExport() {
    downloadXlsx(`บัญชีรายชื่อผู้เดินทาง-${ctx.tour?.name ?? 'tour'}`, [
      {
        name: 'รายชื่อผู้เดินทาง',
        rows: tableToSheetRows(columns, rows),
        colWidths: columns.map((c) => (c.key === 'index' ? 6 : c.key === 'name' ? 28 : 20)),
      },
    ])
  }

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
      onExportXlsx={handleExport}
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
