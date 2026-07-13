import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import AnnouncementBanner from './AnnouncementBanner'
import Icon from './Icon'

function formatTime(dbTime) {
  return dbTime ? dbTime.slice(0, 5) : ''
}

function greetingKey() {
  const h = new Date().getHours()
  if (h < 12) return 'greetingMorning'
  if (h < 17) return 'greetingAfternoon'
  return 'greetingEvening'
}

// เลือกห้องที่ตรงกับช่วงวันเข้าพักปัจจุบัน ไม่งั้นใช้ห้องแรกสุด
function pickStay(stays) {
  if (stays.length === 0) return null
  const today = new Date().toISOString().slice(0, 10)
  const active = stays.find(
    (s) => s.checkIn && s.checkOut && s.checkIn <= today && today <= s.checkOut
  )
  if (active) return active
  const upcoming = stays
    .filter((s) => s.checkIn && s.checkIn >= today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]
  return upcoming ?? stays[0]
}

export default function GuestHome({ guest, isNew = false }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const displayName = guest?.nickname || guest?.name || t('guest.home.traveler')

  const [checkedIn, setCheckedIn] = useState(!!guest?.check_in_status)
  const [stay, setStay] = useState(null) // { roomNumber, floor, hotelName }
  const [seat, setSeat] = useState(null) // { label, busName }
  const [items, setItems] = useState([])

  useEffect(() => {
    const guestId = guest?.id
    if (!guestId) return
    let isMounted = true

    async function loadRoom() {
      const { data: assigns } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('guest_id', guestId)
      if (!assigns || assigns.length === 0) return

      const roomIds = [...new Set(assigns.map((a) => a.room_id))]
      const { data: rooms } = await supabase
        .from('hotel_rooms')
        .select('id, room_number, floor, hotel_id')
        .in('id', roomIds)
      if (!rooms || rooms.length === 0) return

      const hotelIds = [...new Set(rooms.map((r) => r.hotel_id).filter(Boolean))]
      let hotelsById = {}
      if (hotelIds.length > 0) {
        const { data: hotels } = await supabase
          .from('hotels')
          .select('id, name, check_in_date, check_out_date')
          .in('id', hotelIds)
        for (const h of hotels ?? []) hotelsById[h.id] = h
      }

      const stays = rooms.map((r) => ({
        roomNumber: r.room_number,
        floor: r.floor,
        hotelName: hotelsById[r.hotel_id]?.name ?? '',
        checkIn: hotelsById[r.hotel_id]?.check_in_date ?? '',
        checkOut: hotelsById[r.hotel_id]?.check_out_date ?? '',
      }))
      if (isMounted) setStay(pickStay(stays))
    }

    async function loadSeat() {
      const { data: seatRows } = await supabase
        .from('bus_seats')
        .select('row_number, seat_position, bus_id')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('guest_id', guestId)
        .limit(1)
      const mySeat = seatRows?.[0]
      if (!mySeat) return

      let busName = ''
      if (mySeat.bus_id) {
        const { data: bus } = await supabase
          .from('buses')
          .select('name')
          .eq('id', mySeat.bus_id)
          .maybeSingle()
        busName = bus?.name ?? ''
      }
      if (isMounted) {
        setSeat({ label: `${mySeat.row_number}${mySeat.seat_position}`, busName })
      }
    }

    async function loadStatus() {
      const { data } = await supabase
        .from('guests')
        .select('check_in_status')
        .eq('id', guestId)
        .maybeSingle()
      if (isMounted && data) setCheckedIn(!!data.check_in_status)
    }

    async function loadItinerary() {
      const { data } = await supabase
        .from('itinerary_items')
        .select('id, day_number, sort_order, scheduled_time, title, location_name, status')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('day_number', { ascending: true })
        .order('sort_order', { ascending: true })
      if (isMounted) setItems(data ?? [])
    }

    loadStatus()
    loadRoom()
    loadSeat()
    loadItinerary()

    const channel = supabase
      .channel(`guest-home-${guestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_items', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadItinerary()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'guests', filter: `id=eq.${guestId}` },
        (payload) => setCheckedIn(!!payload.new.check_in_status)
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [guest?.id])

  const { currentItem, nextItem } = useMemo(() => {
    const curIdx = items.findIndex((it) => it.status === 'current')
    if (curIdx !== -1) {
      const next = items.slice(curIdx + 1).find((it) => it.status !== 'completed')
      return { currentItem: items[curIdx], nextItem: next ?? null }
    }
    const upcoming = items.find((it) => it.status === 'upcoming')
    return { currentItem: null, nextItem: upcoming ?? null }
  }, [items])

  const heroItem = currentItem || nextItem

  return (
    <>
      {/* Hero ต้อนรับ + สถานะเช็คอิน */}
      <div className="mt-2 overflow-hidden rounded-card bg-brand-gradient p-5 text-white shadow-brand">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-2xl">
            {isNew ? '🎉' : '👋'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/80">
              {isNew ? t('guest.register.successTitle') : t(`guest.home.${greetingKey()}`)}
            </p>
            <h1 className="truncate text-2xl font-extrabold">{displayName}</h1>
          </div>
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-semibold ${
              checkedIn ? 'bg-white/25 text-white' : 'bg-white/10 text-white/80'
            }`}
          >
            <Icon name="check" size={14} filled={checkedIn} />
            {checkedIn ? t('guest.home.checkedIn') : t('guest.home.notCheckedIn')}
          </span>
        </div>
        <p className="mt-3 text-sm text-white/85">
          {isNew ? t('guest.register.successBody') : t('guest.home.subtitle')}
        </p>
      </div>

      {/* ประกาศด่วน — อยู่เหนือกำหนดการ */}
      <AnnouncementBanner variant="box" />

      {/* การ์ด ตอนนี้ / ถัดไป — sync จาก itinerary status */}
      {heroItem && (
        <button
          onClick={() => navigate('/itinerary')}
          className="mt-4 w-full rounded-card border-2 border-brand bg-surface p-4 text-left shadow-card transition active:scale-[0.99]"
        >
          <div className="flex items-center justify-between">
            <span
              className={`flex items-center gap-1.5 text-xs font-semibold ${
                currentItem ? 'text-accent-text' : 'text-brand'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${currentItem ? 'bg-accent' : 'bg-brand'}`}
              />
              {currentItem ? t('guest.home.nowLabel') : t('guest.home.nextLabel')}
            </span>
            {heroItem.scheduled_time && (
              <span className="text-xs text-ink-muted">{formatTime(heroItem.scheduled_time)}</span>
            )}
          </div>
          <p className="mt-1 truncate text-lg font-bold text-ink">{heroItem.title}</p>
          {heroItem.location_name && (
            <p className="truncate text-sm text-ink-faint">{heroItem.location_name}</p>
          )}
          {currentItem && nextItem && (
            <div className="mt-2 flex items-center gap-1.5 border-t border-ink-faint/15 pt-2 text-sm text-ink-muted">
              <Icon name="compass" size={15} />
              <span className="truncate">
                {t('guest.home.nextLabel')} {formatTime(nextItem.scheduled_time)} · {nextItem.title}
                {nextItem.location_name && (
                  <span className="text-ink-faint"> · {nextItem.location_name}</span>
                )}
              </span>
            </div>
          )}
        </button>
      )}

      {/* ข้อมูลส่วนตัวเห็นเร็ว — ห้องพัก + ที่นั่ง */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate('/my-room')}
          className="rounded-card border-2 border-brand bg-surface p-4 text-left shadow-card transition active:scale-[0.98]"
        >
          <div className="flex items-center gap-1.5 text-ink-muted">
            <Icon name="bed" size={16} />
            <span className="text-xs font-medium">{t('guest.home.roomLabel')}</span>
          </div>
          {stay ? (
            <>
              <p className="mt-1 text-2xl font-extrabold text-ink">{stay.roomNumber}</p>
              <p className="truncate text-xs text-ink-faint">
                {stay.floor != null ? t('guest.home.floorLabel', { floor: stay.floor }) : stay.hotelName}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-faint">{t('guest.home.noRoom')}</p>
          )}
        </button>

        <button
          onClick={() => navigate('/my-seat')}
          className="rounded-card border-2 border-brand bg-surface p-4 text-left shadow-card transition active:scale-[0.98]"
        >
          <div className="flex items-center gap-1.5 text-ink-muted">
            <Icon name="seat" size={16} />
            <span className="text-xs font-medium">{t('guest.home.seatLabel')}</span>
          </div>
          {seat ? (
            <>
              <p className="mt-1 text-2xl font-extrabold text-ink">{seat.label}</p>
              {seat.busName && <p className="truncate text-xs text-ink-faint">{seat.busName}</p>}
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-faint">{t('guest.home.noSeat')}</p>
          )}
        </button>
      </div>

      {/* QR หลัก */}
      <button
        onClick={() => navigate('/my-qr')}
        className="mt-3 flex w-full items-center gap-4 rounded-card border border-white/60 bg-surface p-4 text-left shadow-card ring-1 ring-black/[0.02] transition active:scale-[0.99]"
      >
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-hover">
          <Icon name="ticket" size={26} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink">{t('guest.nav.myQr')}</p>
          <p className="truncate text-sm text-ink-muted">{t('guest.home.qrSubtitle')}</p>
        </div>
        <span className="text-lg text-ink-muted" aria-hidden="true">›</span>
      </button>

      {/* เมนูลัด */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <HubTile icon="map" label={t('guest.nav.itinerary')} onClick={() => navigate('/itinerary')} />
        <HubTile icon="book" label={t('guest.nav.tripGuide')} onClick={() => navigate('/trip-guide')} />
        <HubTile icon="target" label={t('guest.nav.bingo')} onClick={() => navigate('/bingo')} />
        <HubTile icon="star" label={t('guest.feedback.title')} onClick={() => navigate('/feedback')} />
        <HubTile icon="location" label={t('guest.nav.shareLocation')} onClick={() => navigate('/share-location')} />
        <HubTile icon="alert" label={t('guest.nav.sos')} onClick={() => navigate('/sos')} danger />
      </div>
    </>
  )
}

function HubTile({ icon, label, onClick, danger = false }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-card border border-white/60 bg-surface p-4 text-left shadow-card ring-1 ring-black/[0.02] transition active:scale-[0.98]"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
          danger ? 'bg-danger-bg text-danger' : 'bg-brand-light text-brand-hover'
        }`}
      >
        <Icon name={icon} size={24} interactive />
      </span>
      <span className="text-sm font-bold text-ink">{label}</span>
    </button>
  )
}
