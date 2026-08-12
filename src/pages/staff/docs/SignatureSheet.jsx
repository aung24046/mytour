import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, useDocumentContext } from '../../../lib/documentData'
import { PAPER, TYPE_SCALE } from '../../../lib/printProfiles'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'
import DocumentHeader from '../../../components/document/DocumentHeader'
import DocumentFooter from '../../../components/document/DocumentFooter'

// ใบเซ็นชื่อ — A4 นอน ใช้เป็นหลักฐานการเข้าร่วม (กรุ๊ปมหาวิทยาลัย/ราชการต้องใช้เบิกจ่าย)
//
// ไม่ใช้ DocumentTable เพราะช่องลายเซ็นเป็น "ช่องว่างที่ต้องสูงพอให้เซ็นได้"
// ซึ่งขัดกับหลักของตารางนั้นที่ความสูงแถวมาจากเนื้อหา
//
// แถวสูง 11mm — เขียนชื่อด้วยลายมือได้สบายโดยไม่เปลืองกระดาษเกินไป
// (79 คน = 3 หน้า ที่ 28 แถว/หน้า)
const ROWS_PER_PAGE = 24

export default function SignatureSheet() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.SIGNATURE_SHEET)
  const meta = DOC_TITLES.signature_sheet

  const [guests, setGuests] = useState([])
  const [buses, setBuses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busFilter, setBusFilter] = useState('all')

  useEffect(() => {
    let cancelled = false

    async function load() {
      // ใบนี้ใช้แค่ "อยู่รถคันไหน" — เลขที่นั่งไม่ช่วยตอนไล่เซ็นชื่อ และทำให้ช่องแคบลงเปล่า ๆ
      const [guestsRes, busesRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, gender, phone, bus_id')
          .eq('tour_id', tourId),
        supabase.from('buses').select('id, name').eq('tour_id', tourId).order('name'),
      ])

      if (cancelled) return
      if (guestsRes.error) {
        console.error('[SignatureSheet] load failed', guestsRes.error)
        setError('โหลดรายชื่อไม่สำเร็จ')
        setLoading(false)
        return
      }

      setGuests(guestsRes.data ?? [])
      setBuses(busesRes.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  const busNameById = useMemo(() => {
    const map = {}
    for (const b of buses) map[b.id] = b.name
    return map
  }, [buses])

  const rows = useMemo(() => {
    const list = guests
      .filter((g) => busFilter === 'all' || g.bus_id === busFilter)
      // เรียงตามชื่อจริง — คนเซ็นไล่หาชื่อตัวเองในใบ ไม่ได้หาตามลำดับที่ลงทะเบียน
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'))
    return list.map((g, i) => ({
      no: i + 1,
      name: g.name,
      nickname: g.nickname,
      bus: busNameById[g.bus_id] ?? '',
    }))
  }, [guests, busFilter, busNameById])

  const pages = useMemo(() => {
    const out = []
    for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) out.push(rows.slice(i, i + ROWS_PER_PAGE))
    return out.length > 0 ? out : [[]]
  }, [rows])

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  const headStyle = {
    fontSize: `${TYPE_SCALE.tableHead.sizePt}pt`,
    fontWeight: TYPE_SCALE.tableHead.weight,
  }
  const bodyStyle = { fontSize: `${TYPE_SCALE.tableBody.sizePt}pt` }

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_landscape}
      orientationNote={`A4 แนวนอน · ${rows.length} รายชื่อ · ${pages.length} หน้า`}
      onPrint={defaultPrint}
      toolbar={
        buses.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setBusFilter('all')}
              className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${
                busFilter === 'all' ? 'bg-brand text-white' : 'bg-surface text-ink-muted ring-1 ring-line-subtle'
              }`}
            >
              ทุกคัน
            </button>
            {buses.map((b) => (
              <button
                key={b.id}
                onClick={() => setBusFilter(b.id)}
                className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${
                  busFilter === b.id ? 'bg-brand text-white' : 'bg-surface text-ink-muted ring-1 ring-line-subtle'
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        )
      }
    >
      {pages.map((pageRows, pageIndex) => (
        <section
          key={pageIndex}
          style={pageIndex > 0 ? { breakBefore: 'page', paddingTop: '6mm' } : undefined}
        >
          <DocumentHeader
            org={ctx.org}
            tour={ctx.tour}
            leader={ctx.leader}
            title={meta.title}
            subtitle={
              busFilter === 'all' ? meta.subtitle : `${meta.subtitle} · ${busNameById[busFilter] ?? ''}`
            }
            pageLabel={`หน้า ${pageIndex + 1}/${pages.length}`}
          />

          <table className="mt-2 w-full border-collapse" style={bodyStyle}>
            <thead>
              <tr>
                <th className="border border-gray-400 px-1.5 py-1 text-center" style={{ ...headStyle, width: '10mm' }}>
                  ลำดับ
                </th>
                <th className="border border-gray-400 px-1.5 py-1 text-left" style={{ ...headStyle, width: '62mm' }}>
                  ชื่อ-นามสกุล
                </th>
                <th className="border border-gray-400 px-1.5 py-1 text-left" style={{ ...headStyle, width: '28mm' }}>
                  ชื่อเล่น
                </th>
                <th className="border border-gray-400 px-1.5 py-1 text-center" style={{ ...headStyle, width: '24mm' }}>
                  รถ
                </th>
                <th className="border border-gray-400 px-1.5 py-1 text-center" style={headStyle}>
                  ลายมือชื่อ
                </th>
                <th className="border border-gray-400 px-1.5 py-1 text-center" style={{ ...headStyle, width: '30mm' }}>
                  หมายเหตุ
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.no} style={{ height: '11mm' }}>
                  <td className="doc-num border border-gray-400 px-1.5 text-center">{r.no}</td>
                  <td className="border border-gray-400 px-1.5">{r.name}</td>
                  <td className="border border-gray-400 px-1.5">{r.nickname}</td>
                  <td className="border border-gray-400 px-1.5 text-center">{r.bus}</td>
                  {/* ช่องลายเซ็นกับหมายเหตุปล่อยว่างตั้งใจ — คนกรอกด้วยปากกา */}
                  <td className="border border-gray-400" />
                  <td className="border border-gray-400" />
                </tr>
              ))}
              {/* เติมแถวว่างให้เต็มหน้า เผื่อมีคนมาสมทบหน้างาน */}
              {pageIndex === pages.length - 1 &&
                Array.from({ length: Math.max(0, 4) }).map((_, i) => (
                  <tr key={`blank-${i}`} style={{ height: '11mm' }}>
                    <td className="doc-num border border-gray-400 px-1.5 text-center text-gray-400">
                      {rows.length + i + 1}
                    </td>
                    <td className="border border-gray-400" />
                    <td className="border border-gray-400" />
                    <td className="border border-gray-400" />
                    <td className="border border-gray-400" />
                    <td className="border border-gray-400" />
                  </tr>
                ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end gap-16 pr-4 text-[9pt] text-gray-600">
            <div className="text-center">
              <div className="h-[14mm]" />
              <p className="border-t border-gray-500 px-8 pt-1">ผู้ควบคุมกลุ่ม</p>
            </div>
            <div className="text-center">
              <div className="h-[14mm]" />
              <p className="border-t border-gray-500 px-8 pt-1">
                {ctx.leader ? `หัวหน้าทัวร์ ${ctx.leader.name}` : 'หัวหน้าทัวร์'}
              </p>
            </div>
          </div>

          <DocumentFooter
            org={ctx.org}
            summary={`รวม ${rows.length} คน`}
            pageLabel={`หน้า ${pageIndex + 1}/${pages.length}`}
          />
        </section>
      ))}
    </DocumentShell>
  )
}
