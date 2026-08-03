import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, formatGender, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentHeader from '../../../components/document/DocumentHeader'
import DocumentFooter from '../../../components/document/DocumentFooter'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// สรุปข้อจำกัดด้านอาหาร (DataSpec §4) — ส่งร้านอาหาร
// ยอดสรุปอยู่บนสุดเพราะร้านต้องการรู้จำนวนก่อนรายละเอียดรายคน
export default function DietarySheet() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.DIETARY_SHEET)

  const [guests, setGuests] = useState([])
  const [dietaryByGuest, setDietaryByGuest] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [guestsRes, fieldsRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, gender, food_allergy, medical_condition')
          .eq('tour_id', tourId)
          .order('name'),
        // หาฟิลด์ที่ทำหน้าที่ "ข้อจำกัดด้านอาหาร" โดยไม่ hardcode field_key
        supabase
          .from('v_tour_form_fields')
          .select('id, field_purpose, is_active')
          .eq('tour_id', tourId)
          .eq('field_purpose', 'dietary'),
      ])

      if (cancelled) return
      if (guestsRes.error) {
        console.error('[DietarySheet] load failed', guestsRes.error)
        setError('โหลดข้อมูลไม่สำเร็จ')
        setLoading(false)
        return
      }

      const dietaryFieldIds = (fieldsRes.data ?? []).filter((f) => f.is_active).map((f) => f.id)

      let byGuest = {}
      if (dietaryFieldIds.length > 0) {
        const { data: responses } = await supabase
          .from('guest_form_responses')
          .select('guest_id, value')
          .in('field_id', dietaryFieldIds)

        for (const r of responses ?? []) {
          if (!r.value?.trim()) continue
          byGuest[r.guest_id] = [byGuest[r.guest_id], r.value].filter(Boolean).join(' · ')
        }
      }

      setGuests(guestsRes.data ?? [])
      setDietaryByGuest(byGuest)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  // แถวเฉพาะคนที่มีข้อจำกัดจริง — ร้านไม่ต้องอ่านรายชื่อคนที่กินได้ทุกอย่าง
  const rows = useMemo(
    () =>
      guests
        .map((g) => ({
          id: g.id,
          name: `${g.nickname || g.name}${g.nickname ? ` (${g.name})` : ''}`,
          gender: formatGender(g.gender),
          allergy: g.food_allergy?.trim() ?? '',
          dietary: dietaryByGuest[g.id] ?? '',
          medical: g.medical_condition?.trim() ?? '',
        }))
        .filter((r) => r.allergy || r.dietary),
    [guests, dietaryByGuest]
  )

  const counts = useMemo(() => {
    const withAllergy = rows.filter((r) => r.allergy).length
    const withDietary = rows.filter((r) => r.dietary).length
    return {
      total: guests.length,
      normal: guests.length - rows.length,
      allergy: withAllergy,
      dietary: withDietary,
    }
  }, [rows, guests.length])

  const meta = DOC_TITLES.dietary_sheet

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell title={meta.title} paper={PAPER.a4_portrait} onPrint={defaultPrint}>
      <DocumentHeader
        org={ctx.org}
        tour={ctx.tour}
        leader={ctx.leader}
        title={meta.title}
        subtitle={meta.subtitle}
      />

      <div className="mt-3 grid grid-cols-4 gap-2">
        <SummaryBox label="ทานได้ปกติ" value={counts.normal} />
        <SummaryBox label="แพ้อาหาร" value={counts.allergy} tone="bg-red-50 text-red-900" />
        <SummaryBox label="ข้อจำกัดอาหาร" value={counts.dietary} tone="bg-amber-50 text-amber-900" />
        <SummaryBox label="รวมทั้งหมด" value={counts.total} />
      </div>

      <table className="doc-table mt-3 w-full border-collapse text-[9pt]" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '30%' }} />
          <col style={{ width: '32%' }} />
          <col style={{ width: '38%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">ชื่อ</th>
            <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">แพ้อาหาร</th>
            <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">ข้อจำกัด / ข้อควรทราบ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="doc-row-group">
              <td className="border border-gray-300 px-1.5 py-1 align-top">
                {r.name}
                {r.gender && <span className="text-gray-500"> ({r.gender})</span>}
              </td>
              <td className="border border-gray-300 px-1.5 py-1 align-top font-medium text-red-800">
                {r.allergy || '—'}
              </td>
              <td className="border border-gray-300 px-1.5 py-1 align-top">
                {[r.dietary, r.medical].filter(Boolean).join(' · ') || '—'}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="border border-gray-300 px-1.5 py-3 text-center text-gray-400">
                ไม่มีลูกทัวร์ที่มีข้อจำกัดด้านอาหาร
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <DocumentFooter org={ctx.org} summary={`รวม ${counts.total} ท่าน`} />
    </DocumentShell>
  )
}

function SummaryBox({ label, value, tone = 'bg-gray-100 text-gray-800' }) {
  return (
    <div
      className={`rounded px-2 py-1.5 ${tone}`}
      style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
    >
      <div className="text-[7.5pt] opacity-80">{label}</div>
      <div className="doc-num text-[13pt] font-medium">{value}</div>
    </div>
  )
}
