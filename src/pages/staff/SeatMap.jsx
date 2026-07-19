import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { genderTextClass, genderBgClass, genderBorderClass } from '../../lib/genderColor'
import BottomSheet from '../../components/common/BottomSheet'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'
import TextField from '../../components/common/TextField'

const NEW_BUS_TEMPLATE = {
  name: '',
  total_rows: 20,
  seats_per_row: 4,
  license_plate: '',
  driver_name: '',
  driver_phone: '',
}

const SEAT_TYPES = ['guest', 'staff', 'vip']

// สีปุ่มเลือกประเภท (active state)
const TYPE_ACTIVE_CLASS = {
  guest: 'bg-sky-500 text-white',
  staff: 'bg-emerald-500 text-white',
  vip: 'bg-amber-500 text-white',
}

// สีพื้นของที่นั่งตามประเภท — ลูกทัวร์ใช้สีตามเพศ (ฟ้า/ชมพู), Staff เขียว, VIP เหลือง
function seatTypeBgClass(type, gender) {
  if (type === 'vip') return 'bg-amber-500 text-white'
  if (type === 'staff') return 'bg-emerald-500 text-white'
  return genderBgClass(gender)
}

export default function SeatMap() {
  const { t } = useTranslation()

  const [mode, setMode] = useState('assign') // 'assign' = จับลงคัน, 'seats' = จัดที่นั่ง
  const [buses, setBuses] = useState([])
  const [activeBusId, setActiveBusId] = useState(null)
  const [seats, setSeats] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedSeat, setSelectedSeat] = useState(null) // seat row object
  const [search, setSearch] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignType, setAssignType] = useState('guest') // ประเภทที่จะใช้ตอนจัดคนลงที่นั่งใหม่

  const [selectedGuest, setSelectedGuest] = useState(null) // โหมดจับลงคัน: คนที่กำลังเลือกคันให้
  const [busMenuId, setBusMenuId] = useState(null) // คอลัมน์ที่เปิดเมนู ⋯ อยู่
  const [poolSearch, setPoolSearch] = useState('') // ค้นหาคนในโหมดจับลงคัน

  const [showNewBusForm, setShowNewBusForm] = useState(false)
  const [newBus, setNewBus] = useState(NEW_BUS_TEMPLATE)
  const [creatingBus, setCreatingBus] = useState(false)
  const [createBusError, setCreateBusError] = useState(null)

  const [editingBusId, setEditingBusId] = useState(null)
  const [busDraft, setBusDraft] = useState(NEW_BUS_TEMPLATE)
  const [savingBus, setSavingBus] = useState(false)
  const [editBusError, setEditBusError] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [busesRes, seatsRes, guestsRes] = await Promise.all([
      supabase
        .from('buses')
        .select('id, name, total_rows, seats_per_row, license_plate, driver_name, driver_phone')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('name'),
      supabase
        .from('bus_seats')
        .select('id, bus_id, row_number, seat_position, guest_id, is_available, is_seat, seat_type')
        .eq('tour_id', ACTIVE_TOUR_ID),
      supabase.from('guests').select('id, name, nickname, gender, bus_id').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
    ])

    if (busesRes.error || seatsRes.error || guestsRes.error) {
      console.error('[SeatMap] load failed', busesRes.error, seatsRes.error, guestsRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setBuses(busesRes.data ?? [])
    setSeats(seatsRes.data ?? [])
    setGuests(guestsRes.data ?? [])
    setActiveBusId((prev) => prev ?? busesRes.data?.[0]?.id ?? null)
    setLoading(false)
  }

  useEffect(() => {
    loadAll()

    const channel = supabase
      .channel(`seatmap-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bus_seats', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        (payload) => {
          setSeats((prev) => {
            if (payload.eventType === 'DELETE') return prev.filter((s) => s.id !== payload.old.id)
            const exists = prev.some((s) => s.id === payload.new.id)
            return exists
              ? prev.map((s) => (s.id === payload.new.id ? payload.new : s))
              : [...prev, payload.new]
          })
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeBus = buses.find((b) => b.id === activeBusId)

  const seatsByPosition = useMemo(() => {
    const map = {}
    for (const s of seats) {
      if (s.bus_id !== activeBusId) continue
      map[`${s.row_number}-${s.seat_position}`] = s
    }
    return map
  }, [seats, activeBusId])

  const occupiedGuestIds = useMemo(
    () => new Set(seats.filter((s) => s.guest_id).map((s) => s.guest_id)),
    [seats]
  )

  const guestById = useMemo(() => {
    const map = {}
    for (const g of guests) map[g.id] = g
    return map
  }, [guests])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return guests
      .filter((g) => !occupiedGuestIds.has(g.id) || g.id === selectedSeat?.guest_id)
      .filter((g) => g.name?.toLowerCase().includes(q) || g.nickname?.toLowerCase().includes(q))
      .slice(0, 20)
  }, [guests, search, occupiedGuestIds, selectedSeat])

  // ----- โหมดจับลงคัน -----
  // seat ที่ลูกทัวร์แต่ละคนนั่งอยู่ (ใช้เตือนก่อนย้ายคัน)
  const seatByGuestId = useMemo(() => {
    const map = {}
    for (const s of seats) if (s.guest_id) map[s.guest_id] = s
    return map
  }, [seats])

  const guestsByBus = useMemo(() => {
    const map = {}
    for (const b of buses) map[b.id] = []
    for (const g of guests) {
      if (g.bus_id && map[g.bus_id]) map[g.bus_id].push(g)
    }
    return map
  }, [buses, guests])

  const unassignedGuests = useMemo(() => {
    const q = poolSearch.trim().toLowerCase()
    return guests
      .filter((g) => !g.bus_id)
      .filter((g) => !q || g.name?.toLowerCase().includes(q) || g.nickname?.toLowerCase().includes(q))
  }, [guests, poolSearch])

  const assignedGuestCount = useMemo(() => guests.filter((g) => g.bus_id).length, [guests])

  function openGuestSheet(guest) {
    setSelectedGuest(guest)
  }

  function closeGuestSheet() {
    setSelectedGuest(null)
  }

  // จับลูกทัวร์ลงคัน — ถ้าเคยมีที่นั่งในคันอื่น ให้ล้างที่นั่งเดิมทิ้ง (คนละคันแล้ว)
  async function assignGuestToBus(guest, busId) {
    if (!guest) return
    setAssigning(true)
    const seat = seatByGuestId[guest.id]
    const seatInOtherBus = seat && seat.bus_id !== busId

    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, bus_id: busId } : g)))
    if (seatInOtherBus) {
      setSeats((prev) =>
        prev.map((s) =>
          s.id === seat.id ? { ...s, guest_id: null, is_available: true, seat_type: 'guest' } : s
        )
      )
    }
    closeGuestSheet()

    const { error: guestErr } = await supabase.from('guests').update({ bus_id: busId }).eq('id', guest.id)
    if (seatInOtherBus) {
      await supabase
        .from('bus_seats')
        .update({ guest_id: null, is_available: true, seat_type: 'guest' })
        .eq('id', seat.id)
    }
    if (guestErr) {
      console.error('[SeatMap] assign bus failed', guestErr)
      loadAll()
    }
    setAssigning(false)
  }

  // เอาลูกทัวร์ออกจากคัน — ล้างทั้ง bus_id และที่นั่ง (ถ้ามี)
  async function removeGuestFromBus(guest) {
    if (!guest) return
    setAssigning(true)
    const seat = seatByGuestId[guest.id]

    setGuests((prev) => prev.map((g) => (g.id === guest.id ? { ...g, bus_id: null } : g)))
    if (seat) {
      setSeats((prev) =>
        prev.map((s) =>
          s.id === seat.id ? { ...s, guest_id: null, is_available: true, seat_type: 'guest' } : s
        )
      )
    }
    closeGuestSheet()

    const { error: guestErr } = await supabase.from('guests').update({ bus_id: null }).eq('id', guest.id)
    if (seat) {
      await supabase
        .from('bus_seats')
        .update({ guest_id: null, is_available: true, seat_type: 'guest' })
        .eq('id', seat.id)
    }
    if (guestErr) {
      console.error('[SeatMap] remove from bus failed', guestErr)
      loadAll()
    }
    setAssigning(false)
  }

  function openSeat(seat) {
    setSelectedSeat(seat)
    setSearch('')
    setAssignType(seat.seat_type || 'guest')
  }

  function closeSheet() {
    setSelectedSeat(null)
    setSearch('')
  }

  async function assignGuest(guestId) {
    if (!selectedSeat) return
    setAssigning(true)

    const patch = { guest_id: guestId, is_available: false, seat_type: assignType }
    setSeats((prev) => prev.map((s) => (s.id === selectedSeat.id ? { ...s, ...patch } : s)))
    // จัดที่นั่งให้ = จับลงคันนั้นโดยปริยาย
    setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, bus_id: selectedSeat.bus_id } : g)))

    const { error: updateError } = await supabase
      .from('bus_seats')
      .update(patch)
      .eq('id', selectedSeat.id)
    await supabase.from('guests').update({ bus_id: selectedSeat.bus_id }).eq('id', guestId)

    if (updateError) {
      console.error('[SeatMap] assign failed', updateError)
      loadAll()
    }
    setAssigning(false)
    closeSheet()
  }

  // เปลี่ยนประเภทของที่นั่งที่มีคนนั่งอยู่แล้ว (ลูกทัวร์/Staff/VIP)
  async function changeSeatType(type) {
    if (!selectedSeat) return
    const patch = { seat_type: type }
    setSeats((prev) => prev.map((s) => (s.id === selectedSeat.id ? { ...s, ...patch } : s)))
    setSelectedSeat((prev) => (prev ? { ...prev, ...patch } : prev))
    setAssignType(type)

    const { error: updateError } = await supabase
      .from('bus_seats')
      .update(patch)
      .eq('id', selectedSeat.id)
    if (updateError) {
      console.error('[SeatMap] change type failed', updateError)
      loadAll()
    }
  }

  async function clearSeat() {
    if (!selectedSeat) return
    setAssigning(true)

    const patch = { guest_id: null, is_available: true, seat_type: 'guest' }
    setSeats((prev) => prev.map((s) => (s.id === selectedSeat.id ? { ...s, ...patch } : s)))

    const { error: updateError } = await supabase
      .from('bus_seats')
      .update(patch)
      .eq('id', selectedSeat.id)

    if (updateError) {
      console.error('[SeatMap] clear failed', updateError)
      loadAll()
    }
    setAssigning(false)
    closeSheet()
  }

  // ปิดใช้งานจุดนี้ (ไม่ใช่ที่นั่งโดยสาร เช่น ห้องน้ำ) — ต้องว่างก่อนถึงจะปิดได้
  async function disableSeat() {
    if (!selectedSeat) return
    setAssigning(true)

    const patch = { is_seat: false, guest_id: null, is_available: true, seat_type: 'guest' }
    setSeats((prev) => prev.map((s) => (s.id === selectedSeat.id ? { ...s, ...patch } : s)))

    const { error: updateError } = await supabase
      .from('bus_seats')
      .update(patch)
      .eq('id', selectedSeat.id)

    if (updateError) {
      console.error('[SeatMap] disable failed', updateError)
      loadAll()
    }
    setAssigning(false)
    closeSheet()
  }

  async function enableSeat() {
    if (!selectedSeat) return
    setAssigning(true)

    const patch = { is_seat: true }
    setSeats((prev) => prev.map((s) => (s.id === selectedSeat.id ? { ...s, ...patch } : s)))

    const { error: updateError } = await supabase
      .from('bus_seats')
      .update(patch)
      .eq('id', selectedSeat.id)

    if (updateError) {
      console.error('[SeatMap] enable failed', updateError)
      loadAll()
    }
    setAssigning(false)
    closeSheet()
  }

  async function deleteBus(bus) {
    const confirmed = window.confirm(t('staff.seatMap.confirmDeleteBus', { name: bus.name }))
    if (!confirmed) return

    const { error: deleteError } = await supabase.from('buses').delete().eq('id', bus.id)
    if (deleteError) {
      console.error('[SeatMap] delete bus failed', deleteError)
      return
    }

    setBuses((prev) => prev.filter((b) => b.id !== bus.id))
    setSeats((prev) => prev.filter((s) => s.bus_id !== bus.id))
    // FK ON DELETE SET NULL เคลียร์ bus_id ใน DB แล้ว — sync local state ด้วย
    setGuests((prev) => prev.map((g) => (g.bus_id === bus.id ? { ...g, bus_id: null } : g)))
    setActiveBusId((prev) => (prev === bus.id ? null : prev))
    setBusMenuId(null)
  }

  async function handleCreateBus(e) {
    e.preventDefault()
    if (!newBus.name.trim()) return

    setCreatingBus(true)
    setCreateBusError(null)

    const totalRows = Number(newBus.total_rows) || 1
    const seatsPerRow = Number(newBus.seats_per_row) || 4
    const positions = ['A', 'B', 'C', 'D'].slice(0, seatsPerRow)

    const { data: bus, error: busError } = await supabase
      .from('buses')
      .insert({
        tour_id: ACTIVE_TOUR_ID,
        name: newBus.name.trim(),
        total_rows: totalRows,
        seats_per_row: seatsPerRow,
        license_plate: newBus.license_plate.trim() || null,
        driver_name: newBus.driver_name.trim() || null,
        driver_phone: newBus.driver_phone.trim() || null,
      })
      .select('id')
      .single()

    if (busError) {
      console.error('[SeatMap] create bus failed', busError)
      setCreateBusError(busError.message ?? t('common.error'))
      setCreatingBus(false)
      return
    }

    const seatRows = []
    for (let row = 1; row <= totalRows; row++) {
      for (const pos of positions) {
        seatRows.push({
          bus_id: bus.id,
          tour_id: ACTIVE_TOUR_ID,
          row_number: row,
          seat_position: pos,
          is_available: true,
          is_seat: true,
          seat_type: 'guest',
        })
      }
    }

    const { error: seatsError } = await supabase.from('bus_seats').insert(seatRows)
    if (seatsError) {
      console.error('[SeatMap] seed seats failed', seatsError)
      setCreateBusError(seatsError.message ?? t('common.error'))
      setCreatingBus(false)
      return
    }

    setNewBus(NEW_BUS_TEMPLATE)
    setShowNewBusForm(false)
    setCreatingBus(false)
    setActiveBusId(bus.id)
    loadAll()
  }

  function startEditBus(bus) {
    setEditingBusId(bus.id)
    setEditBusError(null)
    setBusDraft({
      name: bus.name ?? '',
      total_rows: bus.total_rows ?? 20,
      seats_per_row: bus.seats_per_row ?? 4,
      license_plate: bus.license_plate ?? '',
      driver_name: bus.driver_name ?? '',
      driver_phone: bus.driver_phone ?? '',
    })
  }

  // บันทึกข้อมูลรถ + ปรับจำนวนที่นั่งให้ตรงกับแถว/ที่นั่งต่อแถวใหม่
  // (เพิ่มที่นั่งที่ขาด, ลบที่นั่งที่เกินออก โดยคงที่นั่งเดิม+คนที่นั่งอยู่ไว้)
  async function saveBusEdit(busId) {
    if (!busDraft.name.trim()) return
    setSavingBus(true)
    setEditBusError(null)

    const totalRows = Number(busDraft.total_rows) || 1
    const seatsPerRow = Math.min(Math.max(Number(busDraft.seats_per_row) || 4, 1), 4)
    const positions = ['A', 'B', 'C', 'D'].slice(0, seatsPerRow)

    const { error: updateError } = await supabase
      .from('buses')
      .update({
        name: busDraft.name.trim(),
        total_rows: totalRows,
        seats_per_row: seatsPerRow,
        license_plate: busDraft.license_plate.trim() || null,
        driver_name: busDraft.driver_name.trim() || null,
        driver_phone: busDraft.driver_phone.trim() || null,
      })
      .eq('id', busId)

    if (updateError) {
      console.error('[SeatMap] edit bus failed', updateError)
      setEditBusError(updateError.message ?? t('common.error'))
      setSavingBus(false)
      return
    }

    // ปรับผังที่นั่งให้ตรงกับกริดใหม่
    const existing = seats.filter((s) => s.bus_id === busId)
    const wanted = new Set()
    const toInsert = []
    for (let row = 1; row <= totalRows; row++) {
      for (const pos of positions) {
        wanted.add(`${row}-${pos}`)
        if (!existing.some((s) => s.row_number === row && s.seat_position === pos)) {
          toInsert.push({
            bus_id: busId,
            tour_id: ACTIVE_TOUR_ID,
            row_number: row,
            seat_position: pos,
            is_available: true,
            is_seat: true,
            seat_type: 'guest',
          })
        }
      }
    }
    const toDelete = existing
      .filter((s) => !wanted.has(`${s.row_number}-${s.seat_position}`))
      .map((s) => s.id)

    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from('bus_seats').insert(toInsert)
      if (insErr) console.error('[SeatMap] add seats failed', insErr)
    }
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.from('bus_seats').delete().in('id', toDelete)
      if (delErr) console.error('[SeatMap] remove seats failed', delErr)
    }

    setSavingBus(false)
    setEditingBusId(null)
    loadAll()
  }

  const rows = activeBus ? Array.from({ length: activeBus.total_rows }, (_, i) => i + 1) : []
  const seatPositions = activeBus
    ? ['A', 'B', 'C', 'D'].slice(0, activeBus.seats_per_row)
    : ['A', 'B', 'C', 'D']
  const leftPositions = seatPositions.slice(0, Math.ceil(seatPositions.length / 2))
  const rightPositions = seatPositions.slice(Math.ceil(seatPositions.length / 2))

  // สรุปที่นั่งที่มีคนนั่งแล้ว / ที่นั่งทั้งหมดของรถคันนี้
  const busSeatList = useMemo(
    () => seats.filter((s) => s.bus_id === activeBusId && s.is_seat),
    [seats, activeBusId]
  )
  const occupiedCount = busSeatList.filter((s) => s.guest_id).length

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-ink">
            <Icon name="seat" size={24} filled />
            {t('staff.seatMap.title')}
          </h1>
          {mode === 'assign' && guests.length > 0 && (
            <span className="inline-flex shrink-0 items-baseline gap-1 rounded-pill bg-brand-lighter px-3 py-1.5">
              <span className="text-xs text-ink-muted">{t('staff.seatMap.onBusLabel')}</span>
              <span className="text-sm font-bold text-brand-hover">
                {assignedGuestCount}/{guests.length}
              </span>
            </span>
          )}
          {mode === 'seats' && activeBus && (
            <span className="inline-flex shrink-0 items-baseline gap-1 rounded-pill bg-brand-lighter px-3 py-1.5">
              <span className="text-xs text-ink-muted">{t('staff.seatMap.assignedLabel')}</span>
              <span className="text-sm font-bold text-brand-hover">
                {occupiedCount}/{busSeatList.length}
              </span>
            </span>
          )}
        </div>

        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="text-danger">{error}</p>}

        {!loading && !error && (
          <>
            {/* สลับโหมด: จับลงคัน / จัดที่นั่ง */}
            <div className="mb-3 flex rounded-pill bg-surface-sunken p-1">
              {[
                { key: 'assign', label: t('staff.seatMap.modeAssign') },
                { key: 'seats', label: t('staff.seatMap.modeSeats') },
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    setMode(m.key)
                    setShowNewBusForm(false)
                    setBusMenuId(null)
                  }}
                  className={`flex-1 rounded-pill py-2 text-sm font-semibold transition ${
                    mode === m.key ? 'bg-brand text-white shadow-brand' : 'text-ink-muted'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === 'seats' && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {buses.map((bus) => (
                  <button
                    key={bus.id}
                    onClick={() => setActiveBusId(bus.id)}
                    className={`shrink-0 rounded-pill px-4 py-2 text-sm font-semibold transition ${
                      activeBusId === bus.id
                        ? 'bg-brand text-white shadow-brand'
                        : 'bg-surface text-ink-muted ring-1 ring-black/[0.04]'
                    }`}
                  >
                    {bus.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setShowNewBusForm((v) => !v)
                    setEditingBusId(null)
                  }}
                  className="shrink-0 rounded-pill border border-dashed border-brand/40 px-3 py-2 text-sm font-semibold text-brand"
                >
                  + {t('staff.seatMap.addBus')}
                </button>
              </div>
            )}

            {/* โหมดจับลงคัน — คอลัมน์รถ + กล่องยังไม่จับ */}
            {mode === 'assign' && (
              <>
                {buses.length === 0 && (
                  <p className="mt-4 text-ink-muted">{t('staff.seatMap.noBus')}</p>
                )}
                {buses.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {buses.map((bus) => {
                      const list = guestsByBus[bus.id] ?? []
                      return (
                        <div
                          key={bus.id}
                          className="relative rounded-card border border-white/60 bg-surface p-2.5 shadow-card ring-1 ring-black/[0.02]"
                        >
                          <div className="mb-2 flex items-center justify-between gap-1">
                            <span className="flex min-w-0 items-center gap-1 font-bold text-ink">
                              <Icon name="bus" size={16} />
                              <span className="truncate">{bus.name}</span>
                            </span>
                            <div className="flex shrink-0 items-center gap-1">
                              <span className="text-xs text-ink-faint">{list.length}</span>
                              <button
                                onClick={() => setBusMenuId((prev) => (prev === bus.id ? null : bus.id))}
                                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken"
                                aria-label={t('staff.seatMap.busMenu')}
                              >
                                <span className="text-lg leading-none">⋯</span>
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-col gap-1.5">
                            {list.length === 0 && (
                              <p className="py-2 text-center text-[11px] text-ink-faint">
                                {t('staff.seatMap.emptyBus')}
                              </p>
                            )}
                            {list.map((g) => {
                              const hasSeat = !!seatByGuestId[g.id]
                              return (
                                <button
                                  key={g.id}
                                  onClick={() => openGuestSheet(g)}
                                  className={`flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold ${genderBgClass(g.gender)}`}
                                >
                                  <span className="truncate">{g.nickname || g.name}</span>
                                  {hasSeat && (
                                    <span className="shrink-0 rounded bg-white/25 px-1 text-[10px]">
                                      {seatByGuestId[g.id].row_number}
                                      {seatByGuestId[g.id].seat_position}
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </div>

                          {busMenuId === bus.id && (
                            <>
                              <div
                                className="fixed inset-0 z-10"
                                onClick={() => setBusMenuId(null)}
                              />
                              <div className="absolute right-2 top-9 z-20 min-w-[132px] rounded-xl border border-black/10 bg-surface p-1 shadow-card">
                                <button
                                  onClick={() => {
                                    setMode('seats')
                                    setActiveBusId(bus.id)
                                    startEditBus(bus)
                                    setBusMenuId(null)
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-sunken"
                                >
                                  <Icon name="edit" size={16} />
                                  {t('staff.seatMap.editBusInfo')}
                                </button>
                                <button
                                  onClick={() => deleteBus(bus)}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-danger hover:bg-danger-bg"
                                >
                                  <Icon name="trash" size={16} />
                                  {t('staff.seatMap.deleteBusShort')}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* ปุ่มเพิ่มคัน */}
                <button
                  onClick={() => {
                    setShowNewBusForm((v) => !v)
                    setEditingBusId(null)
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-brand/40 py-3 text-sm font-semibold text-brand"
                >
                  + {t('staff.seatMap.addBus')}
                </button>

                {/* กล่องคนที่ยังไม่จับลงคัน */}
                <div className="mt-3 rounded-card border border-warning/30 bg-warning-bg p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-warning-text">
                    <Icon name="people" size={15} />
                    {t('staff.seatMap.unassignedTitle', { count: guests.filter((g) => !g.bus_id).length })}
                  </p>
                  {guests.some((g) => !g.bus_id) && (
                    <input
                      type="text"
                      placeholder={t('staff.checkIn.searchPlaceholder')}
                      value={poolSearch}
                      onChange={(e) => setPoolSearch(e.target.value)}
                      className="mb-2.5 w-full rounded-control border border-black/10 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                    />
                  )}
                  {!guests.some((g) => !g.bus_id) ? (
                    <p className="py-1 text-center text-[11px] text-warning-text/80">
                      {t('staff.seatMap.allAssigned')}
                    </p>
                  ) : unassignedGuests.length === 0 ? (
                    <p className="py-1 text-center text-[11px] text-warning-text/80">
                      {t('staff.checkIn.noResults')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {unassignedGuests.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => openGuestSheet(g)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${genderBorderClass(g.gender)}`}
                        >
                          {g.nickname || g.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {showNewBusForm && (
              <Card className="mt-3">
                <form onSubmit={handleCreateBus} className="flex flex-col gap-3">
                  <TextField
                    label={t('staff.seatMap.busName')}
                    required
                    value={newBus.name}
                    onChange={(e) => setNewBus((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <TextField
                      label={t('staff.seatMap.totalRows')}
                      type="number"
                      min={1}
                      value={newBus.total_rows}
                      onChange={(e) =>
                        setNewBus((prev) => ({ ...prev, total_rows: e.target.value }))
                      }
                      className="flex-1"
                    />
                    <TextField
                      label={t('staff.seatMap.seatsPerRow')}
                      type="number"
                      min={1}
                      max={4}
                      value={newBus.seats_per_row}
                      onChange={(e) =>
                        setNewBus((prev) => ({ ...prev, seats_per_row: e.target.value }))
                      }
                      className="flex-1"
                    />
                  </div>
                  <TextField
                    label={t('staff.seatMap.licensePlate')}
                    value={newBus.license_plate}
                    onChange={(e) => setNewBus((prev) => ({ ...prev, license_plate: e.target.value }))}
                  />
                  <div className="rounded-xl bg-gray-50 p-2.5">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {t('staff.seatMap.driverSection')}
                    </p>
                    <div className="flex flex-col gap-2">
                      <TextField
                        label={t('staff.seatMap.driverName')}
                        value={newBus.driver_name}
                        onChange={(e) => setNewBus((prev) => ({ ...prev, driver_name: e.target.value }))}
                      />
                      <TextField
                        label={t('staff.seatMap.driverPhone')}
                        type="tel"
                        value={newBus.driver_phone}
                        onChange={(e) => setNewBus((prev) => ({ ...prev, driver_phone: e.target.value }))}
                      />
                    </div>
                  </div>
                  {createBusError && <p className="text-sm text-red-500">{createBusError}</p>}
                  <div className="flex gap-2">
                    <Button type="submit" disabled={creatingBus || !newBus.name.trim()}>
                      {creatingBus ? t('guest.register.submitting') : t('common.save')}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setShowNewBusForm(false)}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </Card>
            )}

            {/* ข้อมูลรถบัส + ปุ่มแก้ไข */}
            {mode === 'seats' && activeBus && editingBusId !== activeBus.id && (
              <Card className="mt-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-lighter text-brand-hover">
                    <Icon name="bus" size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink">{activeBus.name}</p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      {t('staff.seatMap.busSizeSummary', {
                        rows: activeBus.total_rows,
                        perRow: activeBus.seats_per_row,
                      })}
                    </p>
                  </div>
                  {activeBus.license_plate && (
                    <span className="shrink-0 rounded-control bg-surface-sunken px-2.5 py-1 font-mono text-sm font-medium tracking-wide text-ink">
                      {activeBus.license_plate}
                    </span>
                  )}
                  <button
                    onClick={() => startEditBus(activeBus)}
                    className="shrink-0 rounded-control bg-brand-lighter px-3 py-1.5 text-sm font-semibold text-brand"
                  >
                    {t('staff.itineraryBuilder.edit')}
                  </button>
                </div>

                {/* กล่องคนขับ — เฉพาะ staff */}
                <div className="mt-3 rounded-control bg-warning-bg px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-warning-text">
                    <Icon name="lock" size={12} />
                    {t('staff.seatMap.driverBoxTitle')}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-ink">
                      {activeBus.driver_name || '—'}
                    </span>
                    {activeBus.driver_phone ? (
                      <a
                        href={`tel:${activeBus.driver_phone}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-surface px-3 py-1.5 text-sm font-semibold text-brand"
                      >
                        <Icon name="phone" size={13} />
                        {activeBus.driver_phone}
                      </a>
                    ) : (
                      <span className="shrink-0 text-sm text-ink-faint">—</span>
                    )}
                  </div>
                </div>
                {/* ปุ่มลบรถ */}
                <button
                  onClick={() => deleteBus(activeBus)}
                  className="mt-2 text-sm font-semibold text-danger"
                >
                  {t('staff.seatMap.deleteBus')}
                </button>
              </Card>
            )}

            {/* ฟอร์มแก้ไขข้อมูลรถบัส */}
            {mode === 'seats' && activeBus && editingBusId === activeBus.id && (
              <Card className="mt-3">
                <div className="flex flex-col gap-3">
                  <TextField
                    label={t('staff.seatMap.busName')}
                    required
                    value={busDraft.name}
                    onChange={(e) => setBusDraft((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <TextField
                      label={t('staff.seatMap.totalRows')}
                      type="number"
                      min={1}
                      value={busDraft.total_rows}
                      onChange={(e) => setBusDraft((prev) => ({ ...prev, total_rows: e.target.value }))}
                      className="flex-1"
                    />
                    <TextField
                      label={t('staff.seatMap.seatsPerRow')}
                      type="number"
                      min={1}
                      max={4}
                      value={busDraft.seats_per_row}
                      onChange={(e) => setBusDraft((prev) => ({ ...prev, seats_per_row: e.target.value }))}
                      className="flex-1"
                    />
                  </div>
                  <p className="-mt-1 text-xs text-gray-400">{t('staff.seatMap.resizeHint')}</p>
                  <TextField
                    label={t('staff.seatMap.licensePlate')}
                    value={busDraft.license_plate}
                    onChange={(e) => setBusDraft((prev) => ({ ...prev, license_plate: e.target.value }))}
                  />
                  <div className="rounded-xl bg-gray-50 p-2.5">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {t('staff.seatMap.driverSection')}
                    </p>
                    <div className="flex flex-col gap-2">
                      <TextField
                        label={t('staff.seatMap.driverName')}
                        value={busDraft.driver_name}
                        onChange={(e) => setBusDraft((prev) => ({ ...prev, driver_name: e.target.value }))}
                      />
                      <TextField
                        label={t('staff.seatMap.driverPhone')}
                        type="tel"
                        value={busDraft.driver_phone}
                        onChange={(e) => setBusDraft((prev) => ({ ...prev, driver_phone: e.target.value }))}
                      />
                    </div>
                  </div>
                  {editBusError && <p className="text-sm text-red-500">{editBusError}</p>}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => saveBusEdit(activeBus.id)}
                      disabled={savingBus || !busDraft.name.trim()}
                    >
                      {savingBus ? t('guest.register.submitting') : t('common.save')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setEditingBusId(null)}
                      disabled={savingBus}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {mode === 'seats' && activeBus && (
              <div className="mt-3 rounded-card border border-white/60 bg-surface p-4 shadow-card ring-1 ring-black/[0.02]">
                {/* คำอธิบายสี */}
                <div className="mb-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[11px] text-ink-muted">
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded bg-surface-sunken" /> {t('staff.seatMap.empty')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded bg-blue-500" />/
                    <span className="h-3 w-3 rounded bg-pink-500" /> {t('staff.seatMap.type_guest')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded bg-emerald-500" /> {t('staff.seatMap.type_staff')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded bg-amber-500" /> {t('staff.seatMap.type_vip')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-3 w-3 rounded bg-ink-faint/50" /> {t('staff.seatMap.blocked')}
                  </span>
                </div>

                {/* ตัวรถ */}
                <div className="overflow-hidden rounded-2xl border-[1.5px] border-black/10">
                  {/* หัวรถ */}
                  <div className="flex items-center justify-between border-b border-dashed border-black/10 bg-surface-muted px-3 py-2">
                    <span className="flex items-center gap-1 text-[11px] text-ink-faint">
                      <Icon name="door" size={14} /> {t('staff.seatMap.doorLabel')}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
                      {t('staff.seatMap.frontDriver')}
                      <Icon name="steering-wheel" size={16} color="#0e7490" />
                    </span>
                  </div>

                  {/* แถวที่นั่ง — ยาวถึงแถวสุดท้าย */}
                  <div className="flex flex-col gap-1.5 px-2 py-3">
                    {rows.map((rowNum) => (
                      <div key={rowNum} className="flex items-stretch gap-2">
                        <span className="flex w-5 shrink-0 items-center justify-center text-xs text-ink-faint">
                          {rowNum}
                        </span>
                        <div className="flex flex-1 gap-2">
                          <div className="flex flex-1 gap-1.5">
                            {leftPositions.map((pos) => {
                              const seat = seatsByPosition[`${rowNum}-${pos}`]
                              return (
                                <SeatButton
                                  key={pos}
                                  seat={seat}
                                  guest={guestById[seat?.guest_id]}
                                  onClick={() => seat && openSeat(seat)}
                                />
                              )
                            })}
                          </div>
                          {rightPositions.length > 0 && <div className="w-3 shrink-0" />}
                          <div className="flex flex-1 gap-1.5">
                            {rightPositions.map((pos) => {
                              const seat = seatsByPosition[`${rowNum}-${pos}`]
                              return (
                                <SeatButton
                                  key={pos}
                                  seat={seat}
                                  guest={guestById[seat?.guest_id]}
                                  onClick={() => seat && openSeat(seat)}
                                />
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ท้ายรถ */}
                  <div className="border-t border-dashed border-black/10 py-1.5 text-center text-[10px] uppercase tracking-wide text-ink-faint">
                    {t('staff.seatMap.rearLabel')}
                  </div>
                </div>

                <p className="mt-3 text-center text-[11px] text-ink-faint">{t('staff.seatMap.tapHint')}</p>
              </div>
            )}

            {mode === 'seats' && !activeBus && (
              <p className="mt-4 text-ink-muted">{t('staff.seatMap.noBus')}</p>
            )}
          </>
        )}
      </div>

      <BottomSheet
        open={!!selectedSeat}
        onClose={closeSheet}
        title={
          selectedSeat
            ? t('staff.seatMap.seatLabel', {
                row: selectedSeat.row_number,
                pos: selectedSeat.seat_position,
              })
            : ''
        }
      >
        {selectedSeat && !selectedSeat.is_seat && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">{t('staff.seatMap.blockedHint')}</p>
            <Button onClick={enableSeat} disabled={assigning}>
              {t('staff.seatMap.enableSeat')}
            </Button>
          </div>
        )}

        {selectedSeat?.is_seat && selectedSeat?.guest_id && (
          <>
            <div className="mb-3 flex items-center justify-between rounded-control bg-brand-lighter px-3 py-2">
              <span className={`font-medium ${genderTextClass(guestById[selectedSeat.guest_id]?.gender) || 'text-ink'}`}>
                {guestById[selectedSeat.guest_id]?.nickname || guestById[selectedSeat.guest_id]?.name}
              </span>
              <button
                onClick={clearSeat}
                disabled={assigning}
                className="text-sm font-semibold text-danger"
              >
                {t('staff.seatMap.removeGuest')}
              </button>
            </div>

            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t('staff.seatMap.seatType')}
            </p>
            <TypeSelector value={selectedSeat.seat_type || 'guest'} onChange={changeSeatType} t={t} />
          </>
        )}

        {selectedSeat?.is_seat && !selectedSeat?.guest_id && (
          <>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t('staff.seatMap.seatType')}
            </p>
            <TypeSelector value={assignType} onChange={setAssignType} t={t} />

            <input
              type="text"
              placeholder={t('staff.checkIn.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-3 w-full rounded-control border border-black/10 px-3 py-2.5 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-light"
            />

            <div className="mt-3 flex flex-col gap-1.5">
              {search.trim() && searchResults.length === 0 && (
                <p className="text-sm text-ink-faint">{t('staff.checkIn.noResults')}</p>
              )}
              {searchResults.map((g) => (
                <button
                  key={g.id}
                  onClick={() => assignGuest(g.id)}
                  disabled={assigning}
                  className="rounded-control border border-black/10 px-3 py-2.5 text-left hover:bg-surface-muted"
                >
                  <span className={`font-medium ${genderTextClass(g.gender) || 'text-ink'}`}>{g.nickname || g.name}</span>
                  {g.nickname && <span className="ml-1 text-sm text-ink-faint">{g.name}</span>}
                </button>
              ))}
            </div>

            <button
              onClick={disableSeat}
              disabled={assigning}
              className="mt-4 w-full rounded-control border border-dashed border-black/15 py-2 text-sm font-medium text-ink-muted hover:border-danger/40 hover:text-danger"
            >
              {t('staff.seatMap.disableSeat')}
            </button>
          </>
        )}
      </BottomSheet>

      {/* โหมดจับลงคัน: เลือกคันให้ลูกทัวร์ */}
      <BottomSheet
        open={!!selectedGuest}
        onClose={closeGuestSheet}
        title={selectedGuest ? selectedGuest.nickname || selectedGuest.name : ''}
      >
        {selectedGuest && (
          <div className="flex flex-col gap-3">
            {selectedGuest.nickname && (
              <p className="-mt-1 text-sm text-ink-muted">{selectedGuest.name}</p>
            )}

            {seatByGuestId[selectedGuest.id] && (
              <p className="rounded-control bg-warning-bg px-3 py-2 text-xs text-warning-text">
                {t('staff.seatMap.hasSeatWarning', {
                  seat: `${seatByGuestId[selectedGuest.id].row_number}${seatByGuestId[selectedGuest.id].seat_position}`,
                })}
              </p>
            )}

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t('staff.seatMap.chooseBus')}
              </p>
              <div className="flex flex-col gap-1.5">
                {buses.map((bus) => {
                  const current = selectedGuest.bus_id === bus.id
                  return (
                    <button
                      key={bus.id}
                      onClick={() => !current && assignGuestToBus(selectedGuest, bus.id)}
                      disabled={assigning || current}
                      className={`flex items-center justify-between gap-2 rounded-control border px-3 py-2.5 text-left text-sm font-semibold ${
                        current
                          ? 'border-brand bg-brand-lighter text-brand-hover'
                          : 'border-black/10 hover:bg-surface-muted'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="bus" size={17} />
                        {bus.name}
                      </span>
                      {current && <Icon name="check" size={16} />}
                    </button>
                  )
                })}
              </div>
            </div>

            {selectedGuest.bus_id && (
              <button
                onClick={() => removeGuestFromBus(selectedGuest)}
                disabled={assigning}
                className="text-sm font-semibold text-danger"
              >
                {t('staff.seatMap.removeFromBus')}
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

// ปุ่มเลือกประเภทที่นั่ง: ลูกทัวร์ / Staff / VIP
function TypeSelector({ value, onChange, t }) {
  return (
    <div className="flex gap-1.5">
      {SEAT_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => onChange(type)}
          className={`flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition ${
            value === type ? TYPE_ACTIVE_CLASS[type] : 'bg-surface-sunken text-ink-muted'
          }`}
        >
          {t(`staff.seatMap.type_${type}`)}
        </button>
      ))}
    </div>
  )
}

function SeatButton({ seat, guest, onClick }) {
  if (!seat) {
    return <div className="h-10 flex-1 rounded-lg bg-transparent" />
  }

  if (!seat.is_seat) {
    return (
      <button
        onClick={onClick}
        className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg bg-ink-faint/50 text-xs font-semibold text-white"
      >
        ×
      </button>
    )
  }

  const occupied = !!seat.guest_id
  const label = occupied ? guest?.nickname || guest?.name || '?' : seat.seat_position

  return (
    <button
      onClick={onClick}
      title={occupied ? guest?.name || '' : ''}
      className={`flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg px-1.5 text-xs font-semibold leading-tight ${
        occupied ? seatTypeBgClass(seat.seat_type, guest?.gender) : 'bg-surface-sunken text-ink-faint'
      }`}
    >
      <span className="w-full truncate text-center">{label}</span>
    </button>
  )
}
