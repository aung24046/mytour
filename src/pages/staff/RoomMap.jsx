import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useActiveTourId, useActiveOrgId } from '../../lib/staffSession'
import { cleanForSave, normalizeList } from '../../lib/hotelFacilities'
import { toTimeInput, toTimeStorage } from '../../lib/timeFormat'
import Card from '../../components/common/Card'
import Icon from '../../components/common/Icon'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import SelectField from '../../components/common/SelectField'
import HotelInfoPanel, { HotelQuickBar } from '../../components/roommap/HotelInfoPanel'
import RoomBoard, { ROOM_TYPES, maxGuestsFor } from '../../components/roommap/RoomBoard'

// หน้าผังห้องพัก — แบ่งเป็น 2 โหมด
//   จัดห้อง       = งานที่ทำซ้ำและแก้หน้างาน (ถาดคนที่ยังไม่มีห้อง + ผังตามชั้น)
//   ข้อมูลโรงแรม  = งานที่ทำครั้งเดียวตอนวางแผน (รายการหัวข้อ แก้ทีละกลุ่ม)
// เดิมสองอย่างนี้อยู่หน้าเดียวกัน ข้อมูลโรงแรมจึงกินพื้นที่จนห้องหลุดไปใต้จอ

const HOTEL_COLUMNS = [
  'id', 'name', 'check_in_date', 'check_out_date', 'general_info',
  'wifi_name', 'wifi_password', 'breakfast_time', 'breakfast_location',
  'checkout_time', 'check_in_time', 'address', 'address_local', 'phone', 'map_url',
  'morning_call', 'luggage_time', 'meeting_point', 'dinner_time', 'dinner_location',
  'booking_ref', 'staff_notes', 'supplier_id', 'sort_order',
  'facilities', 'room_amenities', 'power_plug',
].join(', ')

const NEW_HOTEL_TEMPLATE = { name: '', check_in_date: '', check_out_date: '' }
const NEW_ROOM_BATCH_TEMPLATE = { room_type: 'twin', count: 5 }

const EMPTY_HOTEL_DRAFT = {
  name: '', check_in_date: '', check_out_date: '', check_in_time: '', checkout_time: '',
  address: '', address_local: '', phone: '', map_url: '',
  wifi_name: '', wifi_password: '', power_plug: '',
  facilities: [], room_amenities: [],
  breakfast_time: '', breakfast_location: '', dinner_time: '', dinner_location: '',
  morning_call: '', luggage_time: '', meeting_point: '',
  booking_ref: '', staff_notes: '', supplier_id: '', general_info: '',
}

const NON_TEXT_HOTEL_KEYS = new Set(['check_in_date', 'check_out_date', 'supplier_id'])
const JSON_HOTEL_KEYS = new Set(['facilities', 'room_amenities'])
const TIME_HOTEL_KEYS = new Set([
  'check_in_time', 'checkout_time', 'breakfast_time',
  'dinner_time', 'morning_call', 'luggage_time',
])

function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const a = new Date(checkIn)
  const b = new Date(checkOut)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const n = Math.round((b - a) / 86400000)
  return n > 0 ? n : null
}

// นับแบบ half-open [in, out) — วันเช็คเอาต์ของที่หนึ่งเป็นวันเช็คอินของอีกที่ได้ปกติ
function datesOverlap(aIn, aOut, bIn, bOut) {
  if (!aIn || !aOut || !bIn || !bOut) return false
  return aIn < bOut && bIn < aOut
}

