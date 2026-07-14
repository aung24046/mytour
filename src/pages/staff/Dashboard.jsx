import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { getStaffSession, clearStaffSession } from '../../lib/staffSession'
import { genderTextClass } from '../../lib/genderColor'
import Card from '../../components/common/Card'
import Icon from '../../components/common/Icon'

// เมนูจัดเป็นหมวด — หาง่ายกว่ารายการยาวๆ
const GROUPS = [
  {
    key: 'duringTrip',
    links: [
      { to: '/staff/check-in', key: 'checkIn', icon: 'check' },
      { to: '/staff/broadcast', key: 'broadcast', icon: 'megaphone' },
      { to: '/staff/sos-monitor', key: 'sosMonitor', icon: 'alert' },
      { to: '/staff/location-monitor', key: 'locationMonitor', icon: 'location' },
      { to: '/staff/bingo-host', key: 'bingoHost', icon: 'target' },
    ],
  },
  {
    key: 'planData',
    links: [
      { to: '/staff/itinerary-builder', key: 'itineraryBuilder', icon: 'map' },
      { to: '/staff/guide-builder', key: 'guideBuilder', icon: 'book' },
      { to: '/staff/seat-map', key: 'seatMap', icon: 'seat' },
      { to: '/staff/room-map', key: 'roomMap', icon: 'bed' },
      { to: '/staff/luggage-manager', key: 'luggageManager', icon: 'bag' },
    ],
  },
  {
    key: 'people',
    links: [
      { to: '/staff/guest-manager', key: 'guestManager', icon: 'people' },
      { to: '/staff/staff-manager', key: 'staffManager', icon: 'settings' },
      { to: '/staff/supplier-manager', key: 'supplierManager', icon: 'briefcase' },
    ],
  },
  {
    key: 'tools',
    links: [
      { to: '/staff/expense-tracker', key: 'expenseTracker', icon: 'wallet' },
      { to: '/staff/dietary-summary', key: 'dietarySummary', icon: 'bowl' },
      { to: '/staff/feedback-summary', key: 'feedbackSummary', icon: 'star' },
      { to: '/staff/form-builder', key: 'formBuilder', icon: 'form' },
      { to: '/staff/print', key: 'printExport', icon: 'print' },
    ],
  },
]

const MISSING_PREVIEW_COUNT = 3

function formatTime(dbTime) {
  return dbTime ? dbTime.slice(0, 5) : ''
}

