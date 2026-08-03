import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentHeader from '../../../components/document/DocumentHeader'
import DocumentFooter from '../../../components/document/DocumentFooter'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// ผังที่นั่งรถ (DataSpec §3) — แนวตั้งเพราะเป็นผังภาพตามรูปทรงรถ ไม่ใช่ตาราง
// ท้ายหน้ามีตารางเลขที่นั่ง–ชื่อ–เบอร์ เรียงตามเลขที่นั่ง สำหรับเรียกชื่อขึ้นรถ
export default function SeatManifest() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.SEAT_MANIFEST)

  const [buses, setBuses] = useState([])
  const [seats, setSeats] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [busesRes, seatsRes, guestsRes] = await Promise.all([
        supabase
          .from('buses')
          .select('id, name, license_plate, driver_name, driver_phone, total_rows, seats_per_row')
          .eq('tour_id', tourId)
          .order('name'),
        supabase
          .from('bus_seats')
          .select('id, bus_id, row_number, seat_position, guest_id, is_seat, is_available, seat_type')
          .eq('tour_id', tourId),
        supabase
          .from('guests')
          .select('id, name, nickname, gender, phone')
          .eq('tour_id', tourId),
      ])

      if (cancelled) return
      if (busesRes.error || seatsRes.error || guestsRes.error) {
        console.error('[SeatManifest] load failed', busesRes.error, seatsRes.error, guestsRes.error)
        setError('โหลดข้อมูลไม่สำเร็จ')
        setLoading(false)
        return
      }

      setBuses(busesRes.data ?? [])
      setSeats(seatsRes.data ?? [])
      setGuests(guestsRes.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const meta = DOC_TITLES.seat_manifest

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a4_portrait}
      onPrint={defaultPrint}
      printDisabled={buses.length === 0}
    >
      {buses.length === 0 && (
        <p className="py-8 text-center text-ink-muted">ทริปนี้ยังไม่ได้เพิ่มรถ</p>
      )}

      {buses.map((bus, i) => {
        const busSeats = seats.filter((s) => s.bus_id === bus.id && s.is_seat !== false)
        const occupied = busSeats.filter((s) => s.guest_id)
        const rows = groupByRow(busSeats)

        return (
          <section key={bus.id} className={i > 0 ? 'doc-page-break pt-6' : ''}>
            <DocumentHeader
              org={ctx.org}
              tour={ctx.tour}
              leader={ctx.leader}
              title={meta.title}
              subtitle={`${bus.name}${bus.license_plate ? ` · ${bus.license_plate}` : ''}`}
              pageLabel={`คันที่ ${i + 1}/${buses.length}`}
            />

            <p className="mt-2 text-[8pt] text-gray-600">
              {bus.driver_name
                ? `คนขับ: ${bus.driver_name}${bus.driver_phone ? ` ${bus.driver_phone}` : ''}`
                : 'ยังไม่ได้ระบุคนขับ'}
            </p>

            <div className="mt-2 rounded border border-gray-400 p-2">
              <div className="mb-1.5 flex justify-between text-[7.5pt] text-gray-500">
                <span>หน้ารถ</span>
                <span>คนขับ</span>
              </div>

              {rows.map(({ rowNumber, seatsInRow }) => (
                <div key={rowNumber} className="mb-1 flex items-stretch gap-1">
                  {seatsInRow.map((seat, idx) => (
                    <SeatBox
                      key={seat.id}
                      seat={seat}
                      guest={guestById[seat.guest_id]}
                      // ช่องทางเดินกลางรถ — วางไว้หลังที่นั่งที่ 2 ตามผังรถบัสมาตรฐาน
                      gapAfter={idx === 1 && seatsInRow.length > 2}
                    />
                  ))}
                </div>
              ))}
            </div>

            <table className="doc-table mt-3 w-full border-collapse text-[8pt]">
              <thead>
                <tr>
                  <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">ที่นั่ง</th>
                  <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">ชื่อ</th>
                  <th className="border border-gray-300 bg-gray-100 px-1.5 py-1 text-left font-medium">โทรศัพท์</th>
                </tr>
              </thead>
              <tbody>
                {occupied
                  .slice()
                  .sort((a, b) => seatLabel(a).localeCompare(seatLabel(b), 'en', { numeric: true }))
                  .map((seat) => {
                    const g = guestById[seat.guest_id]
                    return (
                      <tr key={seat.id}>
                        <td className="doc-num border border-gray-300 px-1.5 py-0.5">{seatLabel(seat)}</td>
                        <td className="border border-gray-300 px-1.5 py-0.5">
                          {g ? `${g.name}${g.nickname ? ` (${g.nickname})` : ''}` : '—'}
                        </td>
                        <td className="doc-num border border-gray-300 px-1.5 py-0.5">{g?.phone ?? '—'}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>

            <DocumentFooter
              org={ctx.org}
              summary={`นั่งแล้ว ${occupied.length} · ว่าง ${busSeats.length - occupied.length}`}
            />
          </section>
        )
      })}
    </DocumentShell>
  )
}

function SeatBox({ seat, guest, gapAfter }) {
  const tone = !guest
    ? 'bg-gray-100 text-gray-500'
    : guest.gender === 'female' || guest.gender === 'หญิง'
      ? 'bg-pink-50 text-pink-900'
      : 'bg-sky-50 text-sky-900'

  return (
    <>
      <div
        className={`flex-1 rounded px-1 py-1 text-center text-[7.5pt] ${tone}`}
        style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
      >
        <span className="block font-medium">{seatLabel(seat)}</span>
        <span className="block truncate">{guest ? guest.nickname || guest.name : 'ว่าง'}</span>
      </div>
      {gapAfter && <div style={{ width: '5mm' }} />}
    </>
  )
}

function seatLabel(seat) {
  return `${seat.row_number ?? ''}${seat.seat_position ?? ''}`
}

function groupByRow(seats) {
  const map = new Map()
  for (const s of seats) {
    const key = s.row_number ?? 0
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(s)
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNumber, seatsInRow]) => ({
      rowNumber,
      seatsInRow: seatsInRow.sort((a, b) =>
        String(a.seat_position ?? '').localeCompare(String(b.seat_position ?? ''))
      ),
    }))
}
