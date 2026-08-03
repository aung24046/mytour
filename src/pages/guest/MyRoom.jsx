import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { useTourId } from '../../lib/TourContext'
import { getGuestId } from '../../lib/guestSession'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { genderTextClass } from '../../lib/genderColor'
import { formatTimeRange } from '../../lib/timeFormat'
import { GUEST_HOTEL_COLUMNS } from '../../lib/hotelVisibility'
import {
  ALL_FACILITIES,
  ROOM_AMENITIES,
  amenityMeta,
  facilityMeta,
  sortByTaxonomy,
} from '../../lib/hotelFacilities'
import AnnouncementBanner from '../../components/common/AnnouncementBanner'
import GuestNav from '../../components/common/GuestNav'
import Icon from '../../components/common/Icon'

const ROOM_TYPE_LABELS = {
  single: 'roomTypeSingle',
  twin: 'roomTypeTwin',
  double: 'roomTypeDouble',
  triple: 'roomTypeTriple',
  quad: 'roomTypeQuad',
  family: 'roomTypeFamily',
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
  const tourId = useTourId()
  const { t } = useTranslation()
  const guestId = getGuestId(tourId)

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
          .select(GUEST_HOTEL_COLUMNS)
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
        // เรียงตามลำดับที่ทีมงานจัดไว้ (sort_order) ก่อน แล้วค่อย fallback เป็นวันเข้าพัก
        // เดิมใช้วันเข้าพักอย่างเดียว โรงแรมที่ยังไม่ได้ใส่วันที่จึงลอยขึ้นมาบนสุดเสมอ
        .sort((a, b) => {
          const orderA = a.hotel?.sort_order ?? Number.MAX_SAFE_INTEGER
          const orderB = b.hotel?.sort_order ?? Number.MAX_SAFE_INTEGER
          if (orderA !== orderB) return orderA - orderB
          return (a.hotel?.check_in_date ?? '').localeCompare(b.hotel?.check_in_date ?? '')
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
                const hasDinner = hotel && (hotel.dinner_time || hotel.dinner_location)
                const hasCheckIn = hotel && hotel.check_in_time
                const hasCheckout = hotel && hotel.checkout_time
                const hasMorningCall = hotel && hotel.morning_call
                const hasLuggage = hotel && hotel.luggage_time
                const hasMeetingPoint = hotel && hotel.meeting_point
                const hasAmenityRows =
                  hasWifi ||
                  hasBreakfast ||
                  hasDinner ||
                  hasCheckIn ||
                  hasCheckout ||
                  hasMorningCall ||
                  hasLuggage ||
                  hasMeetingPoint
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

                          {/* ที่อยู่โรงแรม + ปุ่มลัด — สำคัญที่สุดเวลาลูกทัวร์แยกตัวไปเที่ยวเองแล้วต้องกลับ */}
                          <HotelLocation hotel={hotel} />

                          {/* ข้อมูลโรงแรมเป็นแถวรายการ */}
                          {hasAmenityRows && (
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
                              {hasDinner && (
                                <AmenityRow icon="bowl" label={t('guest.myRoom.dinner')}>
                                  {[hotel.dinner_time, hotel.dinner_location].filter(Boolean).join(' · ')}
                                </AmenityRow>
                              )}
                              {hasCheckIn && (
                                <AmenityRow icon="ticket" label={t('guest.myRoom.checkIn')}>
                                  {hotel.check_in_time}
                                </AmenityRow>
                              )}
                              {hasCheckout && (
                                <AmenityRow icon="door" label={t('guest.myRoom.checkout')}>
                                  {hotel.checkout_time}
                                </AmenityRow>
                              )}
                              {hasMorningCall && (
                                <AmenityRow icon="alert" label={t('guest.myRoom.morningCall')}>
                                  {hotel.morning_call}
                                </AmenityRow>
                              )}
                              {hasLuggage && (
                                <AmenityRow icon="bag" label={t('guest.myRoom.luggageTime')}>
                                  {hotel.luggage_time}
                                </AmenityRow>
                              )}
                              {hasMeetingPoint && (
                                <AmenityRow icon="bus" label={t('guest.myRoom.meetingPoint')}>
                                  {hotel.meeting_point}
                                </AmenityRow>
                              )}
                            </div>
                          )}

                          {/* สิ่งอำนวยความสะดวก + ของในห้อง */}
                          <HotelFacilities hotel={hotel} />

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

// ที่อยู่โรงแรม + ปุ่มโทร/แผนที่/คัดลอก และที่อยู่ภาษาท้องถิ่นแบบตัวใหญ่
// สำหรับยื่นหน้าจอให้คนขับแท็กซี่ดูตอนอยู่ต่างประเทศ
function HotelLocation({ hotel }) {
  const { t } = useTranslation()
  const [showLocal, setShowLocal] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!hotel) return null
  if (!hotel.address && !hotel.address_local && !hotel.phone && !hotel.map_url) return null

  async function handleCopy() {
    const text = [hotel.name, hotel.address, hotel.address_local].filter(Boolean).join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (clipboardError) {
      console.error('[MyRoom] copy failed', clipboardError)
    }
  }

  return (
    <div className="mt-3 rounded-control bg-surface-muted p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex w-5 shrink-0 justify-center">
          <Icon name="location" size={16} color="#0e7490" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {t('guest.myRoom.address')}
          </p>
          {hotel.address && (
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{hotel.address}</p>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {hotel.phone && (
          <a
            href={`tel:${hotel.phone}`}
            className="inline-flex items-center gap-1 rounded-pill bg-surface px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-black/[0.04]"
          >
            <Icon name="phone" size={13} /> {t('guest.myRoom.callHotel')}
          </a>
        )}
        {hotel.map_url && (
          <a
            href={hotel.map_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-pill bg-surface px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-black/[0.04]"
          >
            <Icon name="map" size={13} /> {t('guest.myRoom.openMap')}
          </a>
        )}
        {(hotel.address || hotel.address_local) && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-pill bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted ring-1 ring-black/[0.04]"
          >
            <Icon name={copied ? 'checkCircle' : 'copy'} size={13} />
            {copied ? t('guest.myRoom.copied') : t('guest.myRoom.copyAddress')}
          </button>
        )}
        {hotel.address_local && (
          <button
            type="button"
            onClick={() => setShowLocal((v) => !v)}
            className="inline-flex items-center gap-1 rounded-pill bg-surface px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-black/[0.04]"
          >
            <Icon name="language" size={13} /> {t('guest.myRoom.showLocalAddress')}
          </button>
        )}
      </div>

      {showLocal && hotel.address_local && (
        <div className="mt-2.5 rounded-control bg-white p-3 ring-1 ring-black/[0.06]">
          <p className="text-[11px] text-ink-faint">{t('guest.myRoom.localAddressHint')}</p>
          <p className="mt-1 whitespace-pre-wrap text-lg font-bold leading-snug text-ink">
            {hotel.address_local}
          </p>
          {hotel.phone && (
            <p className="mt-1 font-mono text-sm text-ink-muted">{hotel.phone}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ชิปสิ่งอำนวยความสะดวกหนึ่งตัว — ป้ายฟรี/เสียเงินสำคัญที่สุด เพราะเป็นต้นเหตุ
// ของการเข้าใจผิดหน้าเคาน์เตอร์มากที่สุด จึงแสดงเสมอเมื่อทีมงานระบุไว้
function FacilityChip({ item, meta, label }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1 text-xs ring-1 ring-black/[0.04]">
      {meta?.icon && <Icon name={meta.icon} size={14} />}
      <span className="font-medium text-ink">{label}</span>
      {item.fee === 'free' && (
        <span className="rounded-pill bg-success-bg px-1.5 text-[10px] font-semibold text-success-text">
          {t('common.facility.feeFree')}
        </span>
      )}
      {item.fee === 'paid' && (
        <span className="rounded-pill bg-warning-bg px-1.5 text-[10px] font-semibold text-warning-text">
          {t('common.facility.feePaid')}
        </span>
      )}
      {formatTimeRange(item.from, item.to) && (
        <span className="text-ink-muted">{formatTimeRange(item.from, item.to)}</span>
      )}
      {item.note && <span className="text-ink-faint">· {item.note}</span>}
    </span>
  )
}

// บล็อกสิ่งอำนวยความสะดวกของโรงแรม + ของใช้ในห้อง สำหรับฝั่งลูกทัวร์
function HotelFacilities({ hotel }) {
  const { t } = useTranslation()
  if (!hotel) return null

  const facilities = sortByTaxonomy(hotel.facilities, ALL_FACILITIES)
  const amenities = sortByTaxonomy(hotel.room_amenities, ROOM_AMENITIES)
  if (facilities.length === 0 && amenities.length === 0 && !hotel.power_plug) return null

  return (
    <div className="mt-3 flex flex-col gap-2">
      {facilities.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {t('common.facility.hotelFacilities')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {facilities.map((item) => (
              <FacilityChip
                key={item.key}
                item={item}
                meta={facilityMeta(item.key)}
                label={t(`common.facility.${item.key}`)}
              />
            ))}
          </div>
        </div>
      )}

      {amenities.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {t('common.facility.roomAmenities')}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {amenities.map((item) => (
              <FacilityChip
                key={item.key}
                item={item}
                meta={amenityMeta(item.key)}
                label={t(`common.facility.${item.key}`)}
              />
            ))}
          </div>
        </div>
      )}

      {hotel.power_plug && (
        <p className="flex items-center gap-1 text-xs text-ink-muted">
          <Icon name="plug" size={13} />
          {t('common.facility.powerPlug')}:{' '}
          <span className="font-medium text-ink">{hotel.power_plug}</span>
        </p>
      )}
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
