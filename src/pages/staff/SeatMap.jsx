import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import BottomSheet from '../../components/common/BottomSheet'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import TextField from '../../components/common/TextField'

const NEW_BUS_TEMPLATE = { name: '', total_rows: 20, seats_per_row: 4 }

export default function SeatMap() {
  const { t } = useTranslation()

  const [buses, setBuses] = useState([])
  const [activeBusId, setActiveBusId] = useState(null)
  const [seats, setSeats] = useState([])
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [selectedSeat, setSelectedSeat] = useState(null) // seat row object
  const [search, setSearch] = useState('')
  const [assigning, setAssigning] = useState(false)

  const [showNewBusForm, setShowNewBusForm] = useState(false)
  const [newBus, setNewBus] = useState(NEW_BUS_TEMPLATE)
  const [creatingBus, setCreatingBus] = useState(false)
  const [createBusError, setCreateBusError] = useState(null)

  async function loadAll() {
    setLoading(true)
    setError(null)

    const [busesRes, seatsRes, guestsRes] = await Promise.all([
      supabase.from('buses').select('id, name, total_rows, seats_per_row').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
      supabase
        .from('bus_seats')
        .select('id, bus_id, row_number, seat_position, guest_id, is_available, is_seat')
        .eq('tour_id', ACTIVE_TOUR_ID),
      supabase.from('guests').select('id, name, nickname').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
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

  function openSeat(seat) {
    setSelectedSeat(seat)
    setSearch('')
  }

  function closeSheet() {
    setSelectedSeat(null)
    setSearch('')
  }

  async function assignGuest(guestId) {
    if (!selectedSeat) return
    setAssigning(true)

    const patch = { guest_id: guestId, is_available: false }
    setSeats((prev) => prev.map((s) => (s.id === selectedSeat.id ? { ...s, ...patch } : s)))

    const { error: updateError } = await supabase
      .from('bus_seats')
      .update(patch)
      .eq('id', selectedSeat.id)

    if (updateError) {
      console.error('[SeatMap] assign failed', updateError)
      loadAll()
    }
    setAssigning(false)
    closeSheet()
  }

  async function clearSeat() {
    if (!selectedSeat) return
    setAssigning(true)

    const patch = { guest_id: null, is_available: true }
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

    const patch = { is_seat: false, guest_id: null, is_available: true }
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
    setActiveBusId((prev) => (prev === bus.id ? null : prev))
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
    loadAll()
  }

  const rows = activeBus ? Array.from({ length: activeBus.total_rows }, (_, i) => i + 1) : []
  const seatPositions = activeBus
    ? ['A', 'B', 'C', 'D'].slice(0, activeBus.seats_per_row)
    : ['A', 'B', 'C', 'D']
  const leftPositions = seatPositions.slice(0, Math.ceil(seatPositions.length / 2))
  const rightPositions = seatPositions.slice(Math.ceil(seatPositions.length / 2))

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="mb-1 text-xl font-bold text-gray-900">{t('staff.seatMap.title')}</h1>

        {loading && <p className="text-gray-500">{t('common.loading')}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && (
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              {buses.map((bus) => (
                <div key={bus.id} className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveBusId(bus.id)}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      activeBusId === bus.id ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {bus.name}
                  </button>
                  <button
                    onClick={() => deleteBus(bus)}
                    className="text-sm text-red-400 hover:text-red-600"
                    aria-label={t('staff.seatMap.deleteBus')}
                    title={t('staff.seatMap.deleteBus')}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => setShowNewBusForm((v) => !v)}
                className="rounded-full border border-dashed border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-500 hover:border-sky-400 hover:text-sky-600"
              >
                + {t('staff.seatMap.addBus')}
              </button>
            </div>

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

            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-gray-200" /> {t('staff.seatMap.empty')}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-sky-500" /> {t('staff.seatMap.occupied')}
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded bg-gray-400" /> {t('staff.seatMap.blocked')}
              </span>
            </div>

            {activeBus && (
              <div className="mt-4 flex flex-col gap-1.5">
                {rows.map((rowNum) => (
                  <div key={rowNum} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-xs text-gray-400">{rowNum}</span>
                    <div className="flex flex-1 justify-between gap-2">
                      <div className="flex gap-1.5">
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
                      {rightPositions.length > 0 && <div className="w-4" />}
                      <div className="flex gap-1.5">
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
            )}

            {!activeBus && (
              <p className="mt-4 text-gray-500">{t('staff.seatMap.noBus')}</p>
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
            <p className="text-sm text-gray-500">{t('staff.seatMap.blockedHint')}</p>
            <Button onClick={enableSeat} disabled={assigning}>
              {t('staff.seatMap.enableSeat')}
            </Button>
          </div>
        )}

        {selectedSeat?.is_seat && selectedSeat?.guest_id && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-sky-50 px-3 py-2">
            <span className="font-medium text-gray-900">
              {guestById[selectedSeat.guest_id]?.nickname || guestById[selectedSeat.guest_id]?.name}
            </span>
            <button
              onClick={clearSeat}
              disabled={assigning}
              className="text-sm font-medium text-red-500"
            >
              {t('staff.seatMap.removeGuest')}
            </button>
          </div>
        )}

        {selectedSeat?.is_seat && !selectedSeat?.guest_id && (
          <>
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
                  onClick={() => assignGuest(g.id)}
                  disabled={assigning}
                  className="rounded-xl border border-gray-200 px-3 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">{g.nickname || g.name}</span>
                  {g.nickname && <span className="ml-1 text-sm text-gray-400">{g.name}</span>}
                </button>
              ))}
            </div>

            <button
              onClick={disableSeat}
              disabled={assigning}
              className="mt-4 w-full rounded-xl border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-500 hover:border-red-300 hover:text-red-500"
            >
              {t('staff.seatMap.disableSeat')}
            </button>
          </>
        )}
      </BottomSheet>
    </div>
  )
}

function SeatButton({ seat, guest, onClick }) {
  if (!seat) {
    return <div className="h-10 w-10 rounded-lg bg-transparent" />
  }

  if (!seat.is_seat) {
    return (
      <button
        onClick={onClick}
        className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-400 text-xs font-semibold text-white"
      >
        ×
      </button>
    )
  }

  const occupied = !!seat.guest_id
  const label = occupied ? (guest?.nickname || guest?.name || '?').slice(0, 2) : ''

  return (
    <button
      onClick={onClick}
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-xs font-semibold ${
        occupied ? 'bg-sky-500 text-white' : 'bg-gray-200 text-gray-400'
      }`}
    >
      {occupied ? label : seat.seat_position}
    </button>
  )
}
