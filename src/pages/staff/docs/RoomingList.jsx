import { useEffect, useMemo, useState } from 'react'

import { supabase } from '../../../lib/supabase'
import { useActiveTourId, getStaffSession } from '../../../lib/staffSession'
import { can } from '../../../lib/permissions'
import {
  AVAILABLE_COLUMNS,
  DOC_TITLES,
  DOC_TYPES,
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
import DocumentShell, { defaultPrint } from '../../../components/document/DocumentShell'
import DocumentFooter from '../../../components/document/DocumentFooter'
import ColumnPicker from '../../../components/document/ColumnPicker'

// ใบจัดห้องพัก (DataSpec §1) — ส่งโรงแรมล่วงหน้า
// จัดกลุ่มตามโรงแรม แล้วเรียงตามเลขห้อง โรงแรมใหม่ขึ้นหน้าใหม่เสมอ
export default function RoomingList() {
  const tourId = useActiveTourId()
  const ctx = useDocumentContext(DOC_TYPES.ROOMING_LIST)
  const session = getStaffSession()

  const [hotels, setHotels] = useState([])
  const [rooms, setRooms] = useState([])
  const [assignments, setAssignments] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [columns, setColumns] = useState([])
  const [presets, setPresets] = useState([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [hotelsRes, roomsRes, assignRes, guestsRes] = await Promise.all([
        supabase
          .from('hotels')
          .select('id, name, check_in_date, check_out_date, checkout_time')
          .eq('tour_id', tourId)
          .order('check_in_date', { ascending: true }),
        supabase
          .from('hotel_rooms')
          .select('id, hotel_id, room_number, floor, room_type, max_guests'),
        supabase.from('room_assignments').select('id, room_id, guest_id'),
        supabase
          .from('guests')
          .select(
            'id, name, nickname, gender, phone, title, name_en, birthdate, national_id, passport_no, passport_expiry, nationality, note'
          )
          .eq('tour_id', tourId),
      ])

      if (cancelled) return

      if (hotelsRes.error || roomsRes.error || assignRes.error || guestsRes.error) {
        console.error('[RoomingList] load failed', hotelsRes.error, roomsRes.error, assignRes.error, guestsRes.error)
        setError('โหลดข้อมูลไม่สำเร็จ')
        setLoading(false)
        return
      }

      setHotels(hotelsRes.data ?? [])
      setRooms(roomsRes.data ?? [])
      setAssignments(assignRes.data ?? [])
      setGuests(guestsRes.data ?? [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [tourId])

  // ตั้งคอลัมน์จาก preset ตั้งต้นครั้งแรกที่ preset โหลดเสร็จ
  useEffect(() => {
    if (ctx.presets.length === 0 || columns.length > 0) return
    setPresets(ctx.presets)
    const def = ctx.presets.find((p) => p.is_default) ?? ctx.presets[0]
    setColumns(hydrateColumns(def.columns ?? []))
  }, [ctx.presets, columns.length])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const roomById = useMemo(() => {
    const map = {}
    for (const r of rooms) map[r.id] = r
    return map
  }, [rooms])

  // แปลงเป็นแถวพร้อมพิมพ์: 1 แถว = ผู้พัก 1 คน แต่เลขห้องแสดงเฉพาะคนแรกของห้อง
  const rowsByHotel = useMemo(() => {
    const byHotel = {}

    for (const hotel of hotels) {
      const hotelRooms = rooms
        .filter((r) => r.hotel_id === hotel.id)
        .sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), 'th', { numeric: true }))

      const out = []
      for (const room of hotelRooms) {
        const occupants = assignments
          .filter((a) => a.room_id === room.id)
          .map((a) => guestById[a.guest_id])
          .filter(Boolean)

        if (occupants.length === 0) {
          out.push({
            _id: `${room.id}-empty`,
            room_number: room.room_number,
            floor: room.floor,
            room_type: `${room.room_type ?? ''}${room.max_guests ? ` · ${room.max_guests} ท่าน` : ''}`,
            name: '(ว่าง)',
          })
          continue
        }

        occupants.forEach((g, i) => {
          out.push({
            _id: `${room.id}-${g.id}`,
            // เลขห้อง/ชั้น/ประเภทแสดงครั้งเดียวต่อห้อง — อ่านง่ายกว่าซ้ำทุกบรรทัด
            room_number: i === 0 ? room.room_number : '',
            floor: i === 0 ? room.floor : '',
            room_type:
              i === 0
                ? `${room.room_type ?? ''}${room.max_guests ? ` · ${room.max_guests} ท่าน` : ''}`
                : '',
            name: g.name,
            nickname: g.nickname,
            name_en: g.name_en,
            gender: formatGender(g.gender),
            birthdate: formatThaiDate(g.birthdate),
            national_id: formatNationalId(g.national_id),
            passport_no: g.passport_no,
            passport_expiry: formatThaiDate(g.passport_expiry),
            nationality: g.nationality,
            phone: g.phone,
            note: g.note,
          })
        })
      }
      byHotel[hotel.id] = out
    }
    return byHotel
  }, [hotels, rooms, assignments, guestById])

  const allRows = useMemo(() => Object.values(rowsByHotel).flat(), [rowsByHotel])

  const availableKeys = useMemo(
    () => AVAILABLE_COLUMNS.rooming_list.map((c) => c.key),
    []
  )
  const fillCounts = useColumnFillCounts(allRows, availableKeys)
  const fillCountsWithTotal = useMemo(
    () => ({ ...fillCounts, __total: allRows.length }),
    [fillCounts, allRows.length]
  )

  const orientation = useMemo(() => decideOrientation(columns), [columns])
  const meta = DOC_TITLES.rooming_list

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
      printDisabled={allRows.length === 0}
      toolbar={
        <ColumnPicker
          docType={DOC_TYPES.ROOMING_LIST}
          available={AVAILABLE_COLUMNS.rooming_list}
          selected={columns}
          onChange={setColumns}
          presets={presets}
          onPresetsChange={setPresets}
          fillCounts={fillCountsWithTotal}
          canSavePreset={can(session, 'document.preset')}
        />
      }
    >
      {hotels.length === 0 && (
        <p className="py-8 text-center text-ink-muted">ทริปนี้ยังไม่ได้เพิ่มโรงแรม</p>
      )}

      {hotels.map((hotel, i) => (
        <section key={hotel.id} className={i > 0 ? 'doc-page-break pt-6' : ''}>
          <DocumentHeader
            org={ctx.org}
            tour={ctx.tour}
            leader={ctx.leader}
            title={meta.title}
            subtitle={meta.subtitle}
            pageLabel={`${i + 1}/${hotels.length}`}
          />

          <div className="my-2 bg-gray-100 px-2 py-1 text-[10pt] font-medium">
            {hotel.name}
            <span className="ml-2 font-normal text-gray-600">
              เช็คอิน {formatThaiDate(hotel.check_in_date)} · เช็คเอาต์{' '}
              {formatThaiDate(hotel.check_out_date)}
              {hotel.checkout_time && ` ${hotel.checkout_time}`}
            </span>
          </div>

          <DocumentTable
            columns={columns}
            rows={rowsByHotel[hotel.id] ?? []}
            emptyText="โรงแรมนี้ยังไม่ได้จัดห้อง"
          />

          <DocumentFooter
            org={ctx.org}
            summary={`${(rowsByHotel[hotel.id] ?? []).filter((r) => r.name !== '(ว่าง)').length} ท่าน`}
          />
        </section>
      ))}
    </DocumentShell>
  )
}
