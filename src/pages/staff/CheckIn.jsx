import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { supabase } from '../../lib/supabase'
import { ACTIVE_TOUR_ID } from '../../lib/constants'
import { findFieldByPurpose, buildResponsesByGuestId, resolveGuestPhone } from '../../lib/guestFields'
import { saveCache, loadCache } from '../../lib/offlineCache'
import { enqueue, getQueue, removeFromQueue } from '../../lib/offlineQueue'
import { genderTextClass } from '../../lib/genderColor'
import Card from '../../components/common/Card'
import Button from '../../components/common/Button'
import BottomSheet from '../../components/common/BottomSheet'
import QrScanner from '../../components/common/QrScanner'

const FILTERS = ['all', 'arrived', 'not_arrived']
const CACHE_KEY = 'checkin_guests'

export default function CheckIn() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const [guests, setGuests] = useState([])
  const [fields, setFields] = useState([])
  const [responses, setResponses] = useState([])
  const [buses, setBuses] = useState([])
  const [busSeats, setBusSeats] = useState([])
  const [staffGuestIds, setStaffGuestIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [usingCache, setUsingCache] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  )
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [busFilter, setBusFilter] = useState('all')
  const [togglingId, setTogglingId] = useState(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanFeedback, setScanFeedback] = useState(null) // { type: 'success' | 'error' | 'duplicate', name }

  // เช็คชื่อหลาย event ผูกกับแผนการเดินทาง — event แรก (is_core) คือเช็คอินจุดนัดพบเดิม
  // ยังใช้ guests.check_in_status + offline queue เหมือนเดิมทุกประการ ส่วน event อื่นๆ (สร้างใหม่
  // ผูกกับจุดหมายในแผนการเดินทาง หรือกำหนดเอง) ใช้ตาราง checkin_records แยกต่างหาก — ไม่รองรับ
  // โหมดออฟไลน์ (ต้องมีเน็ตตอนเช็ค) เพื่อจำกัดขอบเขตงานให้จัดการได้
  const [events, setEvents] = useState([])
  const [itineraryItems, setItineraryItems] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [eventRecords, setEventRecords] = useState([])
  const [eventPickerOpen, setEventPickerOpen] = useState(false)
  const [createEventOpen, setCreateEventOpen] = useState(false)
  const [createEventTab, setCreateEventTab] = useState('itinerary') // 'itinerary' | 'custom'
  const [selectedItineraryItemId, setSelectedItineraryItemId] = useState('')
  const [newEventTitle, setNewEventTitle] = useState('')
  const [creatingEvent, setCreatingEvent] = useState(false)

  // เปิดกล้องสแกนอัตโนมัติเมื่อมาจากปุ่มลัดบนแดชบอร์ด (?scan=1)
  useEffect(() => {
    if (searchParams.get('scan') === '1') {
      setScanFeedback(null)
      setScannerOpen(true)
      searchParams.delete('scan')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refreshPendingCount() {
    setPendingCount(getQueue().filter((a) => a.type === 'checkin').length)
  }

  async function flushQueue() {
    const queue = getQueue().filter((a) => a.type === 'checkin')
    for (const action of queue) {
      const { error } = await supabase
        .from('guests')
        .update({ check_in_status: action.status, check_in_time: action.checkInTime })
        .eq('id', action.guestId)

      if (!error) {
        removeFromQueue(action.id)
      }
    }
    refreshPendingCount()
  }

  useEffect(() => {
    let isMounted = true

    async function loadGuests() {
      setLoading(true)
      setLoadError(null)

      const [guestsRes, fieldsRes, busesRes, busSeatsRes, staffRes] = await Promise.all([
        supabase
          .from('guests')
          .select('id, name, nickname, gender, phone, qr_token, check_in_status, check_in_time')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .order('name', { ascending: true }),
        supabase
          .from('form_fields')
          .select('id, field_key, field_purpose, is_core')
          .eq('tour_id', ACTIVE_TOUR_ID),
        supabase.from('buses').select('id, name').eq('tour_id', ACTIVE_TOUR_ID).order('name'),
        supabase
          .from('bus_seats')
          .select('bus_id, guest_id')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .not('guest_id', 'is', null),
        supabase
          .from('staff')
          .select('id, guest_id')
          .eq('tour_id', ACTIVE_TOUR_ID)
          .not('guest_id', 'is', null),
      ])

      if (!isMounted) return

      if (guestsRes.error || fieldsRes.error || busesRes.error || busSeatsRes.error) {
        console.error(
          '[CheckIn] load failed — falling back to offline cache',
          guestsRes.error,
          fieldsRes.error,
          busesRes.error,
          busSeatsRes.error
        )
        const cached = loadCache(CACHE_KEY)
        if (cached) {
          setGuests(cached.guests ?? [])
          setFields(cached.fields ?? [])
          setBuses(cached.buses ?? [])
          setBusSeats(cached.busSeats ?? [])
          setStaffGuestIds(cached.staffGuestIds ?? [])
          setUsingCache(true)
        } else {
          setLoadError(t('staff.checkIn.loadError'))
        }
        setLoading(false)
        return
      }

      setGuests(guestsRes.data ?? [])
      setFields(fieldsRes.data ?? [])
      setBuses(busesRes.data ?? [])
      setBusSeats(busSeatsRes.data ?? [])
      setStaffGuestIds(staffRes.error ? [] : (staffRes.data ?? []).map((s) => s.guest_id))
      setUsingCache(false)

      let responsesData = []
      const phoneField = findFieldByPurpose(fieldsRes.data ?? [], 'phone')
      if (phoneField && !phoneField.is_core) {
        const { data, error: responsesError } = await supabase
          .from('guest_form_responses')
          .select('guest_id, field_id, value')
          .eq('field_id', phoneField.id)

        if (!responsesError && isMounted) {
          responsesData = data ?? []
          setResponses(responsesData)
        }
      }

      saveCache(CACHE_KEY, {
        guests: guestsRes.data ?? [],
        fields: fieldsRes.data ?? [],
        buses: busesRes.data ?? [],
        busSeats: busSeatsRes.data ?? [],
        staffGuestIds: staffRes.error ? [] : (staffRes.data ?? []).map((s) => s.guest_id),
        responses: responsesData,
      })

      setLoading(false)
    }

    loadGuests()
    refreshPendingCount()
    flushQueue()

    // Realtime: sync check-in status if another staff member checks someone in
    const channel = supabase
      .channel(`checkin-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'guests',
          filter: `tour_id=eq.${ACTIVE_TOUR_ID}`,
        },
        (payload) => {
          setGuests((prev) =>
            prev.map((g) => (g.id === payload.new.id ? { ...g, ...payload.new } : g))
          )
        }
      )
      .subscribe()

    function handleOnline() {
      setIsOnline(true)
      loadGuests()
      flushQueue()
    }
    function handleOffline() {
      setIsOnline(false)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // กันเคสที่ browser ไม่ยิง online/offline event แม่นยำ — ลองรีเฟรชคิวเป็นระยะ
    const retryInterval = setInterval(() => {
      if (navigator.onLine) flushQueue()
    }, 15000)

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(retryInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t])

  async function loadEvents() {
    const [eventsRes, itemsRes] = await Promise.all([
      supabase
        .from('checkin_events')
        .select('id, title, is_core, itinerary_item_id, sort_order')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('sort_order', { ascending: true }),
      supabase
        .from('itinerary_items')
        .select('id, day_number, scheduled_time, title, location_name')
        .eq('tour_id', ACTIVE_TOUR_ID)
        .order('day_number', { ascending: true })
        .order('sort_order', { ascending: true }),
    ])

    if (eventsRes.data) {
      setEvents(eventsRes.data)
      setSelectedEventId((prev) => prev ?? eventsRes.data.find((ev) => ev.is_core)?.id ?? eventsRes.data[0]?.id ?? null)
    }
    if (itemsRes.data) setItineraryItems(itemsRes.data)
  }

  useEffect(() => {
    loadEvents()

    const channel = supabase
      .channel(`checkin-events-${ACTIVE_TOUR_ID}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checkin_events', filter: `tour_id=eq.${ACTIVE_TOUR_ID}` },
        () => loadEvents()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedEvent = useMemo(
    () => events.find((ev) => ev.id === selectedEventId) ?? null,
    [events, selectedEventId]
  )
  // ก่อนโหลด events เสร็จ ถือว่าเป็น core event ไปก่อน (พฤติกรรมเดิมทุกประการ ไม่กระทบของเก่า)
  const isCoreEvent = selectedEvent ? selectedEvent.is_core : true

  // โหลด/subscribe checkin_records เฉพาะตอนเลือก event ที่ไม่ใช่ core
  useEffect(() => {
    if (!selectedEventId || isCoreEvent) {
      setEventRecords([])
      return
    }

    let isMounted = true

    async function loadRecords() {
      const { data, error } = await supabase
        .from('checkin_records')
        .select('id, guest_id, checked_in_at')
        .eq('event_id', selectedEventId)

      if (isMounted && !error) setEventRecords(data ?? [])
    }

    loadRecords()

    const channel = supabase
      .channel(`checkin-records-${selectedEventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'checkin_records', filter: `event_id=eq.${selectedEventId}` },
        () => loadRecords()
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [selectedEventId, isCoreEvent])

  const checkedInGuestIds = useMemo(
    () => new Set(eventRecords.map((r) => r.guest_id)),
    [eventRecords]
  )

  function isCheckedIn(guest) {
    return isCoreEvent ? !!guest.check_in_status : checkedInGuestIds.has(guest.id)
  }

  async function toggleEventRecord(guest) {
    setTogglingId(guest.id)
    const currentlyIn = checkedInGuestIds.has(guest.id)

    if (currentlyIn) {
      setEventRecords((prev) => prev.filter((r) => r.guest_id !== guest.id))
      const { error } = await supabase
        .from('checkin_records')
        .delete()
        .eq('event_id', selectedEventId)
        .eq('guest_id', guest.id)
      if (error) console.error('[CheckIn] remove event record failed', error)
    } else {
      const tempRecord = { id: `temp-${guest.id}`, guest_id: guest.id, checked_in_at: new Date().toISOString() }
      setEventRecords((prev) => [...prev, tempRecord])
      const { error } = await supabase
        .from('checkin_records')
        .insert({ event_id: selectedEventId, guest_id: guest.id })
      if (error) {
        console.error('[CheckIn] add event record failed', error)
        setEventRecords((prev) => prev.filter((r) => r.id !== tempRecord.id))
      }
    }
    setTogglingId(null)
  }

  async function handleToggle(guest) {
    if (isCoreEvent) {
      await toggleCheckIn(guest)
    } else {
      await toggleEventRecord(guest)
    }
  }

  async function handleCreateEvent(e) {
    e.preventDefault()

    let title = newEventTitle.trim()
    const itineraryItemId = createEventTab === 'itinerary' ? selectedItineraryItemId || null : null

    if (createEventTab === 'itinerary' && !itineraryItemId) return
    if (!title) return

    setCreatingEvent(true)
    const maxSort = events.reduce((max, ev) => Math.max(max, ev.sort_order), 0)

    const { data, error } = await supabase
      .from('checkin_events')
      .insert({
        tour_id: ACTIVE_TOUR_ID,
        itinerary_item_id: itineraryItemId,
        title,
        is_core: false,
        sort_order: maxSort + 1,
      })
      .select('id, title, is_core, itinerary_item_id, sort_order')
      .single()

    if (!error && data) {
      setEvents((prev) => [...prev, data])
      setSelectedEventId(data.id)
      setNewEventTitle('')
      setSelectedItineraryItemId('')
      setCreateEventTab('itinerary')
      setCreateEventOpen(false)
      setEventPickerOpen(false)
    } else {
      console.error('[CheckIn] create event failed', error)
    }
    setCreatingEvent(false)
  }

  function pickItineraryItem(item) {
    setSelectedItineraryItemId(item.id)
    setNewEventTitle(item.location_name || item.title)
  }

  function itineraryItemLabel(item) {
    const time = item.scheduled_time ? item.scheduled_time.slice(0, 5) : ''
    const place = item.location_name ? ` — ${item.location_name}` : ''
    return `${t('staff.checkIn.dayLabel', { day: item.day_number })}${time ? ' · ' + time : ''} · ${item.title}${place}`
  }

  async function toggleCheckIn(guest) {
    setTogglingId(guest.id)
    const nextStatus = !guest.check_in_status
    const checkInTime = nextStatus ? new Date().toISOString() : null

    // Optimistic update — ติ๊กได้ทันทีไม่ว่าจะออนไลน์หรือไม่
    setGuests((prev) =>
      prev.map((g) =>
        g.id === guest.id ? { ...g, check_in_status: nextStatus, check_in_time: checkInTime } : g
      )
    )

    if (!navigator.onLine) {
      enqueue({ type: 'checkin', guestId: guest.id, status: nextStatus, checkInTime })
      refreshPendingCount()
      setTogglingId(null)
      return
    }

    const { error } = await supabase
      .from('guests')
      .update({ check_in_status: nextStatus, check_in_time: checkInTime })
      .eq('id', guest.id)

    if (error) {
      console.error('[CheckIn] toggle failed — queued for retry', error)
      enqueue({ type: 'checkin', guestId: guest.id, status: nextStatus, checkInTime })
      refreshPendingCount()
    }
    setTogglingId(null)
  }

  async function handleScan(decodedText) {
    setScannerOpen(false)

    const guest = guests.find((g) => g.qr_token === decodedText)
    if (!guest) {
      setScanFeedback({ type: 'error' })
      return
    }

    if (isCheckedIn(guest)) {
      setScanFeedback({ type: 'duplicate', name: guest.nickname || guest.name })
      return
    }

    await handleToggle(guest)
    setScanFeedback({ type: 'success', name: guest.nickname || guest.name })
  }

  function handleScanError(err) {
    setScannerOpen(false)
    console.error('[CheckIn] camera error', err)
    setScanFeedback({ type: 'camera_error' })
  }

  const guestBusId = useMemo(() => {
    const map = {}
    for (const s of busSeats) map[s.guest_id] = s.bus_id
    return map
  }, [busSeats])

  const staffGuestIdSet = useMemo(() => new Set(staffGuestIds), [staffGuestIds])

  const filteredGuests = useMemo(() => {
    const q = search.trim().toLowerCase()
    return guests.filter((g) => {
      const matchesSearch =
        !q ||
        g.name?.toLowerCase().includes(q) ||
        g.nickname?.toLowerCase().includes(q)

      const checkedIn = isCheckedIn(g)
      const matchesFilter =
        filter === 'all' ||
        (filter === 'arrived' && checkedIn) ||
        (filter === 'not_arrived' && !checkedIn)

      const matchesBus = busFilter === 'all' || guestBusId[g.id] === busFilter

      return matchesSearch && matchesFilter && matchesBus
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guests, search, filter, busFilter, guestBusId, isCoreEvent, checkedInGuestIds])

  const checkedInCount = isCoreEvent
    ? guests.filter((g) => g.check_in_status).length
    : checkedInGuestIds.size

  const phoneField = useMemo(() => findFieldByPurpose(fields, 'phone'), [fields])
  const responsesByGuestId = useMemo(() => buildResponsesByGuestId(responses), [responses])

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold text-gray-900">{t('staff.checkIn.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {t('staff.checkIn.summary', { checkedIn: checkedInCount, total: guests.length })}
        </p>

        <button
          onClick={() => setEventPickerOpen(true)}
          className="mt-2 flex w-full items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-left"
        >
          <span className="min-w-0 truncate text-sm font-semibold text-sky-800">
            📍 {selectedEvent ? selectedEvent.title : t('common.loading')}
          </span>
          <span className="shrink-0 text-xs font-medium text-sky-600">{t('staff.checkIn.changeEvent')}</span>
        </button>

        {!isCoreEvent && (
          <p className="mt-1 text-xs text-amber-700">{t('staff.checkIn.eventOfflineNotice')}</p>
        )}

        {(!isOnline || usingCache || pendingCount > 0) && (
          <div className="mt-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-800">
            {!isOnline && <p>{t('staff.checkIn.offline')}</p>}
            {usingCache && <p>{t('staff.checkIn.usingCache')}</p>}
            {pendingCount > 0 && <p>{t('staff.checkIn.pendingSync', { count: pendingCount })}</p>}
          </div>
        )}

        {scanFeedback && (
          <div
            className={`mt-2 rounded-xl px-3 py-2 text-sm font-medium ${
              scanFeedback.type === 'success'
                ? 'bg-green-100 text-green-800'
                : scanFeedback.type === 'duplicate'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-red-100 text-red-700'
            }`}
          >
            {scanFeedback.type === 'success' &&
              t('staff.checkIn.scanSuccess', { name: scanFeedback.name })}
            {scanFeedback.type === 'duplicate' &&
              t('staff.checkIn.scanDuplicate', { name: scanFeedback.name })}
            {scanFeedback.type === 'error' && t('staff.checkIn.scanNotFound')}
            {scanFeedback.type === 'camera_error' && t('staff.checkIn.scanCameraError')}
            <button
              onClick={() => setScanFeedback(null)}
              className="ml-2 font-bold underline"
            >
              {t('common.close')}
            </button>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder={t('staff.checkIn.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
          <button
            onClick={() => {
              setScanFeedback(null)
              setScannerOpen(true)
            }}
            className="shrink-0 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            {t('staff.checkIn.scanQr')}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                filter === f
                  ? 'bg-sky-600 text-white'
                  : 'bg-gray-100 text-gray-700'
              }`}
            >
              {f === 'all' && t('staff.checkIn.filterAll')}
              {f === 'arrived' && t('staff.checkIn.filterArrived')}
              {f === 'not_arrived' && t('staff.checkIn.filterNotArrived')}
            </button>
          ))}
        </div>

        {buses.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => setBusFilter('all')}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                busFilter === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {t('staff.checkIn.allBuses')}
            </button>
            {buses.map((bus) => (
              <button
                key={bus.id}
                onClick={() => setBusFilter(bus.id)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  busFilter === bus.id ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {bus.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {loading && <p className="text-gray-500">{t('common.loading')}</p>}
          {loadError && <p className="text-red-500">{loadError}</p>}
          {!loading && !loadError && filteredGuests.length === 0 && (
            <p className="text-gray-500">{t('staff.checkIn.noResults')}</p>
          )}

          {filteredGuests.map((guest) => {
            const phone = resolveGuestPhone(guest, phoneField, responsesByGuestId)
            const checkedIn = isCheckedIn(guest)
            return (
              <Card
                key={guest.id}
                className={`flex cursor-pointer items-center justify-between border-l-4 transition ${
                  checkedIn
                    ? 'border-l-green-500 bg-green-50'
                    : 'border-l-red-400 bg-red-50'
                } ${togglingId === guest.id ? 'opacity-60' : ''}`}
                onClick={() => handleToggle(guest)}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className={`font-medium ${genderTextClass(guest.gender) || 'text-gray-900'}`}>
                      {guest.name}
                    </p>
                    {staffGuestIdSet.has(guest.id) && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {t('staff.checkIn.staffBadge')}
                      </span>
                    )}
                  </div>
                  {guest.nickname && (
                    <p className="text-sm text-gray-500">{guest.nickname}</p>
                  )}
                  {phone && (
                    <a
                      href={`tel:${phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 inline-block text-sm font-medium text-sky-600"
                    >
                      {phone}
                    </a>
                  )}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    checkedIn
                      ? 'bg-green-500 text-white'
                      : 'bg-red-400 text-white'
                  }`}
                >
                  {checkedIn
                    ? t('staff.checkIn.arrived')
                    : t('staff.checkIn.notArrived')}
                </span>
              </Card>
            )
          })}
        </div>
      </div>

      <BottomSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title={t('staff.checkIn.scanQr')}
      >
        <QrScanner onScan={handleScan} onError={handleScanError} />
        <p className="mt-3 text-center text-sm text-gray-500">
          {t('staff.checkIn.scanHint')}
        </p>
        <Button variant="secondary" className="mt-3" onClick={() => setScannerOpen(false)}>
          {t('common.cancel')}
        </Button>
      </BottomSheet>

      <BottomSheet
        open={eventPickerOpen}
        onClose={() => setEventPickerOpen(false)}
        title={t('staff.checkIn.selectEvent')}
      >
        <div className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto">
          {events.map((ev) => (
            <button
              key={ev.id}
              onClick={() => {
                setSelectedEventId(ev.id)
                setEventPickerOpen(false)
              }}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition ${
                ev.id === selectedEventId
                  ? 'border-sky-400 bg-sky-50 text-sky-800'
                  : 'border-gray-200 text-gray-900 hover:bg-gray-50'
              }`}
            >
              {ev.title}
              {ev.is_core && (
                <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                  {t('staff.checkIn.coreEventTag')}
                </span>
              )}
            </button>
          ))}
        </div>

        <Button
          className="mt-3"
          onClick={() => {
            setEventPickerOpen(false)
            setCreateEventOpen(true)
          }}
        >
          {t('staff.checkIn.createEvent')}
        </Button>
        <Button variant="secondary" className="mt-2" onClick={() => setEventPickerOpen(false)}>
          {t('common.close')}
        </Button>
      </BottomSheet>

      <BottomSheet
        open={createEventOpen}
        onClose={() => setCreateEventOpen(false)}
        title={t('staff.checkIn.createEvent')}
      >
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => setCreateEventTab('itinerary')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              createEventTab === 'itinerary'
                ? 'bg-brand-gradient text-white shadow-brand'
                : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.checkIn.fromItinerary')}
          </button>
          <button
            type="button"
            onClick={() => setCreateEventTab('custom')}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold transition ${
              createEventTab === 'custom'
                ? 'bg-brand-gradient text-white shadow-brand'
                : 'bg-surface-sunken text-neutral-text'
            }`}
          >
            {t('staff.checkIn.customEvent')}
          </button>
        </div>

        <form onSubmit={handleCreateEvent} className="flex flex-col gap-3">
          {createEventTab === 'itinerary' && (
            <div className="max-h-[30vh] overflow-y-auto rounded-xl border border-gray-100">
              {itineraryItems.length === 0 && (
                <p className="p-3 text-sm text-gray-400">{t('staff.checkIn.noItineraryItems')}</p>
              )}
              {itineraryItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => pickItineraryItem(item)}
                  className={`block w-full border-b border-gray-50 px-3 py-2 text-left text-sm last:border-b-0 ${
                    selectedItineraryItemId === item.id
                      ? 'bg-sky-50 font-semibold text-sky-700'
                      : 'text-gray-900'
                  }`}
                >
                  {itineraryItemLabel(item)}
                </button>
              ))}
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {t('staff.checkIn.eventTitleLabel')}
            </span>
            <input
              type="text"
              value={newEventTitle}
              onChange={(e) => setNewEventTitle(e.target.value)}
              placeholder={t('staff.checkIn.eventTitlePlaceholder')}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
          </label>

          <Button
            type="submit"
            disabled={
              creatingEvent ||
              !newEventTitle.trim() ||
              (createEventTab === 'itinerary' && !selectedItineraryItemId)
            }
          >
            {creatingEvent ? t('common.loading') : t('staff.checkIn.createEvent')}
          </Button>
          <Button variant="secondary" type="button" onClick={() => setCreateEventOpen(false)}>
            {t('common.cancel')}
          </Button>
        </form>
      </BottomSheet>
    </div>
  )
}
