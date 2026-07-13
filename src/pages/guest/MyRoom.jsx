import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { getGuestId } from '../../lib/guestSession'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { genderTextClass } from '../../lib/genderColor'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import GuestNav from '../../components/common/GuestNav'
import Icon from '../../components/common/Icon'

const ROOM_TYPE_LABELS = {
  single: 'roomTypeSingle',
  twin: 'roomTypeTwin',
  double: 'roomTypeDouble',
  triple: 'roomTypeTriple',
}

const CACHE_KEY = 'my_room'

// จุดสีตามเพศ (พื้นทึบ) สำหรับชิปเพื่อนร่วมห้อง
function genderDotClass(gender) {
  if (gender === 'ชาย') return 'bg-blue-500'
  if (gender === 'หญิง') return 'bg-pink-500'
  return 'bg-ink-faint'
}

// นับจำนวนคืนจากวันเข้าพัก–ออก (null ถ้าข้อมูลไม่ครบ)
function nightsBetween(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const a = new Date(checkIn)
  const b = new Date(checkOut)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  const n = Math.round((b - a) / 86400000)
  return n > 0 ? n : null
}

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
            <Icon name="bed" size={24} color="#0e7490" />
            {t('guest.myRoom.title')}
          </h1>

          <GuestNav active="myRoom" />

          {usingCache && (
            <p className="mb-3 rounded-control bg-warning-bg px-3 py-2 text-sm text-warning-text">
              {t('guest.itinerary.usingCache')}
            </p>
          )}

          {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
          {error && <p className="text-danger">{error}</p>}

          {!loading && !error && stays.length === 0 && (
            <p className="text-ink-muted">{t('guest.myRoom.noRoom')}</p>
          )}

          {!loading && !error && stays.length > 0 && (
            <div className="flex flex-col gap-3">
              {stays.map(({ room, hotel, roommates }, index) => {
                const isCollapsed = !!collapsedStays[room.id]
                const title = hotel?.name || t('guest.myRoom.roomNumber', { number: room.room_number || '—' })
                const nights = nightsBetween(hotel?.check_in_date, hotel?.check_out_date)
                const roomTypeLabel = t(`guest.myRoom.${ROOM_TYPE_LABELS[room.room_type] ?? 'roomTypeTwin'}`)
                const hasWifi = hotel && (hotel.wifi_name || hotel.wifi_password)
                const hasBreakfast = hotel && (hotel.breakfast_time || hotel.breakfast_location)
                const hasCheckout = hotel && hotel.checkout_time
                const hasNotes = hotel && hotel.general_info
                return (
                  <div
                    key={room.id}
                    className="overflow-hidden rounded-card border border-white/60 bg-surface shadow-card ring-1 ring-black/[0.02]"
                  >
                    {/* หัวบัตร กดย่อ/ขยายได้ */}
                    <button
                      type="button"
                      onClick={() => toggleStay(room.id)}
                      aria-expanded={!isCollapsed}
                      className="w-full p-4 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          {stays.length > 1 && (
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                              {t('guest.myRoom.stayNumber', { number: index + 1 })}
                            </p>
                          )}
                          <p className="truncate font-bold text-ink">{title}</p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {roomTypeLabel} · {t('guest.myRoom.floorLabel', { floor: room.floor || '—' })}
                          </p>
                          {(hotel?.check_in_date || hotel?.check_out_date) && (
                            <span className="mt-2 inline-flex items-center gap-1.5 rounded-control bg-brand-lighter px-2 py-1 text-[11px] font-medium text-brand">
                              <Icon name="calendar" size={12} />
                              {hotel.check_in_date || '—'} → {hotel.check_out_date || '—'}
                              {nights ? ` · ${t('guest.myRoom.nights', { count: nights })}` : ''}
                            </span>
                          )}
                        </div>
                        <svg
                          viewBox="0 0 24 24"
                          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>

                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-xs text-ink-faint">{t('guest.myRoom.roomNumberLabel')}</span>
                        <span className="text-[40px] font-extrabold leading-none text-brand">
                          {room.room_number || '—'}
                        </span>
                      </div>
                    </button>

                    {!isCollapsed && (
                      <>
                        {/* รอยปรุแบบบัตร */}
                        <div className="mx-4 border-t-2 border-dashed border-black/10" />

                        <div className="p-4">
                          {/* เพื่อนร่วมห้อง */}
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                            {t('guest.myRoom.roommates')}
                          </p>
                          {roommates.length === 0 ? (
                            <p className="text-sm text-ink-faint">{t('guest.myRoom.noRoommates')}</p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {roommates.map((g) => (
                                <span
                                  key={g.id}
                                  className="inline-flex items-center gap-1.5 rounded-pill bg-surface-muted px-2.5 py-1 ring-1 ring-black/[0.04]"
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${genderDotClass(g.gender)}`} />
                                  <span className={`text-xs font-medium ${genderTextClass(g.gender) || 'text-ink'}`}>
                                    {g.nickname || g.name}
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}

                          {/* ข้อมูลโรงแรมเป็นแถวรายการ */}
                          {(hasWifi || hasBreakfast || hasCheckout) && (
                            <div className="mt-3 flex flex-col">
                              {hasWifi && (
                                <AmenityRow icon="wifi" label={t('guest.myRoom.wifi')}>
                                  {hotel.wifi_name}
                                  {hotel.wifi_name && hotel.wifi_password ? ' · ' : ''}
                                  {hotel.wifi_password && (
                                    <span className="select-all font-mono">{hotel.wifi_password}</span>
                                  )}
                                </AmenityRow>
                              )}
                              {hasBreakfast && (
                                <AmenityRow icon="coffee" label={t('guest.myRoom.breakfast')}>
                                  {[hotel.breakfast_time, hotel.breakfast_location].filter(Boolean).join(' · ')}
                                </AmenityRow>
                              )}
                              {hasCheckout && (
                                <AmenityRow icon="door" label={t('guest.myRoom.checkout')}>
                                  {hotel.checkout_time}
                                </AmenityRow>
                              )}
                            </div>
                          )}

                          {hasNotes && (
                            <div className="mt-3 flex items-start gap-2.5 rounded-control bg-surface-muted p-3">
                              <span className="mt-0.5 flex w-5 shrink-0 justify-center">
                                <Icon name="form" size={16} color="#0e7490" />
                              </span>
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                                  {t('guest.myRoom.notes')}
                                </p>
                                <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink-muted">
                                  {hotel.general_info}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
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

// แถวข้อมูลโรงแรม: ไอคอน + หัวข้อ (ซ้าย) + ค่า (ขวา) แบบรายการในบัตร
function AmenityRow({ icon, label, children }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-black/[0.06] py-2.5 last:border-0">
      <span className="flex w-6 shrink-0 justify-center">
        <Icon name={icon} size={18} color="#0e7490" />
      </span>
      <span className="flex-1 text-sm text-ink-muted">{label}</span>
      <span className="min-w-0 text-right text-sm font-medium text-ink">{children}</span>
    </div>
  )
}
