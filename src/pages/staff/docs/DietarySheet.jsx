import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import {
  DOC_TITLES,
  DOC_TYPES,
  formatGender,
  useDocumentContext,
  useGuestCustomFields,
} from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import { downloadXlsx } from '../../../lib/exportXlsx'
import DocumentHeader from '../../../components/document/DocumentHeader'
import DocumentFooter from '../../../components/document/DocumentFooter'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// สรุปข้อจำกัดด้านอาหาร (DataSpec §4) — ส่งร้านอาหาร
// ยอดสรุปอยู่บนสุดเพราะร้านต้องการรู้จำนวนก่อนรายละเอียดรายคน
export default function DietarySheet() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.DIETARY_SHEET)
  // ทริปจริงเก็บ "อาหารที่แพ้" กับ "ข้อจำกัดด้านอาหาร" ไว้คนละ custom field
  // ตัว resolver แยกสองอย่างนี้ออกจากกันให้แล้ว (ดู sources ใน documentData.js)
  const custom = useGuestCustomFields(tourId)

  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error: loadError } = await supabase
        .from('guests')
        .select('id, name, nickname, gender, food_allergy, medical_condition')
        .eq('tour_id', tourId)
        .order('name')

      if (cancelled) return
      if (loadError) {
        console.error('[DietarySheet] load failed', loadError)
        setError('โหลดข้อมูลไม่สำเร็จ')
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

  // แถวเฉพาะคนที่มีข้อจำกัดจริง — ร้านไม่ต้องอ่านรายชื่อคนที่กินได้ทุกอย่าง
  const rows = useMemo(
    () =>
      guests
        // resolveList คืนเป็นรายการที่แกะแล้ว (ตัดวงเล็บอังกฤษ + คำนำหน้า "อื่นๆ โปรดระบุ:")
        // เดิมใช้ resolve ที่ต่อทุกอย่างเป็นสตริงเดียว ช่องเลยกลายเป็นกำแพงข้อความ
        .map((g) => ({
          id: g.id,
          name: `${g.nickname || g.name}${g.nickname ? ` (${g.name})` : ''}`,
          gender: formatGender(g.gender),
          allergy: custom.resolveList(g, 'food_allergy'),
          dietary: custom.resolveList(g, 'dietary'),
          medical: custom.resolveList(g, 'medical_condition'),
        }))
        // resolver ตัดคำตอบ "ไม่มี" ออกให้แล้ว เหลือว่าง = คนนี้กินได้ทุกอย่าง
        .filter((r) => r.allergy.length > 0 || r.dietary.length > 0),
    [guests, custom]
  )

  const counts = useMemo(() => {
    const withAllergy = rows.filter((r) => r.allergy.length > 0).length
    const withDietary = rows.filter((r) => r.dietary.length > 0).length
    return {
      total: guests.length,
      normal: guests.length - rows.length,
      allergy: withAllergy,
      dietary: withDietary,
    }
  }, [rows, guests.length])

  const meta = DOC_TITLES.dietary_sheet

  function handleExport() {
    downloadXlsx(`สรุปข้อจำกัดด้านอาหาร-${ctx.tour?.name ?? 'tour'}`, [
      {
        name: 'ข้อจำกัดด้านอาหาร',
        rows: [
          ['ชื่อ', 'เพศ', 'แพ้อาหาร', 'ข้อจำกัด', 'โรคประจำตัว'],
          ...rows.map((r) => [
            r.name,
            r.gender,
            r.allergy.join(', '),
            r.dietary.join(', '),
            r.medical.join(', '),
          ]),
        ],
        colWidths: [30, 8, 34, 34, 34],
      },
    ])
  }

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_portrait}
      onPrint={defaultPrint}
      onExportXlsx={handleExport}
    >
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
          <col style={{ width: '26%' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '26%' }} />
          <col style={{ width: '22%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">ชื่อ</th>
            {/* แยกสามอย่างที่เคยกองรวมกัน: แพ้ = ห้ามเด็ดขาด · ไม่ทาน = ปรับเมนูได้ · สุขภาพ = ไว้ให้ทีมงานรู้ */}
            <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">แพ้อาหาร</th>
            <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">ไม่ทาน / ข้อจำกัด</th>
            <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">สุขภาพ</th>
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
                <ItemList items={r.allergy} />
              </td>
              <td className="border border-gray-300 px-1.5 py-1 align-top">
                <ItemList items={r.dietary} />
              </td>
              <td className="border border-gray-300 px-1.5 py-1 align-top text-gray-600">
                <ItemList items={r.medical} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="border border-gray-300 px-1.5 py-3 text-center text-gray-400">
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

// หนึ่งข้อ = หนึ่งบรรทัด — ร้านอาหารกวาดตาหาของที่ต้องเตรียมได้เร็วกว่าอ่านสตริงยาว
function ItemList({ items }) {
  if (!items || items.length === 0) return <span className="text-gray-400">—</span>
  return (
    <ul className="m-0 list-none p-0">
      {items.map((item, i) => (
        <li key={`${item}-${i}`} className="flex gap-1 leading-snug">
          <span aria-hidden="true">·</span>
          <span style={{ overflowWrap: 'anywhere' }}>{item}</span>
        </li>
      ))}
    </ul>
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
