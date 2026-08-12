import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// ป้ายชื่อคล้องคอ — A4 ตั้ง 4 ใบต่อแผ่น (2×2) ตัดตามเส้นประแล้วใส่ซองพลาสติก
//
// QR ใช้ qr_token ตัวเดียวกับหน้า MyQR ของลูกทัวร์ — สแกนที่ CheckIn ได้เลย
// เผื่อกรณีลูกทัวร์มือถือแบตหมดหรือเปิดแอปไม่เป็น ทีมงานสแกนจากป้ายคล้องคอแทนได้
//
// ไม่มีหัวกระดาษ (DocumentHeader) เพราะแต่ละใบต้องถูกตัดออกจากกัน
// ข้อมูลบริษัทจึงย่อไปอยู่ในแต่ละใบแทน
const PER_PAGE = 4

export default function NameTag() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.NAME_TAG)
  const meta = DOC_TITLES.name_tag

  const [guests, setGuests] = useState([])
  const [buses, setBuses] = useState([])
  const [seats, setSeats] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showQr, setShowQr] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [guestsRes, busesRes, seatsRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, qr_token, bus_id')
          .eq('tour_id', tourId),
        supabase.from('buses').select('id, name').eq('tour_id', tourId),
        supabase
          .from('bus_seats')
          .select('guest_id, row_number, seat_position')
          .eq('tour_id', tourId)
          .not('guest_id', 'is', null),
      ])

      if (cancelled) return
      if (guestsRes.error) {
        console.error('[NameTag] load failed', guestsRes.error)
        setError('โหลดรายชื่อไม่สำเร็จ')
        setLoading(false)
        return
      }

      setGuests(guestsRes.data ?? [])
      setBuses(busesRes.data ?? [])
      setSeats(seatsRes.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  const seatByGuestId = useMemo(() => {
    const map = {}
    for (const s of seats) if (s.guest_id) map[s.guest_id] = `${s.row_number}${s.seat_position}`
    return map
  }, [seats])

  const busNameById = useMemo(() => {
    const map = {}
    for (const b of buses) map[b.id] = b.name
    return map
  }, [buses])

  const sorted = useMemo(
    () => [...guests].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th')),
    [guests]
  )

  const pages = useMemo(() => {
    const out = []
    for (let i = 0; i < sorted.length; i += PER_PAGE) out.push(sorted.slice(i, i + PER_PAGE))
    return out
  }, [sorted])

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_portrait}
      orientationNote={`A4 แนวตั้ง · 4 ใบ/แผ่น · ${sorted.length} คน · ${pages.length} แผ่น`}
      onPrint={defaultPrint}
      toolbar={
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={showQr}
            onChange={(e) => setShowQr(e.target.checked)}
            className="h-4 w-4 accent-[rgb(var(--c-brand))]"
          />
          พิมพ์ QR สำหรับเช็คอินบนป้ายด้วย
        </label>
      }
    >
      {pages.map((pageGuests, pageIndex) => (
        <section
          key={pageIndex}
          className="grid grid-cols-2 gap-0"
          style={pageIndex > 0 ? { breakBefore: 'page' } : undefined}
        >
          {pageGuests.map((g) => (
            <div
              key={g.id}
              className="flex flex-col items-center justify-center p-4 text-center"
              style={{ height: '128mm', border: '1px dashed #9ca3af' }}
            >
              <p className="max-w-full truncate text-[8pt] text-gray-500">{ctx.tour?.name}</p>

              <p className="mt-2 max-w-full break-words text-[30pt] font-medium leading-tight">
                {g.nickname || g.name}
              </p>
              {g.nickname && (
                <p className="mt-1 max-w-full break-words text-[11pt] text-gray-600">{g.name}</p>
              )}

              {(busNameById[g.bus_id] || seatByGuestId[g.id]) && (
                <p className="doc-num mt-3 border border-gray-400 px-3 py-1 text-[12pt]">
                  {[busNameById[g.bus_id], seatByGuestId[g.id] && `ที่นั่ง ${seatByGuestId[g.id]}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}

              {showQr && g.qr_token && (
                <div className="mt-3">
                  <QRCodeSVG value={g.qr_token} size={96} level="M" />
                </div>
              )}

              <div className="mt-auto w-full pt-3 text-[8pt] text-gray-600">
                {ctx.leader && (
                  <p>
                    ติดต่อ {ctx.leader.name}
                    {ctx.leader.phone && <span className="doc-num"> · {ctx.leader.phone}</span>}
                  </p>
                )}
                {ctx.org?.name && <p className="truncate text-gray-400">{ctx.org.name}</p>}
              </div>
            </div>
          ))}
        </section>
      ))}

      {sorted.length === 0 && (
        <p className="py-10 text-center text-gray-400">ยังไม่มีลูกทัวร์ในทริปนี้</p>
      )}
    </DocumentShell>
  )
}
