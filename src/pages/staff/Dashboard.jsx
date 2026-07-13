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

const LINKS = [
  { to: '/staff/check-in', key: 'checkIn', icon: 'check' },
  { to: '/staff/broadcast', key: 'broadcast', icon: 'megaphone' },
  { to: '/staff/itinerary-builder', key: 'itineraryBuilder', icon: 'map' },
  { to: '/staff/guide-builder', key: 'guideBuilder', icon: 'book' },
  { to: '/staff/seat-map', key: 'seatMap', icon: 'seat' },
  { to: '/staff/room-map', key: 'roomMap', icon: 'bed' },
  { to: '/staff/luggage-manager', key: 'luggageManager', icon: 'bag' },
  { to: '/staff/guest-manager', key: 'guestManager', icon: 'people' },
  { to: '/staff/expense-tracker', key: 'expenseTracker', icon: 'wallet' },
  { to: '/staff/supplier-manager', key: 'supplierManager', icon: 'briefcase' },
  { to: '/staff/location-monitor', key: 'locationMonitor', icon: 'location' },
  { to: '/staff/sos-monitor', key: 'sosMonitor', icon: 'alert' },
  { to: '/staff/bingo-host', key: 'bingoHost', icon: 'target' },
  { to: '/staff/form-builder', key: 'formBuilder', icon: 'form' },
  { to: '/staff/dietary-summary', key: 'dietarySummary', icon: 'bowl' },
  { to: '/staff/feedback-summary', key: 'feedbackSummary', icon: 'star' },
  { to: '/staff/print', key: 'printExport', icon: 'print' },
  { to: '/staff/staff-manager', key: 'staffManager', icon: 'settings' },
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

  async function endItem(item) {
    setItineraryItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: 'completed' } : it))
    )
    await supabase.from('itinerary_items').update({ status: 'completed' }).eq('id', item.id)
  }

  return (
    <div className="min-h-screen p-4">
      <div className="mx-auto max-w-md">
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

        <div className="hero-gradient mb-4 rounded-card p-5 shadow-brand">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/70">
                MyTour
              </p>
              <h1 className="text-2xl font-extrabold text-white">{t('staff.dashboard.title')}</h1>
              {staffSession?.name && (
                <p className="mt-0.5 text-sm text-white/80">{staffSession.name}</p>
              )}
            </div>
            <button
              onClick={handleLogout}
              className="rounded-pill bg-white/20 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/30"
            >
              {t('staff.dashboard.logout')}
            </button>
          </div>

          {!loading && !error && (
            <div className="mt-4 rounded-control bg-white/15 p-4 backdrop-blur">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-white/80">
                  {t('staff.dashboard.checkingInAt')}
                  {activeCheckpoint ? ` · ${activeCheckpoint.title}` : ''}
                </p>
                {checkpoints.length > 1 && (
                  <p className="text-xs text-white/60">
                    {t('staff.dashboard.checkpointStep', {
                      current: activeIndex + 1,
                      total: checkpoints.length,
                    })}
                  </p>
                )}
              </div>
              <p className="mt-0.5 text-4xl font-extrabold text-white">
                {heroCount}
                <span className="text-xl font-semibold text-white/60"> / {heroTotal}</span>
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-pill bg-white/25">
                <div
                  className="h-full rounded-pill bg-white transition-all"
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
                          isActive ? 'bg-white/25 ring-1 ring-white/40' : 'bg-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <Icon
                            name={done ? 'check' : isActive ? 'location' : 'compass'}
                            size={12}
                            color={done ? '#5DCAA5' : isActive ? '#fff' : 'rgba(255,255,255,0.6)'}
                          />
                          <span className="truncate text-[10px] text-white/75">{cp.title}</span>
                        </div>
                        <p className="mt-0.5 text-xs font-semibold text-white">
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
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-control bg-white py-3 text-base font-semibold text-brand"
              >
                <Icon name="ticket" size={20} />
                {t('staff.dashboard.scanCheckIn')}
              </button>
            </div>
          )}
        </div>

        {loading && <p className="text-ink-muted">{t('common.loading')}</p>}
        {error && <p className="text-danger">{error}</p>}

        {!loading && !error && (
          <div className="mb-4 grid grid-cols-2 gap-3">
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
        )}

        {!loading && !error && todayItems.length > 0 && (
          <Card className="mb-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">{t('staff.dashboard.todaySchedule')}</p>
              <Link to="/staff/itinerary-builder" className="text-xs font-semibold text-brand">
                {t('staff.dashboard.viewAll')}
              </Link>
            </div>
            <div className="flex flex-col gap-3">
              {todayItems.map((item) => {
                const isCurrent = item.status === 'current'
                const isDone = item.status === 'completed'
                return (
                  <div key={item.id} className="flex items-center gap-2.5">
                    <span className="w-11 shrink-0 text-xs font-medium text-ink-faint">
                      {formatTime(item.scheduled_time)}
                    </span>
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        isCurrent
                          ? 'bg-brand ring-4 ring-brand-light'
                          : isDone
                            ? 'bg-ink-faint'
                            : 'bg-ink-faint/40'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${
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
                        <p className={`truncate text-xs text-ink-faint ${isDone ? 'line-through' : ''}`}>
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

        {!loading && !error && missingGuests.length > 0 && (
          <Card className="mb-4">
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

        <Link
          to="/staff/broadcast"
          className="mb-4 flex items-center justify-center gap-2 rounded-control bg-surface py-3 text-sm font-semibold text-ink shadow-card ring-1 ring-black/[0.02]"
        >
          <Icon name="megaphone" size={18} />
          {t('staff.dashboard.broadcast')}
        </Link>

        <div className="grid grid-cols-2 gap-3">
          {LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="group relative">
              {link.key === 'sosMonitor' && openSosCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white shadow-sm">
                  {openSosCount}
                </span>
              )}
              <Card hover className="flex h-full flex-col gap-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-control bg-brand-lighter text-brand">
                  <Icon name={link.icon} size={21} />
                </span>
                <span className="text-sm font-semibold leading-tight text-ink">
                  {t(`staff.${link.key}.title`)}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
