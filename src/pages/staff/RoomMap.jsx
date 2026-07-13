import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { genderTextClass } from '../../lib/genderColor'
import BottomSheet from '../../components/common/BottomSheet'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import SelectField from '../../components/common/SelectField'

// จุดสีตามเพศ (พื้นทึบ) สำหรับชิปผู้เข้าพัก
function genderDotClass(gender) {
  if (gender === 'ชาย') return 'bg-blue-500'
  if (gender === 'หญิง') return 'bg-pink-500'
  return 'bg-ink-faint'
}

// นับจำนวนคืนจากวันเข้าพัก–ออก (คืนค่า null ถ้าข้อมูลไม่ครบ/ไม่ถูกต้อง)
function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const a = new Date(checkIn)
  const b = new Date(checkOut)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const n = Math.round((b - a) / 86400000)
  return n > 0 ? n : null
}

const ROOM_TYPES = [
  { value: 'single', label: 'Single Room', maxGuests: 1 },
  { value: 'twin', label: 'Twin Room', maxGuests: 2 },
  { value: 'double', label: 'Double Room', maxGuests: 2 },
  { value: 'triple', label: 'Triple Room', maxGuests: 3 },
]

function maxGuestsFor(roomType) {
  return ROOM_TYPES.find((rt) => rt.value === roomType)?.maxGuests ?? 2
}

const NEW_HOTEL_TEMPLATE = { name: '', check_in_date: '', check_out_date: '', general_info: '' }
const NEW_ROOM_BATCH_TEMPLATE = { room_type: 'twin', count: 5 }

