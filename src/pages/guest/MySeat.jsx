import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { genderBgClass } from '../../lib/genderColor'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import Icon from '../../components/common/Icon'
import GuestNav from '../../components/common/GuestNav'

const CACHE_KEY = 'my_seat'

// สีพื้นของที่นั่งตามประเภท — เหมือนฝั่ง Staff: ลูกทัวร์ใช้สีตามเพศ, Staff เขียว, VIP เหลือง
function seatTypeBgClass(type, gender) {
  if (type === 'vip') return 'bg-amber-500 text-white'
  if (type === 'staff') return 'bg-emerald-500 text-white'
  return genderBgClass(gender)
}

export default function MySeat() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const guestId = getGuestId()

  const [bus, setBus] = useState(null)
  const [seats, setSeats] = useState([])
  const [guestsById, setGuestsById] = useState({})
  const [notAssigned, setNotAssigned] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadMySeat() {
      if (!guestId) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      // 1) หาที่นั่งของฉันก่อน — ไม่ระบุ tour_id ผ่าน bus เพราะ bus_seats มี tour_id ตรงอยู่แล้ว
      const { data: mySeatRow, error: mySeatError } = await supabase
        .from('bus_seats')
        .select('id, bus_id, row_number, seat_position')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('guest_id', guestId)
        .maybeSingle()

      if (!isMounted) return

      if (mySeatError || !mySeatRow) {
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setBus(cached.bus)
          setSeats(cached.seats)
          setGuestsById(cached.guestsById)
          setNotAssigned(false)
          setUsingCache(true)
        } else {
          setNotAssigned(true)
        }
        setLoading(false)
        return
      }

      // 2) โหลดข้อมูลรถ + ที่นั่งทั้งคัน + รายชื่อลูกทัวร์ที่นั่งอยู่ (สำหรับระบายสีตามเพศ)
      const [busRes, seatsRes] = await Promise.all([
        supabase
          .from('buses')
          .select('id, name, license_plate, total_rows, seats_per_row')
          .eq('id', mySeatRow.bus_id)
          .single(),
        supabase
          .from('bus_seats')
          .select('id, bus_id, row_number, seat_position, guest_id, is_available, is_seat, seat_type')
          .eq('bus_id', mySeatRow.bus_id),
      ])

      if (!isMounted) return

      if (busRes.error || !busRes.data || seatsRes.error) {
        setError(t('common.error'))
        setLoading(false)
        return
      }

      const seatRows = seatsRes.data ?? []
      const guestIds = [...new Set(seatRows.filter((s) => s.guest_id).map((s) => s.guest_id))]

      let nextGuestsById = {}
      if (guestIds.length > 0) {
        const { data: guestsData } = await supabase
          .from('guests')
          .select('id, name, nickname, gender')
          .in('id', guestIds)
        for (const g of guestsData ?? []) nextGuestsById[g.id] = g
      }

      setBus(busRes.data)
      setSeats(seatRows)
      setGuestsById(nextGuestsById)
      setNotAssigned(false)
      setUsingCache(false)
      saveCache(CACHE_KEY, { bus: busRes.data, seats: seatRows, guestsById: nextGuestsById })
      setLoading(false)
    }

    loadMySeat()

    const channel = supabase
      .channel(`my-seat-${guestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bus_seats', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadMySeat()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buses', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadMySeat()
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, t])

  const seatsByPosition = useMemo(() => {
    const map = {}
    for (const s of seats) map[`${s.row_number}-${s.seat_position}`] = s
    return map
  }, [seats])

  const rows = bus ? Array.from({ length: bus.total_rows }, (_, i) => i + 1) : []
  const seatPositions = bus ? ['A', 'B', 'C', 'D'].slice(0, bus.seats_per_row) : []
  const leftPositions = seatPositions.slice(0, Math.ceil(seatPositions.length / 2))
  const rightPositions = seatPositions.slice(Math.ceil(seatPositions.length / 2))

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <Icon name="seat" size={26} filled />
            {t('guest.mySeat.title')}
          </h1>

          {!guestId && (
            <Card className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-ink-muted">{t('guest.mySeat.notRegistered')}</p>
              <Button onClick={() => navigate('/')} fullWidth={false} className="px-6">
                {t('guest.mySeat.goRegister')}
              </Button>
            </Card>
          )}

          {guestId && usingCache && (
            <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {t('guest.mySeat.usingCache')}
            </p>
          )}

          {guestId && loading && <p className="text-ink-muted">{t('common.loading')}</p>}
          {guestId && !loading && error && <p className="text-danger">{error}</p>}

          {guestId && !loading && !error && notAssigned && (
            <Card className="py-8 text-center">
              <p className="text-sm text-ink-muted">{t('guest.mySeat.noSeatYet')}</p>
            </Card>
          )}

          {guestId && !loading && !error && !notAssigned && bus && (
            <>
              {/* ข้อมูลรถ — ไม่แสดงข้อมูลคนขับ (staff เท่านั้น) */}
              <Card className="mb-3">
                <p className="font-bold text-ink">{bus.name}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  <span className="text-ink-muted/70">{t('guest.mySeat.licensePlate')}: </span>
                  <span className="font-medium text-ink">{bus.license_plate || '—'}</span>
                </p>
              </Card>

              {/* คำอธิบายสี */}
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-muted">
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-gray-200" /> {t('guest.mySeat.legendEmpty')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-blue-500" /> /{' '}
                  <span className="h-3 w-3 rounded bg-pink-500" /> {t('guest.mySeat.legendGuest')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-emerald-500" /> {t('guest.mySeat.legendStaff')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-amber-500" /> {t('guest.mySeat.legendVip')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-gray-400" /> {t('guest.mySeat.legendBlocked')}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-brand ring-2 ring-brand ring-offset-1" /> {t('guest.mySeat.yourSeat')}
                </span>
              </div>

              {/* ผังที่นั่ง */}
              <div className="flex flex-col gap-1.5">
                {rows.map((rowNum) => (
                  <div key={rowNum} className="flex items-stretch gap-2">
                    <span className="flex w-5 shrink-0 items-center text-xs text-ink-muted">{rowNum}</span>
                    <div className="flex flex-1 gap-2">
                      <div className="flex flex-1 gap-1.5">
                        {leftPositions.map((pos) => {
                          const seat = seatsByPosition[`${rowNum}-${pos}`]
                          return (
                            <MySeatBox
                              key={pos}
                              seat={seat}
                              guest={guestsById[seat?.guest_id]}
                              isMine={!!seat && seat.guest_id === guestId}
                            />
                          )
                        })}
                      </div>
                      {rightPositions.length > 0 && <div className="w-3 shrink-0" />}
                      <div className="flex flex-1 gap-1.5">
                        {rightPositions.map((pos) => {
                          const seat = seatsByPosition[`${rowNum}-${pos}`]
                          return (
                            <MySeatBox
                              key={pos}
                              seat={seat}
                              guest={guestsById[seat?.guest_id]}
                              isMine={!!seat && seat.guest_id === guestId}
                            />
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <GuestNav active="mySeat" />
    </div>
  )
}

// กล่องที่นั่งแบบอ่านอย่างเดียว (ไม่กดได้) — ที่นั่งของฉันไฮไลต์ด้วยขอบ brand หนา + ไอคอนหมุด
function MySeatBox({ seat, guest, isMine }) {
  if (!seat) {
    return <div className="h-10 flex-1 rounded-lg bg-transparent" />
  }

  if (!seat.is_seat) {
    return (
      <div className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg bg-gray-400 text-xs font-semibold text-white">
        ×
      </div>
    )
  }

  const occupied = !!seat.guest_id
  const label = occupied ? guest?.nickname || guest?.name || '?' : seat.seat_position

  return (
    <div
      title={occupied ? guest?.name || '' : ''}
      className={`relative flex h-10 min-w-0 flex-1 items-center justify-center rounded-lg px-1.5 text-xs font-semibold leading-tight transition ${
        occupied ? seatTypeBgClass(seat.seat_type, guest?.gender) : 'bg-gray-200 text-gray-400'
      } ${isMine ? 'ring-[3px] ring-brand ring-offset-1 scale-[1.06]' : ''}`}
    >
      {isMine && (
        <span className="absolute -top-2 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[9px] text-white shadow-sm">
          <Icon name="location" size={10} color="#fff" />
        </span>
      )}
      <span className="w-full truncate text-center">{label}</span>
    </div>
  )
}