export default function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const staffSession = getStaffSession()

  function handleLogout() {
    clearStaffSession()
    navigate('/staff/login')
  }

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openSosCount, setOpenSosCount] = useState(0)
  const [missingExpanded, setMissingExpanded] = useState(false)
  const [menuSearch, setMenuSearch] = useState('')

  // จุดเช็คอินหลายจุด (checkin_events) + จำนวนที่เช็คแล้วต่อจุด
  const [events, setEvents] = useState([])
  const [recordCounts, setRecordCounts] = useState({}) // eventId -> count (เฉพาะ event ที่ไม่ใช่ core)

  // แผนการเดินทางสำหรับไทม์ไลน์วันนี้
  const [itineraryItems, setItineraryItems] = useState([])

  // โลจิสติกส์สำหรับ stat tiles
  const [luggageLoaded, setLuggageLoaded] = useState(0)
  const [luggageTotal, setLuggageTotal] = useState(0)
  const [roomsAssigned, setRoomsAssigned] = useState(0)

  async function loadOpenSosCount() {
    const { count } = await supabase
      .from('sos_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('tour_id', ACTIVE_TOUR_ID)
      .eq('status', 'open')

    setOpenSosCount(count ?? 0)
  }

  async function loadSummary() {
    setLoading(true)
    setError(null)

    const [guestsRes, fieldsRes] = await Promise.all([
      supabase
        .from('guests')
        .select('id, name, nickname, gender, phone, check_in_status')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('name'),
      supabase
        .from('form_fields')
        .select('id, field_key, field_purpose, is_core')
        .eq('tour_id', ACTIVE_TOUR_ID),
    ])

    if (guestsRes.error || fieldsRes.error) {
      console.error('[Dashboard] load failed', guestsRes.error, fieldsRes.error)
      setError(t('common.error'))
      setLoading(false)
      return
    }

    setGuests(guestsRes.data ?? [])
    setFields(fieldsRes.data ?? [])

    // Only need to fetch guest_form_responses if the phone field turns out to be custom.
    const phoneField = findFieldByPurpose(fieldsRes.data ?? [], 'phone')
    if (phoneField && !phoneField.is_core) {
      const { data: responsesData, error: responsesError } = await supabase
        .from('guest_form_responses')
        .select('guest_id, field_id, value')
        .eq('field_id', phoneField.id)

      if (!responsesError) setResponses(responsesData ?? [])
    }

    setLoading(false)
  }

  async function loadCheckpoints() {
    const { data: eventsData, error: eventsError } = await supabase
      .from('checkin_events')
      .select('id, title, is_core, itinerary_item_id, sort_order')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('sort_order', { ascending: true })

    if (eventsError) {
      console.error('[Dashboard] load checkpoints failed', eventsError)
      return
    }

    setEvents(eventsData ?? [])

    const nonCoreIds = (eventsData ?? []).filter((ev) => !ev.is_core).map((ev) => ev.id)
    if (nonCoreIds.length === 0) {
      setRecordCounts({})
      return
    }

    const { data: records } = await supabase
      .from('checkin_records')
      .select('event_id, guest_id')
      .in('event_id', nonCoreIds)

    const counts = {}
    for (const r of records ?? []) counts[r.event_id] = (counts[r.event_id] ?? 0) + 1
    setRecordCounts(counts)
  }

  async function loadItinerary() {
    const { data } = await supabase
      .from('itinerary_items')
      .select('id, day_number, sort_order, scheduled_time, title, location_name, status')
      .eq('tour_id', ACTIVE_TOUR_ID)
      .order('day_number', { ascending: true })
      .order('sort_order', { ascending: true })

    setItineraryItems(data ?? [])
  }

  async function loadLogistics() {
    const [luggageRes, roomsRes] = await Promise.all([
      supabase.from('luggage').select('status').eq('tour_id', ACTIVE_TOUR_ID),
      supabase.from('room_assignments').select('guest_id').eq('tour_id', ACTIVE_TOUR_ID),
    ])

    const luggage = luggageRes.data ?? []
    setLuggageTotal(luggage.length)
    setLuggageLoaded(
      luggage.filter((l) => l.status === 'loaded' || l.status === 'delivered').length
    )

    const assigned = new Set((roomsRes.data ?? []).map((r) => r.guest_id).filter(Boolean))
    setRoomsAssigned(assigned.size)
  }

  useEffect(() => {
    loadSummary()
    loadOpenSosCount()
    loadCheckpoints()
    loadItinerary()
    loadLogistics()

    const channel = supabase
      .channel(`dashboard-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'guests', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        (payload) => {
          setGuests((prev) =>
            prev.map((g) => (g.id === payload.new.id ? { ...g, ...payload.new } : g))
          )
        }
      )
      .subscribe()

    const sosChannel = supabase
      .channel(`dashboard-sos-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sos_alerts', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadOpenSosCount()
      )
      .subscribe()

    const opsChannel = supabase
      .channel(`dashboard-ops-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_items', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadItinerary()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checkin_records' },
        () => loadCheckpoints()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'luggage', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadLogistics()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_assignments', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadLogistics()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(sosChannel)
      supabase.removeChannel(opsChannel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const phoneField = useMemo(() => findFieldByPurpose(fields, 'phone'), [fields])
  const responsesByGuestId = useMemo(() => buildResponsesByGuestId(responses), [responses])

  const checkedInCount = guests.filter((g) => g.check_in_status).length
  const missingGuests = guests.filter((g) => !g.check_in_status)
  const totalGuests = guests.length

  // จำนวนที่เช็คแล้วต่อจุด — core ใช้ check_in_status, จุดอื่นใช้ checkin_records
  const checkpoints = useMemo(() => {
    return events.map((ev) => ({
      id: ev.id,
      title: ev.title,
      isCore: ev.is_core,
      itineraryItemId: ev.itinerary_item_id,
      count: ev.is_core ? checkedInCount : recordCounts[ev.id] ?? 0,
      total: totalGuests,
    }))
  }, [events, recordCounts, checkedInCount, totalGuests])

  // จุดที่ "กำลังทำ" — จุดแรกที่ยังเช็คไม่ครบ ไล่ตามลำดับ, ถ้าครบหมดใช้จุดสุดท้าย
  const activeIndex = useMemo(() => {
    if (checkpoints.length === 0) return -1
    const idx = checkpoints.findIndex((c) => c.count < c.total)
    return idx === -1 ? checkpoints.length - 1 : idx
  }, [checkpoints])

  const activeCheckpoint = activeIndex >= 0 ? checkpoints[activeIndex] : null
  const heroCount = activeCheckpoint ? activeCheckpoint.count : checkedInCount
  const heroTotal = activeCheckpoint ? activeCheckpoint.total : totalGuests
  const heroPct = heroTotal ? (heroCount / heroTotal) * 100 : 0

  // เลือกวันของไทม์ไลน์: วันของรายการที่ status current, ไม่งั้นวันแรกที่ยังไม่จบ, ไม่งั้นวันสุดท้าย
  const todayItems = useMemo(() => {
    if (itineraryItems.length === 0) return []
    const current = itineraryItems.find((it) => it.status === 'current')
    let day = current?.day_number
    if (day == null) {
      const nextUp = itineraryItems.find((it) => it.status !== 'completed')
      day = nextUp?.day_number ?? itineraryItems[itineraryItems.length - 1].day_number
    }
    return itineraryItems.filter((it) => it.day_number === day)
  }, [itineraryItems])

  // โชว์แค่ 4 รายการรอบปัจจุบัน: ก่อนหน้า 1 + ปัจจุบัน + ถัดไป 2
  const windowedItems = useMemo(() => {
    if (todayItems.length === 0) return []
    const curIdx = todayItems.findIndex((it) => it.status === 'current')
    if (curIdx !== -1) return todayItems.slice(Math.max(0, curIdx - 1), curIdx + 3)
    const notDone = todayItems.filter((it) => it.status !== 'completed')
    if (notDone.length > 0) return notDone.slice(0, 4)
    return todayItems.slice(-4)
  }, [todayItems])

  // หารายการถัดไปในวันเดียวกันที่ยังไม่จบ (ใช้ตอน auto-advance)
  function nextUpcomingInDay(item) {
    const dayList = itineraryItems
      .filter((it) => it.day_number === item.day_number)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const idx = dayList.findIndex((it) => it.id === item.id)
    return dayList.slice(idx + 1).find((it) => it.status !== 'completed') ?? null
  }

  async function startItem(item) {
    const priorIds = todayItems
      .filter((it) => (it.sort_order ?? 0) < (item.sort_order ?? 0) && it.status !== 'completed')
      .map((it) => it.id)

    setItineraryItems((prev) =>
      prev.map((it) => {
        if (it.id === item.id) return { ...it, status: 'current' }
        if (priorIds.includes(it.id)) return { ...it, status: 'completed' }
        return it
      })
    )

    await Promise.all([
      supabase.from('itinerary_items').update({ status: 'current' }).eq('id', item.id),
      priorIds.length > 0
        ? supabase.from('itinerary_items').update({ status: 'completed' }).in('id', priorIds)
        : Promise.resolve(),
    ])
  }

  // สิ้นสุดรายการปัจจุบัน → เซ็ตรายการถัดไปเป็น current อัตโนมัติ
  async function endItem(item) {
    const next = nextUpcomingInDay(item)

    setItineraryItems((prev) =>
      prev.map((it) => {
        if (it.id === item.id) return { ...it, status: 'completed' }
        if (next && it.id === next.id) return { ...it, status: 'current' }
        return it
      })
    )

    const updates = [
      supabase.from('itinerary_items').update({ status: 'completed' }).eq('id', item.id),
    ]
    if (next) {
      updates.push(supabase.from('itinerary_items').update({ status: 'current' }).eq('id', next.id))
    }
    await Promise.all(updates)
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
        {/* หัว — พื้นขาว อ่านง่าย */}
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              MyTour
            </p>
            <h1 className="text-2xl font-extrabold text-ink">{t('staff.dashboard.title')}</h1>
            {staffSession?.name && (
              <p className="mt-0.5 text-sm text-ink-muted">{staffSession.name}</p>
            )}
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-pill bg-brand-lighter px-3 py-1.5 text-sm font-semibold text-brand"
          >
            {t('staff.dashboard.logout')}
          </button>
        </div>

        {!loading && openSosCount > 0 && (
          <Link
            to="/staff/sos-monitor"
            className="mb-3 flex items-center gap-2.5 rounded-control border border-danger/30 bg-danger-bg px-4 py-3 text-danger-text"
          >
            <Icon name="alert" size={20} />
            <span className="text-sm font-semibold">
              {t('staff.dashboard.sosOpen', { count: openSosCount })}
            </span>
          </Link>
        )}

        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="text-danger">{error}</p>}

        {!loading && !error && (
          <>
            {/* การ์ดเช็คอิน (พื้นขาว) */}
            <div className="mb-3 rounded-card border border-white/60 bg-surface p-4 shadow-card ring-1 ring-black/[0.02]">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink-muted">
                  {t('staff.dashboard.checkingInAt')}
                  {activeCheckpoint ? ` · ${activeCheckpoint.title}` : ''}
                </p>
                {checkpoints.length > 1 && (
                  <p className="text-xs text-ink-faint">
                    {t('staff.dashboard.checkpointStep', {
                      current: activeIndex + 1,
                      total: checkpoints.length,
                    })}
                  </p>
                )}
              </div>
              <p className="mt-0.5 text-4xl font-extrabold text-ink">
                {heroCount}
                <span className="text-xl font-semibold text-ink-faint"> / {heroTotal}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-pill bg-ink-faint/15">
                <div
                  className="h-full rounded-pill bg-brand-gradient transition-all"
                  style={{ width: `${heroPct}%` }}
                />
              </div>

              {checkpoints.length > 1 && (
                <div className="mt-3 flex gap-1.5">
                  {checkpoints.map((cp, i) => {
                    const done = cp.total > 0 && cp.count >= cp.total
                    const isActive = i === activeIndex
                    return (
                      <div
                        key={cp.id}
                        className={`flex-1 rounded-control px-2 py-1.5 ${
                          isActive ? 'bg-brand-lighter ring-1 ring-brand-light' : 'bg-surface-sunken'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <Icon
                            name={done ? 'check' : isActive ? 'location' : 'compass'}
                            size={12}
                            color={done ? '#16a34a' : isActive ? '#0891b2' : '#93a7b0'}
                          />
                          <span className="truncate text-[10px] text-ink-muted">{cp.title}</span>
                        </div>
                        <p className="mt-0.5 text-xs font-semibold text-ink">
                          {cp.count === 0 && !isActive && !done
                            ? t('staff.dashboard.waiting')
                            : `${cp.count}/${cp.total}`}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}

              <button
                onClick={() => navigate('/staff/check-in?scan=1')}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-control bg-brand-gradient py-3 text-base font-semibold text-white shadow-brand"
              >
                <Icon name="ticket" size={20} />
                {t('staff.dashboard.scanCheckIn')}
              </button>
            </div>

            {/* stat tiles */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              <Link to="/staff/luggage-manager">
                <Card hover className="h-full">
                  <div className="flex items-center gap-1.5 text-ink-muted">
                    <Icon name="bag" size={16} />
                    <span className="text-xs font-medium">{t('staff.dashboard.luggageLoaded')}</span>
                  </div>
                  <p className="mt-1 text-2xl font-extrabold text-ink">
                    {luggageLoaded}
                    <span className="text-sm font-semibold text-ink-faint"> / {luggageTotal}</span>
                  </p>
                </Card>
              </Link>
              <Link to="/staff/room-map">
                <Card hover className="h-full">
                  <div className="flex items-center gap-1.5 text-ink-muted">
                    <Icon name="bed" size={16} />
                    <span className="text-xs font-medium">{t('staff.dashboard.roomsAssigned')}</span>
                  </div>
                  <p className="mt-1 text-2xl font-extrabold text-ink">
                    {roomsAssigned}
                    {totalGuests > 0 && roomsAssigned >= totalGuests ? (
                      <span className="text-sm font-semibold text-success-text"> {t('staff.dashboard.complete')}</span>
                    ) : (
                      <span className="text-sm font-semibold text-ink-faint"> / {totalGuests}</span>
                    )}
                  </p>
                </Card>
              </Link>
            </div>

            {/* กำหนดการวันนี้ — โชว์ 4 รายการรอบปัจจุบัน */}
            {windowedItems.length > 0 && (
              <Card className="mb-3">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">{t('staff.dashboard.todaySchedule')}</p>
                  <Link to="/staff/itinerary-builder" className="text-xs font-semibold text-brand">
                    {t('staff.dashboard.viewAll')}
                  </Link>
                </div>
                <div className="flex flex-col gap-3">
                  {windowedItems.map((item) => {
                    const isCurrent = item.status === 'current'
                    const isDone = item.status === 'completed'
                    return (
                      <div key={item.id} className="flex items-start gap-2.5">
                        <span className="w-11 shrink-0 pt-0.5 text-xs font-medium text-ink-faint">
                          {formatTime(item.scheduled_time)}
                        </span>
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            isCurrent
                              ? 'bg-brand ring-4 ring-brand-light'
                              : isDone
                                ? 'bg-ink-faint'
                                : 'bg-ink-faint/40'
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-sm ${
                              isCurrent
                                ? 'font-semibold text-ink'
                                : isDone
                                  ? 'text-ink-faint line-through'
                                  : 'text-ink-muted'
                            }`}
                          >
                            {item.title}
                            {isCurrent && (
                              <span className="ml-1 text-xs font-normal text-brand">
                                · {t('staff.dashboard.nowTag')}
                              </span>
                            )}
                          </p>
                          {item.location_name && (
                            <p className={`text-xs text-ink-faint ${isDone ? 'line-through' : ''}`}>
                              {item.location_name}
                            </p>
                          )}
                        </div>
                        {isCurrent ? (
                          <button
                            onClick={() => endItem(item)}
                            className="shrink-0 rounded-control border border-danger/30 bg-danger-bg px-3 py-1.5 text-xs font-semibold text-danger-text"
                          >
                            {t('staff.dashboard.endItem')}
                          </button>
                        ) : (
                          !isDone && (
                            <button
                              onClick={() => startItem(item)}
                              className="shrink-0 rounded-control bg-brand px-3 py-1.5 text-xs font-semibold text-white"
                            >
                              {t('staff.dashboard.startItem')}
                            </button>
                          )
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}

            {/* รายชื่อยังไม่เช็คอิน */}
            {missingGuests.length > 0 && (
              <Card className="mb-3">
                <p className="mb-2 text-sm font-semibold text-ink">
                  {t('staff.dashboard.missingList', { count: missingGuests.length })}
                </p>
                <div className="flex flex-col gap-1.5">
                  {(missingExpanded ? missingGuests : missingGuests.slice(0, MISSING_PREVIEW_COUNT)).map((g) => {
                    const phone = resolveGuestPhone(g, phoneField, responsesByGuestId)
                    return (
                      <div
                        key={g.id}
                        className="flex items-center justify-between rounded-control bg-danger-bg/60 px-3 py-2.5"
                      >
                        <span className={`font-semibold ${genderTextClass(g.gender) || 'text-ink'}`}>
                          {g.nickname || g.name}
                        </span>
                        {phone ? (
                          <a
                            href={`tel:${phone}`}
                            className="rounded-pill bg-white px-3 py-1 text-sm font-semibold text-brand shadow-sm"
                          >
                            {phone}
                          </a>
                        ) : (
                          <span className="text-sm text-ink-faint">
                            {t('staff.dashboard.noPhone')}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>

                {missingGuests.length > MISSING_PREVIEW_COUNT && (
                  <button
                    onClick={() => setMissingExpanded((prev) => !prev)}
                    className="mt-2 w-full text-center text-sm font-semibold text-brand"
                  >
                    {missingExpanded
                      ? t('staff.dashboard.showLess')
                      : t('staff.dashboard.showMore', { count: missingGuests.length - MISSING_PREVIEW_COUNT })}
                  </button>
                )}
              </Card>
            )}

            {/* ค้นหาเมนู */}
            <div className="mb-4 flex items-center gap-2 rounded-control border border-black/10 bg-surface px-3">
              <Icon name="search" size={16} color="#93a7b0" />
              <input
                type="text"
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                placeholder={t('staff.dashboard.searchMenu')}
                className="w-full bg-transparent py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
              />
            </div>

            {/* เมนูจัดกลุ่ม 3 คอลัมน์ */}
            {GROUPS.map((group) => {
              const q = menuSearch.trim().toLowerCase()
              const links = group.links.filter(
                (l) => !q || t(`staff.${l.key}.title`).toLowerCase().includes(q)
              )
              if (links.length === 0) return null
              return (
                <div key={group.key} className="mb-4">
                  <p className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {t(`staff.dashboard.groups.${group.key}`)}
                  </p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {links.map((link) => {
                      const isSos = link.key === 'sosMonitor'
                      return (
                        <Link key={link.to} to={link.to} className="relative flex flex-col items-center gap-1.5">
                          {isSos && openSosCount > 0 && (
                            <span className="absolute -right-1 -top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-sm">
                              {openSosCount}
                            </span>
                          )}
                          <span
                            className={`flex h-[52px] w-full items-center justify-center rounded-[14px] ${
                              isSos
                                ? 'bg-danger-bg text-danger'
                                : 'bg-surface text-brand shadow-card ring-1 ring-black/[0.03]'
                            }`}
                          >
                            <Icon name={link.icon} size={23} />
                          </span>
                          <span className="text-center text-[11px] font-medium leading-tight text-ink-muted">
                            {t(`staff.${link.key}.title`)}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {menuSearch.trim() &&
              GROUPS.every((group) =>
                group.links.every(
                  (l) => !t(`staff.${l.key}.title`).toLowerCase().includes(menuSearch.trim().toLowerCase())
                )
              ) && <p className="text-center text-sm text-ink-faint">{t('staff.checkIn.noResults')}</p>}
          </>
        )}
      </div>
    </div>
  )
}