export default function RoomMap() {
  const tourId = useActiveTourId()
  const orgId = useActiveOrgId()
  const { t } = useTranslation()

  const [hotels, setHotels] = useState([])
  const [activeHotelId, setActiveHotelId] = useState(null)
  const [rooms, setRooms] = useState([])
  const [assignments, setAssignments] = useState([])
  const [guests, setGuests] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [tab, setTab] = useState('assign') // 'assign' | 'info'
  const [showNewHotelForm, setShowNewHotelForm] = useState(false)
  const [newHotel, setNewHotel] = useState(NEW_HOTEL_TEMPLATE)
  const [creatingHotel, setCreatingHotel] = useState(false)
  const [createHotelError, setCreateHotelError] = useState(null)

  const [editingItem, setEditingItem] = useState(null)
  const [hotelDraft, setHotelDraft] = useState(EMPTY_HOTEL_DRAFT)
  const [savingInfo, setSavingInfo] = useState(false)
  const [saveInfoError, setSaveInfoError] = useState(null)
  const [reordering, setReordering] = useState(false)

  const [showNewRoomForm, setShowNewRoomForm] = useState(false)
  const [newRoomBatch, setNewRoomBatch] = useState(NEW_ROOM_BATCH_TEMPLATE)
  const [creatingRooms, setCreatingRooms] = useState(false)

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [hotelsRes, roomsRes, assignmentsRes, guestsRes] = await Promise.all([
      supabase
        .from('hotels')
        .select(HOTEL_COLUMNS)
        .eq('tour_id', tourId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('check_in_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true }),
      supabase
        .from('hotel_rooms')
        .select('id, hotel_id, room_number, floor, room_type, max_guests, note')
        .eq('tour_id', tourId)
        // created_at เป็นหลัก + id เป็นตัวตัดสินสำรอง เพราะห้องที่สร้างเป็นชุด (bulk insert)
        // มี created_at เท่ากันเป๊ะ ถ้าไม่มี tiebreaker ลำดับจะไม่นิ่งข้าม query
        // และเลขชั่วคราว TWN-1/TWN-2 จะสลับกันเองระหว่างโหลด
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase.from('room_assignments').select('id, room_id, guest_id').eq('tour_id', tourId),
      supabase.from('guests').select('id, name, nickname, gender').eq('tour_id', tourId).order('name'),
    ])

    if (hotelsRes.error || roomsRes.error || assignmentsRes.error || guestsRes.error) {
      console.error('[RoomMap] load failed', hotelsRes.error, roomsRes.error, assignmentsRes.error, guestsRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setHotels(hotelsRes.data ?? [])
    setRooms(roomsRes.data ?? [])
    setAssignments(assignmentsRes.data ?? [])
    setGuests(guestsRes.data ?? [])
    setActiveHotelId((prev) => prev ?? hotelsRes.data?.[0]?.id ?? null)
    setLoading(false)
  }

  async function loadSuppliers() {
    if (!orgId) return
    const { data, error: supplierError } = await supabase
      .from('suppliers')
      .select('id, name, phone, address, contact_person')
      .eq('org_id', orgId)
      .eq('category', 'hotel')
      .eq('is_active', true)
      .order('name')
    if (supplierError) {
      console.error('[RoomMap] load suppliers failed', supplierError)
      return
    }
    setSuppliers(data ?? [])
  }

  useEffect(() => {
    loadAll()
    loadSuppliers()

    const channel = supabase
      .channel(`roommap-${tourId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_assignments', filter: `tour_id=eq.${tourId}` },
        () => loadAll()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_rooms', filter: `tour_id=eq.${tourId}` },
        (payload) => {
          // patch เฉพาะแถวที่เปลี่ยน ไม่ reload ทั้งหมด — ลำดับห้องจะได้ไม่ขยับระหว่างพิมพ์
          if (payload.eventType === 'DELETE') {
            setRooms((prev) => prev.filter((r) => r.id !== payload.old.id))
          } else if (payload.eventType === 'INSERT') {
            setRooms((prev) => (prev.some((r) => r.id === payload.new.id) ? prev : [...prev, payload.new]))
          } else if (payload.eventType === 'UPDATE') {
            setRooms((prev) => prev.map((r) => (r.id === payload.new.id ? { ...r, ...payload.new } : r)))
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeHotel = hotels.find((h) => h.id === activeHotelId) ?? null
  const hotelRooms = useMemo(
    () => rooms.filter((r) => r.hotel_id === activeHotelId),
    [rooms, activeHotelId]
  )

  const assignmentsByRoom = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      if (!map[a.room_id]) map[a.room_id] = []
      map[a.room_id].push(a)
    }
    return map
  }, [assignments])

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const bedSummary = useMemo(() => {
    const beds = hotelRooms.reduce((sum, r) => sum + (Number(r.max_guests) || 0), 0)
    return { beds, diff: beds - guests.length }
  }, [hotelRooms, guests.length])

  const overlappingHotel = useMemo(() => {
    if (!activeHotel) return null
    return (
      hotels.find(
        (h) =>
          h.id !== activeHotel.id &&
          datesOverlap(activeHotel.check_in_date, activeHotel.check_out_date, h.check_in_date, h.check_out_date)
      ) ?? null
    )
  }, [hotels, activeHotel])

  const draftDateError =
    hotelDraft.check_in_date && hotelDraft.check_out_date && hotelDraft.check_out_date <= hotelDraft.check_in_date
      ? t('staff.roomMap.errDateOrder')
      : null

  const assignedInHotel = useMemo(() => {
    const roomIds = new Set(hotelRooms.map((r) => r.id))
    return new Set(assignments.filter((a) => roomIds.has(a.room_id)).map((a) => a.guest_id)).size
  }, [assignments, hotelRooms])

  async function handleCreateHotel(e) {
    e.preventDefault()
    if (!newHotel.name.trim()) return
    if (newHotel.check_in_date && newHotel.check_out_date && newHotel.check_out_date <= newHotel.check_in_date) {
      setCreateHotelError(t('staff.roomMap.errDateOrder'))
      return
    }

    setCreatingHotel(true)
    setCreateHotelError(null)
    const nextOrder = hotels.reduce((max, h) => Math.max(max, h.sort_order ?? 0), 0) + 1

    const { data: inserted, error: insertError } = await supabase
      .from('hotels')
      .insert({
        tour_id: tourId,
        name: newHotel.name.trim(),
        check_in_date: newHotel.check_in_date || null,
        check_out_date: newHotel.check_out_date || null,
        sort_order: nextOrder,
      })
      .select('id')
      .single()

    if (insertError) {
      console.error('[RoomMap] create hotel failed', insertError)
      setCreateHotelError(insertError.message ?? t('common.error'))
      setCreatingHotel(false)
      return
    }

    setNewHotel(NEW_HOTEL_TEMPLATE)
    setShowNewHotelForm(false)
    setCreatingHotel(false)
    await loadAll()
    if (inserted?.id) setActiveHotelId(inserted.id)
  }

  async function deleteHotel(hotel) {
    if (!window.confirm(t('staff.roomMap.confirmDeleteHotel', { name: hotel.name }))) return
    const { error: deleteError } = await supabase.from('hotels').delete().eq('id', hotel.id)
    if (deleteError) {
      console.error('[RoomMap] delete hotel failed', deleteError)
      return
    }
    setHotels((prev) => prev.filter((h) => h.id !== hotel.id))
    setRooms((prev) => prev.filter((r) => r.hotel_id !== hotel.id))
    setActiveHotelId((prev) => (prev === hotel.id ? null : prev))
  }

  async function moveHotel(hotelId, direction) {
    const index = hotels.findIndex((h) => h.id === hotelId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= hotels.length) return

    const next = [...hotels]
    const swap = next[index]
    next[index] = next[target]
    next[target] = swap
    const renumbered = next.map((h, i) => ({ ...h, sort_order: i + 1 }))
    setHotels(renumbered)

    const results = await Promise.all(
      renumbered.map((h) => supabase.from('hotels').update({ sort_order: h.sort_order }).eq('id', h.id))
    )
    if (results.some((r) => r.error)) {
      console.error('[RoomMap] reorder failed', results.find((r) => r.error)?.error)
      loadAll()
    }
  }

  function startEditItem(itemKey) {
    if (!activeHotel) return
    const draft = { ...EMPTY_HOTEL_DRAFT }
    for (const key of Object.keys(EMPTY_HOTEL_DRAFT)) {
      if (JSON_HOTEL_KEYS.has(key)) draft[key] = normalizeList(activeHotel[key])
      else if (TIME_HOTEL_KEYS.has(key)) draft[key] = toTimeInput(activeHotel[key])
      else draft[key] = activeHotel[key] ?? ''
    }
    setHotelDraft(draft)
    setSaveInfoError(null)
    setEditingItem(itemKey)
  }

  function fillFromSupplier() {
    const supplier = suppliers.find((s) => s.id === hotelDraft.supplier_id)
    if (!supplier) return
    setHotelDraft((prev) => ({
      ...prev,
      address: prev.address || supplier.address || '',
      phone: prev.phone || supplier.phone || '',
    }))
  }

  async function saveInfo() {
    if (!activeHotel) return
    if (!hotelDraft.name.trim()) {
      setSaveInfoError(t('staff.roomMap.errNameRequired'))
      return
    }
    if (draftDateError) {
      setSaveInfoError(draftDateError)
      return
    }

    setSavingInfo(true)
    setSaveInfoError(null)

    const patch = {}
    for (const [key, value] of Object.entries(hotelDraft)) {
      if (JSON_HOTEL_KEYS.has(key)) patch[key] = cleanForSave(value)
      else if (TIME_HOTEL_KEYS.has(key)) patch[key] = toTimeStorage(value)
      else if (NON_TEXT_HOTEL_KEYS.has(key)) patch[key] = value || null
      else patch[key] = typeof value === 'string' ? value.trim() || null : value
    }
    patch.name = hotelDraft.name.trim()

    setHotels((prev) => prev.map((h) => (h.id === activeHotel.id ? { ...h, ...patch } : h)))

    const { error: updateError } = await supabase.from('hotels').update(patch).eq('id', activeHotel.id)
    if (updateError) {
      console.error('[RoomMap] save info failed', updateError)
      setSaveInfoError(updateError.message ?? t('common.error'))
      loadAll()
      setSavingInfo(false)
      return
    }
    setSavingInfo(false)
    setEditingItem(null)
  }

  async function handleCreateRooms(e) {
    e.preventDefault()
    if (!activeHotelId) return

    setCreatingRooms(true)
    const count = Number(newRoomBatch.count) || 1
    const maxGuests = maxGuestsFor(newRoomBatch.room_type)
    const roomRows = Array.from({ length: count }, () => ({
      tour_id: tourId,
      hotel_id: activeHotelId,
      room_type: newRoomBatch.room_type,
      max_guests: maxGuests,
      room_number: '',
      floor: '',
    }))

    const { error: insertError } = await supabase.from('hotel_rooms').insert(roomRows)
    if (insertError) console.error('[RoomMap] create rooms failed', insertError)

    setNewRoomBatch(NEW_ROOM_BATCH_TEMPLATE)
    setShowNewRoomForm(false)
    setCreatingRooms(false)
    loadAll()
  }

  async function updateRoomField(roomId, patch) {
    setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, ...patch } : r)))
    const { error: updateError } = await supabase.from('hotel_rooms').update(patch).eq('id', roomId)
    if (updateError) {
      console.error('[RoomMap] update room failed', updateError)
      loadAll()
    }
  }

  async function deleteRoom(room) {
    if (!window.confirm(t('staff.roomMap.confirmDeleteRoom'))) return
    const { error: deleteError } = await supabase.from('hotel_rooms').delete().eq('id', room.id)
    if (deleteError) {
      console.error('[RoomMap] delete room failed', deleteError)
      return
    }
    setRooms((prev) => prev.filter((r) => r.id !== room.id))
  }

  // วางหลายคนในห้องเดียวด้วย insert ชุดเดียว — เร็วกว่ายิงทีละคนและไม่ทิ้งสถานะครึ่งๆ กลางๆ
  async function assignMany(roomId, guestIds) {
    if (guestIds.length === 0) return
    const rows = guestIds.map((guestId) => ({ tour_id: tourId, room_id: roomId, guest_id: guestId }))
    const { data, error: insertError } = await supabase.from('room_assignments').insert(rows).select('id, room_id, guest_id')
    if (insertError) {
      console.error('[RoomMap] assign failed', insertError)
      loadAll()
      return
    }
    setAssignments((prev) => [...prev, ...(data ?? [])])
  }

  async function removeAssignment(assignmentId) {
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId))
    const { error: deleteError } = await supabase.from('room_assignments').delete().eq('id', assignmentId)
    if (deleteError) {
      console.error('[RoomMap] remove guest failed', deleteError)
      loadAll()
    }
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        <div className="hero-gradient mb-3 flex items-center justify-between rounded-card p-5 shadow-brand">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">MyTour</p>
            <h1 className="text-2xl font-extrabold text-white">{t('staff.roomMap.title')}</h1>
          </div>
          {activeHotel && (
            <div className="text-right">
              <p className="text-2xl font-extrabold leading-none text-white">
                {assignedInHotel}
                <span className="text-sm font-semibold text-white/60">/{guests.length}</span>
              </p>
              <p className="mt-1 text-[11px] text-white/75">{t('staff.roomMap.assignedLabel')}</p>
            </div>
          )}
        </div>

        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="text-danger">{error}</p>}

        {!loading && !error && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {hotels.map((hotel) => (
                <button
                  key={hotel.id}
                  onClick={() => {
                    setActiveHotelId(hotel.id)
                    setEditingItem(null)
                  }}
                  className={`shrink-0 rounded-pill px-4 py-2 text-sm font-semibold transition ${
                    activeHotelId === hotel.id
                      ? 'bg-brand text-white shadow-brand'
                      : 'bg-surface text-ink-muted ring-1 ring-line-subtle'
                  }`}
                >
                  {hotel.name}
                </button>
              ))}
              <button
                onClick={() => setShowNewHotelForm((v) => !v)}
                className="shrink-0 rounded-pill border border-dashed border-brand/40 px-3 py-2 text-sm font-semibold text-brand"
              >
                + {t('staff.roomMap.addHotel')}
              </button>
            </div>

            {showNewHotelForm && (
              <Card className="mt-3">
                <form onSubmit={handleCreateHotel} className="flex flex-col gap-3">
                  <TextField
                    label={t('staff.roomMap.hotelName')}
                    required
                    value={newHotel.name}
                    onChange={(e) => setNewHotel((p) => ({ ...p, name: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <TextField
                      label={t('staff.roomMap.checkInDate')}
                      type="date"
                      value={newHotel.check_in_date}
                      onChange={(e) => setNewHotel((p) => ({ ...p, check_in_date: e.target.value }))}
                      className="flex-1"
                    />
                    <TextField
                      label={t('staff.roomMap.checkOutDate')}
                      type="date"
                      value={newHotel.check_out_date}
                      onChange={(e) => setNewHotel((p) => ({ ...p, check_out_date: e.target.value }))}
                      className="flex-1"
                    />
                  </div>
                  {createHotelError && <p className="text-sm text-danger">{createHotelError}</p>}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creatingHotel || !newHotel.name.trim()}>
                      {creatingHotel ? t('guest.register.submitting') : t('common.save')}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setShowNewHotelForm(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {hotels.length === 0 && <p className="mt-4 text-ink-muted">{t('staff.roomMap.noHotel')}</p>}

            {activeHotel && (
              <>
                {/* แถบโรงแรม: ชื่อ + วัน + เวลาสำคัญ ย่อให้เหลือบรรทัดเดียว */}
                <div className="mt-3 rounded-card bg-surface p-3 ring-1 ring-line-subtle">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                      {activeHotel.name}
                    </span>
                    {nightsBetween(activeHotel.check_in_date, activeHotel.check_out_date) && (
                      <span className="shrink-0 rounded-pill bg-brand-lighter px-2 py-0.5 text-[11px] font-semibold text-brand">
                        {t('staff.roomMap.nights', {
                          count: nightsBetween(activeHotel.check_in_date, activeHotel.check_out_date),
                        })}
                      </span>
                    )}
                    {activeHotel.booking_ref && (
                      <span className="shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                        #{activeHotel.booking_ref}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
                    <span>{activeHotel.check_in_date || '—'}</span>
                    <span className="text-ink-faint">→</span>
                    <span>{activeHotel.check_out_date || '—'}</span>
                  </div>
                  <div className="mt-1.5">
                    <HotelQuickBar hotel={activeHotel} />
                  </div>
                </div>

                {(!activeHotel.check_in_date || !activeHotel.check_out_date) && (
                  <p className="mt-2 flex items-center gap-1.5 rounded-control bg-warning-bg px-2.5 py-1.5 text-xs text-warning-text">
                    <Icon name="alert" size={14} />
                    {t('staff.roomMap.warnNoDates')}
                  </p>
                )}
                {overlappingHotel && (
                  <p className="mt-2 flex items-center gap-1.5 rounded-control bg-warning-bg px-2.5 py-1.5 text-xs text-warning-text">
                    <Icon name="alert" size={14} />
                    {t('staff.roomMap.warnOverlap', { name: overlappingHotel.name })}
                  </p>
                )}

                <div className="mt-3 flex gap-1 rounded-control bg-surface-sunken p-1">
                  {[
                    { key: 'assign', label: t('staff.roomMap.tabAssign') },
                    { key: 'info', label: t('staff.roomMap.tabHotelInfo') },
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setTab(item.key)}
                      className={`flex-1 rounded-[0.7rem] py-1.5 text-xs font-semibold transition ${
                        tab === item.key ? 'bg-surface text-ink shadow-card' : 'text-ink-muted'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                {tab === 'assign' && (
                  <>
                    {hotelRooms.length > 0 && (
                      <div
                        className={`mt-3 flex items-center justify-between rounded-control px-3 py-2 text-xs font-semibold ${
                          bedSummary.diff < 0
                            ? 'bg-danger-bg text-danger-text'
                            : bedSummary.diff > 0
                              ? 'bg-warning-bg text-warning-text'
                              : 'bg-success-bg text-success-text'
                        }`}
                      >
                        <span>
                          {t('staff.roomMap.bedsLabel')} {bedSummary.beds} / {guests.length}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          {bedSummary.diff < 0 && <Icon name="alert" size={13} />}
                          {bedSummary.diff === 0 && <Icon name="checkCircle" size={13} />}
                          {bedSummary.diff < 0
                            ? t('staff.roomMap.bedsShort', { count: -bedSummary.diff })
                            : bedSummary.diff > 0
                              ? t('staff.roomMap.bedsExtra', { count: bedSummary.diff })
                              : t('staff.roomMap.bedsOk')}
                        </span>
                      </div>
                    )}

                    {showNewRoomForm && (
                      <Card className="mt-3">
                        <form onSubmit={handleCreateRooms} className="flex flex-col gap-3">
                          <SelectField
                            label={t('staff.roomMap.roomType')}
                            options={ROOM_TYPES}
                            value={newRoomBatch.room_type}
                            onChange={(e) => setNewRoomBatch((p) => ({ ...p, room_type: e.target.value }))}
                          />
                          <TextField
                            label={t('staff.roomMap.roomCount')}
                            type="number"
                            min={1}
                            value={newRoomBatch.count}
                            onChange={(e) => setNewRoomBatch((p) => ({ ...p, count: e.target.value }))}
                          />
                          <div className="flex gap-2">
                            <Button type="submit" disabled={creatingRooms}>
                              {creatingRooms ? t('guest.register.submitting') : t('common.save')}
                            </Button>
                            <Button type="button" variant="secondary" onClick={() => setShowNewRoomForm(false)}>
                              {t('common.cancel')}
                            </Button>
                          </div>
                        </form>
                      </Card>
                    )}

                    <RoomBoard
                      rooms={hotelRooms}
                      guests={guests}
                      assignmentsByRoom={assignmentsByRoom}
                      guestById={guestById}
                      onAssignMany={assignMany}
                      onRemoveAssignment={removeAssignment}
                      onUpdateRoom={updateRoomField}
                      onDeleteRoom={deleteRoom}
                      onAddRooms={() => setShowNewRoomForm(true)}
                    />
                  </>
                )}

                {tab === 'info' && (
                  <>
                    <HotelInfoPanel
                      hotel={activeHotel}
                      draft={hotelDraft}
                      setDraft={setHotelDraft}
                      onStartEdit={startEditItem}
                      onSave={saveInfo}
                      onCancel={() => setEditingItem(null)}
                      editingItem={editingItem}
                      saving={savingInfo}
                      saveError={saveInfoError}
                      dateError={draftDateError}
                      suppliers={suppliers}
                      onFillFromSupplier={fillFromSupplier}
                    />

                    {!editingItem && (
                      <div className="mt-3 flex items-center gap-3">
                        {hotels.length > 1 && (
                          <button
                            onClick={() => setReordering((v) => !v)}
                            className="text-xs font-semibold text-brand"
                          >
                            {reordering ? t('staff.roomMap.reorderDone') : `↕ ${t('staff.roomMap.reorder')}`}
                          </button>
                        )}
                        <span className="flex-1" />
                        <button
                          onClick={() => deleteHotel(activeHotel)}
                          className="text-xs font-semibold text-danger"
                        >
                          {t('staff.roomMap.deleteHotel')}
                        </button>
                      </div>
                    )}

                    {reordering && (
                      <Card className="mt-2 p-2">
                        <div className="flex flex-col gap-1">
                          {hotels.map((hotel, i) => (
                            <div key={hotel.id} className="flex items-center gap-2 rounded-control px-2 py-1.5">
                              <span className="w-5 text-center text-xs font-bold text-ink-faint">{i + 1}</span>
                              <span className="min-w-0 flex-1 truncate text-sm text-ink">{hotel.name}</span>
                              <button
                                onClick={() => moveHotel(hotel.id, -1)}
                                disabled={i === 0}
                                title={t('staff.roomMap.moveUp')}
                                className="rounded-control px-2 py-1 text-sm font-bold text-brand disabled:text-ink-faint/40"
                              >
                                ↑
                              </button>
                              <button
                                onClick={() => moveHotel(hotel.id, 1)}
                                disabled={i === hotels.length - 1}
                                title={t('staff.roomMap.moveDown')}
                                className="rounded-control px-2 py-1 text-sm font-bold text-brand disabled:text-ink-faint/40"
                              >
                                ↓
                              </button>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
