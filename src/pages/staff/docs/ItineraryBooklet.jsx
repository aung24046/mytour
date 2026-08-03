import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId } from '../../../lib/staffSession'
import { DOC_TITLES, DOC_TYPES, formatThaiDate, useDocumentContext } from '../../../lib/documentData'
import { PAPER } from '../../../lib/printProfiles'
import DocumentFooter from '../../../components/document/DocumentFooter'
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'

// เล่มโปรแกรมทัวร์ (DataSpec §5) — แจกลูกค้า A5 เย็บเล่ม 1 วันต่อ 1 หน้า
// ต่างจากเอกสารใบอื่นตรงที่ผู้รับเป็นลูกค้า ไม่ใช่คู่ค้า — จึงไม่ใช้ DocumentHeader
// แบบตาราง แต่ทำปกแยกและจัดหน้าให้อ่านสบาย
export default function ItineraryBooklet() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.ITINERARY_BOOKLET)

  const [items, setItems] = useState([])
  const [hotels, setHotels] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [itemsRes, hotelsRes, contactsRes] = await Promise.all([
        supabase
          .from('itinerary_items')
          .select('id, day_number, sort_order, scheduled_time, title, description, location_name')
          .eq('tour_id', tourId)
          .order('day_number', { ascending: true })
          .order('sort_order', { ascending: true }),
        supabase
          .from('hotels')
          .select('id, name, check_in_date, check_out_date, wifi_name, wifi_password, breakfast_time, breakfast_location')
          .eq('tour_id', tourId)
          .order('check_in_date'),
        supabase
          .from('v_tour_emergency_contacts')
          .select('label, phone, category, sort_order, is_active')
          .eq('tour_id', tourId)
          .order('sort_order'),
      ])

      if (cancelled) return
      if (itemsRes.error) {
        console.error('[ItineraryBooklet] load failed', itemsRes.error)
        setError('โหลดกำหนดการไม่สำเร็จ')
        setLoading(false)
        return
      }

      setItems(itemsRes.data ?? [])
      setHotels(hotelsRes.data ?? [])
      setContacts((contactsRes.data ?? []).filter((c) => c.is_active !== false))
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  const days = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const key = item.day_number ?? 0
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [items])

  // จับคู่โรงแรมกับวัน โดยเทียบ check_in_date กับวันที่ของ day_number นั้น
  function hotelForDay(dayNumber) {
    if (!ctx.tour?.start_date) return null
    const date = new Date(ctx.tour.start_date)
    date.setDate(date.getDate() + (dayNumber - 1))
    const iso = date.toISOString().slice(0, 10)
    return hotels.find((h) => h.check_in_date <= iso && (!h.check_out_date || iso < h.check_out_date)) ?? null
  }

  const joinUrl =
    ctx.tour?.join_code && typeof window !== 'undefined'
      ? `${window.location.origin}/t/${ctx.tour.join_code}`
      : ''

  const meta = DOC_TITLES.itinerary_booklet

  if (loading || ctx.loading) return <p className="p-8 text-center text-ink-muted">กำลังโหลด…</p>
  if (error || ctx.error) return <p className="p-8 text-center text-danger">{error ?? ctx.error}</p>

  return (
    <DocumentShell
      title={meta.title}
      paper={PAPER.a5_portrait}
      orientationNote="A5 เย็บเล่ม · 1 วันต่อ 1 หน้า"
      onPrint={defaultPrint}
      printDisabled={items.length === 0}
    >
      {/* ปกหน้า */}
      <section className="doc-page-break flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
        {ctx.org?.logo_url ? (
          <img src={ctx.org.logo_url} alt="" className="h-14 object-contain" />
        ) : (
          <div className="text-[8pt] text-gray-400">{ctx.org?.name}</div>
        )}
        <h2 className="text-[16pt] font-medium">{ctx.tour?.name}</h2>
        <p className="text-[9pt] text-gray-600">
          {formatThaiDate(ctx.tour?.start_date)} – {formatThaiDate(ctx.tour?.end_date)}
        </p>
        {joinUrl && (
          <>
            <QRCodeSVG value={joinUrl} size={92} />
            <p className="text-[7.5pt] text-gray-500">
              สแกนเข้าแอป · รหัสทริป {ctx.tour.join_code}
            </p>
          </>
        )}
        <p className="mt-4 text-[8pt] text-gray-500">{ctx.org?.name}</p>
        {ctx.org?.phone && <p className="text-[7.5pt] text-gray-500">{ctx.org.phone}</p>}
      </section>

      {/* วันละหน้า */}
      {days.map(([dayNumber, dayItems], i) => {
        const hotel = hotelForDay(dayNumber)
        return (
          <section key={dayNumber} className={i < days.length - 1 ? 'doc-page-break pt-4' : 'pt-4'}>
            <h3 className="border-b border-gray-800 pb-1 text-[11pt] font-medium">
              วันที่ {dayNumber}
              {ctx.tour?.start_date && (
                <span className="ml-2 text-[8pt] font-normal text-gray-500">
                  {formatThaiDate(addDays(ctx.tour.start_date, dayNumber - 1))}
                </span>
              )}
            </h3>

            <div className="mt-2 space-y-1.5 text-[9pt]">
              {dayItems.map((item) => (
                <div key={item.id} className="flex gap-2">
                  <span className="doc-num w-11 shrink-0 text-gray-500">
                    {item.scheduled_time?.slice(0, 5) ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{item.title}</div>
                    {item.location_name && (
                      <div className="text-gray-500">{item.location_name}</div>
                    )}
                    {item.description && (
                      <div className="text-gray-600">{item.description}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {hotel && (
              <div
                className="mt-3 rounded bg-gray-100 px-2 py-1.5 text-[8pt]"
                style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
              >
                <div className="font-medium">พักคืนนี้ · {hotel.name}</div>
                <div className="text-gray-600">
                  {hotel.wifi_name && `WiFi: ${hotel.wifi_name}`}
                  {hotel.wifi_password && ` / ${hotel.wifi_password}`}
                  {hotel.breakfast_time && (
                    <>
                      <br />
                      อาหารเช้า {hotel.breakfast_time}
                      {hotel.breakfast_location && ` · ${hotel.breakfast_location}`}
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )
      })}

      {/* หน้าสุดท้าย — เบอร์ฉุกเฉิน */}
      {contacts.length > 0 && (
        <section className="doc-page-break pt-4">
          <h3 className="border-b border-gray-800 pb-1 text-[11pt] font-medium">เบอร์ติดต่อฉุกเฉิน</h3>
          <table className="mt-2 w-full text-[9pt]">
            <tbody>
              {contacts.map((c, idx) => (
                <tr key={idx}>
                  <td className="py-0.5">{c.label}</td>
                  <td className="doc-num py-0.5 text-right">{c.phone}</td>
                </tr>
              ))}
              {ctx.leader && (
                <tr>
                  <td className="py-0.5">หัวหน้าทัวร์ {ctx.leader.name}</td>
                  <td className="doc-num py-0.5 text-right">{ctx.leader.phone}</td>
                </tr>
              )}
            </tbody>
          </table>
          <DocumentFooter org={ctx.org} summary={`${days.length} วัน`} />
        </section>
      )}
    </DocumentShell>
  )
}

function addDays(iso, n) {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
