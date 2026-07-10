import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { genderTextClass } from '../../lib/genderColor'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import GuestNav from '../../components/common/GuestNav'

const ROOM_TYPE_LABELS = {
  single: 'roomTypeSingle',
  twin: 'roomTypeTwin',
  double: 'roomTypeDouble',
  triple: 'roomTypeTriple',
}

const CACHE_KEY = 'my_room'

export default function MyRoom() {
  const { t } = useTranslation()
  const guestId = getGuestId()

  // ลูกทัวร์คนเดียวสามารถมีห้องพักได้หลายห้อง (คนละโรงแรม/คนละคืน) — เก็บเป็น array ของ "stays"
  // แต่ละ stay คือ { room, hotel, roommates } หนึ่งชุด
  const [stays, setStays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)
  // ที่พักแต่ละคืน (แต่ละ stay) ย่อ/ขยายตามวันที่ได้ — เก็บเฉพาะห้องที่ถูก"ย่อ"
  const [collapsedStays, setCollapsedStays] = useState({})

  const toggleStay = (id) =>
    setCollapsedStays((prev) => ({ ...prev, [id]: !prev[id] }))

  useEffect(() => {
    let isMounted = true

    async function loadMyRoom() {
      setLoading(true)
      setError(null)

      if (!guestId) {
        setLoading(false)
        return
      }

      // 1) หา room_id ทั้งหมดของฉันจาก room_assignments — แก้บั๊ก "ห้องที่สองไม่แสดง"
      // เดิมใช้ .maybeSingle() ซึ่งจะ error ทันทีถ้ามีมากกว่า 1 แถว (คนเดียวอยู่ได้หลายห้อง/หลายโรงแรม
      // ตามการแก้ไขฝั่ง staff ก่อนหน้านี้) ทำให้ query ล้มเหลวไปเข้าโหมด fallback/แคชเงียบๆ
      const { data: myAssignments, error: assignError } = await supabase
        .from('room_assignments')
        .select('room_id')
        .eq('guest_id', guestId)

      if (!isMounted) return

      if (assignError || !myAssignments || myAssignments.length === 0) {
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setStays(cached)
          setUsingCache(true)
        }
        setLoading(false)
        return
      }

      const roomIds = [...new Set(myAssignments.map((a) => a.room_id))]

      // 2) โหลดข้อมูลห้องทั้งหมด + โรงแรมที่เกี่ยวข้อง + เพื่อนร่วมห้องของทุกห้อง
      const [roomsRes, allAssignmentsRes] = await Promise.all([
        supabase
          .from('hotel_rooms')
          .select('id, room_number, floor, room_type, max_guests, hotel_id')
          .in('id', roomIds),
        supabase
          .from('room_assignments')
          .select('room_id, guest_id, guests(id, name, nickname, gender)')
          .in('room_id', roomIds),
      ])

      if (!isMounted) return

      if (roomsRes.error || !roomsRes.data) {
        setError(t('common.error'))
        setLoading(false)
        return
      }

      const hotelIds = [...new Set(roomsRes.data.map((r) => r.hotel_id).filter(Boolean))]
      let hotelsById = {}
      if (hotelIds.length > 0) {
        const { data: hotelsData } = await supabase
          .from('hotels')
          .select('id, name, check_in_date, check_out_date, general_info, wifi_name, wifi_password, breakfast_time, breakfast_location, checkout_time')
          .in('id', hotelIds)
        for (const h of hotelsData ?? []) hotelsById[h.id] = h
      }

      const assignmentsByRoom = {}
      for (const a of allAssignmentsRes.data ?? []) {
        if (!assignmentsByRoom[a.room_id]) assignmentsByRoom[a.room_id] = []
        assignmentsByRoom[a.room_id].push(a)
      }

      const nextStays = roomsRes.data
        .map((room) => ({
          room,
          hotel: room.hotel_id ? (hotelsById[room.hotel_id] ?? null) : null,
          roommates: (assignmentsByRoom[room.id] ?? [])
            .filter((a) => a.guest_id !== guestId)
            .map((a) => a.guests)
            .filter(Boolean),
        }))
        // เรียงตามวันเข้าพักก่อน-หลัง ให้ลูกทัวร์เห็นลำดับทริปถูกต้อง
        .sort((a, b) => {
          const dateA = a.hotel?.check_in_date ?? ''
          const dateB = b.hotel?.check_in_date ?? ''
          return dateA.localeCompare(dateB)
        })

      setStays(nextStays)
      setUsingCache(false)
      saveCache(CACHE_KEY, nextStays)
      setLoading(false)
    }

    loadMyRoom()

    const channel = supabase
      .channel(`my-room-${guestId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_assignments' },
        () => loadMyRoom()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotel_rooms' },
        () => loadMyRoom()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'hotels' },
        () => loadMyRoom()
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, t])

  return (
    <div className="min-h-screen">
      <AnnouncementBanner />
      <div className="p-4 pb-28">
        <div className="mx-auto max-w-md">
          <h1 className="mb-4 flex items-center gap-2 text-2xl font-extrabold text-ink">
            <span aria-hidden="true">🛏️</span>{t('guest.myRoom.title')}
          </h1>

          <GuestNav active="myRoom" />

          {usingCache && (
            <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
              {t('guest.itinerary.usingCache')}
            </p>
          )}

          {loading && <p className="text-gray-500">{t('common.loading')}</p>}
          {error && <p className="text-red-500">{error}</p>}

          {!loading && !error && stays.length === 0 && (
            <p className="text-gray-500">{t('guest.myRoom.noRoom')}</p>
          )}

          {!loading && !error && stays.length > 0 && (
            <div className="flex flex-col gap-3">
              {stays.map(({ room, hotel, roommates }, index) => {
                const isCollapsed = !!collapsedStays[room.id]
                const title = hotel?.name || t('guest.myRoom.roomNumber', { number: room.room_number || '—' })
                return (
                  <div
                    key={room.id}
                    className="overflow-hidden rounded-card border border-white/60 bg-surface shadow-card ring-1 ring-black/[0.02]"
                  >
                    {/* หัวข้อกดย่อ/ขยายได้ตามวันที่/ที่พัก */}
                    <button
                      type="button"
                      onClick={() => toggleStay(room.id)}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-3 p-3 text-left"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-lg font-bold text-sky-700">
                        {room.room_number || '—'}
                      </div>
                      <div className="min-w-0 flex-1">
                        {stays.length > 1 && (
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                            {t('guest.myRoom.stayNumber', { number: index + 1 })}
                          </p>
                        )}
                        <p className="truncate font-bold text-gray-900">{title}</p>
                        {(hotel?.check_in_date || hotel?.check_out_date) && (
                          <p className="mt-0.5 truncate text-xs text-gray-500">
                            {hotel.check_in_date || '—'} → {hotel.check_out_date || '—'}
                          </p>
                        )}
                      </div>
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {!isCollapsed && (
                      <div className="border-t border-gray-100 px-3 pb-3 pt-3">
                        {/* ข้อมูลห้อง */}
                        <p className="text-sm text-gray-500">
                          {t('guest.myRoom.floorLabel', { floor: room.floor || '—' })}
                          {' · '}
                          {t(`guest.myRoom.${ROOM_TYPE_LABELS[room.room_type] ?? 'roomTypeTwin'}`)}
                        </p>

                        {/* เพื่อนร่วมห้อง */}
                        <div className="mt-3">
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                            {t('guest.myRoom.roommates')}
                          </p>
                          {roommates.length === 0 ? (
                            <p className="text-sm text-gray-400">{t('guest.myRoom.noRoommates')}</p>
                          ) : (
                            <div className="flex flex-wrap gap-x-3 gap-y-1">
                              {roommates.map((g) => (
                                <p key={g.id} className={`text-sm font-medium ${genderTextClass(g.gender) || 'text-gray-800'}`}>
                                  {g.nickname || g.name}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ข้อมูลโรงแรมแบบจัดเป็นสัดส่วน */}
                        {hotel && <HotelInfo hotel={hotel} t={t} />}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// กล่องข้อมูลย่อยแบบมีไอคอน + หัวข้อ ให้อ่านง่ายเป็นสัดส่วน
function InfoBlock({ icon, label, children }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-surface-sunken px-3 py-2.5">
      <span aria-hidden="true" className="text-base leading-5">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <div className="mt-0.5 space-y-0.5">{children}</div>
      </div>
    </div>
  )
}

function InfoLine({ label, value, mono = false }) {
  return (
    <p className="text-sm text-gray-700">
      {label && <span className="text-gray-400">{label}: </span>}
      <span className={`font-medium text-gray-900 ${mono ? 'select-all font-mono tracking-wide' : ''}`}>
        {value}
      </span>
    </p>
  )
}

// แสดงข้อมูลโรงแรมแบบจัดหัวข้อ: WIFI / อาหารเช้า / Check-out / หมายเหตุเพิ่มเติม
function HotelInfo({ hotel, t }) {
  const hasWifi = hotel.wifi_name || hotel.wifi_password
  const hasBreakfast = hotel.breakfast_time || hotel.breakfast_location
  const hasCheckout = !!hotel.checkout_time
  const hasNotes = !!hotel.general_info
  const hasAny = hasWifi || hasBreakfast || hasCheckout || hasNotes

  if (!hasAny) return null

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('guest.myRoom.hotelInfo')}
      </p>
      <div className="flex flex-col gap-2">
        {hasWifi && (
          <InfoBlock icon="📶" label={t('guest.myRoom.wifi')}>
            {hotel.wifi_name && <InfoLine label={t('guest.myRoom.wifiName')} value={hotel.wifi_name} />}
            {hotel.wifi_password && (
              <InfoLine label={t('guest.myRoom.wifiPassword')} value={hotel.wifi_password} mono />
            )}
          </InfoBlock>
        )}

        {hasBreakfast && (
          <InfoBlock icon="🍳" label={t('guest.myRoom.breakfast')}>
            {hotel.breakfast_time && (
              <InfoLine label={t('guest.myRoom.time')} value={hotel.breakfast_time} />
            )}
            {hotel.breakfast_location && (
              <InfoLine label={t('guest.myRoom.location')} value={hotel.breakfast_location} />
            )}
          </InfoBlock>
        )}

        {hasCheckout && (
          <InfoBlock icon="🚪" label={t('guest.myRoom.checkout')}>
            <InfoLine value={hotel.checkout_time} />
          </InfoBlock>
        )}

        {hasNotes && (
          <InfoBlock icon="📝" label={t('guest.myRoom.notes')}>
            <p className="whitespace-pre-wrap text-sm text-gray-700">{hotel.general_info}</p>
          </InfoBlock>
        )}
      </div>
    </div>
  )
}
