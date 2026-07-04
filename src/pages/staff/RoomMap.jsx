import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import BottomSheet from '../../components/common/BottomSheet'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'
import TextAreaField from '../../components/common/TextAreaField'
import SelectField from '../../components/common/SelectField'

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
  const [infoDraft, setInfoDraft] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)

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

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [hotelsRes, roomsRes, assignmentsRes, guestsRes] = await Promise.all([
      supabase
        .from('hotels')
        .select('id, name, check_in_date, check_out_date, general_info')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('check_in_date', { ascending: true }),
      supabase
        .from('hotel_rooms')
        .select('id, hotel_id, room_number, floor, room_type, max_guests')
        .eq('tour_id', ACTIVE_TOUR_ID),
      supabase
        .from('room_assignments')
        .select('id, room_id, guest_id')
        .eq('tour_id', ACTIVE_TOUR_ID),
      supabase.from('guests').select('id, name, nickname').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
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
        () => loadAll()
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

  const assignedGuestIds = useMemo(() => new Set(assignments.map((a) => a.guest_id)), [assignments])

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
  }, [hotelRooms, roomTypeFilter, floorFilter, roomSearch, assignmentsByRoom, guestById])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    const currentOccupantIds = selectedRoom
      ? (assignmentsByRoom[selectedRoom.id] ?? []).map((a) => a.guest_id)
      : []
    return guests
      .filter((g) => !assignedGuestIds.has(g.id) || currentOccupantIds.includes(g.id))
      .filter((g) => g.name?.toLowerCase().includes(q) || g.nickname?.toLowerCase().includes(q))
      .slice(0, 20)
  }, [guests, search, assignedGuestIds, selectedRoom, assignmentsByRoom])

  async function handleCreateHotel(e) {
    e.preventDefault()
    if (!newHotel.name.trim()) return

    setCreatingHotel(true)
    setCreateHotelError(null)

    const { error: insertError } = await supabase.from('hotels').insert({
      tour_id: ACTIVE_TOUR_ID,
      name: newHotel.name.trim(),
      check_in_date: newHotel.check_in_date || null,
      check_out_date: newHotel.check_out_date || null,
      general_info: newHotel.general_info.trim() || null,
    })

    if (insertError) {
      console.error('[RoomMap] create hotel failed', insertError)
      setCreateHotelError(insertError.message ?? t('common.error'))
      setCreatingHotel(false)
      return
    }

    setNewHotel(NEW_HOTEL_TEMPLATE)
    setShowNewHotelForm(false)
    setCreatingHotel(false)
    loadAll()
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
    setEditingInfoHotelId(hotel.id)
    setInfoDraft(hotel.general_info ?? '')
  }

  async function saveInfo(hotelId) {
    setSavingInfo(true)
    const patch = { general_info: infoDraft.trim() || null }
    setHotels((prev) => prev.map((h) => (h.id === hotelId ? { ...h, ...patch } : h)))

    const { error: updateError } = await supabase.from('hotels').update(patch).eq('id', hotelId)
    if (updateError) {
      console.error('[RoomMap] save info failed', updateError)
      loadAll()
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

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.roomMap.title')}</h1>

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            {/* Step 1: hotels */}
            <div className="mt-2 flex flex-wrap gap-2">
              {hotels.map((hotel) => (
                <div key={hotel.id} className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveHotelId(hotel.id)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      activeHotelId === hotel.id ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {hotel.name}
                  </button>
                  <button
                    onClick={() => deleteHotel(hotel)}
                    className="text-sm text-red-400 hover:text-red-600"
                    title={t('staff.roomMap.deleteHotel')}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => setShowNewHotelForm((v) => !v)}
                className="rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
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
              <p className="mt-4 text-gray-500">{t('staff.roomMap.noHotel')}</p>
            )}

            {activeHotel && (
              <>
                {/* Hotel general info — visible to all guests */}
                <Card className="mt-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-gray-900">{t('staff.roomMap.generalInfo')}</h2>
                    {editingInfoHotelId !== activeHotel.id && (
                      <button
                        onClick={() => startEditInfo(activeHotel)}
                        className="text-sm font-medium text-sky-600"
                      >
                        {t('staff.itineraryBuilder.edit')}
                      </button>
                    )}
                  </div>

                  {editingInfoHotelId === activeHotel.id ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <TextAreaField
                        value={infoDraft}
                        onChange={(e) => setInfoDraft(e.target.value)}
                        placeholder={t('staff.roomMap.generalInfoPlaceholder')}
                      />
                      <div className="flex gap-2">
                        <Button onClick={() => saveInfo(activeHotel.id)} disabled={savingInfo}>
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
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">
                      {activeHotel.general_info || t('staff.roomMap.noGeneralInfo')}
                    </p>
                  )}
                </Card>

                {/* Step 2: room types + bulk create */}
                <div className="mt-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    {t('staff.roomMap.rooms')}
                  </h2>
                  <button
                    onClick={() => setShowNewRoomForm((v) => !v)}
                    className="text-sm font-medium text-sky-600"
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
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                  <div className="flex gap-2">
                    <select
                      value={roomTypeFilter}
                      onChange={(e) => setRoomTypeFilter(e.target.value)}
                      className="flex-1 rounded-xl border border-gray-300 bg-white px-2 py-2 text-sm"
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
                      className="flex-1 rounded-xl border border-gray-300 bg-white px-2 py-2 text-sm"
                    >
                      <option value="all">{t('staff.roomMap.allFloors')}</option>
                      {floorOptions.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-2 flex flex-col gap-1.5">
                  {hotelRooms.length === 0 && (
                    <p className="text-sm text-gray-400">{t('staff.roomMap.noRooms')}</p>
                  )}
                  {hotelRooms.length > 0 && visibleRooms.length === 0 && (
                    <p className="text-sm text-gray-400">{t('staff.roomMap.noRoomsMatch')}</p>
                  )}
                  {visibleRooms.map((room) => {
                    const occupants = assignmentsByRoom[room.id] ?? []
                    return (
                      <Card key={room.id} className="p-2.5">
                        <div className="flex items-stretch gap-2">
                          {/* Left column: floor (top), room number (bottom) */}
                          <div className="flex w-16 shrink-0 flex-col justify-between">
                            <input
                              type="text"
                              placeholder={t('staff.roomMap.floor')}
                              value={room.floor}
                              onChange={(e) =>
                                setRooms((prev) =>
                                  prev.map((r) =>
                                    r.id === room.id ? { ...r, floor: e.target.value } : r
                                  )
                                )
                              }
                              onBlur={(e) => updateRoomField(room.id, { floor: e.target.value })}
                              className="w-full rounded-md border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500"
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
                              className="mt-1 w-full rounded-md border border-gray-200 px-1.5 py-0.5 text-sm font-semibold text-gray-900"
                            />
                          </div>

                          {/* Right column: occupant names / assign buttons */}
                          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                            {Array.from({ length: room.max_guests }, (_, slotIndex) => {
                              const occupant = occupants[slotIndex]
                              const guest = occupant ? guestById[occupant.guest_id] : null
                              return (
                                <div key={slotIndex} className="flex items-center justify-between gap-1">
                                  {guest ? (
                                    <>
                                      <span className="truncate text-sm font-medium text-gray-900">
                                        {guest.nickname || guest.name}
                                      </span>
                                      <button
                                        onClick={() => removeGuestFromRoom(occupant.id)}
                                        className="shrink-0 text-xs font-medium text-red-500"
                                      >
                                        {t('staff.seatMap.removeGuest')}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => openAssignSlot(room, slotIndex)}
                                      className="text-sm text-sky-600"
                                    >
                                      + {t('staff.roomMap.addOccupant')}
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                          </div>

                          {/* Far right: type tag + delete */}
                          <div className="flex shrink-0 flex-col items-end justify-between gap-1">
                            <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                              {ROOM_TYPES.find((rt) => rt.value === room.room_type)?.label ??
                                room.room_type}
                            </span>
                            <button
                              onClick={() => deleteRoom(room)}
                              className="text-xs font-medium text-red-500"
                            >
                              {t('staff.formBuilder.delete')}
                            </button>
                          </div>
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
        <input
          type="text"
          placeholder={t('staff.checkIn.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
        <div className="mt-3 flex flex-col gap-1.5">
          {search.trim() && searchResults.length === 0 && (
            <p className="text-sm text-gray-400">{t('staff.checkIn.noResults')}</p>
          )}
          {searchResults.map((g) => (
            <button
              key={g.id}
              onClick={() => assignGuestToSlot(g.id)}
              disabled={assigning}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-left hover:bg-gray-50"
            >
              <span className="font-medium text-gray-900">{g.nickname || g.name}</span>
              {g.nickname && <span className="ml-1 text-sm text-gray-400">{g.name}</span>}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  )
}