export default function RoomMap() {
  const { t } = useTranslation()

  const [hotels, setHotels] = useState([])
  const [activeHotelId, setActiveHotelId] = useState(null)
  const [rooms, setRooms] = useState([])
  const [assignments, setAssignments] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [showNewHotelForm, setShowNewHotelForm] = useState(false)
  const [newHotel, setNewHotel] = useState(NEW_HOTEL_TEMPLATE)
  const [creatingHotel, setCreatingHotel] = useState(false)
  const [createHotelError, setCreateHotelError] = useState(null)

  const [editingInfoHotelId, setEditingInfoHotelId] = useState(null)
  const [hotelDraft, setHotelDraft] = useState({
    name: '',
    check_in_date: '',
    check_out_date: '',
    wifi_name: '',
    wifi_password: '',
    breakfast_time: '',
    breakfast_location: '',
    checkout_time: '',
    general_info: '',
  })
  const [savingInfo, setSavingInfo] = useState(false)
  const [saveInfoError, setSaveInfoError] = useState(null)

  const [showNewRoomForm, setShowNewRoomForm] = useState(false)
  const [newRoomBatch, setNewRoomBatch] = useState(NEW_ROOM_BATCH_TEMPLATE)
  const [creatingRooms, setCreatingRooms] = useState(false)
  const [createRoomError, setCreateRoomError] = useState(null)

  const [selectedRoom, setSelectedRoom] = useState(null)
  const [assignSlot, setAssignSlot] = useState(null) // index of occupant slot being filled
  const [search, setSearch] = useState('')
  const [assigning, setAssigning] = useState(false)

  const [roomTypeFilter, setRoomTypeFilter] = useState('all')
  const [floorFilter, setFloorFilter] = useState('all')
  const [roomSearch, setRoomSearch] = useState('')
  const [occupancyFilter, setOccupancyFilter] = useState('all') // 'all' | 'vacant' | 'full'

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [hotelsRes, roomsRes, assignmentsRes, guestsRes] = await Promise.all([
      supabase
        .from('hotels')
        .select('id, name, check_in_date, check_out_date, general_info, wifi_name, wifi_password, breakfast_time, breakfast_location, checkout_time')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('check_in_date', { ascending: true }),
      supabase
        .from('hotel_rooms')
        .select('id, hotel_id, room_number, floor, room_type, max_guests')
        .eq('tour_id', ACTIVE_TOUR_ID)
        // เรียงตาม created_at เป็นหลัก + id เป็นตัวตัดสินสำรอง เพราะห้องที่สร้างพร้อมกันเป็นชุด (bulk insert)
        // จะมี created_at เท่ากันเป๊ะ ถ้าไม่มี tiebreaker ลำดับอาจไม่นิ่งข้าม query
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase
        .from('room_assignments')
        .select('id, room_id, guest_id')
        .eq('tour_id', ACTIVE_TOUR_ID),
      supabase.from('guests').select('id, name, nickname, gender').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
    ])

    if (hotelsRes.error || roomsRes.error || assignmentsRes.error || guestsRes.error) {
      console.error(
        '[RoomMap] load failed',
        hotelsRes.error,
        roomsRes.error,
        assignmentsRes.error,
        guestsRes.error
      )
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

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel(`roommap-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_assignments', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadAll()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_rooms', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        (payload) => {
          // แก้บั๊ก "ห้องเด้งลงล่างตอนกำลังพิมพ์" — เดิม full reload ทุกครั้งที่มีการแก้ไข
          // ทำให้ลำดับห้องสลับใหม่ทุกครั้ง (Postgres ไม่การันตีลำดับถ้าไม่มี ORDER BY ที่ query ตรง)
          // เปลี่ยนมา patch state เฉพาะแถวที่เปลี่ยน แทนการโหลดใหม่ทั้งหมด — ลำดับเดิมจึงไม่ขยับ
          if (payload.eventType === 'DELETE') {
            setRooms((prev) => prev.filter((r) => r.id !== payload.old.id))
          } else if (payload.eventType === 'INSERT') {
            setRooms((prev) =>
              prev.some((r) => r.id === payload.new.id) ? prev : [...prev, payload.new]
            )
          } else if (payload.eventType === 'UPDATE') {
            setRooms((prev) =>
              prev.map((r) => (r.id === payload.new.id ? { ...r, ...payload.new } : r))
            )
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeHotel = hotels.find((h) => h.id === activeHotelId)
  const hotelRooms = useMemo(
    () => rooms.filter((r) => r.hotel_id === activeHotelId),
    [rooms, activeHotelId]
  )

  const floorOptions = useMemo(() => {
    const floors = new Set(hotelRooms.map((r) => r.floor).filter((f) => f && f.trim()))
    return Array.from(floors).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [hotelRooms])

  const assignmentsByRoom = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      if (!map[a.room_id]) map[a.room_id] = []
      map[a.room_id].push(a)
    }
    return map
  }, [assignments])

  // แก้บั๊ก "ผูกคนในโรงแรม 1 แล้วหาชื่อในโรงแรม 2 ไม่เจอ" — เดิมเช็คว่าลูกทัวร์ถูกผูกห้องไปแล้วหรือยัง
  // แบบรวมทั้งทริป (ทุกโรงแรม) ทั้งที่ schema อนุญาตให้คนเดียวกันอยู่ได้หลายห้อง/หลายโรงแรม
  // (unique constraint คือ room_id+guest_id ไม่ใช่ guest_id เดี่ยวๆ) เพราะทัวร์ย้ายโรงแรมคนละคืนได้ปกติ
  // แก้เป็นเช็คเฉพาะห้องของโรงแรมที่กำลังเปิดอยู่เท่านั้น
  const activeHotelRoomIds = useMemo(() => new Set(hotelRooms.map((r) => r.id)), [hotelRooms])
  const assignedGuestIdsInActiveHotel = useMemo(
    () =>
      new Set(
        assignments.filter((a) => activeHotelRoomIds.has(a.room_id)).map((a) => a.guest_id)
      ),
    [assignments, activeHotelRoomIds]
  )

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const visibleRooms = useMemo(() => {
    const q = roomSearch.trim().toLowerCase()
    return hotelRooms.filter((r) => {
      if (roomTypeFilter !== 'all' && r.room_type !== roomTypeFilter) return false
      if (floorFilter !== 'all' && (r.floor || '') !== floorFilter) return false

      const occ = (assignmentsByRoom[r.id] ?? []).length
      if (occupancyFilter === 'vacant' && occ >= r.max_guests) return false
      if (occupancyFilter === 'full' && occ < r.max_guests) return false

      if (!q) return true

      const occupantNames = (assignmentsByRoom[r.id] ?? [])
        .map((a) => {
          const g = guestById[a.guest_id]
          return g ? `${g.name} ${g.nickname ?? ''}` : ''
        })
        .join(' ')
        .toLowerCase()

      return (
        (r.room_number ?? '').toLowerCase().includes(q) ||
        (r.floor ?? '').toLowerCase().includes(q) ||
        occupantNames.includes(q)
      )
    })
  }, [hotelRooms, roomTypeFilter, floorFilter, occupancyFilter, roomSearch, assignmentsByRoom, guestById])

  // สรุปจำนวนห้องว่าง/เต็ม ของโรงแรมที่เปิดอยู่ (ใช้กับตัวกรอง + header)
  const { vacantCount, fullCount } = useMemo(() => {
    let vacant = 0
    for (const r of hotelRooms) {
      const occ = (assignmentsByRoom[r.id] ?? []).length
      if (occ < r.max_guests) vacant += 1
    }
    return { vacantCount: vacant, fullCount: hotelRooms.length - vacant }
  }, [hotelRooms, assignmentsByRoom])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const currentOccupantIds = selectedRoom
      ? (assignmentsByRoom[selectedRoom.id] ?? []).map((a) => a.guest_id)
      : []
    return guests
      .filter((g) => !assignedGuestIdsInActiveHotel.has(g.id) || currentOccupantIds.includes(g.id))
      .filter((g) => g.name?.toLowerCase().includes(q) || g.nickname?.toLowerCase().includes(q))
      .slice(0, 20)
  }, [guests, search, assignedGuestIdsInActiveHotel, selectedRoom, assignmentsByRoom])

  async function handleCreateHotel(e) {
    e.preventDefault()
    if (!newHotel.name.trim()) return

    setCreatingHotel(true)
    setCreateHotelError(null)

    const { data: insertedHotel, error: insertError } = await supabase
      .from('hotels')
      .insert({
        tour_id: ACTIVE_TOUR_ID,
        name: newHotel.name.trim(),
        check_in_date: newHotel.check_in_date || null,
        check_out_date: newHotel.check_out_date || null,
        general_info: newHotel.general_info.trim() || null,
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
    // แก้บั๊ก "กดเพิ่มโรงแรมแล้วเด้งกลับไปโรงแรมแรก" — เดิม loadAll() ไม่เปลี่ยน activeHotelId
    // เลยค้างอยู่ที่โรงแรมเดิมที่เคยเลือกไว้ (ซึ่งถ้าเป็นครั้งแรกจะดูเหมือน "เด้งกลับไปโรงแรมแรก")
    // ตอนนี้สลับไปที่โรงแรมที่เพิ่งสร้างให้เลยทันที
    if (insertedHotel?.id) setActiveHotelId(insertedHotel.id)
  }

  async function deleteHotel(hotel) {
    const confirmed = window.confirm(t('staff.roomMap.confirmDeleteHotel', { name: hotel.name }))
    if (!confirmed) return

    const { error: deleteError } = await supabase.from('hotels').delete().eq('id', hotel.id)
    if (deleteError) {
      console.error('[RoomMap] delete hotel failed', deleteError)
      return
    }
    setHotels((prev) => prev.filter((h) => h.id !== hotel.id))
    setRooms((prev) => prev.filter((r) => r.hotel_id !== hotel.id))
    setActiveHotelId((prev) => (prev === hotel.id ? null : prev))
  }

  function startEditInfo(hotel) {
    // แก้บั๊ก "แก้ไขวันที่ไม่ได้หลังสร้างโรงแรมแล้ว" — เดิมแก้ได้แค่ general_info
    // ตอนนี้ดึงชื่อ/วันที่เข้ามาด้วย ให้แก้ไขได้ทั้งหมดในฟอร์มเดียว
    setEditingInfoHotelId(hotel.id)
    setHotelDraft({
      name: hotel.name ?? '',
      check_in_date: hotel.check_in_date ?? '',
      check_out_date: hotel.check_out_date ?? '',
      wifi_name: hotel.wifi_name ?? '',
      wifi_password: hotel.wifi_password ?? '',
      breakfast_time: hotel.breakfast_time ?? '',
      breakfast_location: hotel.breakfast_location ?? '',
      checkout_time: hotel.checkout_time ?? '',
      general_info: hotel.general_info ?? '',
    })
    setSaveInfoError(null)
  }

  async function saveInfo(hotelId) {
    if (!hotelDraft.name.trim()) return

    setSavingInfo(true)
    setSaveInfoError(null)

    const patch = {
      name: hotelDraft.name.trim(),
      check_in_date: hotelDraft.check_in_date || null,
      check_out_date: hotelDraft.check_out_date || null,
      wifi_name: hotelDraft.wifi_name.trim() || null,
      wifi_password: hotelDraft.wifi_password.trim() || null,
      breakfast_time: hotelDraft.breakfast_time.trim() || null,
      breakfast_location: hotelDraft.breakfast_location.trim() || null,
      checkout_time: hotelDraft.checkout_time.trim() || null,
      general_info: hotelDraft.general_info.trim() || null,
    }
    setHotels((prev) => prev.map((h) => (h.id === hotelId ? { ...h, ...patch } : h)))

    const { error: updateError } = await supabase.from('hotels').update(patch).eq('id', hotelId)
    if (updateError) {
      console.error('[RoomMap] save info failed', updateError)
      setSaveInfoError(updateError.message ?? t('common.error'))
      loadAll()
      setSavingInfo(false)
      return
    }
    setSavingInfo(false)
    setEditingInfoHotelId(null)
  }

  async function handleCreateRooms(e) {
    e.preventDefault()
    if (!activeHotelId) return

    setCreatingRooms(true)
    setCreateRoomError(null)

    const count = Number(newRoomBatch.count) || 1
    const maxGuests = maxGuestsFor(newRoomBatch.room_type)

    const roomRows = Array.from({ length: count }, () => ({
      tour_id: ACTIVE_TOUR_ID,
      hotel_id: activeHotelId,
      room_type: newRoomBatch.room_type,
      max_guests: maxGuests,
      room_number: '',
      floor: '',
    }))

    const { error: insertError } = await supabase.from('hotel_rooms').insert(roomRows)
    if (insertError) {
      console.error('[RoomMap] create rooms failed', insertError)
      setCreateRoomError(insertError.message ?? t('common.error'))
      setCreatingRooms(false)
      return
    }

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
    const confirmed = window.confirm(t('staff.roomMap.confirmDeleteRoom'))
    if (!confirmed) return

    const { error: deleteError } = await supabase.from('hotel_rooms').delete().eq('id', room.id)
    if (deleteError) {
      console.error('[RoomMap] delete room failed', deleteError)
      return
    }
    setRooms((prev) => prev.filter((r) => r.id !== room.id))
  }

  function openAssignSlot(room, slotIndex) {
    setSelectedRoom(room)
    setAssignSlot(slotIndex)
    setSearch('')
  }

  function closeAssignSheet() {
    setSelectedRoom(null)
    setAssignSlot(null)
    setSearch('')
  }

  async function assignGuestToSlot(guestId) {
    if (!selectedRoom) return
    setAssigning(true)

    const { error: insertError } = await supabase.from('room_assignments').insert({
      tour_id: ACTIVE_TOUR_ID,
      room_id: selectedRoom.id,
      guest_id: guestId,
    })

    if (insertError) {
      console.error('[RoomMap] assign failed', insertError)
    } else {
      loadAll()
    }
    setAssigning(false)
    closeAssignSheet()
  }

  async function removeGuestFromRoom(assignmentId) {
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId))
    const { error: deleteError } = await supabase
      .from('room_assignments')
      .delete()
      .eq('id', assignmentId)
    if (deleteError) {
      console.error('[RoomMap] remove guest failed', deleteError)
      loadAll()
    }
  }

  const assignedInHotel = assignedGuestIdsInActiveHotel.size

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        <div className="hero-gradient mb-4 flex items-center justify-between rounded-card p-5 shadow-brand">
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
            {/* Step 1: hotels */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {hotels.map((hotel) => (
                <button
                  key={hotel.id}
                  onClick={() => setActiveHotelId(hotel.id)}
                  className={`shrink-0 rounded-pill px-4 py-2 text-sm font-semibold transition ${
                    activeHotelId === hotel.id
                      ? 'bg-brand text-white shadow-brand'
                      : 'bg-surface text-ink-muted ring-1 ring-black/[0.04]'
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
                    onChange={(e) => setNewHotel((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <TextField
                      label={t('staff.roomMap.checkInDate')}
                      type="date"
                      value={newHotel.check_in_date}
                      onChange={(e) =>
                        setNewHotel((prev) => ({ ...prev, check_in_date: e.target.value }))
                      }
                      className="flex-1"
                    />
                    <TextField
                      label={t('staff.roomMap.checkOutDate')}
                      type="date"
                      value={newHotel.check_out_date}
                      onChange={(e) =>
                        setNewHotel((prev) => ({ ...prev, check_out_date: e.target.value }))
                      }
                      className="flex-1"
                    />
                  </div>
                  {createHotelError && <p className="text-sm text-red-500">{createHotelError}</p>}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creatingHotel || !newHotel.name.trim()}>
                      {creatingHotel ? t('guest.register.submitting') : t('common.save')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setShowNewHotelForm(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {!activeHotel && hotels.length === 0 && (
              <p className="mt-4 text-ink-muted">{t('staff.roomMap.noHotel')}</p>
            )}

            {activeHotel && (
              <>
                {/* Hotel general info — visible to all guests */}
                <Card className="mt-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-ink">{activeHotel.name}</h2>
                    {editingInfoHotelId !== activeHotel.id && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => startEditInfo(activeHotel)}
                          className="flex items-center gap-1 rounded-control bg-brand-lighter px-3 py-1.5 text-sm font-semibold text-brand"
                        >
                          <Icon name="form" size={14} />
                          {t('staff.itineraryBuilder.edit')}
                        </button>
                        <button
                          onClick={() => deleteHotel(activeHotel)}
                          className="rounded-control px-2.5 py-1.5 text-sm font-semibold text-danger"
                          title={t('staff.roomMap.deleteHotel')}
                        >
                          {t('staff.formBuilder.delete')}
                        </button>
                      </div>
                    )}
                  </div>

                  {editingInfoHotelId === activeHotel.id ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <TextField
                        label={t('staff.roomMap.hotelName')}
                        required
                        value={hotelDraft.name}
                        onChange={(e) =>
                          setHotelDraft((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                      <div className="flex gap-2">
                        <TextField
                          label={t('staff.roomMap.checkInDate')}
                          type="date"
                          value={hotelDraft.check_in_date}
                          onChange={(e) =>
                            setHotelDraft((prev) => ({ ...prev, check_in_date: e.target.value }))
                          }
                          className="flex-1"
                        />
                        <TextField
                          label={t('staff.roomMap.checkOutDate')}
                          type="date"
                          value={hotelDraft.check_out_date}
                          onChange={(e) =>
                            setHotelDraft((prev) => ({ ...prev, check_out_date: e.target.value }))
                          }
                          className="flex-1"
                        />
                      </div>
                      {/* WIFI */}
                      <div className="rounded-xl bg-gray-50 p-2.5">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          📶 {t('staff.roomMap.wifi')}
                        </p>
                        <div className="flex flex-col gap-2">
                          <TextField
                            label={t('staff.roomMap.wifiName')}
                            value={hotelDraft.wifi_name}
                            onChange={(e) =>
                              setHotelDraft((prev) => ({ ...prev, wifi_name: e.target.value }))
                            }
                          />
                          <TextField
                            label={t('staff.roomMap.wifiPassword')}
                            value={hotelDraft.wifi_password}
                            onChange={(e) =>
                              setHotelDraft((prev) => ({ ...prev, wifi_password: e.target.value }))
                            }
                          />
                        </div>
                      </div>

                      {/* อาหารเช้า */}
                      <div className="rounded-xl bg-gray-50 p-2.5">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          🍳 {t('staff.roomMap.breakfast')}
                        </p>
                        <div className="flex flex-col gap-2">
                          <TextField
                            label={t('staff.roomMap.breakfastTime')}
                            placeholder="07:00 AM"
                            value={hotelDraft.breakfast_time}
                            onChange={(e) =>
                              setHotelDraft((prev) => ({ ...prev, breakfast_time: e.target.value }))
                            }
                          />
                          <TextField
                            label={t('staff.roomMap.breakfastLocation')}
                            value={hotelDraft.breakfast_location}
                            onChange={(e) =>
                              setHotelDraft((prev) => ({ ...prev, breakfast_location: e.target.value }))
                            }
                          />
                        </div>
                      </div>

                      {/* Check-out */}
                      <div className="rounded-xl bg-gray-50 p-2.5">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          🚪 {t('staff.roomMap.checkoutHeading')}
                        </p>
                        <TextField
                          label={t('staff.roomMap.checkoutTime')}
                          placeholder="12:00 PM"
                          value={hotelDraft.checkout_time}
                          onChange={(e) =>
                            setHotelDraft((prev) => ({ ...prev, checkout_time: e.target.value }))
                          }
                        />
                      </div>

                      <TextAreaField
                        label={t('staff.roomMap.additionalNotes')}
                        value={hotelDraft.general_info}
                        onChange={(e) =>
                          setHotelDraft((prev) => ({ ...prev, general_info: e.target.value }))
                        }
                        placeholder={t('staff.roomMap.generalInfoPlaceholder')}
                      />
                      {saveInfoError && <p className="text-sm text-red-500">{saveInfoError}</p>}
                      <div className="flex gap-2">
                        <Button
                          onClick={() => saveInfo(activeHotel.id)}
                          disabled={savingInfo || !hotelDraft.name.trim()}
                        >
                          {t('common.save')}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setEditingInfoHotelId(null)}
                          disabled={savingInfo}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                        <span className="font-medium text-ink">{activeHotel.check_in_date || '—'}</span>
                        <span className="text-ink-faint">→</span>
                        <span className="font-medium text-ink">{activeHotel.check_out_date || '—'}</span>
                        {nightsBetween(activeHotel.check_in_date, activeHotel.check_out_date) && (
                          <span className="rounded-pill bg-brand-lighter px-2 py-0.5 text-xs font-semibold text-brand">
                            {t('staff.roomMap.nights', {
                              count: nightsBetween(activeHotel.check_in_date, activeHotel.check_out_date),
                            })}
                          </span>
                        )}
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-control bg-surface-muted p-2.5 text-center">
                          <p className="text-lg leading-none">📶</p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                            {t('staff.roomMap.wifi')}
                          </p>
                          {activeHotel.wifi_name || activeHotel.wifi_password ? (
                            <div className="mt-0.5">
                              {activeHotel.wifi_name && (
                                <p className="break-words text-xs font-medium text-ink">{activeHotel.wifi_name}</p>
                              )}
                              {activeHotel.wifi_password && (
                                <p className="select-all break-words font-mono text-[11px] text-ink-muted">
                                  {activeHotel.wifi_password}
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="mt-0.5 text-[11px] text-ink-faint">—</p>
                          )}
                        </div>

                        <div className="rounded-control bg-surface-muted p-2.5 text-center">
                          <p className="text-lg leading-none">🍳</p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                            {t('staff.roomMap.breakfast')}
                          </p>
                          {activeHotel.breakfast_time || activeHotel.breakfast_location ? (
                            <div className="mt-0.5">
                              {activeHotel.breakfast_time && (
                                <p className="text-xs font-medium text-ink">{activeHotel.breakfast_time}</p>
                              )}
                              {activeHotel.breakfast_location && (
                                <p className="break-words text-[11px] text-ink-muted">{activeHotel.breakfast_location}</p>
                              )}
                            </div>
                          ) : (
                            <p className="mt-0.5 text-[11px] text-ink-faint">—</p>
                          )}
                        </div>

                        <div className="rounded-control bg-surface-muted p-2.5 text-center">
                          <p className="text-lg leading-none">🚪</p>
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                            {t('staff.roomMap.checkoutHeading')}
                          </p>
                          <p className="mt-0.5 text-xs font-medium text-ink">{activeHotel.checkout_time || '—'}</p>
                        </div>
                      </div>

                      {activeHotel.general_info && (
                        <div className="mt-3 rounded-control bg-surface-muted p-2.5">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                            📝 {t('staff.roomMap.additionalNotes')}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">
                            {activeHotel.general_info}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </Card>

                {/* Step 2: room types + bulk create */}
                <div className="mt-5 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink">
                    {t('staff.roomMap.rooms')} · {hotelRooms.length}
                  </h2>
                  <button
                    onClick={() => setShowNewRoomForm((v) => !v)}
                    className="text-sm font-semibold text-brand"
                  >
                    + {t('staff.roomMap.addRooms')}
                  </button>
                </div>

                {showNewRoomForm && (
                  <Card className="mt-2">
                    <form onSubmit={handleCreateRooms} className="flex flex-col gap-3">
                      <SelectField
                        label={t('staff.roomMap.roomType')}
                        options={ROOM_TYPES}
                        value={newRoomBatch.room_type}
                        onChange={(e) =>
                          setNewRoomBatch((prev) => ({ ...prev, room_type: e.target.value }))
                        }
                      />
                      <TextField
                        label={t('staff.roomMap.roomCount')}
                        type="number"
                        min={1}
                        value={newRoomBatch.count}
                        onChange={(e) =>
                          setNewRoomBatch((prev) => ({ ...prev, count: e.target.value }))
                        }
                      />
                      {createRoomError && <p className="text-sm text-red-500">{createRoomError}</p>}
                      <div className="flex gap-2">
                        <Button type="submit" disabled={creatingRooms}>
                          {creatingRooms ? t('guest.register.submitting') : t('common.save')}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => setShowNewRoomForm(false)}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </form>
                  </Card>
                )}

                {/* Filter + search bar — sizable room count expected */}
                <div className="mt-3 flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder={t('staff.roomMap.searchRooms')}
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    className="w-full rounded-control border border-black/10 bg-surface px-3 py-2.5 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
                  />
                  <div className="flex gap-2">
                    <select
                      value={roomTypeFilter}
                      onChange={(e) => setRoomTypeFilter(e.target.value)}
                      className="flex-1 rounded-control border border-black/10 bg-surface px-2 py-2.5 text-sm text-ink-muted"
                    >
                      <option value="all">{t('staff.roomMap.allRoomTypes')}</option>
                      {ROOM_TYPES.map((rt) => (
                        <option key={rt.value} value={rt.value}>
                          {rt.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={floorFilter}
                      onChange={(e) => setFloorFilter(e.target.value)}
                      className="flex-1 rounded-control border border-black/10 bg-surface px-2 py-2.5 text-sm text-ink-muted"
                    >
                      <option value="all">{t('staff.roomMap.allFloors')}</option>
                      {floorOptions.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* ตัวกรองสถานะห้อง: ทั้งหมด / ว่าง / เต็ม */}
                  <div className="flex gap-1 rounded-control bg-surface-sunken p-1">
                    {[
                      { key: 'all', label: t('staff.roomMap.filterAll'), count: hotelRooms.length, dot: null },
                      { key: 'vacant', label: t('staff.roomMap.filterVacant'), count: vacantCount, dot: 'bg-brand' },
                      { key: 'full', label: t('staff.roomMap.filterFull'), count: fullCount, dot: 'bg-success' },
                    ].map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setOccupancyFilter(opt.key)}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-[0.7rem] py-1.5 text-xs font-semibold transition ${
                          occupancyFilter === opt.key
                            ? 'bg-surface text-ink shadow-card'
                            : 'text-ink-muted'
                        }`}
                      >
                        {opt.dot && <span className={`h-1.5 w-1.5 rounded-full ${opt.dot}`} />}
                        {opt.label}
                        <span className="text-ink-faint">{opt.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  {hotelRooms.length === 0 && (
                    <p className="text-sm text-ink-faint">{t('staff.roomMap.noRooms')}</p>
                  )}
                  {hotelRooms.length > 0 && visibleRooms.length === 0 && (
                    <p className="text-sm text-ink-faint">{t('staff.roomMap.noRoomsMatch')}</p>
                  )}
                  {visibleRooms.map((room) => {
                    const occupants = assignmentsByRoom[room.id] ?? []
                    const occ = occupants.length
                    const isFull = occ >= room.max_guests
                    const typeLabel =
                      ROOM_TYPES.find((rt) => rt.value === room.room_type)?.label ?? room.room_type
                    return (
                      <Card key={room.id} className="p-3">
                        <div className="flex items-start gap-3">
                          {/* คีย์การ์ด: ชั้น + เลขห้อง (กดพิมพ์แก้ได้เลย) */}
                          <div className="w-16 shrink-0 rounded-control bg-brand-lighter px-2 py-1.5">
                            <input
                              type="text"
                              placeholder={t('staff.roomMap.floor')}
                              value={room.floor}
                              onChange={(e) =>
                                setRooms((prev) =>
                                  prev.map((r) => (r.id === room.id ? { ...r, floor: e.target.value } : r))
                                )
                              }
                              onBlur={(e) => updateRoomField(room.id, { floor: e.target.value })}
                              className="w-full bg-transparent text-center text-[10px] text-ink-faint placeholder:text-ink-faint/60 focus:outline-none"
                            />
                            <input
                              type="text"
                              placeholder={t('staff.roomMap.roomNumber')}
                              value={room.room_number}
                              onChange={(e) =>
                                setRooms((prev) =>
                                  prev.map((r) =>
                                    r.id === room.id ? { ...r, room_number: e.target.value } : r
                                  )
                                )
                              }
                              onBlur={(e) => updateRoomField(room.id, { room_number: e.target.value })}
                              className="w-full bg-transparent text-center text-lg font-extrabold text-brand-hover placeholder:text-xs placeholder:font-normal placeholder:text-brand/40 focus:outline-none"
                            />
                          </div>

                          {/* กลาง: ประเภท + สถานะ + ชิปผู้เข้าพัก */}
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="rounded-pill bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                                {typeLabel} · {t('staff.roomMap.guestsUnit', { count: room.max_guests })}
                              </span>
                              <span
                                className={`shrink-0 text-[11px] font-semibold ${
                                  isFull ? 'text-success-text' : occ > 0 ? 'text-brand' : 'text-ink-faint'
                                }`}
                              >
                                {isFull
                                  ? t('staff.roomMap.statusFull')
                                  : t('staff.roomMap.statusVacantN', { count: room.max_guests - occ })}
                              </span>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                              {occupants.map((occupant) => {
                                const guest = guestById[occupant.guest_id]
                                return (
                                  <span
                                    key={occupant.id}
                                    className="inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-1 ring-1 ring-black/[0.04]"
                                  >
                                    <span className={`h-1.5 w-1.5 rounded-full ${genderDotClass(guest?.gender)}`} />
                                    <span
                                      className={`max-w-[7rem] truncate text-xs font-medium ${
                                        genderTextClass(guest?.gender) || 'text-ink'
                                      }`}
                                    >
                                      {guest ? guest.nickname || guest.name : '—'}
                                    </span>
                                    <button
                                      onClick={() => removeGuestFromRoom(occupant.id)}
                                      className="text-sm leading-none text-ink-faint"
                                      title={t('staff.roomMap.removeGuest')}
                                    >
                                      ×
                                    </button>
                                  </span>
                                )
                              })}
                              {!isFull && (
                                <button
                                  onClick={() => openAssignSlot(room, occ)}
                                  className="inline-flex items-center gap-1 rounded-pill border border-dashed border-brand/40 px-2.5 py-1 text-xs font-semibold text-brand"
                                >
                                  + {t('staff.roomMap.addOccupant')}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* ลบห้อง */}
                          <button
                            onClick={() => deleteRoom(room)}
                            className="shrink-0 text-xs font-semibold text-danger"
                            title={t('staff.formBuilder.delete')}
                          >
                            {t('staff.formBuilder.delete')}
                          </button>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <BottomSheet
        open={!!selectedRoom}
        onClose={closeAssignSheet}
        title={t('staff.roomMap.assignGuest')}
      >
        {/* แก้บั๊ก "มองไม่เห็น dropdown ชื่อคน" — เดิมผลลัพธ์อยู่ใต้ช่องค้นหา
            พอคีย์บอร์ดมือถือเด้งขึ้นมาจะบังผลลัพธ์ที่อยู่ด้านล่างจนมองไม่เห็น
            สลับมาโชว์ผลลัพธ์ไว้ด้านบน ช่องค้นหาปักไว้ด้านล่างสุดแทน (แบบเดียวกับกล่องแชท)
            เพื่อให้ผลลัพธ์ยังอยู่เหนือคีย์บอร์ดเสมอ */}
        <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
          {search.trim() && searchResults.length === 0 && (
            <p className="text-sm text-ink-faint">{t('staff.checkIn.noResults')}</p>
          )}
          {searchResults.map((g) => (
            <button
              key={g.id}
              onClick={() => assignGuestToSlot(g.id)}
              disabled={assigning}
              className="rounded-control border border-black/10 px-3 py-2.5 text-left hover:bg-surface-muted"
            >
              <span className={`font-medium ${genderTextClass(g.gender) || 'text-ink'}`}>{g.nickname || g.name}</span>
              {g.nickname && <span className="ml-1 text-sm text-ink-faint">{g.name}</span>}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder={t('staff.checkIn.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mt-3 w-full rounded-control border border-black/10 px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
        />
      </BottomSheet>
    </div>
  )
}
