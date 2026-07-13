import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import AnnouncementBanner from './AnnouncementBanner'
import BottomSheet from './BottomSheet'
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
  const [articlesByItem, setArticlesByItem] = useState({}) // itinerary_item_id -> guide article
  const [openArticle, setOpenArticle] = useState(null)

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

    // คู่มือที่ผูกกับจุดในแผนการเดินทาง (เฉพาะที่เผยแพร่แล้ว) — ทำ map itinerary_item_id -> บทความ
    async function loadGuideArticles() {
      const { data } = await supabase
        .from('guide_articles')
        .select('id, category, title, body, source_url, image_url, itinerary_item_id')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .eq('is_published', true)
        .not('itinerary_item_id', 'is', null)
      const map = {}
      for (const a of data ?? []) map[a.itinerary_item_id] = a
      if (isMounted) setArticlesByItem(map)
    }

    loadStatus()
    loadRoom()
    loadSeat()
    loadItinerary()
    loadGuideArticles()

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

  // รายการที่จะโชว์ในการ์ด: ถ้ามี current ให้เอา current + ถัดไปอีก 2, ไม่งั้นเอา upcoming 3 แรก
  const scheduleItems = useMemo(() => {
    const curIdx = items.findIndex((it) => it.status === 'current')
    if (curIdx !== -1) {
      const nexts = items
        .slice(curIdx + 1)
        .filter((it) => it.status !== 'completed')
        .slice(0, 2)
      return [
        { item: items[curIdx], isCurrent: true },
        ...nexts.map((item) => ({ item, isCurrent: false })),
      ]
    }
    const upcoming = items.filter((it) => it.status === 'upcoming').slice(0, 3)
    return upcoming.map((item) => ({ item, isCurrent: false }))
  }, [items])

  // ชื่อกิจกรรม — ถ้าจุดนั้นมีคู่มือผูกอยู่ ทำให้กดได้ + ไอคอนหนังสือท้ายชื่อ
  function renderTitle(item, className) {
    const article = articlesByItem[item.id]
    if (!article) return <p className={className}>{item.title}</p>
    return (
      <button
        onClick={() => setOpenArticle(article)}
        className={`inline-flex items-center gap-1 text-left ${className}`}
      >
        <span className="underline decoration-brand/40 underline-offset-2">{item.title}</span>
        <Icon name="book" size={14} color="#0e7490" />
      </button>
    )
  }

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

      {/* การ์ดกำหนดการวันนี้ — ไทม์ไลน์ ไฮไลท์รายการปัจจุบัน */}
      {scheduleItems.length > 0 && (
        <div className="mt-4 rounded-card border border-white/60 bg-surface p-4 shadow-card ring-1 ring-black/[0.02]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">{t('guest.home.todaySchedule')}</span>
            <button
              onClick={() => navigate('/itinerary')}
              className="text-xs font-semibold text-brand"
            >
              {t('guest.home.viewAll')} ›
            </button>
          </div>

          {scheduleItems.map(({ item, isCurrent }, i) => {
            const isLast = i === scheduleItems.length - 1
            return (
              <div key={item.id} className="flex gap-2.5">
                <span
                  className={`w-11 shrink-0 text-right text-sm ${
                    isCurrent ? 'pt-[9px] font-semibold text-success' : 'pt-0.5 text-ink-muted'
                  }`}
                >
                  {formatTime(item.scheduled_time)}
                </span>

                <div className="relative flex w-4 shrink-0 justify-center">
                  <span
                    className={`absolute w-0.5 bg-ink-faint/25 ${
                      isCurrent ? 'bottom-0 top-[18px]' : isLast ? 'top-0 h-[9px]' : 'inset-y-0'
                    }`}
                  />
                  <span
                    className={`relative z-10 rounded-full ${
                      isCurrent
                        ? 'mt-[11px] h-[15px] w-[15px] bg-success ring-4 ring-success-bg'
                        : 'mt-1 h-[11px] w-[11px] border-2 border-ink-faint bg-white'
                    }`}
                  />
                </div>

                <div className={`min-w-0 flex-1 ${isCurrent ? 'pb-4' : 'pb-3.5'}`}>
                  {isCurrent ? (
                    <div className="rounded-control border border-l-[3px] border-success/30 border-l-success bg-success-bg/50 p-3">
                      {renderTitle(item, 'text-[17px] font-semibold text-ink')}
                      {item.location_name && (
                        <p className="mt-0.5 text-xs text-ink-muted">{item.location_name}</p>
                      )}
                    </div>
                  ) : (
                    <>
                      {renderTitle(item, 'text-sm font-semibold text-ink')}
                      {item.location_name && (
                        <p className="mt-0.5 text-[11px] text-ink-faint">{item.location_name}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ห้องพัก + ที่นั่ง — การ์ดกะทัดรัด */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate('/my-room')}
          className="rounded-control border-[1.5px] border-brand-light bg-surface p-3 text-left shadow-card transition active:scale-[0.98]"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-brand-lighter text-brand-hover">
              <Icon name="bed" size={17} />
            </span>
            <span className="text-xs text-ink-muted">{t('guest.home.roomLabel')}</span>
          </div>
          {stay ? (
            <>
              <p className="mt-1.5 text-[22px] font-bold leading-none text-ink">{stay.roomNumber}</p>
              <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                {stay.floor != null ? t('guest.home.floorLabel', { floor: stay.floor }) : stay.hotelName}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-ink-faint">{t('guest.home.noRoom')}</p>
          )}
        </button>

        <button
          onClick={() => navigate('/my-seat')}
          className="rounded-control border-[1.5px] border-brand-light bg-surface p-3 text-left shadow-card transition active:scale-[0.98]"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-brand-lighter text-brand-hover">
              <Icon name="seat" size={17} />
            </span>
            <span className="text-xs text-ink-muted">{t('guest.home.seatLabel')}</span>
          </div>
          {seat ? (
            <>
              <p className="mt-1.5 text-[22px] font-bold leading-none text-ink">{seat.label}</p>
              {seat.busName && <p className="mt-0.5 truncate text-[11px] text-ink-faint">{seat.busName}</p>}
            </>
          ) : (
            <p className="mt-1.5 text-sm text-ink-faint">{t('guest.home.noSeat')}</p>
          )}
        </button>
      </div>

      {/* เมนูลัด (QR ย้ายไปปุ่มกลางแถบล่างแล้ว) */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <NavTile icon="book" label={t('guest.nav.tripGuide')} onClick={() => navigate('/trip-guide')} />
        <NavTile icon="target" label={t('guest.nav.bingo')} onClick={() => navigate('/bingo')} />
        <NavTile icon="location" label={t('guest.nav.shareLocation')} onClick={() => navigate('/share-location')} />
        <NavTile icon="alert" label={t('guest.nav.sos')} onClick={() => navigate('/sos')} danger />
      </div>

      {/* คู่มือสถานที่ — เด้งขึ้นเมื่อกดชื่อกิจกรรมที่มีคู่มือ */}
      <BottomSheet open={!!openArticle} onClose={() => setOpenArticle(null)} title={openArticle?.title}>
        {openArticle && (
          <div>
            {openArticle.image_url && (
              <img
                src={openArticle.image_url}
                alt={openArticle.title}
                className="mb-3 h-44 w-full rounded-xl object-cover"
              />
            )}
            {openArticle.source_url && (
              <a
                href={openArticle.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1.5 text-sm font-semibold text-brand-deep underline"
              >
                🔗 {t('guest.tripGuide.sourceLink')}
              </a>
            )}
            {openArticle.body && (
              <div className="max-w-none text-ink [&_a]:text-brand [&_a]:underline [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_li]:mb-1 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5">
                <ReactMarkdown>{openArticle.body}</ReactMarkdown>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  )
}

function NavTile({ icon, label, onClick, danger = false }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5">
      <span
        className={`flex h-[46px] w-[46px] items-center justify-center rounded-[14px] ${
          danger ? 'bg-danger-bg text-danger' : 'bg-brand-lighter text-brand-hover'
        }`}
      >
        <Icon name={icon} size={22} interactive />
      </span>
      <span className="text-[10px] font-medium text-ink-muted">{label}</span>
    </button>
  )
}
