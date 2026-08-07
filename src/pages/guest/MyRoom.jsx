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
  if (gender === 'ชาย') return 'bg-blue-600'
  if (gender === 'หญิง') return 'bg-pink-600'
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
            <Icon name="bed" size={24} className="text-brand-hover" />
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
            <div className="flex flex-col gap-4">
              {stays.map((stay, index) => (
                <StayCard
                  key={stay.room.id}
                  stay={stay}
                  index={index}
                  showStayNumber={stays.length > 1}
                  collapsed={!!collapsedStays[stay.room.id]}
                  onToggle={() => toggleStay(stay.room.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ══ การ์ดที่พักหนึ่งแห่ง ══════════════════════════════════════════════
// โครงเป็น "หัวการ์ดสีแบรนด์ + เนื้อหาแบ่งบล็อกมีหัวข้อ"
// เหตุผลที่แบ่งบล็อก: ของเดิมเป็นแถวไอคอน+ข้อความ 8 แถวเรียงกันน้ำหนักเท่ากันหมด
// ลูกทัวร์ต้องอ่านทีละแถวถึงจะเจอสิ่งที่ต้องการ พอแบ่งเป็น "อินเทอร์เน็ต /
// ตารางเวลา / เพื่อนร่วมห้อง / กลับโรงแรม / สิ่งอำนวยความสะดวก" จะกวาดตาหาได้ทันที
function StayCard({ stay, index, showStayNumber, collapsed, onToggle }) {
  const { t } = useTranslation()
  const { room, hotel, roommates } = stay

  const title = hotel?.name || t('guest.myRoom.roomNumber', { number: room.room_number || '—' })
  const nights = nightsBetween(hotel?.check_in_date, hotel?.check_out_date)
  const roomTypeLabel = t(`guest.myRoom.${ROOM_TYPE_LABELS[room.room_type] ?? 'roomTypeTwin'}`)

  // บรรทัดบนสุดของหัวการ์ด: ที่พักที่ N · วันเข้า → วันออก · กี่คืน
  const kicker = [
    showStayNumber ? t('guest.myRoom.stayNumber', { number: index + 1 }) : null,
    hotel?.check_in_date || hotel?.check_out_date
      ? `${hotel.check_in_date || '—'} → ${hotel.check_out_date || '—'}`
      : null,
    nights ? t('guest.myRoom.nights', { count: nights }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const scheduleRows = hotel
    ? [
        { icon: 'ticket', label: t('guest.myRoom.checkIn'), value: hotel.check_in_time },
        {
          icon: 'coffee',
          label: t('guest.myRoom.breakfast'),
          value: [hotel.breakfast_time, hotel.breakfast_location].filter(Boolean).join(' · '),
        },
        {
          icon: 'bowl',
          label: t('guest.myRoom.dinner'),
          value: [hotel.dinner_time, hotel.dinner_location].filter(Boolean).join(' · '),
        },
        { icon: 'alarm', label: t('guest.myRoom.morningCall'), value: hotel.morning_call },
        { icon: 'bag', label: t('guest.myRoom.luggageTime'), value: hotel.luggage_time },
        { icon: 'bus', label: t('guest.myRoom.meetingPoint'), value: hotel.meeting_point },
        { icon: 'door', label: t('guest.myRoom.checkout'), value: hotel.checkout_time },
      ].filter((r) => r.value)
    : []

  return (
    <div className="rounded-[1.5rem] border border-line-subtle bg-surface p-1 shadow-card">
      {/* ── หัวการ์ด — กดเพื่อย่อ/ขยาย ─────────────────────────────── */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="relative w-full overflow-hidden rounded-[1.25rem] bg-stay-hero p-4 text-left text-white"
      >
        {/* ลายเตียงจางๆ มุมขวาล่าง — ให้หัวการ์ดมีอะไรมองนอกจากตัวหนังสือ
            aria-hidden เพราะเป็นของตกแต่งล้วน */}
        <span className="pointer-events-none absolute -bottom-6 -right-5 opacity-[0.14]" aria-hidden="true">
          <Icon name="bed" size={120} />
        </span>

        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {kicker && (
              <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-white/80">
                {kicker}
              </p>
            )}
            <p className="mt-1 text-lg font-extrabold leading-tight">{title}</p>
          </div>
          <svg
            viewBox="0 0 24 24"
            className={`mt-1 h-4 w-4 shrink-0 text-white/80 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
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

        {/* แถบสามช่อง: เลขห้อง / ชั้น / ประเภท — สามอย่างที่ถูกถามบ่อยที่สุด
            รวมไว้บรรทัดเดียวบนหัวการ์ด ไม่ต้องกางการ์ดก็เห็น */}
        <div className="relative mt-4 flex overflow-hidden rounded-control border border-white/25 bg-white/[0.13]">
          <div className="flex-1 border-r border-white/20 px-2.5 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/80">
              {t('guest.myRoom.roomShort')}
            </p>
            <p className="mt-0.5 text-xl font-extrabold leading-none">{room.room_number || '—'}</p>
          </div>
          <div className="flex-1 border-r border-white/20 px-2.5 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/80">
              {t('guest.myRoom.floorShort')}
            </p>
            <p className="mt-0.5 text-base font-extrabold leading-tight">{room.floor || '—'}</p>
          </div>
          <div className="flex-1 px-2.5 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-white/80">
              {t('guest.myRoom.typeLabel')}
            </p>
            <p className="mt-0.5 truncate text-[13px] font-extrabold leading-tight">{roomTypeLabel}</p>
          </div>
        </div>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-4 px-3 pb-3 pt-4">
          <WifiBlock hotel={hotel} />

          {scheduleRows.length > 0 && (
            <section>
              <SectionHeading>{t('guest.myRoom.sectionSchedule')}</SectionHeading>
              <div className="flex flex-col gap-px overflow-hidden rounded-control border border-line-subtle bg-line-subtle">
                {scheduleRows.map((r) => (
                  <div key={r.label} className="flex items-center gap-2.5 bg-surface px-3 py-2.5">
                    <Icon name={r.icon} size={16} className="shrink-0 text-brand" />
                    <span className="flex-1 text-[13px] text-ink-muted">{r.label}</span>
                    <span className="min-w-0 text-right text-[13px] font-bold text-ink">{r.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionHeading>{t('guest.myRoom.roommates')}</SectionHeading>
            {roommates.length === 0 ? (
              <p className="text-sm text-ink-faint">{t('guest.myRoom.noRoommates')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {/* ตัวเราเองอยู่ในกลุ่มด้วย — ลูกทัวร์นับหัวได้ว่าห้องนี้มีกี่คน
                    โดยไม่ต้องบวกหนึ่งเอง */}
                <PersonAvatar isMe label={t('guest.myRoom.me')} />
                {roommates.map((g) => (
                  <PersonAvatar key={g.id} gender={g.gender} label={g.nickname || g.name} />
                ))}
              </div>
            )}
          </section>

          {/* ที่อยู่โรงแรม + ปุ่มลัด — สำคัญที่สุดเวลาลูกทัวร์แยกตัวไปเที่ยวเองแล้วต้องกลับ */}
          <HotelLocation hotel={hotel} />

          {/* สิ่งอำนวยความสะดวก + ของในห้อง */}
          <HotelFacilities hotel={hotel} />

          {hotel?.general_info && (
            <div className="rounded-r-control border-l-[3px] border-accent bg-accent-bg px-3 py-2.5">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-accent-text">
                {t('guest.myRoom.notes')}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-accent-text">
                {hotel.general_info}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// หัวข้อประจำบล็อก — ตัวหนังสือสั้นๆ + เส้นลากยาวไปจนสุดขอบ
// ทำให้แต่ละบล็อกแยกจากกันได้โดยไม่ต้องใส่กล่องซ้อนกล่อง
function SectionHeading({ children }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[12.5px] font-extrabold tracking-tight text-ink">{children}</span>
      <span className="h-px flex-1 bg-line-subtle" />
    </div>
  )
}

// อวาตาร์กลมของคนหนึ่งคน — สีตามเพศเหมือนที่ใช้ทั้งแอป
// ตัวเราเองใช้กรอบประแทนพื้นทึบ เพื่อให้แยกออกจากเพื่อนร่วมห้องได้ทันที
function PersonAvatar({ gender, label, isMe = false }) {
  const initial = (label || '').trim().charAt(0) || '?'
  return (
    <div className="flex w-[62px] flex-col items-center gap-1.5">
      <span
        className={`grid h-11 w-11 place-items-center rounded-full text-[15px] font-extrabold ${
          isMe
            ? 'border-2 border-dashed border-brand-light bg-surface-sunken text-brand'
            : `${genderDotClass(gender)} text-white`
        }`}
        aria-hidden="true"
      >
        {initial}
      </span>
      <span
        className={`text-center text-[11px] font-semibold leading-tight ${
          isMe ? 'text-ink-muted' : genderTextClass(gender) || 'text-ink'
        }`}
      >
        {label}
      </span>
    </div>
  )
}

// Wi-Fi แยกออกมาเป็นบล็อกของตัวเอง — เป็นข้อมูลที่ถูกเปิดหาบ่อยที่สุดในหน้านี้
// และเป็นข้อมูลเดียวที่ต้อง "พิมพ์ตาม" จึงต้องตัวใหญ่ + มีปุ่มคัดลอก
function WifiBlock({ hotel }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  if (!hotel || (!hotel.wifi_name && !hotel.wifi_password)) return null

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(hotel.wifi_password)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (clipboardError) {
      console.error('[MyRoom] copy wifi failed', clipboardError)
    }
  }

  return (
    <section>
      <SectionHeading>{t('guest.myRoom.sectionInternet')}</SectionHeading>
      <div className="rounded-control border border-dashed border-brand-light bg-brand-lighter p-3">
        {hotel.wifi_name && (
          <>
            <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-faint">
              <Icon name="wifi" size={13} className="text-brand" />
              {t('guest.myRoom.wifiName')}
            </p>
            <p className="mt-1 break-all text-[15px] font-extrabold text-ink">{hotel.wifi_name}</p>
          </>
        )}
        {hotel.wifi_password && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-control border border-line bg-surface px-3 py-2">
            <code className="select-all break-all font-mono text-[15px] font-bold tracking-wide text-ink">
              {hotel.wifi_password}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex shrink-0 items-center gap-1 rounded-control bg-brand px-2.5 py-1.5 text-[11px] font-bold text-white"
            >
              <Icon name={copied ? 'checkCircle' : 'copy'} size={12} />
              {copied ? t('guest.myRoom.copied') : t('guest.myRoom.copyPassword')}
            </button>
          </div>
        )}
      </div>
    </section>
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
    <section>
      <SectionHeading>{t('guest.myRoom.sectionGoBack')}</SectionHeading>

      {/* ปุ่มลัดเป็นช่องสี่เหลี่ยมเรียงกัน แตะง่ายกว่าชิปเล็กๆ แบบเดิม
          ซึ่งสำคัญมากเพราะสถานการณ์ที่ต้องใช้คือยืนอยู่กลางถนนต่างประเทศ */}
      <div className="grid grid-cols-3 gap-1.5">
        {hotel.map_url && (
          <a
            href={hotel.map_url}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col items-center gap-1.5 rounded-control border border-line-subtle bg-surface-muted px-1 py-2.5 text-[11px] font-bold text-brand"
          >
            <Icon name="map" size={19} />
            {t('guest.myRoom.openMap')}
          </a>
        )}
        {hotel.phone && (
          <a
            href={`tel:${hotel.phone}`}
            className="flex flex-col items-center gap-1.5 rounded-control border border-line-subtle bg-surface-muted px-1 py-2.5 text-[11px] font-bold text-brand"
          >
            <Icon name="phone" size={19} />
            {t('guest.myRoom.callHotel')}
          </a>
        )}
        {hotel.address_local && (
          <button
            type="button"
            onClick={() => setShowLocal((v) => !v)}
            aria-expanded={showLocal}
            className={`flex flex-col items-center gap-1.5 rounded-control border px-1 py-2.5 text-[11px] font-bold ${
              showLocal
                ? 'border-brand bg-brand-lighter text-brand'
                : 'border-line-subtle bg-surface-muted text-brand'
            }`}
          >
            <Icon name="language" size={19} />
            {t('guest.myRoom.showLocalAddress')}
          </button>
        )}
      </div>

      {showLocal && hotel.address_local && (
        <div className="mt-2 rounded-control border border-line bg-surface p-3">
          <p className="text-[11px] text-ink-faint">{t('guest.myRoom.localAddressHint')}</p>
          <p className="mt-1 whitespace-pre-wrap text-lg font-bold leading-snug text-ink">
            {hotel.address_local}
          </p>
          {hotel.phone && <p className="mt-1 font-mono text-sm text-ink-muted">{hotel.phone}</p>}
        </div>
      )}

      {hotel.address && (
        <div className="mt-2 flex items-start gap-2">
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-faint">
            {hotel.address}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-line-subtle bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-ink-muted"
          >
            <Icon name={copied ? 'checkCircle' : 'copy'} size={12} />
            {copied ? t('guest.myRoom.copied') : t('guest.myRoom.copyAddress')}
          </button>
        </div>
      )}
    </section>
  )
}

// ชิปสิ่งอำนวยความสะดวกหนึ่งตัว — ป้ายฟรี/เสียเงินสำคัญที่สุด เพราะเป็นต้นเหตุ
// ของการเข้าใจผิดหน้าเคาน์เตอร์มากที่สุด จึงแสดงเสมอเมื่อทีมงานระบุไว้
function FacilityChip({ item, meta, label }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1 text-xs ring-1 ring-line-subtle">
      {meta?.icon && <Icon name={meta.icon} size={14} className="text-brand" />}
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
    <section className="flex flex-col gap-3">
      {facilities.length > 0 && (
        <div>
          <SectionHeading>{t('common.facility.hotelFacilities')}</SectionHeading>
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
          <SectionHeading>{t('common.facility.roomAmenities')}</SectionHeading>
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
          <Icon name="plug" size={13} className="text-brand" />
          {t('common.facility.powerPlug')}:{' '}
          <span className="font-medium text-ink">{hotel.power_plug}</span>
        </p>
      )}
    </section>
  )
}
